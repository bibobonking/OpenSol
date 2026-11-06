import assert from 'node:assert/strict'
import test from 'node:test'
import { heliumMood, HELIUM_LABELS } from './helium.ts'

const user = { id: 'u', role: 'user', content: 'hi', createdAt: 0 }
const assistant = (patch) => ({
  id: 'a',
  role: 'assistant',
  content: '',
  reasoning: '',
  toolCalls: [],
  round: 0,
  createdAt: 0,
  ...patch,
})
const tool = (status) => ({
  id: 't',
  role: 'tool',
  call: { id: 'c', name: 'read_file', args: {} },
  status,
  round: 0,
  createdAt: 0,
})

test('no messages means Helium waves', () => {
  assert.equal(heliumMood([], false), 'wave')
})

test('reasoning while streaming is thinking', () => {
  assert.equal(heliumMood([user, assistant({ reasoning: 'hmm' })], true), 'thinking')
})

test('streaming with content is typing', () => {
  assert.equal(heliumMood([user, assistant({ reasoning: 'hmm', content: 'so far' })], true), 'typing')
})

test('an awaiting tool needs approval, a failed tool is an error', () => {
  assert.equal(heliumMood([user, tool('awaiting')], true), 'alert')
  assert.equal(heliumMood([user, tool('error')], false), 'error')
})

test('a finished answer is happy, a stopped answer is sleepy', () => {
  assert.equal(heliumMood([user, assistant({ content: 'done' })], false), 'happy')
  assert.equal(heliumMood([user, assistant({ stopped: true })], false), 'sleepy')
})

test('every mood has a label', () => {
  for (const mood of Object.keys(HELIUM_LABELS)) {
    assert.ok(HELIUM_LABELS[mood])
  }
})
