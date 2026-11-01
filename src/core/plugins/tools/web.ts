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

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing string argument "${key}".`)
  return value
}

export const name = 'tool-web'
export const inject = ['tools']

export function apply(ctx: Context) {
  const unregisters = [
    ctx.tools.register({
      name: 'web_search',
      description: 'Search the web for current information. Returns titles, URLs and snippets. Cite URLs you use.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      allowedInMode: () => true,
      async execute(args, exec): Promise<ToolResult> {
        const query = requireString(args, 'query')
        const result = record(
          (
            await executeDaemonTool(
              'web_search',
              { query, provider: exec.settings.searchProvider },
              exec.mode,
              exec.signal,
            )
          ).result,
        )
        const results = Array.isArray(result.results) ? result.results : []
        if (results.length === 0) return { output: 'No results found.', isError: false }
        const formatted = results
          .map((raw, index) => {
            const item = record(raw)
            return `${index + 1}. ${textValue(item.title)}\n   ${textValue(item.url)}${textValue(item.snippet) ? `\n   ${textValue(item.snippet)}` : ''}`
          })
          .join('\n\n')
        return {
          output: truncate(`Search: ${query}\nProvider: ${textValue(result.provider) || 'web'}\n\n${formatted}`),
          isError: false,
        }
      },
    }),

    ctx.tools.register({
      name: 'read_url',
      description: 'Read a public web page as plain text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The http(s) URL to read.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      allowedInMode: () => true,
      async execute(args, exec): Promise<ToolResult> {
        const url = requireString(args, 'url')
        const result = record((await executeDaemonTool('read_url', { url }, exec.mode, exec.signal)).result)
        const title = textValue(result.title)
        return {
          output: truncate(
            `Source: ${textValue(result.url) || url}${title ? `\nTitle: ${title}` : ''}\n\n${textValue(result.content)}${result.truncated === true ? '\n\n… page truncated.' : ''}`,
          ),
          isError: false,
        }
      },
    }),
  ]

  return () => unregisters.forEach((fn) => fn())
}
