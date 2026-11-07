import type { Message } from '../types'

export type PixleMood =
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

export const PIXLE_LABELS: Record<PixleMood, string> = {
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

/**
 * Pick PixleSol's face from the tail of the conversation. Presentation only —
 * nothing here mutates a session.
 */
export function pixleMood(messages: Message[], streaming: boolean): PixleMood {
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
