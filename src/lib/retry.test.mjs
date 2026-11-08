import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PROVIDER_RETRIES, isRetryableProviderError, retryDelayMs } from './retry.ts'

test('provider hiccups are retried, auth and validation errors are not', () => {
  assert.equal(isRetryableProviderError('429 Too Many Requests'), true)
  assert.equal(isRetryableProviderError('503 Service Unavailable'), true)
  assert.equal(isRetryableProviderError('socket hang up: ECONNRESET'), true)
  assert.equal(isRetryableProviderError('401 Unauthorized: invalid api key'), false)
  assert.equal(isRetryableProviderError('400 invalid request: unknown field'), false)
})

test('five retries with a capped backoff', () => {
  assert.equal(MAX_PROVIDER_RETRIES, 5)
  assert.equal(retryDelayMs(1), 1200)
  assert.equal(retryDelayMs(5), 8000)
})
