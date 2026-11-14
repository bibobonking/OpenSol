import type {
  AssistantMessage,
  Message,
  ToolMessage,
  UserMessage,
} from '../types'
import { findModel } from '../store/models'
import { useSettings } from '../store/settings'
import { EMPTY_HANDLERS } from './adapters/shared'
import { streamModel } from './model'
import { buildSubagentPrompt } from './prompt'
import { executeTool } from './tools'

function id(prefix: string) {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  return `${prefix}_${raw}`
}

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}

/**
 * Runs a short read-only investigation for the main agent. It shares the
 * selected model and the encrypted daemon credentials, but never edits files.
 */
export async function runSubagent(
  task: string,
  context: string,
  signal: AbortSignal,
  sessionId?: string,
): Promise<string> {
  const cleanTask = task.trim()
  if (!cleanTask) return 'The subagent was not given a task.'
  if (signal.aborted) throw abortError()

  const settings = useSettings.getState()
  const model = findModel(settings.provider, settings.model)
  const system = buildSubagentPrompt(settings, sessionId)
  const now = Date.now()
  const first: UserMessage = {
    id: id('sub'),
    role: 'user',
    content: [
      `Task: ${cleanTask}`,
      context.trim() ? `\nContext from the main agent:\n${context.trim()}` : '',
      '\nInvestigate now. Return a concise report with file paths and evidence.',
    ]
      .filter(Boolean)
      .join('\n'),
    createdAt: now,
  }
  const history: Message[] = [first]

  for (let round = 0; ; round += 1) {
    if (signal.aborted) throw abortError()
    const result = await streamModel({
      settings,
      model,
      history,
      system,
      mode: 'plan',
      tools: [],
      signal,
      handlers: EMPTY_HANDLERS,
    })
    const assistant: AssistantMessage = {
      id: id('submsg'),
      role: 'assistant',
      content: result.content,
      reasoning: result.reasoning,
      thinkingBlocks: result.thinkingBlocks,
      toolCalls: result.toolCalls,
      round,
      createdAt: Date.now(),
    }
    history.push(assistant)

    if (result.toolCalls.length === 0) return assistant.content.trim() || 'The subagent returned no report.'
    if (signal.aborted) throw abortError()

    for (const call of result.toolCalls) {
      const output = await executeTool(call.name, call.args, settings, 'plan', signal)
      const toolMessage: ToolMessage = {
        id: id('subtool'),
        role: 'tool',
        call,
        status: output.isError ? 'error' : 'done',
        result: output.output,
        round,
        createdAt: Date.now(),
      }
      history.push(toolMessage)
    }
  }
}
