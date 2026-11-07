import { kernel } from '../core/kernel'
import {
  waitForApproval as coreWaitForApproval,
  resolveApproval as coreResolveApproval,
} from '../core/services/approval'

export function waitForApproval(toolCallId: string, signal: AbortSignal): Promise<boolean> {
  if (kernel.approval) {
    return kernel.approval.waitForApproval(toolCallId, signal)
  }
  return coreWaitForApproval(toolCallId, signal)
}

export function resolveApproval(toolCallId: string, allow: boolean): void {
  if (kernel.approval) {
    kernel.approval.resolveApproval(toolCallId, allow)
  } else {
    coreResolveApproval(toolCallId, allow)
  }
}
