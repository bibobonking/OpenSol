import { Service, type Context } from 'cordis'
import type { AssistantMessage, Message, ModelInfo, UserMessage } from '../../types'
import { createId } from '../../store/chats'
import { activeModelId, useSettings } from '../../store/settings'
import { findModel } from '../../store/models'
import { useRuntime } from '../../store/ui'
import { AUTO_COMPACT_THRESHOLD, contextLimit, estimateSessionTokens } from '../../lib/context'
import { backoffMs, classifyProviderError } from '../../lib/retry'
import {
  chunkParts,
  clip,
  collectFiles,
  fallbackSummary,
  planCompaction,
  previousSummary,
  recentSteps,
  tokensOf,
  transcriptParts,
} from '../../lib/compact-plan'

const SYSTEM = `You are a session compactor for a coding agent. Produce a dense, structured summary that REPLACES the conversation, so the agent can continue as if it had seen everything.

You may receive <previous_summary> (an earlier compaction) and <new_transcript> (what happened after it). Merge them into ONE updated summary: keep what is still true and relevant, drop what was superseded or finished long ago, and never invent facts.

Write these sections (omit a section only if it is truly empty):

## Goal
What the user wants overall, with their constraints, preferences and style requirements in their own words.

## Done
Concrete outcomes: what was built or changed (file paths, function names), commands that mattered with their key results, bugs found and how they were fixed, decisions made and why.

## State
The exact current state of the workspace and what has been verified (tests, builds) versus assumed. Anything broken or half-finished.

## Next
The ordered next steps. Quote the user's latest request verbatim if it is not finished.

## Facts
Technical facts the agent would otherwise have to rediscover: versions, commands to run checks, architecture notes, pitfalls, error messages worth remembering.

Rules: keep exact paths, identifiers, commands and error text; do not paste large file contents; do not list every file touched (a tracked file list is appended automatically); no preamble or closing remarks; stay under about 1500 words.`

const TRANSIENT_ATTEMPTS = 2
const SUMMARY_PREFIX = '[Summary of the earlier conversation — the original messages were compacted to save context]\n\n'

export interface CompactOptions {
  /** Extra instructions for the summary, e.g. "focus on the auth bug". */
  focus?: string
  /** The user asked for it: report problems instead of failing silently. */
  manual?: boolean
  /** Called while the agent is mid-turn: the running request is carried over in a handoff message. */
  midTurn?: boolean
}

function notice(message: string, tone: 'info' | 'success' | 'error') {
  window.dispatchEvent(new CustomEvent('maxcode:notice', { detail: { message, tone } }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function formatK(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

const compacting = new Set<string>()

export function isCompacting(sessionId: string): boolean {
  return compacting.has(sessionId)
}

/** Provider-reported prompt size of the newest reply beats our character estimate when it is larger. */
export function usedTokens(messages: Message[]): number {
  const estimate = estimateSessionTokens(messages) + 2_000
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant' && message.usage?.input) {
      const reported = message.usage.input + (message.usage.output ?? 0) + estimateSessionTokens(messages.slice(index + 1))
      return Math.max(estimate, reported)
    }
  }
  return estimate
}

export class CompactionService extends Service {
  static provide = 'compaction'
  static inject = ['sessions', 'llm']

  constructor(ctx: Context) {
    super(ctx, 'compaction')
  }

  isCompacting(sessionId: string): boolean {
    return isCompacting(sessionId)
  }

  /**
   * Compacts when the context is nearly full. `midTurn` is for a running turn: it checks again after
   * tool rounds, because one long turn can fill the window without a new user message.
   */
  async checkAutoCompact(sessionId: string, { midTurn = false }: { midTurn?: boolean } = {}): Promise<boolean> {
    const session = this.ctx.sessions.current(sessionId)
    if (!session || session.messages.length < 4 || isCompacting(sessionId)) return false
    const settings = useSettings.getState()
    const model = findModel(settings.provider, activeModelId(settings))
    const ratio = usedTokens(session.messages) / contextLimit(model)
    if (ratio < AUTO_COMPACT_THRESHOLD) return false
    notice(`Context at ${Math.min(Math.round(ratio * 100), 100)}% — compacting before the next request…`, 'info')
    return await this.compact(sessionId, { midTurn })
  }

  /** Returns true when the transcript was rewritten. Never throws. */
  async compact(sessionId: string, options: CompactOptions = {}): Promise<boolean> {
    if (compacting.has(sessionId)) return false
    compacting.add(sessionId)
    useRuntime.getState().setCompacting(sessionId, true)
    try {
      return await this.run(sessionId, options)
    } catch (error) {
      notice(`Compaction failed: ${error instanceof Error ? error.message : 'unknown error'}. Context was left unchanged.`, 'error')
      return false
    } finally {
      compacting.delete(sessionId)
      useRuntime.getState().setCompacting(sessionId, false)
    }
  }

  private async run(sessionId: string, options: CompactOptions): Promise<boolean> {
    const session = this.ctx.sessions.current(sessionId)
    if (!session) return false
    const messages = session.messages
    const settings = useSettings.getState()
    const modelId = activeModelId(settings)
    if (!modelId) return false
    const model = findModel(settings.provider, modelId)
    const limit = contextLimit(model)
    const before = usedTokens(messages)

    // Where to cut: older turns are summarised, the newest ones stay verbatim.
    const keepTokens = Math.min(Math.floor(limit * 0.3), 60_000)
    let plan = options.midTurn ? null : planCompaction(messages, keepTokens)
    const last = messages[messages.length - 1]
    if (!plan) {
      if (messages.length < 4) {
        if (options.manual) notice('Nothing to compact yet.', 'info')
        return false
      }
      // One long turn: summarise everything before the newest user message, or (mid-turn) everything.
      if (last.role === 'user' && !options.midTurn) {
        plan = { cut: messages.length - 1, head: messages.slice(0, -1), tail: [last], midTurn: false }
      } else {
        plan = { cut: messages.length, head: messages.slice(), tail: [], midTurn: true }
      }
    }
    if (plan.head.length < 3) {
      if (options.manual) notice('Nothing to compact yet.', 'info')
      return false
    }

    const previous = previousSummary(plan.head)
    const fresh = plan.head.slice(previous?.skip ?? 0)
    const files = collectFiles(fresh, previous?.files ?? [])

    let summary: string
    let fallback = false
    try {
      summary = await this.summarise(model, previous?.text ?? '', fresh, options.focus)
    } catch (error) {
      const ratio = before / limit
      if (!options.manual && ratio < 0.95) {
        notice(`Auto-compact failed: ${error instanceof Error ? error.message : 'unknown error'}. Continuing with full context.`, 'error')
        return false
      }
      if (options.manual) {
        notice(`Compaction failed: ${error instanceof Error ? error.message : 'unknown error'}.`, 'error')
        return false
      }
      summary = fallbackSummary(fresh, previous?.text ?? '', files)
      fallback = true
    }
    if (!summary.trim()) return false

    const now = Date.now()
    const trigger = options.midTurn ? 'mid-turn' : options.manual ? 'manual' : 'auto'
    const first = messages.find((message): message is UserMessage => message.role === 'user')
    const next: Message[] = []
    if (first) {
      const names = (first.attachments ?? []).map((item) => item.name)
      next.push({
        ...first,
        content: `${clip(first.content, 8_000)}${names.length ? `\n[Attachments: ${names.join(', ')}]` : ''}`,
        attachments: undefined,
      })
    }
    const summaryMessage: AssistantMessage = {
      id: createId('msg'),
      role: 'assistant',
      content: `${SUMMARY_PREFIX}${summary.trim()}${files.length ? `\n\n## Files changed (tracked)\n${files.map((file) => `- ${file}`).join('\n')}` : ''}`,
      reasoning: '',
      toolCalls: [],
      round: 0,
      model: modelId,
      provider: settings.provider,
      createdAt: now,
      durationMs: 0,
      compaction: {
        files,
        turns: plan.head.filter((message) => message.role === 'user').length,
        toolCalls: plan.head.filter((message) => message.role === 'tool').length,
        at: now,
        trigger,
        fallback: fallback || undefined,
      },
    }
    next.push(summaryMessage)

    if (plan.tail.length > 0) {
      next.push(...plan.tail)
    } else if (options.midTurn) {
      const lastUser = [...messages].reverse().find((message): message is UserMessage => message.role === 'user')
      const steps = recentSteps(messages)
      next.push({
        id: createId('msg'),
        role: 'user',
        content: [
          '[Context compacted while you were working. The summary above is the record so far.]',
          lastUser ? `The request you are working on:\n${clip(lastUser.content.trim(), 6_000)}` : '',
          steps ? `Most recent steps (verbatim):\n${steps}` : '',
          'Continue from exactly here. Do not redo completed work.',
        ]
          .filter(Boolean)
          .join('\n\n'),
        attachments: lastUser?.attachments,
        createdAt: now,
      })
    }

    const after = tokensOf(next) + 2_000
    if (after >= before) {
      if (options.manual) notice('Compaction would not free any space, so nothing changed.', 'info')
      return false
    }

    // Rewrite only if the transcript did not change while we were summarising.
    const latest = this.ctx.sessions.current(sessionId)
    if (!latest || latest.messages.length !== messages.length || latest.messages[latest.messages.length - 1]?.id !== last.id) {
      if (options.manual) notice('The conversation changed while compacting, so nothing was changed. Try again.', 'info')
      return false
    }
    this.ctx.sessions.updateSession(sessionId, { messages: next })
    const kept = plan.tail.filter((message) => message.role === 'user').length
    notice(
      `Context compacted: ${formatK(before)} → ${formatK(after)} tokens${kept > 1 ? ` · kept the last ${kept} turns` : ''}${fallback ? ' · summary built without the model' : ''}.`,
      fallback ? 'info' : 'success',
    )
    return true
  }

  /** Rolling summary: each chunk of transcript updates the running summary, so huge sessions still fit. */
  private async summarise(model: ModelInfo | null, previous: string, messages: Message[], focus?: string): Promise<string> {
    const maxChars = Math.min(Math.floor(contextLimit(model) * 0.45 * 3), 120_000)
    const chunks = chunkParts(transcriptParts(messages), Math.max(maxChars, 12_000))
    let summary = previous
    for (let index = 0; index < chunks.length; index += 1) {
      const last = index === chunks.length - 1
      const request = [
        summary ? `<previous_summary>\n${summary}\n</previous_summary>` : '',
        `<new_transcript part="${index + 1}/${chunks.length}">\n${chunks[index]}\n</new_transcript>`,
        focus?.trim() && last ? `<focus>\n${focus.trim()}\n</focus>\nGive extra weight to the focus above.` : '',
        'Write the updated summary now.',
      ]
        .filter(Boolean)
        .join('\n\n')
      summary = await this.complete(model, request)
    }
    return summary
  }

  private async complete(model: ModelInfo | null, prompt: string): Promise<string> {
    const settings = useSettings.getState()
    const controller = new AbortController()
    for (let attempt = 1; ; attempt += 1) {
      let text = ''
      try {
        const result = await this.ctx.llm.stream({
          settings,
          model,
          history: [{ id: createId('msg'), role: 'user', content: prompt, createdAt: Date.now() }],
          system: SYSTEM,
          mode: 'plan',
          tools: [],
          signal: controller.signal,
          handlers: {
            onText: (delta) => {
              text += delta
            },
            onReasoning: () => undefined,
            onToolCalls: () => undefined,
            onUsage: () => undefined,
          },
        })
        return (result.content || text).trim()
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (attempt >= TRANSIENT_ATTEMPTS || !classifyProviderError(message).retry) throw error
        await sleep(backoffMs(attempt, message))
      }
    }
  }
}
