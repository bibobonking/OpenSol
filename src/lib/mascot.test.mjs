import test from 'node:test'
import assert from 'node:assert/strict'
import { MASCOTS, normalizeMascot, normalizeMascotScope, mascotMood } from './mascot.ts'

test('mascot ids normalize and fall back to Helium', () => {
  assert.deepEqual(Object.keys(MASCOTS), ['helium', 'clawd', 'sol', 'byte', 'off'])
  assert.equal(normalizeMascot(undefined), 'helium')
  assert.equal(normalizeMascot('clawd'), 'clawd')
  assert.equal(normalizeMascot('sol'), 'sol')
  assert.equal(normalizeMascot('byte'), 'byte')
  assert.equal(normalizeMascot('off'), 'off')
  assert.equal(normalizeMascot('unknown'), 'helium')
})

test('mascot scope defaults to all', () => {
  assert.equal(normalizeMascotScope(undefined), 'all')
  assert.equal(normalizeMascotScope('home'), 'home')
  assert.equal(normalizeMascotScope('all'), 'all')
  assert.equal(normalizeMascotScope('nope'), 'all')
})

test('mascot mood follows the conversation tail', () => {
  assert.equal(mascotMood([], false), 'wave')
  assert.equal(mascotMood([{ role: 'tool', status: 'awaiting' }], false), 'alert')
  assert.equal(mascotMood([{ role: 'tool', status: 'error' }], false), 'error')
  assert.equal(mascotMood([{ role: 'tool', status: 'done' }], false), 'party')
  assert.equal(mascotMood([{ role: 'assistant', reasoning: 'thinking', content: '', stopped: false }], true), 'thinking')
  assert.equal(mascotMood([{ role: 'assistant', reasoning: '', content: 'answer', stopped: false }], true), 'typing')
  assert.equal(mascotMood([{ role: 'assistant', reasoning: '', content: 'answer', stopped: false }], false), 'happy')
  assert.equal(mascotMood([{ role: 'assistant', reasoning: '', content: '', stopped: true }], false), 'sleepy')
  assert.equal(mascotMood([{ role: 'user', content: 'hi' }], true), 'working')
})
