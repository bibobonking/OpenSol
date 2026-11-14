/**
 * Decides whether a provider error is worth retrying.
 *
 * Transient problems (rate-limit bursts, overload, 5xx, dropped connections) are retried.
 * Permanent ones (quota or credits exhausted, bad key, bad request, context too long) never are,
 * because waiting cannot fix them. A 429 that says the quota or limit was *reached* is permanent too.
 */
export const MAX_RETRIES = 5

const PERMANENT =
  /quota|insufficient[_ ]?(funds|credit|balance)|out of credits?|no credits?|billing|payment required|\b402\b|credit balance|limit (has been )?(reached|exceeded)|reached (the |your )?(\w+ )?limit|exceeded (your |the )?(current )?(quota|limit|plan)|usage limit|monthly limit|daily limit|spend(ing)? limit|invalid[_ ]?(api[_ ]?)?key|incorrect api key|unauthori[sz]ed|\b401\b|\b403\b|forbidden|permission|not found|\b404\b|invalid[_ ]request|\b400\b|context (length|window)|too many tokens|maximum context|content[_ ]policy|safety|model .*(not|does not)|credentials|deprecated/i

const TRANSIENT =
  /\b(429|500|502|503|504|520|521|522|523|524|529)\b|rate.?limit|too many requests|overloaded|capacity|temporar|try again|unavailable|timed? ?out|timeout|could not be reached|lost the connection|failed to fetch|networkerror|network error|econnreset|etimedout|socket hang up|bad gateway|gateway|stream (ended|closed)|internal server error|server error/i

export type RetryDecision = { retry: boolean; reason: 'transient' | 'permanent' | 'unknown' }

export function classifyProviderError(message: string): RetryDecision {
  const text = message || ''
  // Short-window throttling ("rate limit … per minute", "retry in 6s") clears by itself, even when it says
  // "reached". Anything about quota, credits, billing or a monthly/daily cap does not.
  const burst = /rate.?limit|too many requests|slow down|per[- ]minute|per[- ]second|requests? per|retry (in|after)|try again (in|later)/i.test(text)
  const hardCap = /quota|credit|billing|balance|usage limit|monthly|daily|spend(ing)? limit|exceeded your (current )?(plan|limit)|payment|\b402\b/i.test(text)
  if (burst && !hardCap && !/invalid|unauthori|forbidden|\b40[0134]\b/i.test(text)) return { retry: true, reason: 'transient' }
  if (PERMANENT.test(text)) return { retry: false, reason: 'permanent' }
  if (TRANSIENT.test(text)) return { retry: true, reason: 'transient' }
  return { retry: false, reason: 'unknown' }
}

/** Seconds the provider asked us to wait ("retry in 12s", "retry-after: 30"), if it said. */
export function retryAfterMs(message: string): number | undefined {
  const match = /(?:retry[- ]after|retry in|try again in|wait)\D{0,6}(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|seconds?|m|min)?/i.exec(message || '')
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  const unit = (match[2] ?? 's').toLowerCase()
  const ms = unit.startsWith('ms') || unit.startsWith('milli') ? value : unit.startsWith('m') && unit !== 'ms' && !unit.startsWith('milli') ? value * 60_000 : value * 1000
  return Math.min(Math.max(ms, 500), 60_000)
}

/** Exponential backoff (1.5s, 3s, 6s, 12s, 24s) with jitter, never shorter than the provider's hint. */
export function backoffMs(attempt: number, message = '', random = Math.random): number {
  const base = Math.min(1500 * 2 ** (attempt - 1), 24_000)
  const jittered = base * (0.8 + random() * 0.4)
  return Math.round(Math.max(jittered, retryAfterMs(message) ?? 0))
}
