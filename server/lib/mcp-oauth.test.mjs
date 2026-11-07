import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'
import { McpManager, sanitizeServerConfig } from './mcp.mjs'

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
  })
}

/** One fake host: OAuth endpoints, a Streamable HTTP MCP endpoint and a legacy SSE endpoint. */
async function fakeServer() {
  const seen = { registrations: 0, refreshes: 0, challenge: '', code: 'code-1' }
  const sseClients = []
  let accessToken = 'access-1'
  const rpc = (message) => {
    if (message.method === 'initialize') return { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake', version: '1' } }
    if (message.method === 'tools/list') return { tools: [{ name: 'hello', description: 'Say hi', inputSchema: { type: 'object', properties: {} } }] }
    if (message.method === 'tools/call') return { content: [{ type: 'text', text: 'hi from fake' }] }
    return {}
  }
  const server = http.createServer(async (req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`
    const url = new URL(req.url, base)
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return send(200, { resource: `${base}/mcp`, authorization_servers: [base] })
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return send(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
      })
    }
    if (url.pathname === '/register') {
      seen.registrations += 1
      const body = JSON.parse(await readBody(req))
      assert.equal(body.token_endpoint_auth_method, 'none')
      return send(201, { client_id: 'client-1' })
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(await readBody(req))
      if (form.get('grant_type') === 'authorization_code') {
        const expected = createHash('sha256').update(form.get('code_verifier')).digest('base64url')
        if (form.get('code') !== seen.code || expected !== seen.challenge) return send(400, { error: 'invalid_grant' })
        return send(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 })
      }
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'refresh-1') {
        seen.refreshes += 1
        accessToken = 'access-2'
        return send(200, { access_token: 'access-2', expires_in: 3600 })
      }
      return send(400, { error: 'invalid_grant' })
    }
    if (url.pathname === '/mcp' && req.method === 'POST') {
      if (req.headers.authorization !== `Bearer ${accessToken}`) {
        return send(401, { error: 'unauthorized' }, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` })
      }
      const message = JSON.parse(await readBody(req))
      if (message.id === undefined) {
        res.writeHead(202)
        return res.end()
      }
      return send(200, { jsonrpc: '2.0', id: message.id, result: rpc(message) })
    }
    if (url.pathname === '/sse' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write('event: endpoint\ndata: /messages?session=1\n\n')
      sseClients.push(res)
      return
    }
    if (url.pathname === '/messages' && req.method === 'POST') {
      const message = JSON.parse(await readBody(req))
      res.writeHead(202)
      res.end('Accepted')
      if (message.id !== undefined) {
        sseClients.at(-1)?.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: rpc(message) })}\n\n`)
      }
      return
    }
    send(404, {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const close = () => {
    for (const client of sseClients) client.end()
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  }
  return { base, seen, close, expireAccess: () => (accessToken = 'rotated-away') }
}

test('OAuth: discovery, dynamic registration, PKCE sign-in and token refresh', async () => {
  const fake = await fakeServer()
  const manager = new McpManager()
  const config = sanitizeServerConfig({ name: 'Secure', transport: 'http', url: `${fake.base}/mcp`, oauth: { enabled: true } })
  await manager.setConfigs([config])

  let view = await manager.connect(config.id)
  assert.equal(view.status, 'needs_auth')
  assert.equal(view.oauth.authorized, false)

  const redirectUri = 'http://127.0.0.1:4174/oauth/mcp/callback'
  const { url } = await manager.startAuth(config.id, redirectUri)
  const authorize = new URL(url)
  assert.equal(authorize.pathname, '/authorize')
  assert.equal(authorize.searchParams.get('client_id'), 'client-1')
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(authorize.searchParams.get('resource'), `${fake.base}/mcp`)
  fake.seen.challenge = authorize.searchParams.get('code_challenge')

  await assert.rejects(() => manager.finishAuth('wrong-state', 'code-1'), /expired|already used/)
  await manager.finishAuth(authorize.searchParams.get('state'), 'code-1')
  view = manager.list()[0]
  assert.equal(view.status, 'connected', view.error)
  assert.equal(view.oauth.authorized, true)
  assert.equal(view.tools[0].name, 'hello')

  // The access token stops working: the manager refreshes once and retries the call.
  fake.expireAccess()
  const result = await manager.callTool(config.id, 'hello', {})
  assert.deepEqual(result, { text: 'hi from fake', isError: false })
  assert.equal(fake.seen.refreshes, 1)

  // A second sign-in reuses the registered client.
  await manager.startAuth(config.id, redirectUri)
  assert.equal(fake.seen.registrations, 1)

  await manager.signOut(config.id)
  assert.equal(manager.list()[0].status, 'needs_auth')
  await manager.shutdown()
  await fake.close()
})

test('a 401 without OAuth explains how to fix it', async () => {
  const fake = await fakeServer()
  const manager = new McpManager()
  const config = sanitizeServerConfig({ name: 'Plain', transport: 'http', url: `${fake.base}/mcp` })
  await manager.setConfigs([config])
  const view = await manager.connect(config.id)
  assert.equal(view.status, 'error')
  assert.match(view.error, /401/)
  await fake.close()
})

test('legacy HTTP+SSE servers connect and answer tool calls', async () => {
  const fake = await fakeServer()
  const manager = new McpManager()
  const config = sanitizeServerConfig({ name: 'Legacy', transport: 'sse', url: `${fake.base}/sse` })
  assert.equal(config.transport, 'sse')
  await manager.setConfigs([config])
  const view = await manager.connect(config.id)
  assert.equal(view.status, 'connected', view.error)
  assert.equal(view.tools[0].name, 'hello')
  assert.deepEqual(await manager.callTool(config.id, 'hello', {}), { text: 'hi from fake', isError: false })
  await manager.shutdown()
  await fake.close()
})

test('OAuth client secrets are masked and kept on save', () => {
  const config = sanitizeServerConfig({ name: 'x', transport: 'http', url: 'https://example.com/mcp', oauth: { enabled: true, clientId: 'abc', clientSecret: 's3cret' } })
  const manager = new McpManager()
  manager.configs.set(config.id, config)
  const view = manager.list()[0]
  assert.notEqual(view.oauth.clientSecret, 's3cret')
  const again = sanitizeServerConfig(view, config)
  assert.equal(again.oauth.clientSecret, 's3cret')
})
