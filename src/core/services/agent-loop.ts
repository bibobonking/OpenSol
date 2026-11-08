import { Service, type Context } from 'cordis'
import type { AssistantMessage, ToolMessage } from '../../types'
import { activeModelId, useSettings } from '../../store/settings'
import { createId } from '../../store/chats'
import { findModel } from '../../store/models'
import { useRuntime } from '../../store/ui'
import { getProviderName } from '../../data/providers'
import { describeRequestError } from '../../lib/sse'
import { messageCost } from '../../lib/credits'
import { MAX_RETRIES, backoffMs, classifyProviderError } from '../../lib/retry'
import type { AdapterResult } from '../../agent/adapters/shared'
import { createTurnQueue, lastUserMessageId } from '../../agent/queue'
import { resolveToolSetting } from '../mcp-tools'
import type { StepContext, StepResult, TurnResult } from '../types'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function truncate(value: string, limit = 40_000) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… truncated (${value.length - limit} more characters)`
}

export class AgentLoopService extends Service {
  static provide = 'agentLoop'
  static inject = ['sessions', 'systemPrompt', 'tools', 'llm', 'approval', 'compaction', 'subagents']

  private controllers = new Map<string, AbortController>()
  private queue = createTurnQueue((sessionId, turnId) => this.runTurn(sessionId, turnId))

  constructor(ctx: Context) {
    super(ctx, 'agentLoop')
  }

  isBusy(sessionId: string): boolean {
    return this.queue.isBusy(sessionId)
  }

  stopRun(sessionId: string): void {
    this.queue.clear(sessionId)
    this.controllers.get(sessionId)?.abort()
    void this.ctx.events.serial('agent/turn-stopping', sessionId)
  }

  stopAllRuns(): void {
    this.queue.clearAll()
    this.controllers.forEach((controller, sessionId) => {
      controller.abort()
      void this.ctx.events.serial('agent/turn-stopping', sessionId)
    })
  }

  runAgent(sessionId: string, userMessageId?: string): void {
    const session = this.ctx.sessions.current(sessionId)
    if (!session) return
    const turnId = userMessageId ?? lastUserMessageId(session.messages)
    if (!turnId) return
    void this.queue.push(sessionId, turnId)
  }

  regenerateLastTurn(sessionId: string): boolean {
    const session = this.ctx.sessions.current(sessionId)
    if (!session || this.queue.isBusy(sessionId)) return false
    let lastUser = -1
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      if (session.messages[index].role === 'user') {
        lastUser = index
        break
      }
    }
    if (lastUser < 0) return false
    const userMessageId = session.messages[lastUser].id
    this.ctx.sessions.updateSession(sessionId, {
      messages: session.messages.slice(0, lastUser + 1),
    })
    this.runAgent(sessionId, userMessageId)
    return true
  }

  private async runTurn(sessionId: string, userMessageId: string): Promise<void> {
    const session = this.ctx.sessions.current(sessionId)
    if (!session) return
    if (!this.ctx.sessions.turnHistory(session.messages, userMessageId)) return

    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    useRuntime.getState().setStreaming(sessionId, true)
    const settings = useSettings.getState()
    const providerName = getProviderName(settings.provider)
    const mode = session.mode ?? settings.mode
    const startedAt = Date.now()
    let totalRounds = 0
    let turnError: string | undefined

    try {
      // No round cap: the turn ends when the model stops calling tools, errors, or the user stops it.
      rounds: for (let round = 0; ; round += 1) {
        totalRounds = round + 1
        if (controller.signal.aborted) break
        let current = this.ctx.sessions.current(sessionId)
        if (!current) break

        // Auto-compaction check before round 0
        // A prompt queued behind this turn would be dropped by the rewrite, so wait until it is the last one.
        if (round === 0 && lastUserMessageId(current.messages) === userMessageId) {
          const compacted = await this.ctx.compaction.checkAutoCompact(sessionId)
          if (compacted) {
            // Compaction rewrites the whole transcript, so the original user message
            // is gone: continue from the handoff message and the fresh session state.
            const refreshed = this.ctx.sessions.current(sessionId)
            if (!refreshed) break
            const handoffId = lastUserMessageId(refreshed.messages)
            if (!handoffId) break
            userMessageId = handoffId
            current = refreshed
          }
        }

        const history = this.ctx.sessions.turnHistory(current.messages, userMessageId)
        if (!history) break

        const assistantId = createId('msg')
        const assistant: AssistantMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          reasoning: '',
          toolCalls: [],
          round,
          model: activeModelId(settings),
          provider: settings.provider,
          createdAt: Date.now(),
        }
        this.ctx.sessions.addMessage(sessionId, assistant)

        let streamedContent = ''
        let streamedReasoning = ''
        let flushTimer: number | undefined
        let usage: AdapterResult['usage'] = {}

        const flush = () => {
          if (flushTimer !== undefined) return
          flushTimer = window.setTimeout(() => {
            flushTimer = undefined
            this.ctx.sessions.updateMessage(sessionId, assistantId, {
              content: streamedContent,
              reasoning: streamedReasoning,
            })
          }, 40)
        }

        const stepContext: StepContext = {
          sessionId,
          round,
          history,
          settings,
          mode,
          signal: controller.signal,
          assistantId,
        }

        // agent/pre-step waterfall
        await this.ctx.events.waterfall('agent/pre-step', stepContext, () => undefined)

        let result: AdapterResult
        let attempt = 0
        for (;;) {
          try {
            result = await this.ctx.llm.stream({
              settings,
              model: findModel(settings.provider, activeModelId(settings)),
              history,
              system: this.ctx.systemPrompt.assemble(settings, mode, sessionId),
              mode,
              signal: controller.signal,
              handlers: {
                onText: (delta) => {
                  streamedContent += delta
                  flush()
                },
                onReasoning: (delta) => {
                  streamedReasoning += delta
                  flush()
                },
                onToolCalls: () => undefined,
                onUsage: (value) => {
                  usage = value
                },
              },
            })
            break
          } catch (error) {
            const stopped = isAbortError(error) || controller.signal.aborted
            // Only retry when nothing reached the screen yet, so a retry never duplicates text.
            const message = error instanceof Error ? error.message : ''
            const decision = classifyProviderError(message)
            const retryable =
              !stopped && decision.retry && attempt < MAX_RETRIES && !streamedContent && !streamedReasoning
            if (retryable) {
              attempt += 1
              const wait = backoffMs(attempt, message)
              window.dispatchEvent(
                new CustomEvent('maxcode:notice', {
                  detail: {
                    message: `${providerName} had a temporary error. Retrying in ${Math.round(wait / 1000)}s (${attempt}/${MAX_RETRIES})…`,
                    tone: 'info',
                  },
                }),
              )
              await sleep(wait, controller.signal)
              continue
            }
            if (flushTimer !== undefined) window.clearTimeout(flushTimer)
            turnError = stopped ? undefined : describeRequestError(error, providerName)
            this.ctx.sessions.updateMessage(sessionId, assistantId, {
              content: streamedContent,
              reasoning: streamedReasoning,
              stopped,
              durationMs: Date.now() - startedAt,
              error: turnError,
            })
            await this.ctx.events.waterfall('agent/request-error', error, stepContext, () => undefined)
            break rounds
          }
        }

        if (flushTimer !== undefined) window.clearTimeout(flushTimer)
        this.ctx.sessions.updateMessage(sessionId, assistantId, {
          content: result.content,
          reasoning: result.reasoning,
          thinkingBlocks: result.thinkingBlocks,
          toolCalls: result.toolCalls,
          usage: usage.input || usage.output ? usage : result.usage,
          cost: messageCost(
            usage.input || usage.output ? usage : result.usage,
            findModel(settings.provider, activeModelId(settings)),
          ),
          durationMs: Date.now() - startedAt,
          stopped: controller.signal.aborted || undefined,
        })
        this.ctx.sessions.updateSession(sessionId, {
          provider: settings.provider,
          model: activeModelId(settings),
          mode,
        })

        if (controller.signal.aborted) break
        if (result.toolCalls.length === 0) {
          const stepResult: StepResult = {
            sessionId,
            round,
            assistant,
            toolResults: [],
            stopped: controller.signal.aborted,
          }
          this.ctx.events.emit('agent/step-finish', stepResult)
          break
        }

        const toolMessages: ToolMessage[] = []

        for (const call of result.toolCalls) {
          if (controller.signal.aborted) break
          const toolSetting = resolveToolSetting(settings, call.name)
          if (!toolSetting?.enabled) {
            const message: ToolMessage = {
              id: createId('tool'),
              role: 'tool',
              call,
              status: 'error',
              result: 'This tool is disabled in Settings → Tools.',
              round,
              createdAt: Date.now(),
            }
            this.ctx.sessions.addMessage(sessionId, message)
            toolMessages.push(message)
            continue
          }

          const toolMessageId = createId('tool')
          const awaiting = toolSetting.approval === 'ask'
          const toolMessage: ToolMessage = {
            id: toolMessageId,
            role: 'tool',
            call,
            status: awaiting ? 'awaiting' : 'running',
            round,
            createdAt: Date.now(),
          }
          this.ctx.sessions.addMessage(sessionId, toolMessage)

          const toolStarted = Date.now()
          try {
            const output =
              call.name === 'subagent'
                ? {
                    output: truncate(
                      await this.ctx.subagents.run(
                        typeof call.args.task === 'string' ? call.args.task : '',
                        typeof call.args.context === 'string' ? call.args.context : '',
                        controller.signal,
                        sessionId,
                      ),
                    ),
                    isError: false,
                  }
                : await this.ctx.tools.execute(
                    call.name,
                    call.args,
                    settings,
                    mode,
                    controller.signal,
                    call.id,
                    userMessageId,
                  )
            const finalToolMessage: ToolMessage = {
              ...toolMessage,
              status: output.isError ? 'error' : 'done',
              result: output.output,
              durationMs: Date.now() - toolStarted,
              diff: output.diff,
            }
            this.ctx.sessions.updateMessage(sessionId, toolMessageId, finalToolMessage)
            toolMessages.push(finalToolMessage)
          } catch (error) {
            const stopped = isAbortError(error)
            const finalToolMessage: ToolMessage = {
              ...toolMessage,
              status: 'error',
              result: stopped ? 'Stopped.' : error instanceof Error ? error.message : 'The tool failed.',
              durationMs: Date.now() - toolStarted,
            }
            this.ctx.sessions.updateMessage(sessionId, toolMessageId, finalToolMessage)
            toolMessages.push(finalToolMessage)
            if (stopped) break
          }
        }

        const stepResult: StepResult = {
          sessionId,
          round,
          assistant,
          toolResults: toolMessages,
          stopped: controller.signal.aborted,
        }
        this.ctx.events.emit('agent/step-finish', stepResult)

        if (controller.signal.aborted) {
          const latest = this.ctx.sessions.current(sessionId)
          if (latest) {
            const recorded = new Set(
              latest.messages
                .filter((message): message is ToolMessage => message.role === 'tool')
                .map((message) => message.call.id),
            )
            for (const call of result.toolCalls) {
              if (recorded.has(call.id)) continue
              this.ctx.sessions.addMessage(sessionId, {
                id: createId('tool'),
                role: 'tool',
                call,
                status: 'error',
                result: 'Stopped before the tool ran.',
                round,
                createdAt: Date.now(),
              })
            }
          }
          break
        }
      }
    } finally {
      this.controllers.delete(sessionId)
      useRuntime.getState().setStreaming(sessionId, false)
      const turnResult: TurnResult = {
        sessionId,
        userMessageId,
        rounds: totalRounds,
        durationMs: Date.now() - startedAt,
        stopped: controller.signal.aborted,
        error: turnError,
      }
      this.ctx.events.emit('agent/turn-finish', turnResult)
    }
  }
}
