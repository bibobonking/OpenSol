import { Service, type Context } from 'cordis'
import type { AssistantMessage, Message, ToolCall, ToolMessage, UserMessage } from '../../types'
import { createId } from '../../store/chats'
import { activeModelId, useSettings } from '../../store/settings'
import { findModel } from '../../store/models'
import { contextLimit } from '../../lib/context'
import { clip, tokensOf } from '../../lib/compact-plan'
import { MAX_RETRIES, backoffMs, classifyProviderError } from '../../lib/retry'
import { toolSummary } from '../../lib/tool-meta'
import { SUBAGENT_TYPES, type SubagentType } from '../../lib/subagent-types'

const TOOL_OUTPUT_LIMIT = 12_000
const RECENT_RESULTS_KEPT = 8

export interface SubagentRequest {
  task: string
  context?: string
  type?: SubagentType
  signal: AbortSignal
  sessionId?: string
  /** Receives a short live log of what the subagent is doing. */
  onProgress?: (text: string) => void
}

export interface SubagentReport {
  output: string
  rounds: number
  toolCalls: number
  /** Stopped at the round cap and asked to report with what it had. */
  capped: boolean
}

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}

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

/** Replaces old tool outputs with a stub so a long investigation never overflows the window. */
function pruneHistory(history: Message[], budgetTokens: number): void {
  if (tokensOf(history) <= budgetTokens) return
  const tools = history.filter((message): message is ToolMessage => message.role === 'tool')
  for (const message of tools.slice(0, Math.max(0, tools.length - RECENT_RESULTS_KEPT))) {
    if (message.result && message.result.length > 200) {
      message.result = `[earlier output of ${message.call.name} pruned: ${message.result.length} characters]`
    }
  }
}

export class SubagentService extends Service {
  static provide = 'subagents'
  static inject = ['tools', 'llm', 'systemPrompt']

  constructor(ctx: Context) {
    super(ctx, 'subagents')
  }

  async run(request: SubagentRequest): Promise<SubagentReport> {
    const { signal, onProgress } = request
    const task = request.task.trim()
    if (!task) return { output: 'The subagent was not given a task.', rounds: 0, toolCalls: 0, capped: false }
    if (signal.aborted) throw abortError()

    const type = request.type ?? 'explore'
    const spec = SUBAGENT_TYPES[type]
    const settings = useSettings.getState()
    const model = findModel(settings.provider, activeModelId(settings))
    const system = this.ctx.systemPrompt.buildSubagentPrompt(settings, request.sessionId, type)
    const allowed = new Set<string>(spec.tools)
    const tools = this.ctx.tools.schemas(settings, 'plan', { subagent: true }).filter((tool) => allowed.has(tool.name))
    const budget = Math.floor(contextLimit(model) * 0.6)

    const history: Message[] = [
      {
        id: createId('sub'),
        role: 'user',
        content: [
          `Task (${spec.label.toLowerCase()}): ${task}`,
          request.context?.trim() ? `\nContext from the main agent:\n${request.context.trim()}` : '',
          '\nInvestigate now, then write the report.',
        ]
          .filter(Boolean)
          .join('\n'),
        createdAt: Date.now(),
      } satisfies UserMessage,
    ]

    const log: string[] = []
    const progress = (line: string) => {
      log.push(line)
      onProgress?.(`${spec.label} subagent\n${log.slice(-14).join('\n')}`)
    }
    progress('starting…')

    let totalCalls = 0
    let capped = false
    for (let round = 0; ; round += 1) {
      if (signal.aborted) throw abortError()
      // On the last round, withdraw the tools so the model has to write its report.
      const finalRound = round >= spec.maxRounds
      if (finalRound) {
        capped = true
        history.push({
          id: createId('sub'),
          role: 'user',
          content: 'You have used your investigation budget. Write the final report now from what you found, and say what is still unverified.',
          createdAt: Date.now(),
        })
      }
      pruneHistory(history, budget)
      const result = await this.stream(system, history, finalRound ? [] : tools, signal, model)
      const assistant: AssistantMessage = {
        id: createId('sub'),
        role: 'assistant',
        content: result.content,
        reasoning: result.reasoning,
        thinkingBlocks: result.thinkingBlocks,
        toolCalls: result.toolCalls,
        round,
        createdAt: Date.now(),
      }
      history.push(assistant)

      if (result.toolCalls.length === 0 || finalRound) {
        const report = assistant.content.trim()
        return {
          output: report || 'The subagent returned no report.',
          rounds: round + 1,
          toolCalls: totalCalls,
          capped,
        }
      }

      // Read-only calls are independent, so they run together.
      const executed = await Promise.all(
        result.toolCalls.map(async (call: ToolCall): Promise<ToolMessage> => {
          totalCalls += 1
          progress(`${call.name} ${clip(toolSummary(call.name, call.args), 90)}`)
          if (!allowed.has(call.name)) {
            return this.toolMessage(call, round, 'error', `Tool "${call.name}" is not available to this subagent.`)
          }
          try {
            const output = await this.ctx.tools.execute(call.name, call.args, settings, 'plan', signal)
            return this.toolMessage(call, round, output.isError ? 'error' : 'done', clip(output.output, TOOL_OUTPUT_LIMIT))
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') throw error
            return this.toolMessage(call, round, 'error', error instanceof Error ? error.message : 'The tool failed.')
          }
        }),
      )
      history.push(...executed)
    }
  }

  private toolMessage(call: ToolCall, round: number, status: 'done' | 'error', result: string): ToolMessage {
    return { id: createId('sub'), role: 'tool', call, status, result, round, createdAt: Date.now() }
  }

  /** One model call with the same transient-error retry as the main loop. */
  private async stream(
    system: string,
    history: Message[],
    tools: ReturnType<Context['tools']['schemas']>,
    signal: AbortSignal,
    model: ReturnType<typeof findModel>,
  ) {
    const settings = useSettings.getState()
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.ctx.llm.stream({
          settings,
          model,
          history,
          system,
          mode: 'plan',
          tools,
          signal,
          handlers: {
            onText: () => undefined,
            onReasoning: () => undefined,
            onToolCalls: () => undefined,
            onUsage: () => undefined,
          },
        })
      } catch (error) {
        if (signal.aborted) throw abortError()
        const message = error instanceof Error ? error.message : ''
        if (attempt > MAX_RETRIES || !classifyProviderError(message).retry) throw error
        await sleep(backoffMs(attempt, message), signal)
      }
    }
  }
}
