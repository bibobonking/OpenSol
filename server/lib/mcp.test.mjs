import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
