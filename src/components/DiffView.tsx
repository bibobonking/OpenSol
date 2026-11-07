import { useMemo } from 'react'
import { diffLines } from '../lib/diff'
import { cn } from '../lib/utils'

const MAX_ROWS = 120

/** Compact unified diff: only the changed lines plus two lines of context, numbered from `startLine`. */
export function DiffView({ before, after, startLine = 1 }: { before: string; after: string; startLine?: number }) {
  const rows = useMemo(() => {
    const ops = diffLines(before, after)
    const keep = new Array<boolean>(ops.length).fill(false)
    ops.forEach((op, index) => {
      if (op.type === 'ctx') return
      for (let k = Math.max(0, index - 2); k <= Math.min(ops.length - 1, index + 2); k += 1) keep[k] = true
    })
    let oldNo = startLine
    let newNo = startLine
    const out: Array<{ key: number; type: string; text: string; no: number | null; gap?: boolean }> = []
    let skipped = false
    ops.forEach((op, index) => {
      const no = op.type === 'add' ? newNo : oldNo
      if (op.type !== 'add') oldNo += 1
      if (op.type !== 'del') newNo += 1
      if (!keep[index]) {
        skipped = true
        return
      }
      if (skipped && out.length > 0) out.push({ key: -index, type: 'gap', text: '', no: null, gap: true })
      skipped = false
      out.push({ key: index, type: op.type, text: op.text, no })
    })
    return out
  }, [before, after, startLine])

  const shown = rows.slice(0, MAX_ROWS)
  return (
    <div className="diff-view thin-scroll max-h-64 overflow-auto rounded-lg border border-line bg-canvas/60 font-mono text-[11px] leading-[1.6]">
      {shown.map((row, index) =>
        row.gap ? (
          <div key={row.key} className="px-2 text-center text-[10px] text-faint">⋯</div>
        ) : (
          <div
            key={row.key}
            style={{ animationDelay: `${Math.min(index * 14, 260)}ms` }}
            className={cn(
              'diff-row flex min-w-max',
              row.type === 'add' && 'bg-success/[0.11] text-ink',
              row.type === 'del' && 'bg-danger/[0.10] text-ink',
              row.type === 'ctx' && 'text-faint',
            )}
          >
            <span className="w-9 shrink-0 select-none pr-2 text-right text-[10px] tabular-nums text-faint/70">{row.no}</span>
            <span
              className={cn(
                'w-4 shrink-0 select-none text-center',
                row.type === 'add' && 'text-success',
                row.type === 'del' && 'text-danger',
              )}
            >
              {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
            </span>
            <span className="whitespace-pre pr-3">{row.text || ' '}</span>
          </div>
        ),
      )}
      {rows.length > MAX_ROWS && (
        <div className="px-3 py-1 text-[10px] text-faint">… {rows.length - MAX_ROWS} more rows</div>
      )}
    </div>
  )
}

export function DiffBadge({
  added,
  removed,
  line,
  column,
  className,
}: {
  added: number
  removed: number
  line?: number
  column?: number
  className?: string
}) {
  return (
    <span className={cn('diff-badge inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums', className)}>
      <span className="text-success">+{added}</span>
      <span className="text-danger">−{removed}</span>
      {line ? (
        <span className="text-faint">
          L{line}
          {column ? `:${column}` : ''}
        </span>
      ) : null}
    </span>
  )
}
