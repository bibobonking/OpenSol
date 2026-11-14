import assert from 'node:assert/strict'
import test from 'node:test'
import { draftFromServer, inputFromDraft, joinArgs, parseMcpJson, splitArgs } from './mcp-config.ts'

test('imports Claude Desktop style config with local and remote servers', () => {
  const { servers, skipped } = parseMcpJson(
    JSON.stringify({
      mcpServers: {
        files: { command: 'npx', args: ['-y', 'server-filesystem', '/my dir'], env: { TOKEN: 'x' } },
        linear: { url: 'https://mcp.linear.app/mcp' },
        legacy: { url: 'https://example.com/sse', type: 'sse' },
        keyed: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer k' } },
        broken: { nothing: true },
      },
    }),
  )
  assert.deepEqual(skipped, ['broken'])
  const byName = Object.fromEntries(servers.map((server) => [server.name, server]))
  assert.equal(byName.files.transport, 'stdio')
  assert.deepEqual(byName.files.args, ['-y', 'server-filesystem', '/my dir'])
  assert.equal(byName.linear.transport, 'http')
  assert.equal(byName.linear.oauth?.enabled, true)
  assert.equal(byName.legacy.transport, 'sse')
  assert.equal(byName.keyed.oauth, null)
})

test('accepts a single server object and rejects junk', () => {
  assert.equal(parseMcpJson('{"command":"node","args":["a.js"]}').servers[0].name, 'Imported')
  assert.throws(() => parseMcpJson('nope'), /valid JSON/)
  assert.throws(() => parseMcpJson('{"a":1}'), /No MCP servers/)
})

test('draft round-trip keeps secrets masked and quoting intact', () => {
  assert.deepEqual(splitArgs('-y "my dir" x'), ['-y', 'my dir', 'x'])
  assert.equal(joinArgs(['-y', 'my dir']), '-y "my dir"')
  const server = {
    id: 'a', name: 'A', transport: 'http', enabled: false, approval: 'auto', disabledTools: ['t'], status: 'connected',
    error: '', serverInfo: null, connectedAt: null, tools: [], url: 'https://x.dev/mcp', headers: { 'X-Key': '••••••••' },
    oauth: { enabled: true, clientId: 'cid', clientSecret: '••••••••', scope: 'read', authorized: true },
  }
  const input = inputFromDraft(draftFromServer(server), server)
  assert.equal(input.enabled, false)
  assert.equal(input.approval, 'auto')
  assert.equal(input.headers['X-Key'], '••••••••')
  assert.equal(input.oauth.clientSecret, '••••••••')
  assert.deepEqual(input.disabledTools, ['t'])
})
