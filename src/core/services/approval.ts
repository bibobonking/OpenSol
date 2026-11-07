import { Service, type Context } from 'cordis'
import type { ToolExecutionContext, ToolPreExecuteResult } from '../types'
import { resolveToolSetting } from '../mcp-tools'

interface PendingApproval {
  toolCallId: string
  resolve: (allow: boolean) => void
  cleanup: () => void
}

const pendingApprovals = new Map<string, PendingApproval>()

export class ApprovalService extends Service {
  static provide = 'approval'
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, 'approval')

    // Attach to tools/pre-execute waterfall gate
    this.ctx.on('tools/pre-execute', async (exec: ToolExecutionContext, next: () => Promise<ToolPreExecuteResult>) => {
      const toolSetting = resolveToolSetting(exec.settings, exec.name)
      if (toolSetting?.approval === 'ask' && exec.callId) {
        const approved = await this.waitForApproval(exec.callId, exec.signal)
        if (!approved) {
          return {
            decision: 'deny',
            reason: exec.signal.aborted ? 'Stopped before the tool ran.' : 'You denied this tool call.',
          }
        }
      }
      return next()
    })
  }

  waitForApproval(toolCallId: string, signal: AbortSignal): Promise<boolean> {
    return waitForApproval(toolCallId, signal)
  }

  resolveApproval(toolCallId: string, allow: boolean): void {
    resolveApproval(toolCallId, allow)
  }
}

export function waitForApproval(toolCallId: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const finish = (allow: boolean) => {
      const entry = pendingApprovals.get(toolCallId)
      if (!entry) return
      entry.cleanup()
      pendingApprovals.delete(toolCallId)
      resolve(allow)
    }
    const onAbort = () => finish(false)
    signal.addEventListener('abort', onAbort, { once: true })
    pendingApprovals.set(toolCallId, {
      toolCallId,
      resolve: finish,
      cleanup: () => signal.removeEventListener('abort', onAbort),
    })
  })
}

export function resolveApproval(toolCallId: string, allow: boolean): void {
  pendingApprovals.get(toolCallId)?.resolve(allow)
}
