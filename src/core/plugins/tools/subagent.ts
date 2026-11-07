import type { Context } from 'cordis'
import type { ToolResult } from '../../types'

const MAX_TOOL_OUTPUT = 28_000

function truncate(value: string, limit = MAX_TOOL_OUTPUT) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… truncated (${value.length - limit} more characters)`
}

export const name = 'tool-subagent'
export const inject = ['tools', 'subagents']

export function apply(ctx: Context) {
  return ctx.tools.register({
    name: 'subagent',
    description:
      'Delegate a focused investigation to a read-only subagent. Use it to explore a large area, trace a bug or verify assumptions without changing files. The subagent returns a concise report.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The specific question or investigation to perform.' },
        context: { type: 'string', description: 'Optional context, constraints or files to start from.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args, exec): Promise<ToolResult> {
      const task = typeof args.task === 'string' ? args.task : ''
      const context = typeof args.context === 'string' ? args.context : ''
      const output = await ctx.subagents.run(task, context, exec.signal)
      return { output: truncate(output), isError: false }
    },
  })
}
