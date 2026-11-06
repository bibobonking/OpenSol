/**
 * ContextBar — compact context-usage indicator shown in the TopBar.
 *
 * Displays a small progress bar and a token percentage. When the session is
 * being compacted it shows a pulsing "Compacting…" state. Colour grades from
 * neutral → warning → danger as the context fills up.
 */

import { useMemo } from 'react'
import { AlertTriangle, Zap } from 'lucide-react'
import type { ModelInfo, Message } from '../types'
import { getContextUsage, AUTO_COMPACT_THRESHOLD } from '../lib/context'
import { isCompacting } from '../agent/compact'
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
  const compacting = sessionId ? isCompacting(sessionId) : false

  if (messages.length === 0) return null

  const { pct, used, limit } = usage
  const isDanger = pct >= AUTO_COMPACT_THRESHOLD * 100
  const isWarning = pct >= 70 && !isDanger

  return (
    <div
      className={cn(
        'hidden h-6 items-center gap-1.5 rounded-full border border-line/60 bg-raised/40 px-2 text-[9.5px] sm:flex',
        isWarning && 'border-warning/30 text-warning',
        isDanger && 'border-danger/30 text-danger',
      )}
      title={`Context: ~${formatTokens(used)} / ${formatTokens(limit)} tokens (${pct}%)`}
    >
      {compacting ? (
        <span className="flex animate-pulse items-center gap-1 text-accent">
          <Zap size={9} className="shrink-0" />
          Compacting…
        </span>
      ) : (
        <>
          {isDanger ? (
            <AlertTriangle size={9} className="shrink-0" />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
          )}
          <div className="relative h-1 w-10 overflow-hidden rounded-full bg-line">
            <div
              className={cn(
                'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                isDanger ? 'bg-danger' : isWarning ? 'bg-warning' : 'bg-accent',
              )}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="tabular-nums">{pct}%</span>
        </>
      )}
    </div>
  )
}
