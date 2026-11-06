import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Square,
} from 'lucide-react'
import type { AssistantMessage, ToolMessage, UserMessage } from '../types'
import type { ConversationTurn } from '../lib/conversation'
import { useUi } from '../store/ui'
import { useSettings } from '../store/settings'
import { useModelCatalog } from '../store/models'
import { regenerateLastTurn } from '../agent'
import { toolLabel } from '../agent/tools'
import { formatBytes, cn } from '../lib/utils'
import { Markdown } from './Markdown'
import { ToolCallCard } from './ToolCallCard'
import { LogoMark } from './Logo'
import { Mascot } from './Mascot'

function formatTokens(value?: number) {
  if (!value) return ''
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function UserBubble({ message }: { message: UserMessage }) {
  const images = (message.attachments ?? []).filter((attachment) => attachment.kind === 'image')
  const files = (message.attachments ?? []).filter((attachment) => attachment.kind === 'text')
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] sm:max-w-[82%]">
        {images.length > 0 && (
          <div className={cn('mb-2 grid gap-2', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
            {images.map((image) => (
              <img
                key={image.id}
                src={image.dataUrl}
                alt={image.name}
                className="max-h-52 w-full rounded-xl border border-line object-cover"
              />
            ))}
          </div>
        )}
        <div className="rounded-[18px] bg-raised px-3.5 py-2.5">
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {files.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[10.5px] text-muted"
                >
                  <FileText size={11} />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  <span className="text-faint">{formatBytes(file.size)}</span>
                </span>
              ))}
            </div>
          )}
          {message.content && (
            <p className="chat-text whitespace-pre-wrap break-words leading-[1.65] text-ink">{message.content}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function TaskCompletedBox({
  tools,
  intermediateMessages = [],
  streaming = false,
}: {
  tools: ToolMessage[]
  intermediateMessages?: AssistantMessage[]
  streaming?: boolean
}) {
  const [open, setOpen] = useState(false)
  const autoOpened = useRef(false)
  const autoCollapse = useSettings((state) => state.autoCollapseWork)
  const detailed = useSettings((state) => state.workDetail === 'detailed')
  const mascot = useSettings((state) => state.mascot)

  const awaiting = tools.some((tool) => tool.status === 'awaiting')
  const active = streaming || tools.some((tool) => tool.status === 'running')

  // Auto-open when awaiting approval or actively running
  useEffect(() => {
    if (awaiting) {
      setOpen(true)
    } else if (active) {
      autoOpened.current = true
      setOpen(true)
    } else if (autoOpened.current && autoCollapse) {
      autoOpened.current = false
      setOpen(false)
    }
  }, [active, awaiting, autoCollapse])

  if (tools.length === 0 && intermediateMessages.length === 0) return null

  const labels = [...new Set(tools.map((tool) => toolLabel(tool.call.name)))]
  const failed = tools.filter((tool) => tool.status === 'error' || tool.status === 'denied').length
  const summary = labels.length <= 3 ? labels.join(' · ') : `${labels.slice(0, 3).join(' · ')} +${labels.length - 3}`

  const taskItems = [
    ...tools.map((t) => ({ kind: 'tool' as const, tool: t, time: t.createdAt })),
    ...intermediateMessages.map((m) => ({ kind: 'assistant' as const, message: m, time: m.createdAt })),
  ].sort((a, b) => a.time - b.time)

  return (
    <div className="my-1.5 overflow-hidden rounded-xl border border-line/80 bg-transparent">
      <button
        type="button"
        onClick={() => {
          autoOpened.current = false
          setOpen((value) => !value)
        }}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-raised/40"
        aria-expanded={open}
      >
        {awaiting ? (
          mascot === 'off' ? <AlertCircle size={20} className="text-warning" /> : <Mascot id={mascot} mood="alert" size={26} />
        ) : active ? (
          mascot === 'off' ? <LoaderCircle size={20} className="animate-spin text-accent" /> : <Mascot id={mascot} mood="working" size={26} />
        ) : failed > 0 ? (
          mascot === 'off' ? <AlertCircle size={20} className="text-danger" /> : <Mascot id={mascot} mood="error" size={26} />
        ) : (
          mascot === 'off' ? <Check size={20} className="text-success" /> : <Mascot id={mascot} mood="happy" size={26} />
        )}

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className={cn('text-[12.5px] font-medium', awaiting ? 'text-warning' : 'text-ink')}>
            {awaiting ? 'Action required' : active ? 'Running task…' : 'Task completed'}
          </span>
          <span className="truncate text-[11px] text-faint">
            {tools.length > 0 && `Used ${tools.length} tool${tools.length === 1 ? '' : 's'}`}
            {summary ? ` (${summary})` : ''}
          </span>
        </div>

        {failed > 0 && (
          <span className="shrink-0 rounded-full bg-danger/10 px-1.5 py-0.5 text-[9.5px] font-medium text-danger">
            {failed} failed
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-faint">
          <span className="hidden sm:inline">{open ? 'Hide' : 'Expand'}</span>
          <ChevronDown
            size={14}
            className={cn('text-faint transition-transform duration-150', open && 'rotate-180')}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t border-line/60 bg-raised/20 p-2.5">
          {taskItems.map((item) =>
            item.kind === 'tool' ? (
              <ToolCallCard key={item.tool.id} message={item.tool} compact={!detailed} />
            ) : (
              <div key={item.message.id} className="rounded-xl border border-line/60 bg-panel p-2.5">
                {item.message.reasoning.trim() && (
                  <div className="thin-scroll max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-muted">
                    {item.message.reasoning}
                  </div>
                )}
                {item.message.content.trim() && (
                  <div className="mt-1 text-[12px] leading-relaxed text-ink">
                    <Markdown content={item.message.content} />
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

export function UsedGroup({ tools, streaming = false }: { tools: ToolMessage[]; streaming?: boolean }) {
  return <TaskCompletedBox tools={tools} streaming={streaming} />
}

export function AssistantBlock({
  message,
  sessionId,
  streaming,
  isLastAssistant,
  showHeader,
}: {
  message: AssistantMessage
  sessionId: string
  streaming: boolean
  isLastAssistant: boolean
  /** Only the first answer of a turn repeats the assistant header. */
  showHeader: boolean
}) {
  const notify = useUi((state) => state.notify)
  const openSettings = useUi((state) => state.openSettings)
  const showTokenEstimate = useSettings((state) => state.showTokenEstimate)
  const providerModels = useModelCatalog((state) =>
    message.provider ? state.byProvider[message.provider] : undefined,
  )
  const [copied, setCopied] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(streaming)
  const hasBody = Boolean(message.content.trim() || message.reasoning.trim() || message.error)
  const modelName =
    providerModels?.find((model) => model.id === message.model)?.name ?? message.model ?? ''
  const needsConfig = Boolean(message.error && /api key|base url|settings|credential|403|401/i.test(message.error))
  const tokenBits: string[] = []
  if (message.usage?.input) tokenBits.push(`${formatTokens(message.usage.input)} in`)
  if (message.usage?.output) tokenBits.push(`${formatTokens(message.usage.output)} out`)
  else if (showTokenEstimate && message.content.trim()) {
    tokenBits.push(`~${formatTokens(Math.ceil(message.content.length / 4))} out`)
  }
  const metaLine = [
    modelName,
    ...tokenBits,
    message.durationMs ? `${(message.durationMs / 1000).toFixed(1)}s` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  useEffect(() => {
    if (streaming) setReasoningOpen(true)
  }, [streaming])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  if (!hasBody && !streaming) {
    return (
      <div className="group">
        <div className="min-w-0">
          {showHeader && (
            <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
              OpenSol
              {modelName && <span className="font-normal text-faint">{modelName}</span>}
            </div>
          )}
          <p className="mt-2 text-[13px] text-muted">The model returned an empty response.</p>
          {isLastAssistant && (
            <button
              type="button"
              onClick={() => regenerateLastTurn(sessionId)}
              className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent hover:underline"
            >
              <RefreshCw size={12} /> Try again
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="group">
      <div className="min-w-0">
        {(showHeader || message.stopped) && (
          <div className="flex min-h-[22px] items-center gap-1.5">
            {showHeader && (
              <>
                <LogoMark size={15} />
                <span className="text-[12px] font-medium text-muted">OpenSol</span>
                {modelName && <span className="truncate text-[11.5px] text-faint">{modelName}</span>}
              </>
            )}
            {message.stopped && (
              <span className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[9.5px] font-medium text-muted">
                <Square size={7} fill="currentColor" />
                Stopped
              </span>
            )}
          </div>
        )}

        {message.reasoning.trim() && (
          <div className="mt-1 overflow-hidden rounded-lg border border-line/60">
            <button
              type="button"
              onClick={() => setReasoningOpen((value) => !value)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-raised/40"
              aria-expanded={reasoningOpen}
            >
              <Brain size={12} className="text-faint" />
              <span className="shrink-0 text-[11.5px] font-medium text-muted">
                {streaming ? 'Thinking' : 'Thought'}
              </span>
              {streaming && <span className="animate-pulse text-accent">…</span>}
              <span className="min-w-0 flex-1 truncate text-left text-[10.5px] text-faint">
                {message.reasoning.replace(/\s+/g, ' ').trim().slice(0, 120)}
              </span>
              <ChevronDown
                size={12}
                className={cn('shrink-0 text-faint transition-transform', reasoningOpen && 'rotate-180')}
              />
            </button>
            {reasoningOpen && (
              <div className="thin-scroll max-h-72 overflow-y-auto border-t border-line/60 px-3 py-2.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.65] text-muted">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {message.content && (
          <div className="mt-1.5">
            <Markdown content={message.content} streaming={streaming} />
          </div>
        )}

        {streaming && !message.content && !message.reasoning && (
          <div className="mt-2 flex items-center gap-2 text-[13px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" />
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent [animation-delay:160ms]" />
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent [animation-delay:320ms]" />
            </span>
            Working
          </div>
        )}

        {message.error && (
          <div className="mt-3 rounded-lg border border-danger/25 bg-danger/[0.035] px-3.5 py-3">
            <div className="flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-ink">The request did not finish</p>
                <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{message.error}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {needsConfig && (
                    <button
                      type="button"
                      onClick={() => openSettings('models')}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[11.5px] font-medium text-ink hover:bg-raised"
                    >
                      <Settings2 size={12} />
                      Open model settings
                    </button>
                  )}
                  {isLastAssistant && (
                    <button
                      type="button"
                      onClick={() => regenerateLastTurn(sessionId)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[11.5px] font-medium text-ink hover:bg-raised"
                    >
                      <RefreshCw size={12} />
                      Try again
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {hasBody && !streaming && (
          <div className="mt-2 flex min-h-[28px] flex-wrap items-center gap-0.5 text-[11.5px] text-faint">
            {message.content && (
              <button
                type="button"
                onClick={copy}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-raised hover:text-ink"
                aria-label="Copy response"
                title={copied ? 'Copied' : 'Copy'}
              >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} strokeWidth={1.7} />}
              </button>
            )}
            {isLastAssistant && (
              <button
                type="button"
                onClick={() => regenerateLastTurn(sessionId)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-raised hover:text-ink"
                aria-label="Regenerate response"
                title="Regenerate"
              >
                <RefreshCw size={14} strokeWidth={1.7} />
              </button>
            )}
            <span className="ml-2">{metaLine}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function TurnBlock({
  turn,
  sessionId,
  streaming,
  lastAssistantId,
  activeTurn = false,
}: {
  turn: ConversationTurn
  sessionId: string
  streaming: boolean
  lastAssistantId?: string
  /** True while this is the turn the agent is currently working on. */
  activeTurn?: boolean
}) {
  const allTools: ToolMessage[] = []
  const assistantMessages: AssistantMessage[] = []

  for (const segment of turn.segments) {
    if (segment.kind === 'tools') {
      allTools.push(...segment.tools)
    } else if (segment.kind === 'assistant') {
      assistantMessages.push(segment.message)
    }
  }

  const hasTools = allTools.length > 0
  const firstAssistantId = assistantMessages[0]?.id
  const finalAssistant = assistantMessages[assistantMessages.length - 1] ?? null

  // While the agent is still working, every step is shown inline. Nothing is
  // folded into "Task completed" until the whole turn actually finishes.
  if (activeTurn && hasTools) {
    return (
      <div className="flex flex-col gap-2.5">
        {turn.user && <UserBubble message={turn.user} />}
        {turn.segments.map((segment, index) =>
          segment.kind === 'tools' ? (
            <div key={`tools-${index}`} className="space-y-1.5">
              {segment.tools.map((tool) => (
                <ToolCallCard key={tool.id} message={tool} />
              ))}
            </div>
          ) : (
            <AssistantBlock
              key={segment.message.id}
              message={segment.message}
              sessionId={sessionId}
              streaming={streaming && segment.message.id === lastAssistantId}
              isLastAssistant={segment.message.id === lastAssistantId}
              showHeader={segment.message.id === firstAssistantId}
            />
          ),
        )}
      </div>
    )
  }

  // Finished turn with no tools: just the conversation.
  if (!hasTools) {
    let seen = 0
    return (
      <div className="flex flex-col gap-2.5">
        {turn.user && <UserBubble message={turn.user} />}
        {assistantMessages.map((message) => (
          <AssistantBlock
            key={message.id}
            message={message}
            sessionId={sessionId}
            streaming={streaming && message.id === lastAssistantId}
            isLastAssistant={message.id === lastAssistantId}
            showHeader={seen++ === 0}
          />
        ))}
      </div>
    )
  }

  // Finished turn: fold the tool calls and intermediate steps into one
  // collapsible "Task completed" block; the final answer stays outside.
  const intermediateAssistants = assistantMessages.slice(0, -1)

  return (
    <div className="flex flex-col gap-2.5">
      {turn.user && <UserBubble message={turn.user} />}

      <TaskCompletedBox tools={allTools} intermediateMessages={intermediateAssistants} />

      {finalAssistant && (
        <AssistantBlock
          key={finalAssistant.id}
          message={finalAssistant}
          sessionId={sessionId}
          streaming={false}
          isLastAssistant={finalAssistant.id === lastAssistantId}
          showHeader={true}
        />
      )}
    </div>
  )
}
