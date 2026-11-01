import { kernel } from '../core/kernel'

export function stopRun(sessionId: string): void {
  if (kernel.agentLoop) {
    kernel.agentLoop.stopRun(sessionId)
  } else {
    queueMicrotask(() => kernel.agentLoop?.stopRun(sessionId))
  }
}

export function stopAllRuns(): void {
  if (kernel.agentLoop) {
    kernel.agentLoop.stopAllRuns()
  } else {
    queueMicrotask(() => kernel.agentLoop?.stopAllRuns())
  }
}

/**
 * Queue one agent run for the submitted user message. A prompt sent while a turn
 * is streaming waits its turn instead of starting a second overlapping reply.
 */
export function runAgent(sessionId: string, userMessageId?: string): void {
  if (kernel.agentLoop) {
    kernel.agentLoop.runAgent(sessionId, userMessageId)
  } else {
    queueMicrotask(() => kernel.agentLoop?.runAgent(sessionId, userMessageId))
  }
}

export function regenerateLastTurn(sessionId: string): boolean {
  if (kernel.agentLoop) {
    return kernel.agentLoop.regenerateLastTurn(sessionId)
  }
  return false
}
