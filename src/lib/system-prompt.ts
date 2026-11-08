import type { AppSettings, ChatSession } from '../types'

export type PromptSource = 'session' | 'workspace' | 'app'

/** The prompt a scope would fall back to when it is set to "shared". */
export function inheritedPrompt(settings: Pick<AppSettings, 'systemPrompt' | 'workspacePrompts'>, root: string): {
  text: string
  source: Exclude<PromptSource, 'session'>
} {
  const custom = root ? settings.workspacePrompts?.[root] : undefined
  if (typeof custom === 'string') return { text: custom, source: 'workspace' }
  return { text: settings.systemPrompt, source: 'app' }
}

/** Session custom → workspace custom → app-wide prompt. */
export function resolveBasePrompt(
  settings: Pick<AppSettings, 'systemPrompt' | 'workspacePrompts'>,
  session: Pick<ChatSession, 'systemPrompt'> | null | undefined,
  root: string,
): { text: string; source: PromptSource } {
  if (typeof session?.systemPrompt === 'string') return { text: session.systemPrompt, source: 'session' }
  return inheritedPrompt(settings, root)
}
