import { useMemo, useState } from 'react'
import { Activity, CalendarDays, Clock3, Coins, Cpu, MessageSquare, Sparkles } from 'lucide-react'
import { useChats } from '../store/chats'
import { useSettings } from '../store/settings'
import { useWorkspace } from '../store/workspace'
import { cn } from '../lib/utils'
import { formatCredits } from '../lib/credits'
import { computeUsage, formatTokens, shortModelName, type UsageRange } from '../lib/usage'
import { PixleSol } from './PixleSol'

const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '30d', label: '30d' },
  { value: '7d', label: '7d' },
]

const HEAT_LEVELS = [
  'bg-raised',
  'bg-accent/20',
  'bg-accent/35',
  'bg-accent/55',
  'bg-accent/80',
]

function heatLevel(count: number, busiest: number) {
  if (count <= 0) return 0
  if (busiest <= 1) return 2
  return Math.min(4, 1 + Math.floor((count / busiest) * 3))
}

function Stat({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line/70 bg-canvas px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <Icon size={12} className="shrink-0 text-faint" />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 truncate text-[20px] font-semibold tracking-[-0.03em] text-ink" title={value}>
        {value}
      </p>
    </div>
  )
}

export function HomeGreeting() {
  const daemon = useSettings((state) => state.daemon)
  const workspace = useWorkspace((state) => state.info)
  const home = daemon?.home ?? ''
  const name = home.split(/[\\/]/).filter(Boolean).pop() || workspace.name || 'there'
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="relative">
        <span className="absolute inset-0 -z-10 m-auto h-16 w-16 rounded-full bg-accent/20 blur-2xl" aria-hidden="true" />
        <PixleSol mood="wave" size={60} />
      </div>
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[34px]">
        What should we build, <span className="text-solar">{name}</span>?
      </h1>
      <p className="-mt-2 text-[13.5px] text-muted">Local-first agent. Your folder, your keys, your machine.</p>
    </div>
  )
}

export function HomeDashboard() {
  const sessions = useChats((state) => state.sessions)
  const [range, setRange] = useState<UsageRange>('30d')
  const [tab, setTab] = useState<'overview' | 'models'>('overview')
  const stats = useMemo(() => computeUsage(sessions, range), [sessions, range])

  const columns = useMemo(() => {
    const weeks: typeof stats.heatmap[] = []
    for (let index = 0; index < stats.heatmap.length; index += 7) {
      weeks.push(stats.heatmap.slice(index, index + 7))
    }
    return weeks
  }, [stats.heatmap])

  const topModelTokens = stats.models[0]?.tokens ?? 0

  return (
    <div className="relative w-full">
      <section className="relative overflow-hidden rounded-xl border border-line bg-panel">
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-3 py-2.5">
          <div className="inline-flex items-center rounded-lg bg-raised p-0.5">
            {(['overview', 'models'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  'h-6 rounded-md px-2.5 text-[11.5px] font-medium capitalize transition-colors',
                  tab === value ? 'bg-panel text-ink shadow-pill' : 'text-muted hover:text-ink',
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-raised p-0.5">
            {RANGES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                onClick={() => setRange(entry.value)}
                className={cn(
                  'h-6 rounded-md px-2.5 text-[11.5px] font-medium transition-colors',
                  range === entry.value ? 'bg-panel text-ink shadow-pill' : 'text-muted hover:text-ink',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'overview' ? (
          <div className="relative p-3">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              <Stat icon={Activity} label="Sessions" value={String(stats.sessions)} />
              <Stat icon={MessageSquare} label="Messages" value={String(stats.messages)} />
              <Stat icon={Sparkles} label="Total tokens" value={stats.tokens ? formatTokens(stats.tokens) : '0'} />
              <Stat icon={Coins} label="Credits spent" value={stats.cost > 0 ? formatCredits(stats.cost) : '—'} />
              <Stat icon={CalendarDays} label="Active days" value={String(stats.activeDays)} />
              <Stat icon={Clock3} label="Peak hour" value={stats.peakHour} />
              <Stat icon={Cpu} label="Favorite model" value={shortModelName(stats.favoriteModel)} />
            </div>

            <div className="mt-3 overflow-x-auto">
              <div className="flex w-max gap-[3px]">
                {columns.map((week, index) => (
                  <div key={index} className="grid grid-rows-7 gap-[3px]">
                    {week.map((day) => (
                      <span
                        key={day.key}
                        className={cn('h-[11px] w-[11px] rounded-[2px]', HEAT_LEVELS[heatLevel(day.count, stats.busiestDay)])}
                        title={`${day.key} · ${day.count} message${day.count === 1 ? '' : 's'}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
              {stats.messages === 0
                ? 'No activity in this range yet. Send a message to start the graph.'
                : `You've used ~${formatTokens(stats.tokens)} tokens across ${stats.messages} messages.`}
              {stats.favoriteModel !== '—' && (
                <>
                  <span className="px-1.5 text-line">·</span>
                  {stats.favoriteShare}% on {shortModelName(stats.favoriteModel)}
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="relative p-3">
            {stats.models.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                <Cpu size={18} className="mx-auto text-faint" />
                <p className="mt-2 text-[12px] font-medium text-ink">No model usage yet</p>
                <p className="mt-1 text-[11px] text-muted">Models appear here after you send a message.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {stats.models.slice(0, 6).map((model) => (
                  <div key={model.model}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[12px] font-medium text-ink" title={model.model}>
                        {shortModelName(model.model)}
                      </span>
                      <span className="shrink-0 text-[10.5px] tabular-nums text-faint">
                        {formatTokens(model.tokens)} · {model.messages} msg{model.cost > 0 ? ` · ${formatCredits(model.cost)}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${topModelTokens ? Math.max(4, (model.tokens / topModelTokens) * 100) : 4}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
