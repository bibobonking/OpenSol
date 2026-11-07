import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'

// The data directory is read when store.mjs loads, so set it before any import.
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'maxcode-data-'))
process.env.MAXCODE_DATA = dataDir
const workspace = await mkdtemp(path.join(os.tmpdir(), 'maxcode-ws-'))

const store = await import('./store.mjs')
const tools = await import('./tools.mjs')
const { startServer } = await import('../daemon.mjs')

await store.addWorkspace(workspace)

test('edit_file keeps $ patterns in the replacement literal', async () => {
  await writeFile(path.join(workspace, 'price.txt'), 'cost: X\n')
  await tools.executeTool('edit_file', { path: 'price.txt', oldText: 'X', newText: '$& and $1' })
  assert.equal(await readFile(path.join(workspace, 'price.txt'), 'utf8'), 'cost: $& and $1\n')
})

test('a checkpoint restores edited files and removes files the turn created', async () => {
  await writeFile(path.join(workspace, 'keep.txt'), 'original')
  const id = 'turn_one'
  await tools.executeTool('write_file', { path: 'keep.txt', content: 'changed' }, { checkpoint: id })
  await tools.executeTool('edit_file', { path: 'keep.txt', oldText: 'changed', newText: 'changed twice' }, { checkpoint: id })
  await tools.executeTool('write_file', { path: 'made/new.txt', content: 'fresh' }, { checkpoint: id })

  const summary = await tools.checkpointSummary(id)
  assert.deepEqual(summary.files.map((f) => f.path).sort(), ['keep.txt', 'made/new.txt'])

  const result = await tools.restoreCheckpoint(id)
  assert.deepEqual(result.restored, ['keep.txt'])
  assert.deepEqual(result.removed, ['made/new.txt'])
  assert.equal(await readFile(path.join(workspace, 'keep.txt'), 'utf8'), 'original')
  assert.equal(await stat(path.join(workspace, 'made/new.txt')).catch(() => null), null)

  await assert.rejects(() => tools.restoreCheckpoint(id), /expired|does not exist/)
})

test('plan mode never records a checkpoint', async () => {
  await assert.rejects(() =>
    tools.executeTool('write_file', { path: 'x.txt', content: 'a' }, { mode: 'plan', checkpoint: 'turn_plan' }),
  )
  assert.equal(await tools.checkpointSummary('turn_plan'), null)
})

test('project instructions load the first matching file', async () => {
  assert.equal((await tools.readProjectInstructions()).file, '')
  await writeFile(path.join(workspace, 'CLAUDE.md'), 'use tabs')
  assert.equal((await tools.readProjectInstructions()).file, 'CLAUDE.md')
  await writeFile(path.join(workspace, 'MAXCODE.md'), 'use spaces')
  const found = await tools.readProjectInstructions()
  assert.equal(found.file, 'MAXCODE.md')
  assert.equal(found.content, 'use spaces')
})

test('the preview route serves workspace files in a sandbox and refuses everything else', async () => {
  await writeFile(path.join(workspace, 'index.html'), '<h1>hi</h1>')
  await mkdir(path.join(workspace, '.git'), { recursive: true })
  await writeFile(path.join(workspace, '.git', 'config'), 'secret')

  const { server, port } = await startServer({ port: 0 })
  const base = `http://127.0.0.1:${port}`
  try {
    const session = await fetch(`${base}/api/session`, { method: 'POST' })
    const cookie = session.headers.get('set-cookie').split(';')[0]
    const { csrf } = await session.json()
    const open = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { cookie, 'x-maxcode-csrf': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ path: workspace }),
    })
    assert.equal(open.status, 200)
    const { token } = await (await fetch(`${base}/api/preview/token`, { headers: { cookie } })).json()
    assert.ok(token.length >= 16)

    // No cookie on purpose: a sandboxed iframe is a different origin.
    const page = await fetch(`${base}/preview/${token}/`)
    assert.equal(page.status, 200)
    assert.equal(await page.text(), '<h1>hi</h1>')
    assert.match(page.headers.get('content-security-policy'), /^sandbox allow-scripts/)
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN')
    assert.match(page.headers.get('content-type'), /text\/html/)

    assert.equal((await fetch(`${base}/preview/${token}/missing.html`)).status, 404)
    assert.equal((await fetch(`${base}/preview/${token}/.git/config`)).status, 403)
    assert.equal((await fetch(`${base}/preview/${token}/..%2f..%2fetc%2fpasswd`)).status, 403)
    assert.equal((await fetch(`${base}/preview/not-a-real-token-1234567890/`)).status, 401)
    // fetch() ignores a custom Host header, so use a raw request to prove DNS-rebinding hosts are refused.
    const rebound = await new Promise((resolve, reject) => {
      const request = http.request(
        { host: '127.0.0.1', port, path: `/preview/${token}/`, headers: { host: 'evil.example' } },
        (response) => {
          response.resume()
          resolve(response.statusCode)
        },
      )
      request.on('error', reject)
      request.end()
    })
    assert.equal(rebound, 403)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})
