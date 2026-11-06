import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react'
import { getPreviewToken } from '../lib/daemon'
import { cn } from '../lib/utils'
import { useWorkspace } from '../store/workspace'
import { Spinner } from './ui'

const DEVICES = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: '100%' },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: '768px' },
  { id: 'phone', label: 'Phone', icon: Smartphone, width: '390px' },
] as const

type DeviceId = (typeof DEVICES)[number]['id']

function pickEntry(pages: string[]): string {
  if (pages.includes('index.html')) return 'index.html'
  return [...pages].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0] ?? ''
}

/** Live, sandboxed preview of an HTML file in the open workspace. Reloads when files change. */
export function PreviewPane() {
  const entries = useWorkspace((state) => state.entries)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [device, setDevice] = useState<DeviceId>('desktop')
  const [nonce, setNonce] = useState(0)

  const pages = useMemo(
    () => entries.filter((entry) => entry.type === 'file' && /\.html?$/i.test(entry.path)).map((entry) => entry.path),
    [entries],
  )
  // Any file change reloads the page, so edits from the agent or the editor show up on their own.
  const version = useMemo(() => {
    const files = entries.filter((entry) => entry.type === 'file')
    return `${files.length}-${files.reduce((latest, entry) => Math.max(latest, entry.mtime), 0)}`
  }, [entries])

  const page = pages.includes(selected) ? selected : pickEntry(pages)

  const fetchToken = useCallback(async () => {
    setError('')
    try {
      setToken((await getPreviewToken()).token)
    } catch (cause) {
      setToken('')
      setError(cause instanceof Error ? cause.message : 'Could not start the preview.')
    }
  }, [])

  useEffect(() => {
    void fetchToken()
  }, [fetchToken])

  const src = token && page ? `/preview/${token}/${encodeURI(page)}?v=${version}.${nonce}` : ''
  const width = DEVICES.find((entry) => entry.id === device)?.width ?? '100%'

  if (pages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-faint">
          <Monitor size={18} />
        </span>
        <p className="text-[13px] font-medium text-ink">Nothing to preview yet</p>
        <p className="max-w-[260px] text-[11.5px] leading-relaxed text-muted">
          Ask MaxCode to build a page or a game. The first HTML file it writes shows up here and reloads as it changes.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-2">
        <select
          value={page}
          onChange={(event) => setSelected(event.target.value)}
          className="h-8 min-w-0 flex-1 truncate rounded-lg border border-line bg-transparent px-2 font-mono text-[11.5px] text-ink outline-none focus:border-accent/50"
          aria-label="Page to preview"
        >
          {pages.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <div className="flex items-center rounded-lg bg-raised/70 p-0.5">
          {DEVICES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setDevice(entry.id)}
              aria-pressed={device === entry.id}
              title={entry.label}
              aria-label={entry.label}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                device === entry.id ? 'bg-panel text-ink shadow-pill' : 'text-muted hover:text-ink',
              )}
            >
              <entry.icon size={14} strokeWidth={1.7} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button h-8 w-8"
          onClick={() => {
            void fetchToken()
            setNonce((value) => value + 1)
          }}
          title="Reload preview"
          aria-label="Reload preview"
        >
          <RefreshCw size={14} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className="icon-button h-8 w-8"
          disabled={!src}
          onClick={() => window.open(src, '_blank', 'noopener')}
          title="Open in a new tab"
          aria-label="Open in a new tab"
        >
          <ExternalLink size={14} strokeWidth={1.7} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto bg-raised/40 p-2">
        {error && (
          <div className="mx-auto mt-6 max-w-[300px] rounded-xl border border-danger/25 bg-danger/[0.05] px-3.5 py-3 text-center">
            <p className="text-[12px] font-medium text-ink">The preview could not start</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{error}</p>
            <button
              type="button"
              onClick={() => void fetchToken()}
              className="mt-2 text-[11.5px] font-medium text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        )}
        {!error && !src && (
          <p className="flex items-center justify-center gap-2 py-8 text-[11.5px] text-faint">
            <Spinner size={12} /> Starting preview…
          </p>
        )}
        {src && (
          <iframe
            key={`${page}-${nonce}`}
            title={`Preview of ${page}`}
            src={src}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
            className="mx-auto block h-full min-h-[320px] max-w-full rounded-lg border border-line bg-white shadow-pill"
            style={{ width }}
          />
        )}
      </div>

      <p className="shrink-0 border-t border-line px-3 py-1.5 text-[11px] text-faint">
        Runs in a sandbox: it can load your files and public CDNs, but cannot reach MaxCode or your keys.
      </p>
    </div>
  )
}
