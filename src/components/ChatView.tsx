import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bug, FolderSearch, Gamepad2, Globe2, KeyRound, LayoutTemplate, ListChecks, Sparkles } from 'lucide-react'
import type { Attachment } from '../types'
import { createId, useChats } from '../store/chats'
import { activeModelId, hasCredentials, useSettings } from '../store/settings'
import { useActiveModel } from '../store/models'
import { useRuntime, useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { getProviderName } from '../data/providers'
import { stopRun, runAgent } from '../agent'
import { getContextUsage } from '../lib/context'
import { heliumMood } from '../lib/helium'
import { formatTokens } from '../lib/usage'
import { groupConversationTurns } from '../lib/conversation'
import { TopBar, type ChatViewMode } from './TopBar'
import { Composer } from './Composer'
import { TurnBlock } from './MessageItem'
import { HomeDashboard, HomeGreeting } from './HomeDashboard'
import { TrajectoryView } from './TrajectoryView'

const STARTERS = [
  {
    icon: Gamepad2,
    label: 'Build a game',
    prompt:
      'Build a small browser game as one self-contained index.html (canvas, no build step). Make it playable with keyboard and touch, with a score and a restart button. Put the whole file in a single html code block so I can preview it.',
  },
  {
    icon: LayoutTemplate,
    label: 'Design a landing page',
    prompt:
      'Design a polished, responsive landing page for a small indie game studio. Choose a distinctive typographic style, keep it to one file, and put everything in a single html code block so I can preview it.',
  },
  {
    icon: Bug,
    label: 'Trace a bug',
    prompt:
      'Inspect this workspace for a real bug. Explain the root cause, make the smallest correct fix, and run the project checks.',
  },
  {
    icon: FolderSearch,
    label: 'Audit this folder',
    prompt:
      'Audit this workspace. Read the key files first, then list the three most important improvements with file references and a short plan.',
  },
  {
    icon: Globe2,
    label: 'Research with sources',
    prompt:
      'Search the web for the current release notes of the main framework in this project, then summarise what matters and cite the pages you read.',
  },
]

export function ChatView() {
  const sessions = useChats((state) => state.sessions)
  const activeId = useChats((state) => state.activeId)
  const session = sessions.find((item) => item.id === activeId) ?? null
  const streaming = useRuntime((state) => (activeId ? Boolean(state.streaming[activeId]) : false))
  const settings = useSettings()
  const setMode = useSettings((state) => state.setMode)
  const update = useSettings((state) => state.update)
  const notify = useUi((state) => state.notify)
  const openSettings = useUi((state) => state.openSettings)
  const focusComposer = useUi((state) => state.focusComposer)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const askConfirm = useUi((state) => state.askConfirm)
  const workspace = useWorkspace((state) => state.info)
  const git = useWorkspace((state) => state.git)
  const activeModel = useActiveModel()
  const [draft, setDraft] = useState('')
  const [view, setView] = useState<ChatViewMode>('chat')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const lastSessionRef = useRef<string | null>(activeId)
  const lastMessageIdRef = useRef<string | null>(null)

  const messages = session?.messages ?? []
  const lastMessage = messages[messages.length - 1]
  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id
  const connected = hasCredentials(settings)
  const selectedModel = activeModelId(settings)
  const activeSkills = settings.skills.filter((skill) => skill.enabled).length
  const turns = groupConversationTurns(messages)
  const context = getContextUsage(messages, activeModel)
  const mood = heliumMood(messages, streaming)

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior })
  }

  useEffect(() => {
    if (lastSessionRef.current !== activeId) {
      lastSessionRef.current = activeId
      setAtBottom(true)
      setView('chat')
      requestAnimationFrame(() => scrollToBottom('auto'))
      const current = useChats.getState().sessions.find((item) => item.id === activeId)
      if (current?.mode) setMode(current.mode)
    }
  }, [activeId, setMode])

  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessage.id
      if (lastMessage.role === 'user') {
        setAtBottom(true)
        requestAnimationFrame(() => scrollToBottom('auto'))
      } else if (atBottom) {
        requestAnimationFrame(() => scrollToBottom('auto'))
      }
    } else if (atBottom) {
      scrollToBottom('auto')
    }
  }, [lastMessage, atBottom])

  useEffect(() => {
    if (!atBottom) return
    const timer = window.setTimeout(() => scrollToBottom('auto'), 40)
    return () => window.clearTimeout(timer)
  }, [messages, atBottom])

  const send = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    const current = useSettings.getState()
    if (!hasCredentials(current)) {
      notify(
        current.provider === 'custom'
          ? 'Add a base URL for your custom endpoint in Settings → Models.'
          : `Add an API key for ${getProviderName(current.provider)} in Settings → Models.`,
        'error',
      )
      openSettings('models')
      return false
    }
    const modelId = activeModelId(current)
    if (!modelId) {
      notify('Choose a model before sending a message.', 'error')
      openSettings('models')
      return false
    }

    let sessionId = activeId
    if (!sessionId || !useChats.getState().sessions.some((item) => item.id === sessionId)) {
      sessionId = useChats.getState().createSession(current.provider, modelId, current.mode)
    }
    const content = text.trim()
    const userMessageId = createId('msg')
    useChats.getState().addMessage(sessionId, {
      id: userMessageId,
      role: 'user',
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: Date.now(),
    })
    useChats.getState().updateSession(sessionId, { mode: current.mode })
    setDraft('')
    setAtBottom(true)
    runAgent(sessionId, userMessageId)
    return true
  }

  const useStarter = (prompt: string) => {
    setDraft(prompt)
    focusComposer()
  }

  const handleCommand = async (command: string, args: string): Promise<boolean> => {
    switch (command) {
      case 'search': {
        if (!args.trim()) {
          setDraft('/search ')
          notify('Type what you want MaxCode to research.', 'info')
          focusComposer()
          return false
        }
        update({ webSearchEnabled: true })
        return send(
          `Use the web to research this: ${args.trim()}\n\nRead the most useful sources, cite the URLs you actually opened, and answer for this workspace.`,
          [],
        )
      }
      case 'plan': {
        setMode('plan')
        if (!args.trim()) {
          notify('Plan mode is on: investigation only until you switch to Build.', 'info')
          focusComposer()
          return true
        }
        return send(args.trim(), [])
      }
      case 'build': {
        setMode('build')
        if (!args.trim()) {
          notify('Build mode is on: MaxCode can edit files and run commands.', 'info')
          focusComposer()
          return true
        }
        return send(args.trim(), [])
      }
      case 'new': {
        useChats.getState().newChat()
        focusComposer()
        return true
      }
      case 'workspace': {
        setWorkspaceOpen(true)
        return true
      }
      case 'deploy': {
        setDeployOpen(true)
        return true
      }
      case 'settings': {
        openSettings('models')
        return true
      }
      case 'clear': {
        const current = useChats.getState().sessions.find((item) => item.id === activeId)
        if (!current || current.messages.length === 0) return true
        const confirmed = await askConfirm({
          title: 'Clear this conversation?',
          body: 'The messages in this conversation will be removed from your local history. The workspace files are not touched.',
          confirmLabel: 'Clear conversation',
          tone: 'danger',
        })
        if (!confirmed) return true
        stopRun(current.id)
        useChats.getState().updateSession(current.id, { messages: [] })
        useChats.getState().updateSession(current.id, { title: 'New conversation' })
        notify('Conversation cleared.', 'success')
        return true
      }
      default:
        return false
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <TopBar session={session} view={view} onViewChange={setView} />

      {!session || messages.length === 0 ? (
        <div className="thin-scroll relative min-h-0 flex-1 overflow-y-auto">
          <div className="hero-wash pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-4 py-10 sm:px-6">
            <div className="animate-rise">
              <HomeGreeting />
            </div>

            <div className="mt-8 w-full animate-rise [animation-delay:80ms]">
              {(!connected || !selectedModel) && (
                <button
                  type="button"
                  onClick={() => openSettings('models')}
                  className="mb-3 flex w-full items-center gap-2 rounded-2xl border border-accent/25 bg-accent-soft/60 px-4 py-2.5 text-left text-[12.5px] font-medium text-accent transition-colors hover:bg-accent-soft"
                >
                  <KeyRound size={14} className="shrink-0" />
                  <span className="flex-1">{connected ? 'Choose a model to start' : 'Connect a provider to start'}</span>
                  <span className="text-[11px] font-normal opacity-70">Open settings →</span>
                </button>
              )}
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={send}
                onStop={() => undefined}
                onCommand={handleCommand}
                streaming={false}
                hints
                autoFocus
                placeholder={connected ? 'How can I help you today?' : 'Add a provider key to start'}
                heliumMood={connected ? 'idle' : 'sleepy'}
              />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.label}
                    type="button"
                    onClick={() => useStarter(starter.prompt)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-line/80 px-3.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-raised/60 hover:text-ink"
                  >
                    <starter.icon size={14} strokeWidth={1.7} className="text-faint" />
                    {starter.label}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 flex items-center justify-center gap-3 px-1 text-[11px] text-faint">
                <span className="truncate">
                  {workspace.available ? workspace.name : 'No folder open'}
                  {workspace.available && git.available && git.branch ? ` · ${git.branch}` : ''}
                </span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">
                  {activeSkills} skill{activeSkills === 1 ? '' : 's'} ·{' '}
                  {!connected ? 'Provider needed' : !selectedModel ? 'Model needed' : 'Ready'}
                </span>
              </div>
            </div>

            <div className="mt-10 animate-rise [animation-delay:160ms]">
              <HomeDashboard />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            {view === 'trajectory' ? (
              <TrajectoryView session={session} />
            ) : (
              <>
                <div
                  ref={scrollRef}
                  onScroll={(event) => {
                    const node = event.currentTarget
                    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
                    setAtBottom(distance < 90)
                  }}
                  className="thin-scroll h-full overflow-y-auto"
                >
                  <div className="mx-auto w-full max-w-[760px] px-4 pb-12 pt-8 sm:px-6 sm:pt-10">
                    {turns.map((turn, index) => (
                      <div key={turn.id} className={index === 0 ? '' : 'mt-10'}>
                        <TurnBlock
                          turn={turn}
                          sessionId={session.id}
                          streaming={streaming}
                          lastAssistantId={lastAssistantId}
                          activeTurn={streaming && index === turns.length - 1}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {!atBottom && (
                  <button
                    type="button"
                    onClick={() => {
                      setAtBottom(true)
                      scrollToBottom('smooth')
                    }}
                    className="surface-lift absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-line px-3.5 py-2 text-[11.5px] font-medium text-muted shadow-pill transition-colors hover:text-ink"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowUp size={11} />
                      Jump to latest
                    </span>
                  </button>
                )}
              </>
            )}
          </div>

          <div className="shrink-0 bg-panel px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
            <div className="mx-auto w-full max-w-[760px]">
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={send}
                onStop={() => session && stopRun(session.id)}
                onCommand={handleCommand}
                streaming={streaming}
                placeholder={connected ? 'How can I help you today?' : 'Add a provider key to start'}
                contextPct={context.pct}
                contextTitle={`Context: ~${formatTokens(context.used)} / ${formatTokens(context.limit)} tokens`}
                heliumMood={mood}
              />
              <div className="mt-2 flex items-center justify-between gap-3 px-2 text-[11px] text-faint">
                <span className="flex items-center gap-1">
                  {settings.mode === 'plan' ? <ListChecks size={10} /> : <Sparkles size={10} />}
                  {settings.mode === 'plan'
                    ? 'Plan mode · read-only tools'
                    : activeSkills > 0
                      ? `${activeSkills} skill${activeSkills === 1 ? '' : 's'} loaded`
                      : 'Build mode · full tools'}
                </span>
                <span className="hidden sm:inline">
                  {workspace.available ? `Working in ${workspace.name}` : 'No workspace open'}
                </span>
                <span className="sm:hidden">
                  {settings.tools.shell.approval === 'ask' ? 'Shell asks first' : 'Shell auto-runs'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
