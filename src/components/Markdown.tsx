import { isValidElement, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, Download, Maximize2, RotateCw, X } from 'lucide-react'
import { cn, downloadText } from '../lib/utils'

function extractLanguage(children: ReactNode): string {
  const first = Array.isArray(children) ? children[0] : children
  if (first && typeof first === 'object' && 'props' in first) {
    const props = (first as { props?: { className?: string } }).props
    const match = /language-([\w-]+)/.exec(props?.className ?? '')
    if (match) return match[1]
  }
  return ''
}

/** Plain text of a (syntax-highlighted) React subtree. */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ''
}

/** Whether a code block is something the browser can run as a page. */
function canPreview(language: string, code: string): boolean {
  if (language === 'svg') return /<svg[\s>]/i.test(code)
  if (language === 'html' || language === 'htm') {
    return /<(html|body|canvas|script|style|svg|main|section|div|h1|button)\b/i.test(code)
  }
  return false
}

/** Turns a snippet into a complete document, so fragments and bare SVG still render. */
function toDocument(language: string, code: string): string {
  if (/<!doctype|<html[\s>]/i.test(code)) return code
  const head =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  if (language === 'svg') {
    return `${head}<style>html,body{margin:0;min-height:100%}body{display:grid;place-items:center;background:#fff}svg{max-width:100%;height:auto}</style></head><body>${code}</body></html>`
  }
  return `${head}</head><body>${code}</body></html>`
}

function PreviewFrame({ html, reloadKey, className }: { html: string; reloadKey: number; className?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return
      if ((event.data as { type?: string } | null)?.type !== 'maxcode-preview-ready') return
      frame.contentWindow?.postMessage({ type: 'maxcode-preview', html }, '*')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [html, reloadKey])

  return (
    <iframe
      key={reloadKey}
      ref={frameRef}
      src="/preview-host.html"
      title="Live preview"
      // No allow-same-origin: the page cannot reach OpenSol, its cookies or the local daemon.
      sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals"
      allow="fullscreen"
      className={cn('block h-full w-full border-0 bg-white', className)}
    />
  )
}

function PreviewOverlay({ html, onClose }: { html: string; onClose: () => void }) {
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-canvas/95 p-3 backdrop-blur-sm sm:p-5" role="dialog" aria-label="Live preview">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13.5px] font-medium text-ink">Live preview</p>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-button" onClick={() => setReloadKey((value) => value + 1)} title="Restart" aria-label="Restart preview">
            <RotateCw size={16} />
          </button>
          <button type="button" className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close preview">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-white shadow-float">
        <PreviewFrame html={html} reloadKey={reloadKey} />
      </div>
    </div>,
    document.body,
  )
}

function CodeBlock({ children, streaming }: { children?: ReactNode; streaming?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<'code' | 'preview'>('code')
  const [reloadKey, setReloadKey] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const language = extractLanguage(children) || 'text'
  const code = useMemo(() => nodeText(children), [children])
  const previewable = !streaming && canPreview(language, code)
  const html = useMemo(() => (previewable ? toDocument(language, code) : ''), [previewable, language, code])
  const showingPreview = previewable && view === 'preview'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be blocked; leave the button unchanged.
    }
  }

  return (
    <div className="code-shell group/code">
      <div className="code-head">
        {previewable ? (
          <div className="inline-flex items-center rounded-lg bg-raised/80 p-0.5" role="tablist" aria-label="Code or preview">
            {(['code', 'preview'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={cn(
                  'h-6 rounded-md px-2.5 text-[11.5px] font-medium capitalize transition-colors',
                  view === value ? 'bg-panel text-ink shadow-pill' : 'text-muted hover:text-ink',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        ) : (
          <span className="code-lang">{language}</span>
        )}
        <div className="flex items-center gap-0.5">
          {showingPreview && (
            <>
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-panel hover:text-ink"
                title="Restart"
                aria-label="Restart preview"
              >
                <RotateCw size={13} />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-panel hover:text-ink"
                title="Full screen"
                aria-label="Open preview full screen"
              >
                <Maximize2 size={13} />
              </button>
            </>
          )}
          {previewable && (
            <button
              type="button"
              onClick={() => downloadText(language === 'svg' ? 'image.svg' : 'index.html', language === 'svg' ? code : html, language === 'svg' ? 'image/svg+xml' : 'text/html')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-panel hover:text-ink"
              title="Download file"
              aria-label="Download file"
            >
              <Download size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-faint transition-colors hover:bg-panel hover:text-ink"
            aria-label="Copy code"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {showingPreview ? (
        <div className="h-[420px] min-h-[220px] resize-y overflow-hidden border-t border-line/60 bg-white">
          <PreviewFrame html={html} reloadKey={reloadKey} />
        </div>
      ) : (
        <pre className="code-pre thin-scroll">{children}</pre>
      )}
      {expanded && <PreviewOverlay html={html} onClose={() => setExpanded(false)} />}
    </div>
  )
}

function MarkdownImpl({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className={cn('md', streaming && 'is-streaming')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock streaming={streaming}>{children}</CodeBlock>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
