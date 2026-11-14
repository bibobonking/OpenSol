import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Building2, MessageSquare, ScrollText } from 'lucide-react'
import type { ChatSession } from '../types'
import { useSettings } from '../store/settings'
import { useChats } from '../store/chats'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { inheritedPrompt, resolveBasePrompt } from '../lib/system-prompt'
import { useClickOutside } from '../lib/hooks'
import { cn } from '../lib/utils'
import { Segmented } from './ui'

type Scope = 'session' | 'workspace'

function Choice({
  active,
  title,
  description,
  onClick,
  disabled,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-accent/40 bg-accent-soft/60' : 'border-line hover:bg-raised/60',
      )}
    >
      <span
        className={cn(
          'mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
          active ? 'border-accent' : 'border-faint',
        )}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[10.5px] leading-snug text-muted">{description}</span>
      </span>
    </button>
  )
}

/** Small editor for the base system prompt: shared, custom for this session, or custom for this workspace. */
export function SystemPromptButton({ session }: { session: ChatSession | null }) {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const updateSession = useChats((state) => state.updateSession)
  const notify = useUi((state) => state.notify)
  const root = useWorkspace((state) => state.root || state.info.root)
  const workspaceName = useWorkspace((state) => state.info.name)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('session')
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useClickOutside(panelRef, () => setOpen(false), open, triggerRef)
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 56, right: 12 })

  // The top bar blurs its backdrop, which traps children in its own stacking context.
  // Render the panel in a portal and place it from the trigger's rectangle.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPosition({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  const effective = resolveBasePrompt(settings, session, root)
  const sessionCustom = typeof session?.systemPrompt === 'string'
  const workspaceCustom = Boolean(root) && typeof settings.workspacePrompts[root] === 'string'
  const customized = sessionCustom || workspaceCustom

  // Session needs a conversation, workspace needs a folder; fall back to whichever scope is usable.
  const activeScope: Scope = scope === 'session' && !session && root ? 'workspace' : scope
  const isSession = activeScope === 'session'
  const custom = isSession ? sessionCustom : workspaceCustom
  const value = isSession ? (session?.systemPrompt ?? '') : (settings.workspacePrompts[root] ?? '')
  const fallback = isSession ? inheritedPrompt(settings, root) : { text: settings.systemPrompt, source: 'app' as const }
  const unavailable = isSession ? !session : !root

  const setCustom = (text: string | undefined) => {
    if (isSession) {
      if (session) updateSession(session.id, { systemPrompt: text })
      return
    }
    if (!root) return
    const next = { ...settings.workspacePrompts }
    if (text === undefined) delete next[root]
    else next[root] = text
    update({ workspacePrompts: next })
  }

  const sharedDescription = isSession
    ? fallback.source === 'workspace'
      ? 'Uses this workspace’s custom prompt.'
      : 'Uses the app-wide prompt from Settings → General.'
    : 'Uses the app-wide prompt from Settings → General.'

  return (
    <div className="relative hidden sm:block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={`System prompt · ${effective.source === 'session' ? 'custom for this session' : effective.source === 'workspace' ? 'custom for this workspace' : 'shared'}`}
        aria-label="Edit system prompt"
        aria-expanded={open}
        className={cn('icon-button relative', open && 'bg-raised text-ink')}
      >
        <ScrollText size={16} strokeWidth={1.7} />
        {customized && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>

      {open &&
        createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="System prompt"
          style={{ top: position.top, right: position.right }}
          className="fixed z-[95] max-h-[calc(100dvh-80px)] w-[min(420px,92vw)] overflow-y-auto rounded-2xl border border-line bg-panel p-3.5 shadow-float"
        >
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-semibold text-ink">System prompt</p>
            <Segmented<Scope>
              value={activeScope}
              onChange={setScope}
              options={[
                { value: 'session', label: 'Session', title: 'Only this conversation' },
                { value: 'workspace', label: 'Workspace', title: 'Every conversation in this folder' },
              ]}
            />
          </div>

          <p className="mb-2 flex items-center gap-1.5 text-[10.5px] text-muted">
            {isSession ? <MessageSquare size={11} /> : <Building2 size={11} />}
            {isSession ? (session ? 'Applies to this conversation only.' : 'Send a message to start a conversation first.') : root ? `Applies to every conversation in ${workspaceName || 'this folder'}.` : 'Open a workspace folder first.'}
          </p>

          <div className="space-y-1.5">
            <Choice
              active={!custom}
              disabled={unavailable}
              title="Use shared prompt"
              description={sharedDescription}
              onClick={() => setCustom(undefined)}
            />
            <Choice
              active={custom}
              disabled={unavailable}
              title={isSession ? 'Custom for this session' : 'Custom for this workspace'}
              description="Write a prompt that replaces the shared one here."
              onClick={() => {
                if (!custom) {
                  setCustom(fallback.text)
                  notify('Started from the current shared prompt. Edit it below.', 'info')
                }
              }}
            />
          </div>

          {custom && !unavailable && (
            <textarea
              value={value}
              onChange={(event) => setCustom(event.target.value)}
              rows={9}
              spellCheck={false}
              aria-label="Custom system prompt"
              className="thin-scroll mt-2.5 w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-accent/50"
              placeholder="You are…"
            />
          )}

          <p className="mt-2 text-[10px] leading-relaxed text-faint">
            Order of precedence: session, then workspace, then shared. Skills, workspace context and mode rules are always added after it.
          </p>
        </div>,
        document.body,
        )}
    </div>
  )
}
