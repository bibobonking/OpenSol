import type { Context } from 'cordis'
import { executeDaemonTool } from '../../../lib/daemon'
import type { ToolResult } from '../../types'

const MAX_TOOL_OUTPUT = 28_000

function truncate(value: string, limit = MAX_TOOL_OUTPUT) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… truncated (${value.length - limit} more characters)`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing string argument "${key}".`)
  return value
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function formatGrep(result: Record<string, unknown>, pattern: string): string {
  const matches = Array.isArray(result.matches) ? result.matches : []
  if (matches.length === 0) return `No matches for ${pattern}.`
  const lines = matches.map((raw) => {
    const match = record(raw)
    return `${textValue(match.file)}:${numberValue(match.line) ?? 0}: ${textValue(match.text)}`
  })
  const suffix = result.truncated === true ? '\n… more matches exist. Narrow the pattern or path.' : ''
  return lines.join('\n') + suffix
}

export const name = 'tool-grep'
export const inject = ['tools']

export function apply(ctx: Context) {
  return ctx.tools.register({
    name: 'grep',
    description: 'Search workspace contents with a regular expression. Returns path, line and matching text.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for.' },
        path: { type: 'string', description: 'File or folder. Defaults to the workspace root.' },
        ignoreCase: { type: 'boolean', description: 'Case-insensitive search. Defaults to false.' },
        maxResults: { type: 'number', description: 'Maximum matches. Defaults to 80.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args, exec): Promise<ToolResult> {
      const pattern = requireString(args, 'pattern')
      const result = record(
        (
          await executeDaemonTool(
            'grep',
            {
              pattern,
              path: optionalString(args, 'path') ?? '',
              ignoreCase: args.ignoreCase === true,
            },
            exec.mode,
            exec.signal,
          )
        ).result,
      )
      const maxResults = Math.min(Math.max(1, Math.round(numberArg(args, 'maxResults', 80))), 200)
      const matches = Array.isArray(result.matches) ? result.matches.slice(0, maxResults) : []
      const clipped = {
        ...result,
        matches,
        truncated: result.truncated === true || (Array.isArray(result.matches) && result.matches.length > maxResults),
      }
      return { output: truncate(formatGrep(clipped, pattern)), isError: false }
    },
  })
}
