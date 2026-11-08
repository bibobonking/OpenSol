import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import {
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  Globe2,
  ListChecks,
  Paperclip,
  ShieldCheck,
  Slash,
  Sparkles,
  Square,
  Upload,
  X,
} from 'lucide-react'
import type { Attachment } from '../types'
import { useSkills } from '../store/skills'
import { activeModelId, hasCredentials, useSettings } from '../store/settings'
import { useActiveModel, useProviderModels } from '../store/models'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { effortOptions } from '../lib/reasoning'
import { PERMISSION_MODES, permissionLabel, permissionMode, permissionTools } from '../lib/permissions'
import { useClickOutside } from '../lib/hooks'
import { cn, formatBytes, readFileAsDataUrl, readFileAsText } from '../lib/utils'
import { ModelDeck, ModelDeckTrigger } from './ModelDeck'
import { PixleSol } from './PixleSol'
import type { PixleMood } from '../lib/pixlesol'

const TEXT_EXTENSIONS = /\.(txt|md|markdown|ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|vue|svelte|py|go|rs|rb|java|kt|cs|c|h|cpp|hpp|php|swift|sh|bash|zsh|yml|yaml|toml|ini|sql|csv|xml|gitignore|env)$/i
const MAX_ATTACHMENTS = 6
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TEXT_BYTES = 512 * 1024

const SLASH_COMMANDS = [
  { name: 'search', usage: '/search <query>', description: 'Search the web and answer with sources', takesArgs: true },
  { name: 'plan', usage: '/plan [task]', description: 'Read-only investigation, then a plan', takesArgs: false },
  { name: 'build', usage: '/build [task]', description: 'Allow edits and commands', takesArgs: false },
  { name: 'new', usage: '/new', description: 'Start a new conversation', takesArgs: false },
  { name: 'workspace', usage: '/workspace', description: 'Open the folder panel', takesArgs: false },
  { name: 'deploy', usage: '/deploy', description: 'Deploy a project folder', takesArgs: false },
  { name: 'settings', usage: '/settings', description: 'Open settings', takesArgs: false },
  { name: 'clear', usage: '/clear', description: 'Clear this conversation', takesArgs: false },
]

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onCommand,
  streaming,
  hints = false,
  autoFocus = false,
  placeholder = 'How can I help you today?',
  contextPct,
  contextTitle,
  pixleMood,
}: {
  value: string
  onChange: (value: string) => void
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean> | boolean
  onStop: () => void
  onCommand?: (command: string, args: string) => Promise<boolean> | boolean
  streaming: boolean
  hints?: boolean
  autoFocus?: boolean
  placeholder?: string
  contextPct?: number
  contextTitle?: string
  pixleMood?: PixleMood
}) {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const setMode = useSettings((state) => state.setMode)
  const notify = useUi((state) => state.notify)
  const openSettings = useUi((state) => state.openSettings)
  const focusToken = useUi((state) => state.composerFocus)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const workspace = useWorkspace((state) => state.info)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const permissionRef = useRef<HTMLDivElement>(null)
  const permissionTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        setPickerOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useClickOutside(permissionRef, () => setPermissionOpen(false), permissionOpen, permissionTriggerRef)

  const modelId = activeModelId(settings)
  const providerModels = useProviderModels(settings.provider)
  const activeModel = useActiveModel()
  const connected = hasCredentials(settings)
  const efforts = effortOptions(activeModel)
  const activeSkills = useSkills((state) => state.skills.filter((skill) => skill.enabled).length)
  const permission = permissionMode(settings.tools)
  const modelLabel = !connected
    ? 'No provider'
    : modelId
      ? providerModels.find((model) => model.id === modelId)?.name ?? modelId
      : 'Select model'

  const commandQuery = useMemo(() => {
    if (!value.startsWith('/') || value.includes('\n')) return null
    const first = value.slice(1).split(/\s/)[0]
    if (value.slice(1).includes(' ')) return null
    return first.toLowerCase()
  }, [value])

  const commandMatches = useMemo(() => {
    if (commandQuery === null) return []
    return SLASH_COMMANDS.filter((command) => command.name.startsWith(commandQuery))
  }, [commandQuery])

  useEffect(() => {
    setCommandIndex(0)
  }, [commandQuery])

  useLayoutEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 52), 220)}px`
  }, [value])

  useEffect(() => {
    if (!autoFocus) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [autoFocus])

  useEffect(() => {
    if (focusToken > 0) textareaRef.current?.focus()
  }, [focusToken])

  useEffect(() => {
    if (!connected) setPickerOpen(false)
  }, [connected])

  useEffect(() => {
    if (activeModel && !efforts.length) update({ effort: 'medium' })
  }, [activeModel, efforts.length, update])

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return
    let room = MAX_ATTACHMENTS - attachments.length
    if (room <= 0) {
      notify(`You can attach up to ${MAX_ATTACHMENTS} files per message.`, 'error')
      return
    }
    const accepted: Attachment[] = []
    for (const file of files) {
      if (room <= 0) {
        notify(`Only ${MAX_ATTACHMENTS} attachments were added.`, 'info')
        break
      }
      const isImage = /^image\/(png|jpeg|webp|gif)$/i.test(file.type)
      const isText = file.type.startsWith('text/') || TEXT_EXTENSIONS.test(file.name)
      if (isImage) {
        if (file.size > MAX_IMAGE_BYTES) {
          notify(`${file.name} is larger than 5 MB.`, 'error')
          continue
        }
        accepted.push({
          id: newId(),
          name: file.name,
          kind: 'image',
          mime: file.type,
          dataUrl: await readFileAsDataUrl(file),
          size: file.size,
        })
        room -= 1
      } else if (isText) {
        if (file.size > MAX_TEXT_BYTES) {
          notify(`${file.name} is larger than 512 KB.`, 'error')
          continue
        }
        accepted.push({
          id: newId(),
          name: file.name,
          kind: 'text',
          mime: file.type || 'text/plain',
          text: await readFileAsText(file),
          size: file.size,
        })
        room -= 1
      } else {
        notify(`Can't attach ${file.name}. Use an image, text or code file.`, 'error')
      }
    }
    if (accepted.length > 0) setAttachments((current) => [...current, ...accepted])
  }

  const submit = async () => {
    if (streaming || submitting) return
    const text = value.trim()
    if (!text && attachments.length === 0) return

    if (text.startsWith('/') && !attachments.length) {
      const [rawName, ...rest] = text.slice(1).split(/\s+/)
      const command = SLASH_COMMANDS.find((entry) => entry.name === rawName.toLowerCase())
      if (command) {
        const args = rest.join(' ').trim()
        if (onCommand) {
          setSubmitting(true)
          try {
            const handled = await onCommand(command.name, args)
            if (handled) {
              onChange('')
              requestAnimationFrame(() => textareaRef.current?.focus())
            }
          } catch (error) {
            notify(error instanceof Error ? error.message : 'That command failed.', 'error')
          } finally {
            setSubmitting(false)
          }
          return
        }
      }
    }

    setSubmitting(true)
    setPickerOpen(false)
    try {
      const accepted = await onSend(value, attachments)
      if (accepted) {
        onChange('')
        setAttachments([])
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The message could not be sent.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const chooseCommand = (name: string, takesArgs: boolean) => {
    if (takesArgs) {
      onChange(`/${name} `)
      textareaRef.current?.focus()
      return
    }
    onChange(`/${name}`)
    window.setTimeout(() => void submitWith(`/${name}`), 0)
  }

  const submitWith = async (text: string) => {
    const [rawName] = text.slice(1).split(/\s+/)
    const command = SLASH_COMMANDS.find((entry) => entry.name === rawName.toLowerCase())
    if (!command || !onCommand) return
    setSubmitting(true)
    try {
      const handled = await onCommand(command.name, text.slice(1).split(/\s+/).slice(1).join(' '))
      if (handled) onChange('')
    } finally {
      setSubmitting(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCommandIndex((index) => (index + 1) % commandMatches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex((index) => (index - 1 + commandMatches.length) % commandMatches.length)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        const command = commandMatches[commandIndex]
        if (command) chooseCommand(command.name, command.takesArgs)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onChange('')
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (streaming) return
      void submit()
    }
    if (event.key === 'Escape') setPickerOpen(false)
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length > 0) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void addFiles(Array.from(event.dataTransfer.files))
  }

  const disabledSend = (!value.trim() && attachments.length === 0) || submitting || streaming
  const contextTone =
    contextPct === undefined
      ? ''
      : contextPct >= 95
        ? 'text-danger'
        : contextPct >= 70
          ? 'text-warning'
          : 'text-faint'

  return (
    <div className="relative w-full">
      <ModelDeck open={pickerOpen && connected} onClose={() => setPickerOpen(false)} />

      {commandMatches.length > 0 && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-[min(94vw,360px)] overflow-hidden rounded-xl border border-line surface-lift shadow-float">
          <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
            <Slash size={10} /> Commands
          </div>
          {commandMatches.map((command, index) => (
            <button
              key={command.name}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseCommand(command.name, command.takesArgs)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left',
                index === commandIndex ? 'bg-accent-soft' : 'hover:bg-raised',
              )}
            >
              <span className={cn('font-mono text-[10.5px]', index === commandIndex ? 'text-accent' : 'text-ink')}>
                {command.usage}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-faint">{command.description}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setWorkspaceOpen(true)}
          className="chip h-7 max-w-[220px] gap-1.5 px-2.5 text-[11px]"
          title={workspace.available ? workspace.root : 'Choose a project folder'}
        >
          <FolderOpen size={12} className="shrink-0 text-faint" />
          <span className="truncate">{workspace.available ? workspace.name : 'No folder'}</span>
        </button>
        <button
          type="button"
          onClick={() => setMode(settings.mode === 'plan' ? 'build' : 'plan')}
          className="chip h-7 gap-1.5 px-2.5 text-[11px]"
          title={settings.mode === 'plan' ? 'Switch to Build mode' : 'Switch to Plan mode (read-only)'}
        >
          {settings.mode === 'plan' ? (
            <ListChecks size={12} className="text-faint" />
          ) : (
            <Sparkles size={12} className="text-faint" />
          )}
          {settings.mode === 'plan' ? 'Plan mode' : 'Build mode'}
        </button>
        <button
          type="button"
          onClick={() => update({ webSearchEnabled: !settings.webSearchEnabled })}
          className={cn('chip h-7 gap-1.5 px-2.5 text-[11px]', settings.webSearchEnabled && 'chip-active')}
          title="Allow OpenSol to search the web and read pages"
          aria-pressed={settings.webSearchEnabled}
        >
          <Globe2 size={12} />
          Search
        </button>
        {activeSkills > 0 && (
          <button
            type="button"
            onClick={() => openSettings('skills')}
            className="chip h-7 gap-1 px-2.5 text-[11px]"
            title="Manage loaded skills"
          >
            {activeSkills} skill{activeSkills === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={onDrop}
        className={cn(
          'surface-lift composer-shadow relative rounded-2xl border transition-all duration-200',
          focused || dragging ? 'border-accent/35' : 'border-line',
          streaming && 'composer-glow border-accent/30',
          dragging && 'ring-4 ring-accent/10',
        )}
      >
        {focused && !dragging && (
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-4 ring-accent/[0.03]" aria-hidden="true" />
        )}

        <div className="relative px-3.5 pb-1 pt-3">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pb-2">
              {attachments.map((attachment) =>
                attachment.kind === 'image' ? (
                  <div key={attachment.id} className="relative">
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="h-14 w-14 rounded-lg border border-line object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                      className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line bg-panel text-muted shadow-sm transition-colors hover:text-ink"
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <span
                    key={attachment.id}
                    className="inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-raised/70 pl-2 pr-1 text-[10.5px] text-muted"
                  >
                    <FileText size={11} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                    <span className="shrink-0 text-faint">{formatBytes(attachment.size)}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:bg-panel hover:text-ink"
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ),
              )}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            rows={1}
            aria-label="Message OpenSol"
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-[15.5px] leading-[1.6] text-ink outline-none placeholder:text-faint"
            style={{ minHeight: 52, maxHeight: 220 }}
          />
        </div>

        <div className="flex items-end justify-between gap-2 px-2.5 pb-2 pt-1">
          <div className="flex min-w-0 items-center gap-0.5">
            <div className="relative">
              <button
                ref={permissionTriggerRef}
                type="button"
                onClick={() => setPermissionOpen((open) => !open)}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
                title="Choose how much OpenSol can do without asking"
                aria-expanded={permissionOpen}
              >
                <ShieldCheck size={13} className="text-faint" />
                {permissionLabel(permission)}
                <ChevronDown size={11} className={cn('text-faint transition-transform', permissionOpen && 'rotate-180')} />
              </button>
              {permissionOpen && (
                <div
                  ref={permissionRef}
                  className="surface-lift absolute bottom-[calc(100%+8px)] left-0 z-40 w-[290px] overflow-hidden rounded-2xl border border-line p-1.5 shadow-float"
                >
                  <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
                    Permissions
                  </p>
                  {PERMISSION_MODES.map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      onClick={() => {
                        update({ tools: permissionTools(settings.tools, entry.value) })
                        setPermissionOpen(false)
                      }}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-raised"
                    >
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                        {permission === entry.value ? (
                          <Check size={12} className="text-accent" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-line" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11.5px] font-medium text-ink">{entry.label}</span>
                        <span className="mt-0.5 block text-[10px] leading-relaxed text-faint">{entry.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-button h-8 w-8"
              onClick={() => fileRef.current?.click()}
              title="Attach images or text files"
              aria-label="Attach files"
            >
              <Paperclip size={15} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,.md,.markdown,.txt,.ts,.tsx,.js,.jsx,.json,.css,.html,.py,.go,.rs,.rb,.java,.cs,.sh,.yml,.yaml,.toml,.sql"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void addFiles(Array.from(event.target.files))
                event.target.value = ''
              }}
            />
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-1">
            {contextPct !== undefined && (
              <span
                className={cn('hidden items-center gap-1 px-1 text-[10.5px] tabular-nums sm:flex', contextTone)}
                title={contextTitle}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {contextPct}%
              </span>
            )}
            <ModelDeckTrigger
              triggerRef={modelTriggerRef}
              label={modelLabel}
              open={pickerOpen}
              disabled={!connected}
              onClick={() => setPickerOpen((open) => !open)}
              efforts={efforts}
              effort={settings.effort}
              title={connected ? 'Model deck: choose model and reasoning effort (Ctrl M)' : 'Add a provider key in Settings first'}
            />
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-panel transition-opacity hover:opacity-85"
                aria-label="Stop generating"
                title="Stop"
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={disabledSend}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150',
                  disabledSend ? 'cursor-not-allowed bg-raised text-faint' : 'bg-accent text-on-accent hover:brightness-110',
                )}
                aria-label="Send message"
                title="Send (Enter)"
              >
                {submitting ? (
                  <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <ArrowUpIcon />
                )}
              </button>
            )}
          </div>
        </div>

        {dragging && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-accent/45 bg-panel/95">
            <Upload size={18} className="text-accent" />
            <p className="text-[12px] font-medium text-ink">Drop files to attach</p>
            <p className="text-[10.5px] text-faint">Images up to 5 MB · text up to 512 KB</p>
          </div>
        )}

        {pixleMood && (
          <PixleSol
            mood={pixleMood}
            size={44}
            className="pointer-events-none absolute -top-[34px] right-4 z-10 hidden sm:inline-flex"
          />
        )}
      </div>

      {hints && (
        <div className="mt-2.5 flex items-center justify-between gap-4 px-2 text-[11px] text-faint">
          <span className="hidden sm:inline">Enter to send · Shift + Enter for a new line · / for commands</span>
          <span className="flex items-center gap-1 sm:ml-auto">
            <ShieldCheck size={11} />
            Local daemon · keys encrypted at rest
          </span>
        </div>
      )}
    </div>
  )
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M8 12.5V3.5M4.2 7.2L8 3.4l3.8 3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
