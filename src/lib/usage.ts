import type { ChatSession, Message } from '../types'

export type UsageRange = 'all' | '30d' | '7d'

export interface ModelUsage {
  model: string
  messages: number
  tokens: number
}

export interface HeatmapDay {
  key: string
  count: number
  date: number
}

export interface UsageStats {
  sessions: number
  messages: number
  tokens: number
  credits: number
  activeDays: number
  peakHour: string
  favoriteModel: string
  favoriteShare: number
  models: ModelUsage[]
  heatmap: HeatmapDay[]
  busiestDay: number
}

const DAY_MS = 86_400_000
const HEATMAP_WEEKS = 26

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function rangeCutoff(range: UsageRange, now: number): number {
  if (range === 'all') return 0
  return startOfDay(now) - (range === '7d' ? 6 : 29) * DAY_MS
}

function messageTime(message: Message, fallback: number): number {
  return typeof message.createdAt === 'number' ? message.createdAt : fallback
}

function estimateTokens(message: Message): number {
  if (message.role !== 'assistant') return 0
  const usage = message.usage
  if (usage && (usage.input || usage.output)) return (usage.input ?? 0) + (usage.output ?? 0)
  const text = `${message.content ?? ''}${message.reasoning ?? ''}`
  return text.trim() ? Math.ceil(text.length / 4) : 0
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

export function computeUsage(sessions: ChatSession[], range: UsageRange, now = Date.now()): UsageStats {
  const cutoff = rangeCutoff(range, now)
  const filteredSessions = sessions.filter((session) => session.updatedAt >= cutoff)
  const messages: Array<{ message: Message; session: ChatSession }> = []

  for (const session of filteredSessions) {
    for (const message of session.messages) {
      if (messageTime(message, session.updatedAt) >= cutoff) {
        messages.push({ message, session })
      }
    }
  }

  const hours = new Array<number>(24).fill(0)
  const days = new Map<string, HeatmapDay>()
  const models = new Map<string, ModelUsage>()
  let tokens = 0
  let credits = 0

  for (const { message, session } of messages) {
    const at = messageTime(message, session.updatedAt)
    const key = dayKey(at)
    const day = days.get(key)
    if (day) day.count += 1
    else days.set(key, { key, count: 1, date: startOfDay(at) })
    hours[new Date(at).getHours()] += 1

    if (message.role !== 'assistant') continue
    const messageTokens = estimateTokens(message)
    tokens += messageTokens
    if (typeof message.usage?.cost === 'number' && Number.isFinite(message.usage.cost)) {
      credits += Math.max(0, message.usage.cost)
    }
    const model = typeof message.model === 'string' ? message.model.trim() : ''
    if (!model) continue
    const entry = models.get(model) ?? { model, messages: 0, tokens: 0 }
    entry.messages += 1
    entry.tokens += messageTokens
    models.set(model, entry)
  }

  const rankedModels = [...models.values()].sort(
    (a, b) => b.tokens - a.tokens || b.messages - a.messages || a.model.localeCompare(b.model),
  )
  const favorite = rankedModels[0]
  const assistantMessages = messages.filter((entry) => entry.message.role === 'assistant').length

  let peak = 0
  for (let hour = 1; hour < 24; hour += 1) {
    if (hours[hour] > hours[peak]) peak = hour
  }

  const heatmap = buildHeatmap(days, now)
  const busiestDay = heatmap.reduce((max, day) => Math.max(max, day.count), 0)

  return {
    sessions: filteredSessions.length,
    messages: messages.length,
    tokens,
    credits,
    activeDays: days.size,
    peakHour: messages.length ? hourLabel(peak) : '—',
    favoriteModel: favorite?.model ?? '—',
    favoriteShare: favorite && assistantMessages ? Math.round((favorite.messages / assistantMessages) * 100) : 0,
    models: rankedModels,
    heatmap,
    busiestDay,
  }
}

function buildHeatmap(counts: Map<string, HeatmapDay>, now: number): HeatmapDay[] {
  const today = new Date(startOfDay(now))
  const start = new Date(today)
  start.setDate(start.getDate() - start.getDay() - (HEATMAP_WEEKS - 1) * 7)
  const days: HeatmapDay[] = []
  for (let index = 0; index < HEATMAP_WEEKS * 7; index += 1) {
    const date = start.getTime() + index * DAY_MS
    const key = dayKey(date)
    days.push(counts.get(key) ?? { key, count: 0, date })
  }
  return days
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

export function formatCredits(value: number): string {
  if (!value) return '—'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

export function shortModelName(model: string): string {
  if (!model || model === '—') return model
  const parts = model.split('/')
  return parts[parts.length - 1] || model
}
