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

function formatGit(result: Record<string, unknown>): string {
  const parts: string[] = []
  if (textValue(result.current)) parts.push(`Current branch: ${textValue(result.current)}`)
  if (textValue(result.branches)) parts.push(textValue(result.branches))
  if (textValue(result.stdout)) parts.push(textValue(result.stdout))
  if (textValue(result.stderr)) parts.push(`stderr:\n${textValue(result.stderr)}`)
  const code = numberValue(result.code)
  if (code !== undefined && code !== 0) parts.push(`exit code: ${code}`)
  return parts.filter(Boolean).join('\n') || 'Git completed with no output.'
}

export const name = 'tool-git'
export const inject = ['tools']

export function apply(ctx: Context) {
  return ctx.tools.register({
    name: 'git',
    description: 'Inspect or change git state. In Plan mode only status, diff, log, show and branch are accepted.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'diff', 'log', 'show', 'branch', 'add', 'commit', 'init', 'checkout'],
        },
        path: { type: 'string', description: 'Limit diff to this file.' },
        staged: { type: 'boolean', description: 'Diff the staged changes.' },
        ref: { type: 'string', description: 'Commit or ref for show.' },
        limit: { type: 'number', description: 'Log limit.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Files to stage.' },
        message: { type: 'string', description: 'Commit message.' },
        branch: { type: 'string', description: 'Branch to create or check out.' },
        create: { type: 'boolean', description: 'Create a new branch. Defaults to true.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args, exec): Promise<ToolResult> {
      const action = requireString(args, 'action')
      const gitArgs: Record<string, unknown> = { ...args }
      delete gitArgs.action
      const result = record((await executeDaemonTool('git', { action, ...gitArgs }, exec.mode, exec.signal)).result)
      if (action === 'add' || action === 'commit' || action === 'init' || action === 'checkout') {
        await useWorkspace.getState().loadGit().catch(() => undefined)
      }
      return {
        output: truncate(formatGit(result)),
        isError: (numberValue(result.code) ?? 0) !== 0,
      }
    },
  })
}
