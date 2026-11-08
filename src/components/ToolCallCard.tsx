import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { FileDiff, ToolMessage, ToolName } from '../types'
import { toolLabel, toolSummary } from '../agent/tools'
import { resolveApproval } from '../agent/approval'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'
import { diffLines, diffStats } from '../lib/diff'
import { DiffBadge, DiffView } from './DiffView'

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'rewrite_file'])

/** The diff the daemon reported, or one worked out from the call itself for older chats. */
export function diffForTool(message: ToolMessage): FileDiff | undefined {
  if (message.diff) return message.diff
  if (message.status !== 'done' || message.call.name !== 'edit_file') return undefined
  const { oldText, newText } = message.call.args
  if (typeof oldText !== 'string' || typeof newText !== 'string') return undefined
  return diffStats(diffLines(oldText, newText))
}

function statusMeta(status: ToolMessage['status']) {
  switch (status) {
    case 'awaiting':
      return { label: 'Needs approval', className: 'text-warning', dot: 'bg-warning' }
    case 'running':
      return { label: 'Running', className: 'text-accent', dot: 'bg-accent' }
    case 'done':
      return { label: 'Done', className: 'text-success', dot: 'bg-success' }
    case 'denied':
      return { label: 'Denied', className: 'text-muted', dot: 'bg-faint' }
    default:
      return { label: 'Failed', className: 'text-danger', dot: 'bg-danger' }
  }
}

function durationLabel(ms?: number) {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function approvalCopy(name: ToolName) {
  switch (name) {
    case 'shell':
      return 'OpenSol wants to run this command in the open workspace.'
    case 'write_file':
      return 'OpenSol wants to create or overwrite this file on disk.'
    case 'edit_file':
    case 'rewrite_file':
      return 'OpenSol wants to change this file on disk.'
    case 'git':
      return 'OpenSol wants to change the Git state of this repository.'
    case 'subagent':
      return 'OpenSol wants to start a read-only subagent to investigate.'
    case 'skill':
      return 'OpenSol wants to load an installed skill.'
    case 'web_search':
      return 'OpenSol wants to search the web.'
    case 'read_url':
      return 'OpenSol wants to read this public page.'
    default:
      return 'OpenSol wants to use this tool.'
  }
}

export function ToolCallCard({ message, compact = false }: { message: ToolMessage; compact?: boolean }) {
  const [open, setOpen] = useState((!compact && message.status === 'awaiting') || message.status === 'error')
  const [copied, setCopied] = useState(false)
  const notify = useUi((state) => state.notify)
  const status = statusMeta(message.status)
  const summary = toolSummary(message.call.name, message.call.args)
  const args = message.call.args
  const diff = diffForTool(message)
  const isFileTool = FILE_TOOLS.has(message.call.name)
  const command = typeof args.command === 'string' ? args.command : ''
  const content =
    typeof args.content === 'string'
      ? args.content
      : typeof args.newText === 'string'
        ? args.newText
        : typeof args.oldText === 'string'
          ? args.oldText
          : ''

  useEffect(() => {
    if (message.status === 'awaiting' || message.status === 'error') setOpen(true)
  }, [message.status])

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(message.result ?? '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  const trailing =
    message.status === 'done' && message.durationMs !== undefined
      ? durationLabel(message.durationMs)
      : message.status === 'done'
        ? ''
        : status.label.toLowerCase()

  return (
    <div className="animate-slideleft text-[12.5px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group/row flex w-full min-w-0 items-baseline gap-1.5 py-[3px] text-left"
        aria-expanded={open}
      >
        <ArrowRight
          size={12}
          strokeWidth={2}
          className={cn(
            'relative top-[1px] shrink-0 self-center text-faint transition-transform duration-200 ease-out group-hover/row:text-ink',
            open && 'rotate-90',
          )}
        />
        <span className="shrink-0 font-medium text-ink">{toolLabel(message.call.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{summary || '—'}</span>
        {isFileTool && diff && message.status === 'done' ? (
          <DiffBadge added={diff.added} removed={diff.removed} line={diff.line} column={diff.column} className="shrink-0" />
        ) : (
          trailing && (
            <span className={cn('shrink-0 text-[11px]', message.status === 'running' ? 'text-shimmer' : message.status === 'done' ? 'text-faint' : status.className)}>
              {trailing}
            </span>
          )
        )}
      </button>

      {message.status === 'awaiting' && (
        <div className="animate-fade py-1 pl-[18px]">
          <p className="text-[12px] leading-relaxed text-warning">{approvalCopy(message.call.name)}</p>
          <p className="mt-1 flex items-center gap-4 text-[12px] font-medium">
            <button
              type="button"
              onClick={() => resolveApproval(message.call.id, true)}
              className="text-ink underline decoration-ink/30 underline-offset-[3px] transition-colors hover:decoration-ink"
            >
              Allow once →
            </button>
            <button
              type="button"
              onClick={() => resolveApproval(message.call.id, false)}
              className="text-muted transition-colors hover:text-ink"
            >
              Deny
            </button>
          </p>
        </div>
      )}

      {open && (
        <div className="animate-fade space-y-2 pb-1.5 pl-[18px] pt-0.5">
          {command && (
            <pre className="thin-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink">
              $ {command}
            </pre>
          )}
          {message.call.name === 'edit_file' && typeof args.oldText === 'string' && typeof args.newText === 'string' && (
            <DiffView before={args.oldText} after={args.newText} startLine={diff?.line ?? 1} />
          )}
          {content && message.call.name !== 'edit_file' && (
            <pre className="thin-scroll max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted">
              {content.length > 4000 ? `${content.slice(0, 4000)}\n… ${content.length - 4000} more characters` : content}
            </pre>
          )}

          {message.result !== undefined && (
            <div>
              <p className="mb-1 flex items-center gap-3 text-[11px] text-faint">
                <span>{message.status === 'error' ? 'Error' : 'Output'}</span>
                <button type="button" onClick={copyOutput} className="transition-colors hover:text-ink">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </p>
              <pre
                className={cn(
                  'thin-scroll max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.65]',
                  message.status === 'error' ? 'text-danger' : 'text-muted',
                )}
              >
                {message.result || '(no output)'}
              </pre>
            </div>
          )}

          {message.result === undefined && !command && !content && message.status !== 'awaiting' && (
            <p className="text-[11.5px] text-muted">
              {message.status === 'running' ? 'Working…' : 'No result was recorded.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
