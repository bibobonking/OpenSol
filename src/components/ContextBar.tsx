/**
 * ContextBar — compact context-usage indicator shown in the TopBar.
 *
 * Displays used / total context tokens and the percentage as plain text. When the session is
 * being compacted it shows a pulsing "Compacting…" state. Colour grades from
 * neutral → warning → danger as the context fills up.
 */

import { useMemo } from 'react'
import type { ModelInfo, Message } from '../types'
import { getContextUsage, AUTO_COMPACT_THRESHOLD } from '../lib/context'
import { isCompacting } from '../agent/compact'
import { formatCredits, sumCost } from '../lib/credits'
import { cn } from '../lib/utils'

interface ContextBarProps {
  messages: Message[]
  model: ModelInfo | null
  sessionId: string | null
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

export function ContextBar({ messages, model, sessionId }: ContextBarProps) {
  const usage = useMemo(() => getContextUsage(messages, model), [messages, model])
  const spent = useMemo(() => sumCost(messages), [messages])
  const compacting = sessionId ? isCompacting(sessionId) : false

  if (messages.length === 0) return null

  const { pct, used, limit } = usage
  const isDanger = pct >= AUTO_COMPACT_THRESHOLD * 100
  const isWarning = pct >= 70 && !isDanger

  return (
    <div
      className={cn(
        'hidden items-baseline gap-1.5 text-[11.5px] tabular-nums text-muted sm:flex',
        isWarning && 'text-warning',
        isDanger && 'text-danger',
      )}
      title={`Context window: ~${used.toLocaleString()} of ${limit.toLocaleString()} tokens used (${pct}%)`}
    >
      {compacting ? (
        <span className="text-shimmer">Compacting…</span>
      ) : (
        <>
          <span className="text-ink/80">{formatTokens(used)}</span>
          <span className="text-faint">/ {formatTokens(limit)} tokens</span>
          <span className="text-faint">·</span>
          <span>{pct}%</span>
          {spent > 0 && (
            <>
              <span className="text-faint">·</span>
              <span className="text-ink/80" title="Credits spent in this session (provider-reported, or tokens × model price)">
                {formatCredits(spent)}
              </span>
            </>
          )}
        </>
      )}
    </div>
  )
}
