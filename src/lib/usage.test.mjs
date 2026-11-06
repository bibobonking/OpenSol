import assert from 'node:assert/strict'
import test from 'node:test'
import { computeUsage, dayKey, formatTokens, shortModelName } from './usage.ts'

const now = new Date(2026, 0, 15, 15, 0, 0, 0).getTime()
const hour = 3_600_000
const day = 86_400_000

function assistant(id, createdAt, model, content = '', usage) {
  return {
    id,
    role: 'assistant',
    content,
    reasoning: '',
    toolCalls: [],
    model,
    usage,
    createdAt,
    round: 0,
  }
}

function session(id, updatedAt, messages) {
  return { id, title: id, createdAt: updatedAt, updatedAt, messages }
}

const sessions = [
  session('recent', now, [
    { id: 'u1', role: 'user', content: 'hello', createdAt: now - hour },
    assistant('a1', now - 2 * hour, 'anthropic/claude-sonnet', 'ok', { input: 100, output: 50 }),
    assistant('a2', now - hour, 'anthropic/claude-sonnet', 'x'.repeat(40)),
  ]),
  session('older', now - 10 * day, [
    assistant('a3', now - 10 * day, 'openai/gpt-5', 'ok', { input: 10, output: 10 }),
  ]),
]

test('counts all sessions and messages', () => {
  const stats = computeUsage(sessions, 'all', now)
  assert.equal(stats.sessions, 2)
  assert.equal(stats.messages, 4)
  assert.equal(stats.tokens, 180)
  assert.equal(stats.activeDays, 2)
  assert.equal(stats.favoriteModel, 'anthropic/claude-sonnet')
  assert.equal(stats.favoriteShare, 67)
  assert.equal(stats.models.length, 2)
})

test('applies the 7 day window', () => {
  const stats = computeUsage(sessions, '7d', now)
  assert.equal(stats.sessions, 1)
  assert.equal(stats.messages, 3)
  assert.equal(stats.tokens, 160)
  assert.equal(stats.favoriteModel, 'anthropic/claude-sonnet')
  assert.equal(stats.peakHour, '2 PM')
})

test('builds a 26 week heatmap that includes the current day', () => {
  const stats = computeUsage(sessions, 'all', now)
  assert.equal(stats.heatmap.length, 26 * 7)
  assert.equal(stats.busiestDay, 3)
  const today = stats.heatmap.find((entry) => entry.key === dayKey(now))
  assert.equal(today?.count, 3)
})

test('formats token counts and model names', () => {
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1_500), '1.5k')
  assert.equal(formatTokens(5_400_000), '5.4M')
  assert.equal(shortModelName('anthropic/claude-sonnet'), 'claude-sonnet')
  assert.equal(shortModelName('gpt-5'), 'gpt-5')
})
