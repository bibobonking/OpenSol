import type { AppSettings, BuiltinToolName, ToolSetting } from '../types'

export type PermissionMode = 'ask' | 'accept-edits' | 'full'

export const PERMISSION_MODES: Array<{ value: PermissionMode; label: string; description: string }> = [
  {
    value: 'ask',
    label: 'Ask first',
    description: 'Confirm shell commands, edits and git changes before they run.',
  },
  {
    value: 'accept-edits',
    label: 'Accept edits',
    description: 'Apply file edits automatically; still confirm shell and git.',
  },
  {
    value: 'full',
    label: 'Full access',
    description: 'Run every enabled tool without asking. Use only in trusted folders.',
  },
]

const WRITE_TOOLS: BuiltinToolName[] = ['write_file', 'edit_file', 'rewrite_file']
const GUARDED_TOOLS: BuiltinToolName[] = ['shell', 'git', 'subagent', 'skill']

export function permissionMode(tools: AppSettings['tools']): PermissionMode {
  const writesAuto = WRITE_TOOLS.every((tool) => tools[tool]?.approval === 'auto')
  const guardedAuto = GUARDED_TOOLS.every((tool) => tools[tool]?.approval === 'auto')
  if (writesAuto && guardedAuto) return 'full'
  if (writesAuto) return 'accept-edits'
  return 'ask'
}

export function permissionTools(
  tools: AppSettings['tools'],
  mode: PermissionMode,
): Record<BuiltinToolName, ToolSetting> {
  const next = {} as Record<BuiltinToolName, ToolSetting>
  for (const key of Object.keys(tools) as BuiltinToolName[]) {
    const mutating = WRITE_TOOLS.includes(key) || GUARDED_TOOLS.includes(key)
    const approval: ToolSetting['approval'] =
      mode === 'full'
        ? 'auto'
        : mode === 'accept-edits'
          ? WRITE_TOOLS.includes(key)
            ? 'auto'
            : GUARDED_TOOLS.includes(key)
              ? 'ask'
              : tools[key].approval
          : mutating
            ? 'ask'
            : tools[key].approval
    next[key] = { ...tools[key], approval }
  }
  return next
}

export function permissionLabel(mode: PermissionMode): string {
  return PERMISSION_MODES.find((entry) => entry.value === mode)?.label ?? 'Ask first'
}
