import { useEffect, useState } from 'react'
import { Check, MessageSquareCode, RotateCcw } from 'lucide-react'
import type { ChatSession } from '../types'
import { useChats } from '../store/chats'
import { DEFAULT_SYSTEM_PROMPT, useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { cn } from '../lib/utils'
import { Modal, ModalHeader } from './ui'

type Mode = 'shared' | 'workspace' | 'session'

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'shared', label: 'Shared prompt', hint: 'The general prompt from Settings → Models.' },
  { id: 'workspace', label: 'This workspace', hint: 'Applies to every session opened in this folder.' },
  { id: 'session', label: 'This session', hint: 'Only this conversation. Overrides the workspace prompt.' },
]

export function SystemPromptModal({
  session,
  open,
  onClose,
}: {
  session: ChatSession | null
  open: boolean
  onClose: () => void
}) {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const updateSession = useChats((state) => state.updateSession)
  const notify = useUi((state) => state.notify)
  const workspaceRoot = useWorkspace((state) => state.root)
  const root = session?.workspace || workspaceRoot || ''
  const workspacePrompt = root ? settings.workspacePrompts[root] ?? '' : ''
  const sessionPrompt = session?.systemPrompt ?? ''
  const current: Mode = sessionPrompt.trim() ? 'session' : workspacePrompt.trim() ? 'workspace' : 'shared'

  const [mode, setMode] = useState<Mode>(current)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!open) return
    setMode(current)
    setDraft(current === 'session' ? sessionPrompt : current === 'workspace' ? workspacePrompt : '')
  }, [open, current, sessionPrompt, workspacePrompt])

  const editorValue = mode === 'shared' ? settings.systemPrompt : draft

  const save = () => {
    if (mode === 'shared') {
      if (session) updateSession(session.id, { systemPrompt: '' })
      if (root) update({ workspacePrompts: { ...settings.workspacePrompts, [root]: '' } })
      notify('Using the shared system prompt.', 'success')
      onClose()
      return
    }
    if (mode === 'workspace') {
      if (!root) {
        notify('Open a workspace folder before saving a workspace prompt.', 'error')
        return
      }
      const value = draft.trim()
      if (!value) {
        notify('Write a prompt or choose the shared prompt.', 'error')
        return
      }
      update({ workspacePrompts: { ...settings.workspacePrompts, [root]: value } })
      if (session) updateSession(session.id, { systemPrompt: '' })
      notify('Workspace system prompt saved.', 'success')
      onClose()
      return
    }
    if (!session) return
    const value = draft.trim()
    if (!value) {
      notify('Write a prompt or choose the shared prompt.', 'error')
      return
    }
    updateSession(session.id, { systemPrompt: value })
    notify('Session system prompt saved.', 'success')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="system-prompt-title">
      <ModalHeader
        id="system-prompt-title"
        title="System prompt"
        description="Choose what the model is told before this conversation. Session overrides workspace, which overrides the shared prompt."
        onClose={onClose}
      />
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid gap-1.5 sm:grid-cols-3">
          {MODES.map((entry) => {
            const active = mode === entry.id
            const disabled = entry.id === 'workspace' && !root
            return (
              <button
                key={entry.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setMode(entry.id)
                  setDraft(entry.id === 'workspace' ? workspacePrompt : entry.id === 'session' ? sessionPrompt : '')
                }}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  active ? 'border-accent/40 bg-accent-soft' : 'border-line bg-panel hover:bg-raised/60',
                )}
              >
                <span className={cn('flex items-center gap-1.5 text-[11.5px] font-medium', active ? 'text-accent' : 'text-ink')}>
                  <MessageSquareCode size={11} />
                  {entry.label}
                </span>
                <span className="mt-1 block text-[9.5px] leading-relaxed text-faint">{entry.hint}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-[10.5px] font-medium text-muted">
              {mode === 'shared' ? 'Shared prompt (edited in Settings → Models)' : mode === 'workspace' ? `Workspace prompt · ${root}` : 'Session prompt'}
            </span>
            {mode !== 'shared' && (
              <button
                type="button"
                onClick={() => setDraft(DEFAULT_SYSTEM_PROMPT)}
                className="inline-flex items-center gap-1 text-[9.5px] font-medium text-faint hover:text-ink"
              >
                <RotateCcw size={10} /> Start from default
              </button>
            )}
          </div>
          <textarea
            value={editorValue}
            onChange={(event) => {
              if (mode === 'shared') update({ systemPrompt: event.target.value })
              else setDraft(event.target.value)
            }}
            readOnly={mode === 'shared'}
            rows={11}
            spellCheck={false}
            data-autofocus
            className="thin-scroll w-full resize-y rounded-xl border border-line bg-canvas/50 px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-ink outline-none focus:border-accent/50 read-only:opacity-70"
            placeholder="You are a focused React reviewer…"
          />
          <p className="mt-1.5 text-[9px] leading-relaxed text-faint">
            Workspace context, project instructions, skills and tool rules are appended after this prompt. A custom prompt replaces the shared one.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" onClick={onClose} className="chip h-8 px-3 text-[11px]">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[11px] font-medium text-on-accent hover:bg-accent/90"
        >
          <Check size={12} /> Save
        </button>
      </div>
    </Modal>
  )
}
