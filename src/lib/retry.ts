/** Automatic retries for provider hiccups: overload, rate limits, 5xx and dropped connections. */
export const MAX_PROVIDER_RETRIES = 5

const RETRYABLE =
  /\b(408|409|425|429|500|502|503|504|522|524|529)\b|rate.?limit|overloaded|temporar|timed out|could not be reached|lost the connection|failed to fetch|networkerror|econnreset|etimedout|enotfound|eai_again/i

export function isRetryableProviderError(message: string): boolean {
  return RETRYABLE.test(message)
}

export function retryDelayMs(attempt: number): number {
  return Math.min(1200 * attempt * attempt, 8000)
}
