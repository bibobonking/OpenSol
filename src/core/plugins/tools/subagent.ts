import type { Context } from 'cordis'
import type { ToolResult } from '../../types'
import { SUBAGENT_TYPES, subagentType } from '../../../lib/subagent-types'

const MAX_TOOL_OUTPUT = 28_000

function truncate(value: string, limit = MAX_TOOL_OUTPUT) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… truncated (${value.length - limit} more characters)`
}

export const name = 'tool-subagent'
export const inject = ['tools', 'subagents']

export function apply(ctx: Context) {
  const kinds = Object.entries(SUBAGENT_TYPES)
    .map(([id, spec]) => `"${id}" (${spec.summary})`)
    .join('; ')
  return ctx.tools.register({
    name: 'subagent',
    description: `Delegate a focused, read-only investigation to a subagent that works in its own context and returns a concise report. Types: ${kinds}. Give it a complete, self-contained task (it cannot see this conversation) and any file paths or constraints as context. To investigate independent questions in parallel, call this tool several times in the same message.`,
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The specific question or investigation. Be precise about what the report must contain.' },
        context: { type: 'string', description: 'Optional context: files to start from, what is already known, constraints.' },
        type: { type: 'string', enum: Object.keys(SUBAGENT_TYPES), description: 'explore (default), research or review.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args, exec): Promise<ToolResult> {
      const report = await ctx.subagents.run({
        task: typeof args.task === 'string' ? args.task : '',
        context: typeof args.context === 'string' ? args.context : '',
        type: subagentType(args.type),
        signal: exec.signal,
        sessionId: exec.sessionId,
        onProgress: exec.onProgress,
      })
      const footer = `\n\n— subagent: ${report.toolCalls} tool call${report.toolCalls === 1 ? '' : 's'}, ${report.rounds} round${report.rounds === 1 ? '' : 's'}${report.capped ? ', stopped at its round budget' : ''}`
      return { output: truncate(report.output) + footer, isError: false }
    },
  })
}
