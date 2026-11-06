import type { Message } from '../types'

export type MascotId = 'helium' | 'clawd' | 'sol' | 'byte' | 'off'
export type MascotScope = 'home' | 'all'

export type MascotMood =
  | 'wave'
  | 'idle'
  | 'thinking'
  | 'working'
  | 'typing'
  | 'happy'
  | 'alert'
  | 'error'
  | 'sleepy'
  | 'party'

export const MASCOTS: Record<MascotId, { label: string; note?: string }> = {
  helium: { label: 'Helium' },
  clawd: { label: 'Clawd', note: 'Anthropic character; optional fan mascot, not MIT.' },
  sol: { label: 'Sol' },
  byte: { label: 'Byte' },
  off: { label: 'Off' },
}

export const MASCOT_LABELS: Record<MascotMood, string> = {
  wave: 'Ready when you are',
  idle: 'Standing by',
  thinking: 'Thinking it through…',
  working: 'Running tools…',
  typing: 'Writing the answer…',
  happy: 'Answer ready',
  alert: 'Needs your approval',
  error: 'Hit a snag',
  sleepy: 'Waiting for the next turn',
  party: 'All steps finished',
}

export function normalizeMascot(value: unknown): MascotId {
  return value === 'clawd' || value === 'sol' || value === 'byte' || value === 'off' || value === 'helium'
    ? value
    : 'helium'
}

export function normalizeMascotScope(value: unknown): MascotScope {
  return value === 'home' ? 'home' : 'all'
}

/**
 * Pick the mascot's face from the tail of the conversation. Presentation only:
 * nothing here mutates a session.
 */
export function mascotMood(messages: Message[], streaming: boolean): MascotMood {
  if (messages.length === 0) return 'wave'
  const last = messages[messages.length - 1]

  if (last.role === 'tool') {
    if (last.status === 'awaiting') return 'alert'
    if (last.status === 'error') return 'error'
    if (streaming || last.status === 'running') return 'working'
    return 'party'
  }

  if (last.role === 'assistant') {
    if (last.error) return 'error'
    if (streaming) {
      if (last.reasoning.trim() && !last.content.trim()) return 'thinking'
      return 'typing'
    }
    if (last.stopped) return 'sleepy'
    if (last.content.trim()) return 'happy'
    return 'idle'
  }

  return streaming ? 'working' : 'idle'
}
