import assert from 'node:assert/strict'
import test from 'node:test'
import { backoffMs, classifyProviderError, retryAfterMs } from './retry.ts'

test('retries transient errors', () => {
  for (const message of [
    'OpenAI returned 429: Rate limit reached for requests per minute. Please retry in 6s.',
    'Anthropic is overloaded (529)',
    '503 Service Unavailable',
    'The request timed out',
    'Lost the connection to the local daemon',
    '500 Internal Server Error',
  ]) {
    assert.equal(classifyProviderError(message).retry, true, message)
  }
})

test('never retries limits that were reached or other permanent errors', () => {
  for (const message of [
    'You exceeded your current quota, please check your plan and billing details. (429)',
    'Usage limit reached for this month',
    'insufficient_quota',
    'Insufficient credits. Add credits to continue (402)',
    '401 Invalid API key',
    '403 Forbidden',
    '400 invalid_request_error: context length exceeded',
    '404 model not found',
    'Daily limit reached',
  ]) {
    assert.equal(classifyProviderError(message).retry, false, message)
  }
})

test('unknown errors are not retried', () => {
  assert.equal(classifyProviderError('Something odd happened').retry, false)
})

test('reads provider retry hints and backs off with a floor', () => {
  assert.equal(retryAfterMs('Please retry in 6s'), 6000)
  assert.equal(retryAfterMs('retry-after: 2'), 2000)
  assert.equal(retryAfterMs('nothing here'), undefined)
  assert.equal(backoffMs(1, '', () => 0.5), 1500)
  assert.equal(backoffMs(3, '', () => 0.5), 6000)
  assert.equal(backoffMs(1, 'retry in 10s', () => 0.5), 10000)
})
