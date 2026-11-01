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

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function formatShell(result: Record<string, unknown>, command: string): string {
  const parts = [`$ ${command}`, textValue(result.stdout)]
  if (textValue(result.stderr)) parts.push(`stderr:\n${textValue(result.stderr)}`)
  const code = numberValue(result.code)
  if (code !== undefined && code !== 0) parts.push(`exit code: ${code}`)
  if (result.timedOut === true) parts.push('The command timed out.')
  return parts.filter((part) => part !== '').join('\n')
}

async function refreshTree() {
  await useWorkspace.getState().refresh({ treeOnly: true }).catch(() => undefined)
}

export const name = 'tool-shell'
export const inject = ['tools']

export function apply(ctx: Context) {
  return ctx.tools.register({
    name: 'shell',
    description:
      'Run a shell command in the workspace root. The working directory resets between calls. Prefer dedicated file and git tools for edits. In Plan mode only read-only commands are accepted.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run.' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds (max 600000).' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args, exec): Promise<ToolResult> {
      const command = requireString(args, 'command')
      const result = record(
        (
          await executeDaemonTool(
            'shell',
            { command, timeoutMs: numberArg(args, 'timeoutMs', 120_000) },
            exec.mode,
            exec.signal,
          )
        ).result,
      )
      void refreshTree()
      return {
        output: truncate(formatShell(result, command)),
        isError: (numberValue(result.code) ?? 0) !== 0 || result.timedOut === true,
      }
    },
  })
}
