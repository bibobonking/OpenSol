// Minimal Model Context Protocol client (stdio + Streamable HTTP), zero dependencies.
// The daemon owns every connection: the browser only sees tool metadata and results.
import { spawn } from 'node:child_process'
import os from 'node:os'
import { HttpError } from './http.mjs'

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

/** Streamable HTTP transport: one POST per message, JSON or SSE replies. */
class HttpTransport {
  constructor(config) {
    this.config = config
    this.sessionId = ''
  }

  async start() {
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
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      ...(this.config.headers ?? {}),
    }
  }

  async request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = ++requestCounter
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      })
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
    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: AbortSignal.timeout(15_000),
    })
    await response.body?.cancel().catch(() => undefined)
  }

  async close() {
    if (!this.sessionId) return
    await fetch(this.config.url, {
      method: 'DELETE',
      headers: this.#headers(),
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined)
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
  const transport = raw.transport === 'http' ? 'http' : 'stdio'
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
  }
  return config
}

export class McpManager {
  constructor() {
    this.configs = new Map()
    this.runtime = new Map()
    this.getCwd = async () => os.homedir()
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
    } catch (error) {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : 'Could not connect.'
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
      throw new HttpError(409, `${config.name} is not connected. Reconnect it in Settings → MCP.`, 'mcp_disconnected')
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
      throw new HttpError(502, error instanceof Error ? error.message : 'The MCP call failed.', 'mcp_failed')
    }
  }
}

export const mcp = new McpManager()
