import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import test from 'node:test'
import { McpManager, functionName, sanitizeServerConfig } from './mcp.mjs'
import { lineDiffStats } from './tools.mjs'

const SERVER = `
import readline from 'node:readline'
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'echo', version: '1' } } })
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }] } })
  else if (m.method === 'tools/call') send({ id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + m.params.arguments.text }] } })
})`

test('an stdio MCP server connects, lists tools and answers a call', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opensol-mcp-'))
  const file = path.join(dir, 'server.mjs')
  await writeFile(file, SERVER)
  const manager = new McpManager()
  const config = sanitizeServerConfig({ name: 'Echo Server', command: process.execPath, args: [file] })
  await manager.setConfigs([config])
  const view = await manager.connect(config.id)
  assert.equal(view.status, 'connected', view.error)
  assert.equal(view.tools[0].fn, functionName(config.id, 'echo'))
  const result = await manager.callTool(config.id, 'echo', { text: 'hi' })
  assert.deepEqual(result, { text: 'echo: hi', isError: false })
  await manager.shutdown()
})

test('secrets are masked in the public view and kept on save', () => {
  const manager = new McpManager()
  const config = sanitizeServerConfig({ name: 'x', command: 'node', env: { TOKEN: 'secret' } })
  manager.configs.set(config.id, config)
  assert.equal(manager.list()[0].env.TOKEN.includes('secret'), false)
  const again = sanitizeServerConfig({ ...manager.list()[0] }, config)
  assert.equal(again.env.TOKEN, 'secret')
})

test('line diff stats count added and removed lines', () => {
  assert.deepEqual(lineDiffStats('a\nb\nc', 'a\nB\nc\nd'), { added: 2, removed: 1 })
  assert.deepEqual(lineDiffStats('same', 'same'), { added: 0, removed: 0 })
})

// ── Auto sync, reconnect and protocol compatibility ──────────────────────────────────────────────

const DYNAMIC = (listChanged) => `
import readline from 'node:readline'
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
let unlocked = false
const tool = (name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: ${listChanged} } }, serverInfo: { name: 'dyn', version: '1' } } })
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: unlocked ? [tool('create_project'), tool('build'), tool('deploy')] : [tool('create_project')] } })
  else if (m.method === 'tools/call') {
    if (m.params.name === 'create_project') {
      unlocked = true
      if (${listChanged}) send({ method: 'notifications/tools/list_changed' })
    }
    if (m.params.name === 'crash') process.exit(1)
    send({ id: m.id, result: { content: [{ type: 'text', text: 'ok ' + m.params.name }] } })
  }
})`

async function startStdio(source, extra = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opensol-mcp-'))
  const file = path.join(dir, 'server.mjs')
  await writeFile(file, source)
  const manager = new McpManager()
  const config = sanitizeServerConfig({ name: 'Dyn', command: process.execPath, args: [file], ...extra })
  await manager.setConfigs([config])
  const view = await manager.connect(config.id)
  assert.equal(view.status, 'connected', view.error)
  return { manager, config, view }
}

for (const listChanged of [true, false]) {
  test(`tools opened by a call are visible before the call returns (listChanged=${listChanged})`, async () => {
    const { manager, config, view } = await startStdio(DYNAMIC(listChanged))
    assert.equal(view.tools.length, 1)
    const events = []
    manager.subscribe((event) => events.push(event))
    const result = await manager.callTool(config.id, 'create_project', {})
    assert.equal(result.toolsChanged.server.tools.length, 3)
    assert.deepEqual(result.toolsChanged.added.sort(), [functionName(config.id, 'build'), functionName(config.id, 'deploy')].sort())
    assert.equal(manager.list()[0].tools.length, 3)
    assert.ok(events.some((event) => event.type === 'server' && event.server.tools.length === 3))
    // A second identical call changes nothing: no flag, no extra event.
    const before = events.length
    const again = await manager.callTool(config.id, 'build', {})
    assert.equal(again.toolsChanged, undefined)
    assert.equal(events.length, before)
    await manager.shutdown()
  })
}

test('a server that dies is reconnected on its own and the next call just works', async () => {
  const { manager, config } = await startStdio(DYNAMIC(true))
  await assert.rejects(manager.callTool(config.id, 'crash', {}))
  // The agent calls again straight away: the manager waits for / starts the reconnect.
  const result = await manager.callTool(config.id, 'create_project', {})
  assert.equal(result.text, 'ok create_project')
  assert.equal(manager.list()[0].status, 'connected')
  await manager.shutdown()
})

test('a reconnect keeps the last known tools callable', async () => {
  const { manager, config } = await startStdio(DYNAMIC(true))
  await manager.callTool(config.id, 'create_project', {})
  const pending = manager.connect(config.id, { auto: true })
  for (let i = 0; i < 200 && manager.list()[0].status !== 'connecting'; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  const during = manager.list()[0]
  assert.equal(during.status, 'connecting')
  assert.equal(during.reconnecting, true)
  assert.equal(during.tools.length, 3)
  await pending
  await manager.shutdown()
})

function legacySseServer() {
  const clients = new Set()
  return http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('event: endpoint\ndata: /messages\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (req.url !== '/messages') {
      res.writeHead(405).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const m = JSON.parse(body)
      res.writeHead(202).end()
      if (m.id === undefined) return
      const result =
        m.method === 'initialize'
          ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'legacy', version: '1' } }
          : m.method === 'tools/list'
            ? { tools: [{ name: 'ping', description: 'p', inputSchema: { type: 'object', properties: {} } }] }
            : { content: [{ type: 'text', text: 'pong' }] }
      for (const client of clients) client.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`)
    })
  })
}

function streamableServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const m = JSON.parse(body)
      if (m.id === undefined) {
        res.writeHead(202).end()
        return
      }
      const result =
        m.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'streamable', version: '1' } }
          : m.method === 'tools/list'
            ? { tools: [{ name: 'ping', description: 'p', inputSchema: { type: 'object', properties: {} } }] }
            : { content: [{ type: 'text', text: 'pong' }] }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'abc' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }))
    })
  })
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

test('a Streamable HTTP config pointed at a legacy SSE server falls back automatically', async () => {
  const server = legacySseServer()
  const url = await listen(server)
  const manager = new McpManager()
  const config = sanitizeServerConfig({ name: 'Legacy', transport: 'http', url: `${url}/sse` })
  await manager.setConfigs([config])
  const view = await manager.connect(config.id)
  assert.equal(view.status, 'connected', view.error)
  assert.equal(view.activeTransport, 'sse')
  assert.equal(view.tools[0].name, 'ping')
  assert.equal((await manager.callTool(config.id, 'ping', {})).text, 'pong')
  await manager.shutdown()
  server.closeAllConnections?.()
  server.close()
})

test('a legacy SSE config pointed at a Streamable HTTP server falls back automatically', async () => {
  const server = streamableServer()
  const url = await listen(server)
  const manager = new McpManager()
  const config = sanitizeServerConfig({ name: 'Modern', transport: 'sse', url: `${url}/mcp` })
  await manager.setConfigs([config])
  const view = await manager.connect(config.id)
  assert.equal(view.status, 'connected', view.error)
  assert.equal(view.activeTransport, 'http')
  assert.equal(view.protocolVersion, '2025-03-26')
  await manager.shutdown()
  server.close()
})

test('a server that never declares the tools capability yields an empty list, not a failed connection', async () => {
  const source = `
import readline from 'node:readline'
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'x', version: '1' } } })
  else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Method not found' } })
})`
  const { manager, view } = await startStdio(source)
  assert.deepEqual(view.tools, [])
  await manager.shutdown()
})
