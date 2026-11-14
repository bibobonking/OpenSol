/**
 * Pure helpers for smart compaction (no stores, no network, so node:test can run them).
 *
 * Strategy: keep the most recent turns verbatim, summarise everything older, and carry the
 * previous summary forward instead of summarising a summary. File paths touched are tracked
 * deterministically, so the model cannot forget them.
 */
import type { AssistantMessage, Message, ToolMessage, UserMessage } from '../types'

const CHARS_PER_TOKEN = 3

export const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'rewrite_file'])

export function messageTokens(message: Message): number {
  if (message.role === 'user') {
    const extra = (message.attachments ?? []).reduce((sum, item) => sum + (item.text?.length ?? 0), 0)
    return Math.ceil((message.content.length + extra) / CHARS_PER_TOKEN) + 4
  }
  if (message.role === 'assistant') {
    const calls = message.toolCalls.reduce((sum, call) => sum + JSON.stringify(call.args).length + call.name.length + 10, 0)
    return Math.ceil((message.content.length + message.reasoning.length + calls) / CHARS_PER_TOKEN) + 4
  }
  return Math.ceil((message.result ?? '').length / CHARS_PER_TOKEN) + 4
}

export function tokensOf(messages: Message[]): number {
  return messages.reduce((sum, message) => sum + messageTokens(message), 0)
}

/** Keeps the start and the end of long text, because the end of a log usually matters most. */
export function clip(text: string, limit: number, tailRatio = 0.35): string {
  if (text.length <= limit) return text
  const tail = Math.floor(limit * tailRatio)
  const head = limit - tail
  return `${text.slice(0, head)}\n… [${text.length - limit} characters omitted] …\n${text.slice(text.length - tail)}`
}

export function isSummaryMessage(message: Message | undefined): message is AssistantMessage {
  return Boolean(message && message.role === 'assistant' && message.compaction)
}

export interface CompactionPlan {
  /** Messages [0, cut) are summarised; [cut, end) stay verbatim. */
  cut: number
  head: Message[]
  tail: Message[]
  /** The cut had to land inside the running turn because older turns alone were too small. */
  midTurn: boolean
}

/**
 * Chooses where to cut. The tail always starts at a user message (so provider alternation stays
 * valid and tool calls never lose their results) and is the newest run of turns that fits in
 * `keepTokens`. The newest turn is always kept. Returns null when there is nothing worth cutting.
 */
export function planCompaction(messages: Message[], keepTokens: number, minHeadMessages = 4): CompactionPlan | null {
  const userIndexes: number[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') userIndexes.push(index)
  })
  if (userIndexes.length === 0) return null

  // Walk turns from the newest backwards while they fit in the keep budget.
  let cut = userIndexes[userIndexes.length - 1]
  let kept = tokensOf(messages.slice(cut))
  for (let i = userIndexes.length - 2; i >= 0; i -= 1) {
    const turnTokens = tokensOf(messages.slice(userIndexes[i], userIndexes[i + 1]))
    if (kept + turnTokens > keepTokens) break
    kept += turnTokens
    cut = userIndexes[i]
  }

  // Skip an existing summary pair (task message + summary) at the very start: it is always head.
  if (cut < minHeadMessages) return null
  return { cut, head: messages.slice(0, cut), tail: messages.slice(cut), midTurn: false }
}

/** Previous summary text, when the head starts with `[task user message, summary]`. */
export function previousSummary(head: Message[]): { text: string; files: string[]; skip: number } | null {
  const summary = head[1]
  if (head[0]?.role === 'user' && isSummaryMessage(summary)) {
    return { text: summary.content, files: summary.compaction?.files ?? [], skip: 2 }
  }
  return null
}

/** Paths written or edited by tool calls, newest last, de-duplicated. */
export function collectFiles(messages: Message[], seed: string[] = []): string[] {
  const seen = new Set(seed)
  const ordered = [...seed]
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls) {
      const path = typeof call.args.path === 'string' ? call.args.path : ''
      if (!path || !WRITE_TOOLS.has(call.name)) continue
      if (seen.has(path)) {
        ordered.splice(ordered.indexOf(path), 1)
      }
      seen.add(path)
      ordered.push(path)
    }
  }
  return ordered
}

function toolResultLimit(message: ToolMessage): number {
  const name = message.call.name
  if (message.status === 'error') return 1500
  if (name === 'read_file') return 700 // contents can be re-read; keep only the shape
  if (name === 'write_file' || name === 'edit_file' || name === 'rewrite_file') return 400
  if (name === 'shell') return 2500
  return 1500
}

function callSummary(args: Record<string, unknown>): string {
  const text = JSON.stringify(args)
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

/** Transcript lines, one entry per message, so they can be chunked without splitting a message. */
export function transcriptParts(messages: Message[]): string[] {
  const parts: string[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const names = (message.attachments ?? []).map((item) => item.name)
      parts.push(`[USER]\n${clip(message.content, 6000)}${names.length ? `\n[Attachments: ${names.join(', ')}]` : ''}`)
    } else if (message.role === 'assistant') {
      const lines: string[] = []
      if (message.content.trim()) lines.push(clip(message.content.trim(), 4000))
      for (const call of message.toolCalls) lines.push(`→ ${call.name} ${callSummary(call.args)}`)
      if (lines.length) parts.push(`[ASSISTANT]\n${lines.join('\n')}`)
    } else {
      const status = message.status === 'done' ? 'ok' : message.status
      parts.push(`[RESULT ${message.call.name} · ${status}]\n${clip(message.result ?? '', toolResultLimit(message))}`)
    }
  }
  return parts
}

/** Groups transcript parts into chunks under `maxChars`; one oversized part gets its own chunk. */
export function chunkParts(parts: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let size = 0
  for (const part of parts) {
    if (current.length && size + part.length > maxChars) {
      chunks.push(current.join('\n\n---\n\n'))
      current = []
      size = 0
    }
    current.push(part)
    size += part.length + 9
  }
  if (current.length) chunks.push(current.join('\n\n---\n\n'))
  return chunks
}

/** Used when the model cannot summarise: a lossy but deterministic record of the session. */
export function fallbackSummary(head: Message[], previous: string, files: string[]): string {
  const asks = head
    .filter((message): message is UserMessage => message.role === 'user')
    .map((message) => `- ${clip(message.content.trim().replace(/\s+/g, ' '), 300)}`)
  const lastAnswer = [...head]
    .reverse()
    .find((message): message is AssistantMessage => message.role === 'assistant' && Boolean(message.content.trim()))
  const toolCount = head.filter((message) => message.role === 'tool').length
  return [
    previous ? `## Earlier summary\n${previous}` : '',
    '## User requests so far',
    asks.slice(-12).join('\n') || '- (none)',
    lastAnswer ? `## Last assistant conclusion\n${clip(lastAnswer.content.trim(), 1500)}` : '',
    `## Activity\n${toolCount} tool calls were made. This summary was built without the model, so details may be missing: re-read files before relying on them.`,
    files.length ? `## Files changed\n${files.map((file) => `- ${file}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** A short, verbatim look at the newest steps, for compaction in the middle of a running turn. */
export function recentSteps(messages: Message[], count = 4): string {
  const steps: string[] = []
  for (let i = messages.length - 1; i >= 0 && steps.length < count; i -= 1) {
    const message = messages[i]
    if (message.role !== 'tool') continue
    steps.push(`• ${message.call.name} ${callSummary(message.call.args)} → ${message.status}\n${clip(message.result ?? '', 1200)}`)
  }
  return steps.reverse().join('\n\n')
}
