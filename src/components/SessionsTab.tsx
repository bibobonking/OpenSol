import { useMemo, useState } from 'react'
import { Check, MessagesSquare, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useChats } from '../store/chats'
import { useRuntime, useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { stopRun } from '../agent'
import { kernel } from '../core/kernel'
import { cn, formatRelativeTime } from '../lib/utils'
import type { ChatSession } from '../types'

function messageCount(session: ChatSession) {
  return session.messages.filter((message) => message.role === 'user').length
}

function editedFiles(session: ChatSession) {
  const files = new Set<string>()
  for (const message of session.messages) {
    if (message.role !== 'tool' || message.status !== 'done') continue
    if (!['write_file', 'edit_file', 'rewrite_file'].includes(message.call.name)) continue
    const path = message.call.args.path
    if (typeof path === 'string') files.add(path)
  }
  return files.size
}

/** Sessions that belong to the open workspace, with quick rename / AI title / delete. */
export function SessionsTab() {
  const sessions = useChats((state) => state.sessions)
  const activeId = useChats((state) => state.activeId)
  const setActive = useChats((state) => state.setActive)
  const newChat = useChats((state) => state.newChat)
  const renameSession = useChats((state) => state.renameSession)
  const deleteSession = useChats((state) => state.deleteSession)
  const root = useWorkspace((state) => state.info.root)
  const streaming = useRuntime((state) => state.streaming)
  const titling = useRuntime((state) => state.titling)
  const askConfirm = useUi((state) => state.askConfirm)
  const notify = useUi((state) => state.notify)
  const focusComposer = useUi((state) => state.focusComposer)

  const [scope, setScope] = useState<'workspace' | 'all'>('workspace')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const shown = useMemo(() => {
    const list = scope === 'all' ? sessions : sessions.filter((session) => session.workspace === root)
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [sessions, scope, root])
  const untagged = sessions.filter((session) => !session.workspace).length

  const commit = () => {
    if (editingId && draft.trim()) renameSession(editingId, draft)
    setEditingId(null)
  }

  const remove = async (session: ChatSession) => {
    const confirmed = await askConfirm({
      title: 'Delete this session?',
      body: `“${session.title}” and its messages will be removed from this computer. This cannot be undone.`,
      confirmLabel: 'Delete session',
      tone: 'danger',
    })
    if (!confirmed) return
    stopRun(session.id)
    deleteSession(session.id)
  }

  const aiName = async (id: string) => {
    const title = await kernel.titles?.generate(id, { force: true })
    if (!title) notify('The model could not suggest a title right now.', 'error')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="relative flex rounded-full bg-raised p-0.5 text-[10.5px] font-medium">
          {(['workspace', 'all'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setScope(item)}
              className={cn(
                'relative z-10 rounded-full px-2.5 py-1 transition-colors',
                scope === item ? 'bg-panel text-ink shadow-pill' : 'text-muted hover:text-ink',
              )}
            >
              {item === 'workspace' ? 'This workspace' : `All · ${sessions.length}`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            newChat()
            focusComposer()
          }}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-full bg-ink px-2.5 text-[10.5px] font-medium text-panel transition-transform active:scale-95"
        >
          <Plus size={12} /> New
        </button>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {shown.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MessagesSquare size={22} className="mx-auto text-faint" />
            <p className="mt-2 text-[12px] font-medium text-ink">No sessions here yet</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
              {scope === 'workspace' && untagged > 0
                ? `${untagged} older session${untagged === 1 ? '' : 's'} were started before workspaces were tracked. Switch to “All” to see them.`
                : 'Start a conversation and it shows up here.'}
            </p>
          </div>
        ) : (
          shown.map((session, index) => {
            const running = Boolean(streaming[session.id])
            const edits = editedFiles(session)
            return (
              <div
                key={session.id}
                style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
                className={cn(
                  'session-card group/session animate-slideleft mb-1.5 rounded-xl border px-3 py-2.5 transition-all duration-200',
                  activeId === session.id ? 'border-accent/40 bg-accent-soft/60' : 'border-transparent hover:border-line hover:bg-raised/60',
                )}
              >
                {editingId === session.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit()
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                    className="h-7 w-full rounded-md border border-accent/50 bg-panel px-2 text-[12px] text-ink outline-none"
                    aria-label="Rename session"
                  />
                ) : (
                  <button type="button" onClick={() => setActive(session.id)} className="block w-full text-left">
                    <span className="flex items-center gap-2">
                      {activeId === session.id && <Check size={12} className="shrink-0 text-accent" />}
                      <span className={cn('min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink', titling[session.id] && 'text-shimmer')}>
                        {session.title}
                      </span>
                      {running && (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-accent">
                          <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" /> running
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-faint">
                      <span>{formatRelativeTime(session.updatedAt)}</span>
                      <span>· {messageCount(session)} turn{messageCount(session) === 1 ? '' : 's'}</span>
                      {edits > 0 && <span>· {edits} file{edits === 1 ? '' : 's'} edited</span>}
                      {session.model && <span className="max-w-[120px] truncate font-mono">· {session.model}</span>}
                      {session.titleSource === 'ai' && (
                        <span className="inline-flex items-center gap-0.5 text-accent/80">
                          <Sparkles size={9} /> AI title
                        </span>
                      )}
                    </span>
                  </button>
                )}
                <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/session:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    className="icon-button h-6 w-6"
                    onClick={() => {
                      setEditingId(session.id)
                      setDraft(session.title)
                    }}
                    title="Rename"
                    aria-label="Rename session"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    className="icon-button h-6 w-6"
                    onClick={() => void aiName(session.id)}
                    disabled={Boolean(titling[session.id]) || session.messages.length === 0}
                    title="Let the model name this session"
                    aria-label="Name session with AI"
                  >
                    <Sparkles size={11} />
                  </button>
                  <button
                    type="button"
                    className="icon-button h-6 w-6 hover:!text-danger"
                    onClick={() => void remove(session)}
                    title="Delete"
                    aria-label="Delete session"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
