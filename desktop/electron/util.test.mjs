import assert from 'node:assert/strict'
import test from 'node:test'
import { isLocalUrl, parseListeningPort } from './util.mjs'

test('parseListeningPort reads the daemon port from its startup line', () => {
  assert.equal(parseListeningPort('[opensol] daemon listening on http://127.0.0.1:4317'), 4317)
  assert.equal(parseListeningPort('[opensol] data: /home/me/.opensol'), null)
})

test('isLocalUrl only trusts the loading page and the local daemon', () => {
  assert.equal(isLocalUrl('http://127.0.0.1:4174/'), true)
  assert.equal(isLocalUrl('http://localhost:5173/'), true)
  assert.equal(isLocalUrl('file:///opt/OpenSol/resources/app.asar/loading/index.html'), true)
  assert.equal(isLocalUrl('about:blank'), true)
  assert.equal(isLocalUrl('https://opensol.dev'), false)
  assert.equal(isLocalUrl('mailto:hello@opensoft.dev'), false)
  assert.equal(isLocalUrl('not a url'), false)
})
