import type { Context } from 'cordis'
import { executeDaemonTool } from '../../../lib/daemon'
import { useWorkspace } from '../../../store/workspace'
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

function formatList(result: Record<string, unknown>): string {
  const entries = Array.isArray(result.entries) ? result.entries : []
  if (entries.length === 0) return 'This folder is empty.'
  const lines = entries.map((raw) => {
    const entry = record(raw)
    const path = textValue(entry.path)
    if (entry.type === 'dir') return `${path}/`
    if (entry.type === 'link') return `${path} -> link`
    return `${path}${numberValue(entry.size) !== undefined ? `  (${numberValue(entry.size)} B)` : ''}`
  })
  const suffix = result.truncated === true ? '\n… listing truncated. Narrow the path or reduce depth.' : ''
  return `${textValue(result.root) ? `Root: ${textValue(result.root)}\n` : ''}${lines.join('\n')}${suffix}`
}

async function refreshWorkspace() {
  await useWorkspace.getState().refresh().catch(() => undefined)
}

export const name = 'tool-fs'
export const inject = ['tools']

export function apply(ctx: Context) {
  const unregisters = [
    ctx.tools.register({
      name: 'read_file',
      description: 'Read a text file from the workspace. Use offset and limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from the workspace root.' },
          offset: { type: 'number', description: '1-based first line. Defaults to 1.' },
          limit: { type: 'number', description: 'Maximum lines. Defaults to 400.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      allowedInMode: () => true,
      async execute(args, exec): Promise<ToolResult> {
        const path = requireString(args, 'path')
        const result = record((await executeDaemonTool('read_file', { path }, exec.mode, exec.signal)).result)
        if (result.binary === true) {
          return { output: `${path} is binary (${numberValue(result.size) ?? 0} bytes).`, isError: false }
        }
        const offset = Math.max(1, Math.round(numberArg(args, 'offset', 1)))
        const limit = Math.min(Math.max(1, Math.round(numberArg(args, 'limit', 400))), 2000)
        const lines = textValue(result.content).split('\n')
        const slice = lines.slice(offset - 1, offset - 1 + limit)
        const remaining = lines.length - (offset - 1 + limit)
        const header = `${textValue(result.path) || path} · ${lines.length} lines${result.truncated === true ? ' · file clipped by daemon' : ''}`
        const footer = remaining > 0 ? `\n… ${remaining} more lines. Read again with offset ${offset + limit}.` : ''
        return { output: truncate(`${header}\n────\n${slice.join('\n')}${footer}`), isError: false }
      },
    }),

    ctx.tools.register({
      name: 'list_files',
      description: 'List files and folders below a workspace path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Folder path. Defaults to the workspace root.' },
          depth: { type: 'number', description: 'Recursion depth, 1–8. Defaults to 3.' },
        },
        additionalProperties: false,
      },
      allowedInMode: () => true,
      async execute(args, exec): Promise<ToolResult> {
        const result = record(
          (
            await executeDaemonTool(
              'list_files',
              {
                path: optionalString(args, 'path') ?? '',
                depth: Math.min(Math.max(1, numberArg(args, 'depth', 3)), 8),
              },
              exec.mode,
              exec.signal,
            )
          ).result,
        )
        return { output: formatList(result), isError: false }
      },
    }),

    ctx.tools.register({
      name: 'write_file',
      description: 'Create a file or replace its full contents. Prefer edit_file for small changes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          content: { type: 'string', description: 'Complete file content.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      allowedInMode: (mode) => mode === 'build',
      async execute(args, exec): Promise<ToolResult> {
        const path = requireString(args, 'path')
        const content = requireString(args, 'content')
        const result = record((await executeDaemonTool('write_file', { path, content }, exec.mode, exec.signal)).result)
        await refreshWorkspace()
        const verb = result.created === true ? 'Created' : 'Updated'
        return {
          output: `${verb} ${textValue(result.path) || path} · ${content.split('\n').length} lines, ${numberValue(result.size) ?? content.length} bytes.`,
          isError: false,
        }
      },
    }),

    ctx.tools.register({
      name: 'rewrite_file',
      description: 'Replace the complete contents of an existing file. Use when most of the file changes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          content: { type: 'string', description: 'The new complete file content.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      allowedInMode: (mode) => mode === 'build',
      async execute(args, exec): Promise<ToolResult> {
        const path = requireString(args, 'path')
        const content = requireString(args, 'content')
        const result = record((await executeDaemonTool('rewrite_file', { path, content }, exec.mode, exec.signal)).result)
        await refreshWorkspace()
        return {
          output: `Rewrote ${textValue(result.path) || path} · ${content.split('\n').length} lines, ${numberValue(result.size) ?? content.length} bytes.`,
          isError: false,
        }
      },
    }),

    ctx.tools.register({
      name: 'edit_file',
      description:
        'Replace an exact text occurrence in a file. oldText must match whitespace exactly and be unique unless replaceAll is true.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          oldText: { type: 'string', description: 'Exact text to replace.' },
          newText: { type: 'string', description: 'Replacement text.' },
          replaceAll: { type: 'boolean', description: 'Replace every occurrence. Defaults to false.' },
        },
        required: ['path', 'oldText', 'newText'],
        additionalProperties: false,
      },
      allowedInMode: (mode) => mode === 'build',
      async execute(args, exec): Promise<ToolResult> {
        const path = requireString(args, 'path')
        const oldText = requireString(args, 'oldText')
        const newText = typeof args.newText === 'string' ? args.newText : ''
        const result = record(
          (
            await executeDaemonTool(
              'edit_file',
              { path, oldText, newText, replaceAll: args.replaceAll === true },
              exec.mode,
              exec.signal,
            )
          ).result,
        )
        await refreshWorkspace()
        return {
          output: `Edited ${textValue(result.path) || path} · ${numberValue(result.replacements) ?? 1} replacement${numberValue(result.replacements) === 1 ? '' : 's'}.`,
          isError: false,
        }
      },
    }),
  ]

  return () => unregisters.forEach((fn) => fn())
}
