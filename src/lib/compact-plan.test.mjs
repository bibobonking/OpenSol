import test from 'node:test'
import assert from 'node:assert/strict'
import { planCompaction, collectFiles, clip, chunkParts, previousSummary, transcriptParts, tokensOf } from './compact-plan.ts'

const user = (id, text = 'x'.repeat(300)) => ({ id, role: 'user', content: text, createdAt: 0 })
const asst = (id, calls = [], content = 'ok') => ({ id, role: 'assistant', content, reasoning: '', toolCalls: calls, round: 0, createdAt: 0 })
const tool = (id, name = 'read_file', result = 'r'.repeat(300)) => ({ id, role: 'tool', call: { id: `${id}c`, name, args: {} }, status: 'done', result, round: 0, createdAt: 0 })

const turn = (n) => [user(`u${n}`), asst(`a${n}`, [{ id: `c${n}`, name: 'read_file', args: {} }]), tool(`t${n}`), asst(`b${n}`)]

test('keeps the newest turns that fit and cuts at a user message', () => {
  const messages = [1, 2, 3, 4, 5].flatMap(turn)
  const plan = planCompaction(messages, tokensOf(turn(1)) * 2 + 10)
  assert.ok(plan)
  assert.equal(plan.tail[0].role, 'user')
  assert.equal(plan.tail.filter((m) => m.role === 'user').length, 2)
  assert.equal(plan.head.length + plan.tail.length, messages.length)
})

test('never separates a tool call from its result', () => {
  const messages = [1, 2, 3].flatMap(turn)
  const plan = planCompaction(messages, 1)
  assert.ok(plan)
  assert.equal(plan.tail.length, 4) // only the newest turn, whole
})

test('returns null when there is nothing to cut', () => {
  assert.equal(planCompaction(turn(1), 10_000), null)
  assert.equal(planCompaction([], 100), null)
})

test('tracks written files once, most recent last', () => {
  const calls = (name, path) => asst('a', [{ id: path + name, name, args: { path } }])
  const files = collectFiles([calls('write_file', 'a.ts'), calls('read_file', 'z.ts'), calls('edit_file', 'b.ts'), calls('edit_file', 'a.ts')], ['old.ts'])
  assert.deepEqual(files, ['old.ts', 'b.ts', 'a.ts'])
})

test('clip keeps head and tail', () => {
  const text = `START${'m'.repeat(1000)}END`
  const out = clip(text, 100)
  assert.ok(out.startsWith('START') && out.endsWith('END') && out.length < 200)
  assert.equal(clip('short', 100), 'short')
})

test('chunks never split a part and respect the size', () => {
  const chunks = chunkParts(['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)], 120)
  assert.equal(chunks.length, 2)
  assert.ok(chunks[0].includes('a') && chunks[0].includes('b') && !chunks[0].includes('c'))
})

test('previousSummary reads a [task, summary] pair', () => {
  const summary = { ...asst('s'), content: 'SUM', compaction: { files: ['f.ts'], turns: 2, toolCalls: 3, at: 1, trigger: 'auto' } }
  assert.deepEqual(previousSummary([user('u'), summary, user('u2')]), { text: 'SUM', files: ['f.ts'], skip: 2 })
  assert.equal(previousSummary([user('u'), asst('a')]), null)
})

test('read_file output is trimmed harder than shell output in transcripts', () => {
  const big = 'q'.repeat(5000)
  const [read] = transcriptParts([tool('t1', 'read_file', big)])
  const [shell] = transcriptParts([tool('t2', 'shell', big)])
  assert.ok(read.length < shell.length)
})
