// Minimal Model Context Protocol client (stdio, Streamable HTTP, legacy HTTP+SSE, OAuth), zero dependencies.
// The daemon owns every connection: the browser only sees tool metadata and results.
import { spawn } from 'node:child_process'
import os from 'node:os'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HttpError } from './http.mjs'
import {
  AuthRequiredError,
  PendingAuthorizations,
  buildAuthorizationUrl,
  createPkce,
  discover,
  exchangeCode,
  refreshTokens,
  registerClient,
  tokenIsFresh,
} from './mcp-oauth.mjs'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Newest first. The client offers the first one and steps down when a server refuses it; whatever the
// server answers with is then used for the MCP-Protocol-Version header (older servers stay compatible).
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const PROTOCOL_VERSION = PROTOCOL_VERSIONS[0]
const CONNECT_TIMEOUT_MS = 60_000
const RECONNECT_DELAYS_MS = [400, 1000, 2500, 5000, 10_000, 20_000, 30_000]
/** How long a tool call waits for a reconnect that is already under way. */
const RECONNECT_WAIT_MS = 20_000
/** Debounce for list_changed bursts: servers often fire several notifications in a row. */
const REFRESH_DEBOUNCE_MS = 30

const CLIENT_VERSION = (() => {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    return String(JSON.parse(raw).version || '3.2.3')
  } catch {
    return '3.2.3'
  }
})()
const REQUEST_TIMEOUT_MS = 120_000
const MAX_RESULT_CHARS = 200_000
const MASK = '••••••••'

let requestCounter = 0

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

class RpcError extends Error {
  constructor(error) {
    super(error?.message || 'MCP request failed.')
    this.code = error?.code
  }
}

class HttpStatusError extends Error {
  constructor(status, text) {
    super(`MCP server answered ${status}${text ? `: ${String(text).slice(0, 200)}` : ''}`)
    this.status = status
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Reply to a request the server sent us: ping and roots/list are answered, the rest politely refused. */
function serverRequestReply(message, roots) {
  if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} }
  if (message.method === 'roots/list' && typeof roots === 'function') {
    return { jsonrpc: '2.0', id: message.id, result: { roots: roots() } }
  }
  return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported by OpenSol.' } }
}

/** Newline-delimited JSON-RPC over a child process. */
class StdioTransport {
  constructor(config, { onNotification, cwd, roots }) {
    this.config = config
    this.onNotification = onNotification
    this.roots = roots
    this.cwd = cwd
    this.pending = new Map()
    this.buffer = ''
    this.stderr = ''
    this.closed = false
  }

  async start() {
    const win = process.platform === 'win32'
    const env = { ...process.env, ...(this.config.env ?? {}) }
    this.child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.cwd,
      env,
      shell: win,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this.#onData(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-4000)
    })
    this.child.stdin.on('error', () => undefined)
    await new Promise((resolve, reject) => {
      this.child.once('spawn', resolve)
      this.child.once('error', (error) => {
        const failure = new Error(`Could not start "${this.config.command}": ${error.message}`)
        failure.permanent = true
        reject(failure)
      })
    })
    this.child.on('exit', (code) => {
      this.closed = true
      const detail = this.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300)
      const error = new Error(`The MCP server exited (code ${code ?? 'signal'}).${detail ? ` ${detail}` : ''}`)
      for (const entry of this.pending.values()) entry.reject(error)
      this.pending.clear()
      this.onExit?.(error)
    })
  }

  #onData(chunk) {
    this.buffer += chunk
    let index
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      this.#dispatch(message)
    }
  }

  #dispatch(message) {
    if (message && message.id !== undefined && (message.result !== undefined || message.error)) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new RpcError(message.error))
      else entry.resolve(message.result)
      return
    }
    if (message?.method && message.id !== undefined) {
      try {
        this.#write(serverRequestReply(message, this.roots))
      } catch {
        // The process is already gone.
      }
      return
    }
    if (message?.method) this.onNotification?.(message.method, message.params)
  }

  #write(message) {
    if (this.closed || !this.child?.stdin?.writable) throw new Error('The MCP server is not running.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = ++requestCounter
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.#write({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
    return withTimeout(promise, timeoutMs, method).catch((error) => {
      this.pending.delete(id)
      throw error
    })
  }

  notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params })
  }

  async close() {
    this.closed = true
    const child = this.child
    if (!child || child.exitCode !== null) return
    try {
      child.stdin.end()
    } catch {
      // Already closed.
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 1500)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }
}

async function readSse(response, wantedId, onMessage) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data) continue
      let message
      try {
        message = JSON.parse(data)
      } catch {
        continue
      }
      if (message.id === wantedId && (message.result !== undefined || message.error)) {
        reader.cancel().catch(() => undefined)
        if (message.error) throw new RpcError(message.error)
        return message.result
      }
      // Anything else on this stream (progress, list_changed, server requests) is not ours to drop.
      onMessage?.(message)
    }
  }
  throw new Error('The MCP server closed the stream without answering.')
}

/** Parses a text/event-stream response into { event, data } records. */
async function* sseEvents(response, signal) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      if (signal?.aborted) return
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
        let event = 'message'
        const data = []
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        }
        if (data.length) yield { event, data: data.join('\n') }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
}

function checkRemoteUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('The MCP server URL is not valid.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('MCP servers must use http or https.')
  return parsed
}

/** Request headers for a remote server: OAuth bearer first, then user-defined headers. */
async function remoteHeaders(config, auth, extra) {
  const bearer = auth ? await auth.header() : ''
  return {
    ...extra,
    ...(bearer ? { Authorization: bearer } : {}),
    ...(config.headers ?? {}),
  }
}

/**
 * fetch() with OAuth handling: a 401 triggers one token refresh and retry, then
 * surfaces AuthRequiredError so the manager can ask the person to sign in.
 */
async function authedFetch(url, build, auth) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, await build())
    if (response.status !== 401) return response
    const challenge = response.headers.get('www-authenticate') ?? ''
    await response.body?.cancel().catch(() => undefined)
    if (auth && attempt === 0 && (await auth.refresh())) continue
    throw new AuthRequiredError(challenge)
  }
}

/** Streamable HTTP transport: one POST per message, JSON or SSE replies, optional standalone GET stream. */
class HttpTransport {
  constructor(config, { auth, onNotification, roots } = {}) {
    this.config = config
    this.auth = auth
    this.onNotification = onNotification
    this.roots = roots
    this.sessionId = ''
    this.protocolVersion = ''
    this.closed = false
    this.listening = false
    this.listenController = null
  }

  async start() {
    checkRemoteUrl(this.config.url)
  }

  #headers({ stream = false } = {}) {
    return remoteHeaders(this.config, this.auth, {
      ...(stream ? { Accept: 'text/event-stream' } : { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }),
      ...(this.protocolVersion ? { 'MCP-Protocol-Version': this.protocolVersion } : {}),
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
    })
  }

  /** Notifications and requests the server pushes on any stream of this session. */
  #incoming(message) {
    if (message?.method && message.id !== undefined) {
      void this.#post(serverRequestReply(message, this.roots)).catch(() => undefined)
    } else if (message?.method) {
      this.onNotification?.(message.method, message.params)
    }
  }

  async #post(message) {
    const response = await authedFetch(
      this.config.url,
      async () => ({
        method: 'POST',
        headers: await this.#headers(),
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(15_000),
      }),
      this.auth,
    )
    await response.body?.cancel().catch(() => undefined)
  }

  async request(method, params, timeoutMs = REQUEST_TIMEOUT_MS, retried = false) {
    const id = ++requestCounter
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await authedFetch(
        this.config.url,
        async () => ({
          method: 'POST',
          headers: await this.#headers(),
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          signal: controller.signal,
        }),
        this.auth,
      )
      const session = response.headers.get('mcp-session-id')
      if (session) this.sessionId = session
      // The server forgot our session (restart, expiry): open a new one and repeat the request once.
      if (response.status === 404 && this.sessionId && method !== 'initialize' && !retried && this.reinit) {
        await response.body?.cancel().catch(() => undefined)
        clearTimeout(timer)
        await this.reinit()
        return this.request(method, params, timeoutMs, true)
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new HttpStatusError(response.status, text)
      }
      const type = response.headers.get('content-type') ?? ''
      if (type.includes('text/event-stream')) return await readSse(response, id, (message) => this.#incoming(message))
      const raw = await response.text()
      if (!raw.trim()) throw new Error('The MCP server answered with an empty body.')
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error(`The MCP server answered with something that is not JSON (${type || 'no content type'}).`)
      }
      // Batch replies: pick our answer, hand the rest to the notification path.
      const messages = Array.isArray(parsed) ? parsed : [parsed]
      let answer
      for (const message of messages) {
        if (message?.id === id && (message.result !== undefined || message.error)) answer = message
        else this.#incoming(message)
      }
      if (!answer) throw new Error('The MCP server did not answer the request.')
      if (answer.error) throw new RpcError(answer.error)
      return answer.result
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s.`)
      if (isConnectionLost(error) && !(error instanceof RpcError) && !(error instanceof HttpStatusError)) this.onLost?.(error)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async notify(method, params) {
    await this.#post({ jsonrpc: '2.0', method, params })
  }

  /**
   * Optional GET stream (spec 2025-03-26+): servers push list_changed here between requests.
   * Servers without it answer 405/404, which ends the attempt quietly for good.
   */
  startListening() {
    if (this.closed || this.listening) return
    this.listening = true
    void this.#listen().finally(() => {
      this.listening = false
    })
  }

  async #listen() {
    let failures = 0
    while (!this.closed) {
      const controller = new AbortController()
      this.listenController = controller
      const started = Date.now()
      try {
        const response = await authedFetch(
          this.config.url,
          async () => ({ method: 'GET', headers: await this.#headers({ stream: true }), signal: controller.signal }),
          this.auth,
        )
        const type = response.headers.get('content-type') ?? ''
        if (!response.ok || !response.body || !type.includes('text/event-stream')) {
          await response.body?.cancel().catch(() => undefined)
          if ([400, 404, 405, 406, 501].includes(response.status) || response.ok) return
          if (++failures > 3) return
          await sleep(1500 * failures)
          continue
        }
        for await (const { data } of sseEvents(response, controller.signal)) {
          let message
          try {
            message = JSON.parse(data)
          } catch {
            continue
          }
          this.#incoming(message)
        }
        failures = Date.now() - started < 2000 ? failures + 1 : 0
        if (failures > 5) return
        await sleep(400)
      } catch (error) {
        if (this.closed || error instanceof AuthRequiredError) return
        if (++failures > 5) return
        await sleep(Math.min(1000 * failures * failures, 15_000))
      }
    }
  }

  async close() {
    this.closed = true
    this.listenController?.abort()
    if (!this.sessionId) return
    await fetch(this.config.url, {
      method: 'DELETE',
      headers: await this.#headers(),
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined)
  }
}

/**
 * Legacy HTTP+SSE transport (protocol 2024-11-05): a long-lived GET stream carries every
 * server message; the first `endpoint` event names the URL that requests are POSTed to.
 */
class SseTransport {
  constructor(config, { auth, onNotification, roots } = {}) {
    this.config = config
    this.auth = auth
    this.onNotification = onNotification
    this.roots = roots
    this.pending = new Map()
    this.closed = false
    this.controller = new AbortController()
  }

  async start() {
    const base = checkRemoteUrl(this.config.url)
    const response = await authedFetch(
      this.config.url,
      async () => ({
        method: 'GET',
        headers: await remoteHeaders(this.config, this.auth, { Accept: 'text/event-stream' }),
        signal: this.controller.signal,
      }),
      this.auth,
    )
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      throw new HttpStatusError(response.status, text)
    }
    // A JSON answer to the GET means this URL is a Streamable HTTP endpoint, not a legacy SSE one.
    if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      await response.body.cancel().catch(() => undefined)
      throw new HttpStatusError(406, 'the URL did not open an event stream')
    }
    const endpoint = new Promise((resolve, reject) => {
      this.resolveEndpoint = resolve
      this.rejectEndpoint = reject
    })
    void this.#pump(response, base)
    await withTimeout(endpoint, 30_000, 'SSE endpoint handshake')
  }

  async #pump(response, base) {
    let failure = new Error('The MCP server closed the SSE stream.')
    try {
      for await (const { event, data } of sseEvents(response, this.controller.signal)) {
        if (event === 'endpoint') {
          const target = new URL(data.trim(), base)
          if (target.origin !== base.origin) throw new Error('The SSE server pointed to a different host; refusing to follow it.')
          this.endpoint = target.toString()
          this.resolveEndpoint?.()
          continue
        }
        let message
        try {
          message = JSON.parse(data)
        } catch {
          continue
        }
        this.#dispatch(message)
      }
    } catch (error) {
      if (!this.controller.signal.aborted) failure = error instanceof Error ? error : failure
    }
    const wasClosed = this.closed
    this.closed = true
    this.rejectEndpoint?.(failure)
    for (const entry of this.pending.values()) entry.reject(failure)
    this.pending.clear()
    if (!wasClosed) this.onExit?.(failure)
  }

  #dispatch(message) {
    if (message && message.id !== undefined && (message.result !== undefined || message.error)) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new RpcError(message.error))
      else entry.resolve(message.result)
      return
    }
    if (message?.method && message.id !== undefined) {
      void this.#post(serverRequestReply(message, this.roots)).catch(() => undefined)
      return
    }
    if (message?.method) this.onNotification?.(message.method, message.params)
  }

  async #post(message) {
    if (this.closed || !this.endpoint) throw new Error('The MCP server is not connected.')
    const response = await authedFetch(
      this.endpoint,
      async () => ({
        method: 'POST',
        headers: await remoteHeaders(this.config, this.auth, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(30_000),
      }),
      this.auth,
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new HttpStatusError(response.status, text)
    }
    await response.body?.cancel().catch(() => undefined)
  }

  request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = ++requestCounter
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.#post({ jsonrpc: '2.0', id, method, params }).catch((error) => {
        this.pending.delete(id)
        reject(error)
      })
    })
    return withTimeout(promise, timeoutMs, method).catch((error) => {
      this.pending.delete(id)
      throw error
    })
  }

  notify(method, params) {
    return this.#post({ jsonrpc: '2.0', method, params })
  }

  async close() {
    this.closed = true
    this.controller.abort()
  }
}

function slug(value, max) {
  return (
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, max) || 'x'
  )
}

/** Tool names must satisfy provider limits: ^[a-zA-Z0-9_-]{1,64}$. */
export function functionName(serverId, toolName) {
  const prefix = `mcp__${slug(serverId, 18)}__`
  const tool = String(toolName).replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${prefix}${tool}`.slice(0, 64)
}

function flattenContent(result) {
  const parts = Array.isArray(result?.content) ? result.content : []
  const lines = []
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    if (part.type === 'text' && typeof part.text === 'string') lines.push(part.text)
    else if (part.type === 'image') lines.push(`[image ${part.mimeType ?? ''} omitted]`)
    else if (part.type === 'audio') lines.push(`[audio ${part.mimeType ?? ''} omitted]`)
    else if (part.type === 'resource' && part.resource) {
      lines.push(typeof part.resource.text === 'string' ? part.resource.text : `[resource ${part.resource.uri ?? ''}]`)
    } else if (part.type === 'resource_link') lines.push(`[resource ${part.uri ?? ''}]`)
  }
  if (lines.length === 0 && result?.structuredContent !== undefined) {
    lines.push(JSON.stringify(result.structuredContent, null, 2))
  }
  const text = lines.join('\n')
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… truncated` : text
}

function maskRecord(record) {
  const out = {}
  for (const key of Object.keys(record ?? {})) out[key] = MASK
  return out
}

export function sanitizeServerConfig(input, existing) {
  const raw = input && typeof input === 'object' ? input : {}
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : ''
  if (!name) throw new HttpError(400, 'Give each MCP server a name.', 'bad_mcp')
  const transport = raw.transport === 'http' || raw.transport === 'sse' ? raw.transport : 'stdio'
  const id =
    typeof raw.id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(raw.id)
      ? raw.id
      : slug(name, 30).replace(/_/g, '-') || 'server'

  const keepSecret = (incoming, previous) => {
    const out = {}
    if (!incoming || typeof incoming !== 'object') return out
    for (const [key, value] of Object.entries(incoming)) {
      if (typeof value !== 'string' || key.length > 120) continue
      out[key] = value === MASK ? previous?.[key] ?? '' : value.slice(0, 4000)
    }
    return out
  }

  const config = {
    id,
    name,
    transport,
    enabled: raw.enabled !== false,
    approval: raw.approval === 'auto' ? 'auto' : 'ask',
    disabledTools: Array.isArray(raw.disabledTools)
      ? raw.disabledTools.filter((item) => typeof item === 'string').slice(0, 200)
      : [],
  }
  if (transport === 'stdio') {
    const command = typeof raw.command === 'string' ? raw.command.trim().slice(0, 500) : ''
    if (!command) throw new HttpError(400, `"${name}" needs a command to start.`, 'bad_mcp')
    config.command = command
    config.args = Array.isArray(raw.args)
      ? raw.args.filter((item) => typeof item === 'string').map((item) => item.slice(0, 1000)).slice(0, 60)
      : []
    const env = keepSecret(raw.env, existing?.env)
    for (const key of Object.keys(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) delete env[key]
    }
    config.env = env
  } else {
    const url = typeof raw.url === 'string' ? raw.url.trim().slice(0, 1000) : ''
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, `"${name}" needs an http(s) URL.`, 'bad_mcp')
    config.url = url
    const headers = keepSecret(raw.headers, existing?.headers)
    for (const key of Object.keys(headers)) {
      if (!/^[A-Za-z0-9-]{1,80}$/.test(key)) delete headers[key]
    }
    config.headers = headers
    const oauth = raw.oauth && typeof raw.oauth === 'object' && raw.oauth.enabled ? raw.oauth : null
    if (oauth) {
      const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
      config.oauth = {
        enabled: true,
        clientId: text(oauth.clientId, 300),
        clientSecret: oauth.clientSecret === MASK ? existing?.oauth?.clientSecret ?? '' : text(oauth.clientSecret, 600),
        scope: text(oauth.scope, 400),
      }
    }
  }
  return config
}

export class McpManager {
  constructor() {
    this.configs = new Map()
    this.runtime = new Map()
    this.getCwd = async () => os.homedir()
    this.pendingAuth = new PendingAuthorizations()
    this.refreshing = new Map()
    this.listeners = new Set()
    // OAuth client + tokens per server. The daemon swaps in the encrypted secrets file.
    const memory = new Map()
    this.authStore = {
      get: async (id) => memory.get(id) ?? null,
      set: async (id, value) => void memory.set(id, value),
      delete: async (id) => void memory.delete(id),
    }
  }

  /** Auth hooks handed to a remote transport; null when the server does not use OAuth. */
  #authHooks(config) {
    if (!config.oauth?.enabled) return null
    const id = config.id
    const refresh = () => {
      const running = this.refreshing.get(id)
      if (running) return running
      const task = (async () => {
        const entry = await this.authStore.get(id)
        if (!entry?.tokens?.refreshToken || !entry.metadata || !entry.client) return false
        try {
          const tokens = await refreshTokens({ metadata: entry.metadata, client: entry.client, tokens: entry.tokens, resource: entry.metadata.resource })
          await this.authStore.set(id, { ...entry, tokens })
          return true
        } catch (error) {
          // A rejected refresh token means the grant is gone; anything else may be transient.
          if (error?.oauthError === 'invalid_grant') await this.authStore.set(id, { ...entry, tokens: null })
          return false
        }
      })().finally(() => this.refreshing.delete(id))
      this.refreshing.set(id, task)
      return task
    }
    return {
      refresh,
      header: async () => {
        let entry = await this.authStore.get(id)
        if (!entry?.tokens) return ''
        if (!tokenIsFresh(entry.tokens)) {
          if (!(await refresh())) return ''
          entry = await this.authStore.get(id)
        }
        return entry?.tokens?.accessToken ? `Bearer ${entry.tokens.accessToken}` : ''
      },
    }
  }

  /** Step 1 of sign-in: returns the URL the person must open to approve access. */
  async startAuth(id, redirectUri) {
    const config = this.configs.get(id)
    if (!config) throw new HttpError(404, 'Unknown MCP server.', 'mcp_missing')
    if (!config.oauth?.enabled) throw new HttpError(400, 'OAuth is not turned on for this server.', 'mcp_no_oauth')
    const state = this.runtime.get(id)
    try {
      const stored = await this.authStore.get(id)
      const metadata = await discover(config.url, state?.wwwAuthenticate ?? '')
      let client
      if (config.oauth.clientId) {
        client = { clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret || '' }
      } else if (stored?.client?.redirectUri === redirectUri && stored.client.issuer === metadata.issuer) {
        client = stored.client
      } else {
        client = { ...(await registerClient(metadata, redirectUri, 'OpenSol')), redirectUri, issuer: metadata.issuer }
      }
      const { verifier, challenge } = createPkce()
      const resource = metadata.resource || config.url
      const key = this.pendingAuth.create({ id, verifier, redirectUri, metadata, client, resource })
      return {
        url: buildAuthorizationUrl({
          metadata,
          clientId: client.clientId,
          redirectUri,
          state: key,
          challenge,
          scope: config.oauth.scope,
          resource,
        }),
      }
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : 'Could not start sign-in.', 'mcp_auth_failed')
    }
  }

  /** Step 2: the authorization server redirected back with a code. */
  async finishAuth(stateKey, code) {
    const pending = this.pendingAuth.take(stateKey)
    if (!pending) throw new HttpError(400, 'This sign-in link expired or was already used. Start again from the MCP panel.', 'mcp_auth_state')
    const config = this.configs.get(pending.id)
    if (!config) throw new HttpError(404, 'That MCP server was removed.', 'mcp_missing')
    let tokens
    try {
      tokens = await exchangeCode({
        metadata: pending.metadata,
        client: pending.client,
        code,
        verifier: pending.verifier,
        redirectUri: pending.redirectUri,
        resource: pending.resource,
      })
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : 'Could not finish sign-in.', 'mcp_auth_failed')
    }
    await this.authStore.set(pending.id, { metadata: pending.metadata, client: pending.client, tokens })
    await this.connect(pending.id)
    return config
  }

  async signOut(id) {
    await this.authStore.delete(id)
    await this.disconnect(id)
    const config = this.configs.get(id)
    if (config?.enabled && config.oauth?.enabled) {
      this.runtime.set(id, { status: 'needs_auth', error: '', tools: [], authorized: false })
      this.#emitServer(id)
    }
    return config ? this.view(config) : null
  }

  async setConfigs(configs) {
    const next = new Map(configs.map((config) => [config.id, config]))
    const stale = []
    for (const [id, previous] of this.configs) {
      const config = next.get(id)
      if (!config || JSON.stringify(config) !== JSON.stringify(previous)) stale.push(id)
    }
    await Promise.all(stale.map((id) => this.#teardown(id)))
    this.configs = next
    for (const id of [...this.runtime.keys()]) if (!next.has(id)) this.runtime.delete(id)
    for (const id of stale) {
      const config = next.get(id)
      if (config) this.runtime.set(id, { status: config.enabled === false ? 'disabled' : 'disconnected', error: '', tools: [] })
    }
    this.#emit({ type: 'servers', servers: this.list() })
  }

  list() {
    return [...this.configs.values()].map((config) => this.view(config))
  }

  /** Live updates for the browser: every change of a server (status, tools, reconnect) is pushed once. */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  #emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A dead listener must never break a connection.
      }
    }
  }

  #emitServer(id) {
    const config = this.configs.get(id)
    if (config) this.#emit({ type: 'server', server: this.view(config) })
  }

  view(config) {
    const state = this.runtime.get(config.id) ?? {}
    const base = {
      id: config.id,
      name: config.name,
      transport: config.transport,
      activeTransport: state.activeTransport ?? config.transport,
      protocolVersion: state.protocolVersion ?? null,
      enabled: config.enabled,
      approval: config.approval,
      disabledTools: config.disabledTools ?? [],
      status: state.status ?? (config.enabled ? 'disconnected' : 'disabled'),
      error: state.error ?? '',
      reconnecting: state.reconnecting === true,
      serverInfo: state.serverInfo ?? null,
      connectedAt: state.connectedAt ?? null,
      toolsHash: state.toolsHash ?? '',
      oauth: config.oauth?.enabled
        ? {
            enabled: true,
            clientId: config.oauth.clientId,
            clientSecret: config.oauth.clientSecret ? MASK : '',
            scope: config.oauth.scope,
            authorized: state.authorized === true,
          }
        : null,
      tools: (state.tools ?? []).map((tool) => ({
        name: tool.name,
        fn: functionName(config.id, tool.name),
        description: typeof tool.description === 'string' ? tool.description.slice(0, 1200) : '',
        inputSchema:
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? tool.inputSchema
            : { type: 'object', properties: {} },
        readOnly: tool.annotations?.readOnlyHint === true,
      })),
    }
    if (config.transport === 'stdio') {
      return { ...base, command: config.command, args: config.args ?? [], env: maskRecord(config.env) }
    }
    return { ...base, url: config.url, headers: maskRecord(config.headers) }
  }

  async #teardown(id) {
    const state = this.runtime.get(id)
    if (!state) return
    clearTimeout(state.refreshTimer)
    clearTimeout(state.reconnectTimer)
    state.refreshTimer = null
    state.reconnectTimer = null
    const transport = state.transport
    state.transport = null
    if (transport) await transport.close().catch(() => undefined)
  }

  /**
   * Connects (or reconnects). `auto` marks a background reconnect: the last known tools stay
   * visible and callable while it runs, so the agent never has to stop for a blip.
   */
  async connect(id, { auto = false, attempts = 0 } = {}) {
    const config = this.configs.get(id)
    if (!config) throw new HttpError(404, 'Unknown MCP server.', 'mcp_missing')
    const previous = this.runtime.get(id)
    const keep = auto ? previous?.tools ?? [] : []
    await this.#teardown(id)
    const state = {
      status: 'connecting',
      error: '',
      tools: keep,
      auto,
      attempts: auto ? attempts : 0,
      reconnecting: auto,
      wasConnected: auto ? previous?.wasConnected === true : false,
      toolsHash: auto ? previous?.toolsHash ?? '' : '',
    }
    this.runtime.set(id, state)
    this.#emitServer(id)
    state.connectPromise = this.#establish(id, config, state).finally(() => {
      state.connectPromise = null
    })
    await state.connectPromise
    return this.view(config)
  }

  async #establish(id, config, state) {
    const kinds = config.transport === 'stdio' ? ['stdio'] : config.transport === 'sse' ? ['sse', 'http'] : ['http', 'sse']
    let failure = null
    for (const [index, kind] of kinds.entries()) {
      try {
        await this.#open(id, config, state, kind)
        failure = null
        if (index > 0) state.note = `Connected over ${kind === 'sse' ? 'legacy HTTP+SSE' : 'Streamable HTTP'} (auto-detected).`
        break
      } catch (error) {
        if (error instanceof SupersededError) {
          await state.transport?.close().catch(() => undefined)
          return
        }
        if (failure === null || index === 0) failure = error
        else if (error instanceof AuthRequiredError) failure = error
        await state.transport?.close().catch(() => undefined)
        state.transport = null
        // Only a protocol mismatch justifies trying the other remote transport.
        if (kind === 'stdio' || !isTransportMismatch(error)) break
      }
    }
    if (this.runtime.get(id) !== state) return
    if (!failure) {
      this.#emitServer(id)
      return
    }
    state.connectedAt = null
    if (failure instanceof AuthRequiredError) {
      state.authorized = false
      state.tools = []
      state.reconnecting = false
      if (config.oauth?.enabled) {
        state.status = 'needs_auth'
        state.error = ''
        state.wwwAuthenticate = failure.wwwAuthenticate
      } else {
        state.status = 'error'
        state.error = 'The server answered 401 (sign-in required). Add credentials under Headers, or turn on OAuth.'
      }
      this.#emitServer(id)
      return
    }
    state.status = 'error'
    state.error = failure instanceof Error ? failure.message : 'Could not connect.'
    // A server that worked before is worth retrying; one that never started (bad command, bad URL) is not.
    if (state.wasConnected && !failure.permanent) {
      this.#scheduleReconnect(id)
      return
    }
    state.tools = []
    state.reconnecting = false
    this.#emitServer(id)
  }

  async #open(id, config, state, kind) {
    const onNotification = (method) => {
      if (method === 'notifications/tools/list_changed') this.scheduleRefresh(id)
    }
    const cwd = await this.getCwd()
    const roots = () => [{ uri: pathToFileURL(cwd).href, name: basename(cwd) || 'workspace' }]
    const auth = kind === 'stdio' ? null : this.#authHooks(config)
    const transport =
      kind === 'http'
        ? new HttpTransport(config, { auth, onNotification, roots })
        : kind === 'sse'
          ? new SseTransport(config, { auth, onNotification, roots })
          : new StdioTransport(config, { cwd, onNotification, roots })
    state.transport = transport
    state.activeTransport = kind
    state.authorized = Boolean(auth && (await this.authStore.get(id))?.tokens)
    await transport.start()
    if (kind !== 'http') transport.onExit = (error) => this.#onTransportLost(id, state, error)
    else transport.onLost = (error) => this.#onTransportLost(id, state, error)
    const init = await this.#handshake(transport)
    if (kind === 'http') {
      transport.reinit = async () => {
        transport.sessionId = ''
        transport.protocolVersion = ''
        await this.#handshake(transport)
      }
    }
    const tools = await this.#listTools(transport)
    if (this.runtime.get(id) !== state) throw new SupersededError()
    state.serverInfo = init?.serverInfo ?? null
    state.protocolVersion = transport.protocolVersion || null
    state.listChanged = init?.capabilities?.tools?.listChanged === true
    state.tools = tools
    state.toolsHash = toolsSignature(tools)
    state.status = 'connected'
    state.error = ''
    state.reconnecting = false
    state.attempts = 0
    state.wasConnected = true
    state.connectedAt = Date.now()
    state.authorized = Boolean(auth && (await this.authStore.get(id))?.tokens)
    // Streamable HTTP servers may push list_changed over a standalone GET stream.
    if (kind === 'http') transport.startListening()
  }

  /** initialize with version negotiation: offer the newest protocol, step down when the server refuses it. */
  async #handshake(transport) {
    let lastError
    for (const [index, version] of PROTOCOL_VERSIONS.entries()) {
      try {
        const init = await withTimeout(
          transport.request('initialize', {
            protocolVersion: version,
            capabilities: { roots: { listChanged: false } },
            clientInfo: { name: 'OpenSol', version: CLIENT_VERSION },
          }),
          CONNECT_TIMEOUT_MS,
          'initialize',
        )
        transport.protocolVersion = typeof init?.protocolVersion === 'string' ? init.protocolVersion : version
        await Promise.resolve()
          .then(() => transport.notify('notifications/initialized'))
          .catch(() => undefined)
        return init
      } catch (error) {
        lastError = error
        const olderLeft = index < PROTOCOL_VERSIONS.length - 1
        const versionRefusal =
          (error instanceof RpcError && (error.code === -32602 || /protocol|version|unsupported/i.test(error.message))) ||
          (error instanceof HttpStatusError && error.status === 400 && /protocol|version|unsupported/i.test(error.message))
        if (olderLeft && versionRefusal) continue
        throw error
      }
    }
    throw lastError
  }

  async #listTools(transport) {
    const tools = []
    let cursor
    try {
      for (let page = 0; page < 20; page += 1) {
        const result = await transport.request('tools/list', cursor ? { cursor } : {}, 30_000)
        if (Array.isArray(result?.tools)) tools.push(...result.tools.filter((tool) => tool && typeof tool.name === 'string'))
        cursor = result?.nextCursor
        if (!cursor) break
      }
    } catch (error) {
      // A server without the tools capability answers "method not found": that is an empty list, not a failure.
      if (error instanceof RpcError && error.code === -32601) return []
      throw error
    }
    return tools
  }

  /** Re-reads the tool list and publishes it only when it really changed (hash compare). */
  async #syncTools(id, state) {
    const transport = state.transport
    if (!transport || state.status !== 'connected') return { changed: false, added: [], removed: [] }
    const next = await this.#listTools(transport)
    if (this.runtime.get(id) !== state) return { changed: false, added: [], removed: [] }
    const hash = toolsSignature(next)
    if (hash === state.toolsHash) return { changed: false, added: [], removed: [] }
    const before = new Set(state.tools.map((tool) => tool.name))
    const after = new Set(next.map((tool) => tool.name))
    const diff = {
      changed: true,
      added: next.filter((tool) => !before.has(tool.name)).map((tool) => tool.name),
      removed: state.tools.filter((tool) => !after.has(tool.name)).map((tool) => tool.name),
    }
    state.tools = next
    state.toolsHash = hash
    this.#emitServer(id)
    return diff
  }

  /**
   * Event-driven sync: called when the server says its tools changed. Bursts are coalesced; a request that
   * arrives while a refresh runs makes it go round once more instead of stacking up.
   */
  scheduleRefresh(id, delay = REFRESH_DEBOUNCE_MS) {
    const state = this.runtime.get(id)
    if (!state || state.status !== 'connected') return
    state.refreshDirty = true
    if (state.refreshTimer || state.refreshing) return
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null
      void this.#runRefresh(id, state)
    }, delay)
  }

  #runRefresh(id, state) {
    if (state.refreshing) return state.refreshing
    state.refreshing = (async () => {
      try {
        while (state.refreshDirty) {
          state.refreshDirty = false
          await this.#syncTools(id, state)
        }
      } catch {
        // Keep the previous list; the next notification or tool call tries again.
      } finally {
        state.refreshing = null
      }
    })()
    return state.refreshing
  }

  async refresh(id) {
    const config = this.configs.get(id)
    const state = this.runtime.get(id)
    if (!config) throw new HttpError(404, 'Unknown MCP server.', 'mcp_missing')
    if (!state?.transport || state.status !== 'connected') return this.connect(id)
    try {
      await this.#syncTools(id, state)
    } catch (error) {
      // The connection may have died quietly: rebuild it instead of reporting a stale list.
      if (!(error instanceof RpcError)) return this.connect(id)
      throw error
    }
    return this.view(config)
  }

  /**
   * After a tool call: make sure the tool list is current before the agent's next step. Servers that
   * announce list_changed are trusted (their notification usually arrives before the result and is
   * flushed here); for the others, a call that may change state is followed by one hash-compared re-list.
   */
  async #settleTools(id, state, readOnly) {
    let pending = null
    if (state.refreshTimer) {
      clearTimeout(state.refreshTimer)
      state.refreshTimer = null
      pending = this.#runRefresh(id, state)
    } else if (state.refreshing) {
      pending = state.refreshing
    } else if (!state.listChanged && !readOnly) {
      state.refreshDirty = true
      pending = this.#runRefresh(id, state)
    }
    if (pending) {
      let timer
      await Promise.race([pending, new Promise((resolve) => (timer = setTimeout(resolve, 3000)))])
      clearTimeout(timer)
    }
  }

  #onTransportLost(id, state, error) {
    if (this.runtime.get(id) !== state) return
    if (state.status !== 'connected') return
    state.status = 'error'
    state.error = error instanceof Error ? error.message : 'The connection was lost.'
    state.transport?.close().catch(() => undefined)
    state.transport = null
    this.#scheduleReconnect(id)
  }

  #scheduleReconnect(id) {
    const state = this.runtime.get(id)
    const config = this.configs.get(id)
    if (!state || !config?.enabled || state.reconnectTimer) return
    const attempt = state.attempts ?? 0
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      state.reconnecting = false
      state.tools = []
      this.#emitServer(id)
      return
    }
    state.reconnecting = true
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null
      if (this.runtime.get(id) !== state) return
      void this.connect(id, { auto: true, attempts: attempt + 1 }).catch(() => undefined)
    }, RECONNECT_DELAYS_MS[attempt])
    state.reconnectTimer.unref?.()
    this.#emitServer(id)
  }

  /** A connected state to run a call on, waiting for (or starting) a reconnect when the server is down. */
  async #ready(id, config) {
    const usable = (state) => state?.status === 'connected' && state.transport && !state.transport.closed
    let state = this.runtime.get(id)
    if (usable(state)) return state
    if (!config.enabled) throw new HttpError(409, `${config.name} is turned off.`, 'mcp_disabled')
    if (state?.status === 'needs_auth') {
      throw new HttpError(401, `${config.name} needs you to sign in. Open the MCP panel and press Authorize.`, 'mcp_auth')
    }
    if (state?.status === 'connected') {
      // The transport closed without telling us: treat it as lost and rebuild it right now.
      this.#onTransportLost(id, state, new Error('The connection closed.'))
      state = this.runtime.get(id)
    }
    let timer
    const limit = new Promise((resolve) => (timer = setTimeout(resolve, RECONNECT_WAIT_MS)))
    if (state?.connectPromise) await Promise.race([state.connectPromise, limit])
    else if (state?.reconnectTimer) {
      // Someone needs the server now: skip the back-off.
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
      await Promise.race([this.connect(id, { auto: true, attempts: state.attempts ?? 0 }), limit])
    } else await Promise.race([this.connect(id, { auto: true, attempts: 0 }), limit])
    clearTimeout(timer)
    state = this.runtime.get(id)
    if (usable(state)) return state
    throw new HttpError(
      409,
      `${config.name} is not connected${state?.error ? `: ${state.error}` : ''}. Reconnect it in the MCP panel.`,
      'mcp_disconnected',
    )
  }

  async disconnect(id) {
    await this.#teardown(id)
    const config = this.configs.get(id)
    this.runtime.set(id, { status: config?.enabled === false ? 'disabled' : 'disconnected', error: '', tools: [] })
    this.#emitServer(id)
    return config ? this.view(config) : null
  }

  async connectAll() {
    await Promise.all(
      [...this.configs.values()].filter((config) => config.enabled).map((config) => this.connect(config.id)),
    )
  }

  async shutdown() {
    await Promise.all([...this.runtime.keys()].map((id) => this.disconnect(id)))
    this.listeners.clear()
  }

  async callTool(id, toolName, args) {
    const config = this.configs.get(id)
    if (!config) throw new HttpError(404, 'Unknown MCP server.', 'mcp_missing')
    if ((config.disabledTools ?? []).includes(toolName)) {
      throw new HttpError(403, `${toolName} is turned off for ${config.name}.`, 'mcp_tool_disabled')
    }
    const state = await this.#ready(id, config)
    const beforeHash = state.toolsHash
    const beforeNames = new Set(state.tools.map((tool) => tool.name))
    const known = state.tools.find((tool) => tool.name === toolName)
    let result
    try {
      result = await state.transport.request('tools/call', {
        name: toolName,
        arguments: args && typeof args === 'object' ? args : {},
      })
    } catch (error) {
      if (error instanceof RpcError) return { text: error.message, isError: true }
      if (error instanceof AuthRequiredError) {
        state.status = 'needs_auth'
        state.authorized = false
        state.wwwAuthenticate = error.wwwAuthenticate
        state.tools = []
        await state.transport?.close().catch(() => undefined)
        state.transport = null
        this.#emitServer(id)
        throw new HttpError(401, `${config.name} needs you to sign in again. Open the MCP panel and press Authorize.`, 'mcp_auth')
      }
      if (isConnectionLost(error)) {
        this.#onTransportLost(id, state, error)
        throw new HttpError(
          502,
          `${config.name} disconnected during the call and is reconnecting automatically. Run the tool again in a moment.`,
          'mcp_lost',
        )
      }
      throw new HttpError(502, error instanceof Error ? error.message : 'The MCP call failed.', 'mcp_failed')
    }
    await this.#settleTools(id, state, known?.annotations?.readOnlyHint === true).catch(() => undefined)
    const out = { text: flattenContent(result), isError: result?.isError === true }
    if (this.runtime.get(id) === state && state.toolsHash !== beforeHash) {
      const afterNames = new Set(state.tools.map((tool) => tool.name))
      out.toolsChanged = {
        added: state.tools.filter((tool) => !beforeNames.has(tool.name)).map((tool) => functionName(id, tool.name)),
        removed: [...beforeNames].filter((name) => !afterNames.has(name)).map((name) => functionName(id, name)),
        server: this.view(config),
      }
    }
    return out
  }
}

class SupersededError extends Error {}

function toolsSignature(tools) {
  const hash = createHash('sha1')
  for (const tool of tools) {
    hash.update(JSON.stringify([tool.name, tool.description ?? '', tool.inputSchema ?? null, tool.annotations?.readOnlyHint === true]))
  }
  return hash.digest('hex')
}

/** 4xx on the first request of a transport usually means "this URL speaks the other protocol". */
function isTransportMismatch(error) {
  return error instanceof HttpStatusError && [400, 404, 405, 406, 415].includes(error.status)
}

function isConnectionLost(error) {
  const text = error instanceof Error ? `${error.name} ${error.message} ${error.cause?.code ?? ''}` : ''
  return /not running|exited|not connected|closed|fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|socket|terminated/i.test(text)
}

export const mcp = new McpManager()
