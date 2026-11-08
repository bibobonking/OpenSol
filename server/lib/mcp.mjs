<<<<<<< HEAD
// Minimal Model Context Protocol client (stdio, Streamable HTTP, legacy HTTP+SSE, OAuth), zero dependencies.
=======
// Minimal Model Context Protocol client (stdio + Streamable HTTP), zero dependencies.
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
// The daemon owns every connection: the browser only sees tool metadata and results.
import { spawn } from 'node:child_process'
import os from 'node:os'
import { HttpError } from './http.mjs'
<<<<<<< HEAD
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
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333

const PROTOCOL_VERSION = '2025-03-26'
const CONNECT_TIMEOUT_MS = 60_000
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

/** Newline-delimited JSON-RPC over a child process. */
class StdioTransport {
  constructor(config, { onNotification, cwd }) {
    this.config = config
    this.onNotification = onNotification
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
      this.child.once('error', (error) => reject(new Error(`Could not start "${this.config.command}": ${error.message}`)))
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
      // Server-initiated requests: answer pings, refuse everything else politely.
      const reply =
        message.method === 'ping'
          ? { jsonrpc: '2.0', id: message.id, result: {} }
          : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported by OpenSol.' } }
      this.#write(reply)
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

async function readSse(response, wantedId) {
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
    }
  }
  throw new Error('The MCP server closed the stream without answering.')
}

<<<<<<< HEAD
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

/** Streamable HTTP transport: one POST per message, JSON or SSE replies. */
class HttpTransport {
  constructor(config, { auth } = {}) {
    this.config = config
    this.auth = auth
=======
/** Streamable HTTP transport: one POST per message, JSON or SSE replies. */
class HttpTransport {
  constructor(config) {
    this.config = config
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
    this.sessionId = ''
  }

  async start() {
<<<<<<< HEAD
    checkRemoteUrl(this.config.url)
  }

  #headers() {
    return remoteHeaders(this.config, this.auth, {
=======
    let parsed
    try {
      parsed = new URL(this.config.url)
    } catch {
      throw new Error('The MCP server URL is not valid.')
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('MCP servers must use http or https.')
  }

  #headers() {
    return {
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
<<<<<<< HEAD
    })
=======
      ...(this.config.headers ?? {}),
    }
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
  }

  async request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = ++requestCounter
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
<<<<<<< HEAD
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
=======
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      })
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
      const session = response.headers.get('mcp-session-id')
      if (session) this.sessionId = session
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`MCP server answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
      }
      const type = response.headers.get('content-type') ?? ''
      if (type.includes('text/event-stream')) return await readSse(response, id)
      const message = await response.json()
      if (message.error) throw new RpcError(message.error)
      return message.result
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s.`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async notify(method, params) {
<<<<<<< HEAD
    const response = await authedFetch(
      this.config.url,
      async () => ({
        method: 'POST',
        headers: await this.#headers(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        signal: AbortSignal.timeout(15_000),
      }),
      this.auth,
    )
=======
    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: AbortSignal.timeout(15_000),
    })
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
    await response.body?.cancel().catch(() => undefined)
  }

  async close() {
    if (!this.sessionId) return
    await fetch(this.config.url, {
      method: 'DELETE',
<<<<<<< HEAD
      headers: await this.#headers(),
=======
      headers: this.#headers(),
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined)
  }
}

<<<<<<< HEAD
/**
 * Legacy HTTP+SSE transport (protocol 2024-11-05): a long-lived GET stream carries every
 * server message; the first `endpoint` event names the URL that requests are POSTed to.
 */
class SseTransport {
  constructor(config, { auth, onNotification } = {}) {
    this.config = config
    this.auth = auth
    this.onNotification = onNotification
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
      throw new Error(`MCP server answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
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
      const reply =
        message.method === 'ping'
          ? { jsonrpc: '2.0', id: message.id, result: {} }
          : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported by OpenSol.' } }
      void this.#post(reply).catch(() => undefined)
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
      throw new Error(`MCP server answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
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

=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
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
<<<<<<< HEAD
  const transport = raw.transport === 'http' || raw.transport === 'sse' ? raw.transport : 'stdio'
=======
  const transport = raw.transport === 'http' ? 'http' : 'stdio'
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
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
<<<<<<< HEAD
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
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
  }
  return config
}

export class McpManager {
  constructor() {
    this.configs = new Map()
    this.runtime = new Map()
    this.getCwd = async () => os.homedir()
<<<<<<< HEAD
    this.pendingAuth = new PendingAuthorizations()
    this.refreshing = new Map()
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
    }
    return config ? this.view(config) : null
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
  }

  async setConfigs(configs) {
    const next = new Map(configs.map((config) => [config.id, config]))
    const stale = []
    for (const [id, previous] of this.configs) {
      const config = next.get(id)
      if (!config || JSON.stringify(config) !== JSON.stringify(previous)) stale.push(id)
    }
    await Promise.all(stale.map((id) => this.disconnect(id)))
    this.configs = next
    for (const id of [...this.runtime.keys()]) if (!next.has(id)) this.runtime.delete(id)
  }

  list() {
    return [...this.configs.values()].map((config) => this.view(config))
  }

  view(config) {
    const state = this.runtime.get(config.id) ?? {}
    const base = {
      id: config.id,
      name: config.name,
      transport: config.transport,
      enabled: config.enabled,
      approval: config.approval,
      disabledTools: config.disabledTools ?? [],
      status: state.status ?? (config.enabled ? 'disconnected' : 'disabled'),
      error: state.error ?? '',
      serverInfo: state.serverInfo ?? null,
      connectedAt: state.connectedAt ?? null,
<<<<<<< HEAD
      oauth: config.oauth?.enabled
        ? {
            enabled: true,
            clientId: config.oauth.clientId,
            clientSecret: config.oauth.clientSecret ? MASK : '',
            scope: config.oauth.scope,
            authorized: state.authorized === true,
          }
        : null,
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
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

  async connect(id) {
    const config = this.configs.get(id)
    if (!config) throw new HttpError(404, 'Unknown MCP server.', 'mcp_missing')
    await this.disconnect(id)
    const state = { status: 'connecting', error: '', tools: [] }
    this.runtime.set(id, state)
    try {
<<<<<<< HEAD
      const onNotification = (method) => {
        if (method === 'notifications/tools/list_changed') void this.refresh(id).catch(() => undefined)
      }
      const auth = config.transport === 'stdio' ? null : this.#authHooks(config)
      const transport =
        config.transport === 'http'
          ? new HttpTransport(config, { auth })
          : config.transport === 'sse'
            ? new SseTransport(config, { auth, onNotification })
            : new StdioTransport(config, { cwd: await this.getCwd(), onNotification })
      state.transport = transport
      state.authorized = Boolean(auth && (await this.authStore.get(id))?.tokens)
      await transport.start()
      if (config.transport !== 'http') {
=======
      const transport =
        config.transport === 'http'
          ? new HttpTransport(config)
          : new StdioTransport(config, {
              cwd: await this.getCwd(),
              onNotification: (method) => {
                if (method === 'notifications/tools/list_changed') void this.refresh(id).catch(() => undefined)
              },
            })
      state.transport = transport
      await transport.start()
      if (config.transport === 'stdio') {
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
        transport.onExit = (error) => {
          if (this.runtime.get(id) === state && state.status === 'connected') {
            state.status = 'error'
            state.error = error.message
          }
        }
      }
      const init = await withTimeout(
        transport.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'OpenSol', version: '3.1.0' },
        }),
        CONNECT_TIMEOUT_MS,
        'initialize',
      )
      await transport.notify('notifications/initialized')
      state.serverInfo = init?.serverInfo ?? null
      state.tools = await this.#listTools(transport)
      state.status = 'connected'
      state.connectedAt = Date.now()
<<<<<<< HEAD
      state.authorized = Boolean(auth && (await this.authStore.get(id))?.tokens)
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        state.authorized = false
        if (config.oauth?.enabled) {
          state.status = 'needs_auth'
          state.error = ''
          state.wwwAuthenticate = error.wwwAuthenticate
        } else {
          state.status = 'error'
          state.error = 'The server answered 401 (sign-in required). Add credentials under Headers, or turn on OAuth.'
        }
      } else {
        state.status = 'error'
        state.error = error instanceof Error ? error.message : 'Could not connect.'
      }
=======
    } catch (error) {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : 'Could not connect.'
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
      await state.transport?.close().catch(() => undefined)
      state.transport = null
    }
    return this.view(config)
  }

  async #listTools(transport) {
    const tools = []
    let cursor
    for (let page = 0; page < 10; page += 1) {
      const result = await transport.request('tools/list', cursor ? { cursor } : {}, 30_000)
      if (Array.isArray(result?.tools)) tools.push(...result.tools.filter((tool) => tool && typeof tool.name === 'string'))
      cursor = result?.nextCursor
      if (!cursor) break
    }
    return tools
  }

  async refresh(id) {
    const config = this.configs.get(id)
    const state = this.runtime.get(id)
    if (!config) throw new HttpError(404, 'Unknown MCP server.', 'mcp_missing')
    if (!state?.transport || state.status !== 'connected') return this.connect(id)
    state.tools = await this.#listTools(state.transport)
    return this.view(config)
  }

  async disconnect(id) {
    const state = this.runtime.get(id)
    if (state?.transport) await state.transport.close().catch(() => undefined)
    const config = this.configs.get(id)
    this.runtime.set(id, { status: config?.enabled === false ? 'disabled' : 'disconnected', error: '', tools: [] })
    return config ? this.view(config) : null
  }

  async connectAll() {
    await Promise.all(
      [...this.configs.values()].filter((config) => config.enabled).map((config) => this.connect(config.id)),
    )
  }

  async shutdown() {
    await Promise.all([...this.runtime.keys()].map((id) => this.disconnect(id)))
  }

  async callTool(id, toolName, args) {
    const config = this.configs.get(id)
    const state = this.runtime.get(id)
    if (!config) throw new HttpError(404, 'Unknown MCP server.', 'mcp_missing')
    if (!state?.transport || state.status !== 'connected') {
<<<<<<< HEAD
      throw new HttpError(409, `${config.name} is not connected. Reconnect it in the MCP panel.`, 'mcp_disconnected')
=======
      throw new HttpError(409, `${config.name} is not connected. Reconnect it in Settings → MCP.`, 'mcp_disconnected')
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
    }
    if ((config.disabledTools ?? []).includes(toolName)) {
      throw new HttpError(403, `${toolName} is turned off for ${config.name}.`, 'mcp_tool_disabled')
    }
    try {
      const result = await state.transport.request('tools/call', {
        name: toolName,
        arguments: args && typeof args === 'object' ? args : {},
      })
      return { text: flattenContent(result), isError: result?.isError === true }
    } catch (error) {
      if (error instanceof RpcError) return { text: error.message, isError: true }
<<<<<<< HEAD
      if (error instanceof AuthRequiredError) {
        state.status = 'needs_auth'
        state.authorized = false
        state.wwwAuthenticate = error.wwwAuthenticate
        await state.transport?.close().catch(() => undefined)
        state.transport = null
        throw new HttpError(401, `${config.name} needs you to sign in again. Open the MCP panel and press Authorize.`, 'mcp_auth')
      }
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
      throw new HttpError(502, error instanceof Error ? error.message : 'The MCP call failed.', 'mcp_failed')
    }
  }
}

export const mcp = new McpManager()
