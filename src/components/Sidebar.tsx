import { useMemo, useState } from 'react'
import {
  Check,
  Download,
  FileText,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  Pencil,
  Plus,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useChats } from '../store/chats'
import { hasCredentials, useSettings } from '../store/settings'
import { useRuntime, useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { stopRun } from '../agent'
import { getProviderName } from '../data/providers'
import { cn, downloadText, formatRelativeTime, groupChatsByDate } from '../lib/utils'
import { LogoLockup } from './Logo'

function shortTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

interface ChatMenu {
  id: string
  x: number
  y: number
}

export function Sidebar() {
  const sessions = useChats((state) => state.sessions)
  const activeId = useChats((state) => state.activeId)
  const setActive = useChats((state) => state.setActive)
  const newChat = useChats((state) => state.newChat)
  const renameSession = useChats((state) => state.renameSession)
  const deleteSession = useChats((state) => state.deleteSession)
  const settings = useSettings()
  const workspace = useWorkspace((state) => state.info)
  const addWorkspace = useWorkspace((state) => state.addWorkspace)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const toggleSidebar = useUi((state) => state.toggleSidebar)
  const mobileOpen = useUi((state) => state.mobileSidebarOpen)
  const setMobileOpen = useUi((state) => state.setMobileSidebarOpen)
  const openSettings = useUi((state) => state.openSettings)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const askConfirm = useUi((state) => state.askConfirm)
  const notify = useUi((state) => state.notify)
  const focusComposer = useUi((state) => state.focusComposer)
  const streaming = useRuntime((state) => state.streaming)

  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<ChatMenu | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [switching, setSwitching] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((session) => session.title.toLowerCase().includes(needle))
  }, [sessions, query])
  const groups = useMemo(() => groupChatsByDate(filtered), [filtered])
  const workspaces = useMemo(
    () => [...workspace.workspaces].sort((a, b) => b.lastOpened - a.lastOpened),
    [workspace.workspaces],
  )
  const connected = hasCredentials(settings)
  const profileName =
    (settings.daemon?.home ?? '').split(/[\\/]/).filter(Boolean).pop() || workspace.name || 'Local'

  const startNewChat = () => {
    newChat()
    setMobileOpen(false)
    setMenu(null)
    focusComposer()
  }

  const openChat = (id: string) => {
    setActive(id)
    setMobileOpen(false)
    setMenu(null)
  }

  const switchWorkspace = async (path: string) => {
    if (path === workspace.root) {
      setWorkspaceOpen(true)
      setMobileOpen(false)
      return
    }
    setSwitching(path)
    try {
      await addWorkspace(path)
      setMobileOpen(false)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open that folder.', 'error')
    } finally {
      setSwitching('')
    }
  }

  const beginRename = (id: string, title: string) => {
    setEditingId(id)
    setDraftTitle(title)
    setMenu(null)
  }

  const commitRename = () => {
    if (!editingId) return
    if (draftTitle.trim()) renameSession(editingId, draftTitle)
    setEditingId(null)
    setDraftTitle('')
  }

  const removeChat = async (id: string, title: string) => {
    setMenu(null)
    const confirmed = await askConfirm({
      title: 'Delete this conversation?',
      body: `“${title}” and its messages will be removed from this computer. This cannot be undone.`,
      confirmLabel: 'Delete conversation',
      tone: 'danger',
    })
    if (!confirmed) return
    stopRun(id)
    deleteSession(id)
  }

  const exportMarkdown = (id: string) => {
    const session = sessions.find((item) => item.id === id)
    if (!session) return
    setMenu(null)
    const body = session.messages
      .flatMap((message) => {
        if (message.role === 'user') return [`## You\n\n${message.content}`]
        if (message.role === 'assistant' && message.content.trim()) return [`## MaxCode\n\n${message.content.trim()}`]
        return []
      })
      .join('\n\n')
    downloadText(
      `maxcode-${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'conversation'}.md`,
      `# ${session.title}\n\n${body}\n`,
      'text/markdown',
    )
    notify('Conversation exported as Markdown.', 'success')
  }

  const exportChat = (id: string) => {
    const session = sessions.find((item) => item.id === id)
    if (!session) return
    setMenu(null)
    downloadText(
      `maxcode-${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'conversation'}.json`,
      JSON.stringify({ app: 'MaxCode', exportedAt: new Date().toISOString(), session }, null, 2),
      'application/json',
    )
    notify('Conversation exported.', 'success')
  }

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-dvh w-[288px] shrink-0 flex-col border-r border-line/60 bg-canvas transition-transform duration-200 lg:static lg:z-auto',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        sidebarCollapsed && 'lg:hidden',
      )}
    >
      <div className="flex h-14 items-center gap-2 pl-2.5 pr-2.5">
        <button
          type="button"
          className="icon-button hidden lg:inline-flex"
          onClick={toggleSidebar}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose size={17} />
        </button>
        <LogoLockup />
        <button
          type="button"
          className="icon-button ml-auto lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X size={17} />
        </button>
      </div>

      <nav className="space-y-0.5 px-2 pt-1">
        <button type="button" onClick={startNewChat} className="nav-item">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
            <Plus size={14} strokeWidth={2.2} />
          </span>
          New session
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false)
            openSettings('skills')
          }}
          className="nav-item"
        >
          <Sparkles size={17} strokeWidth={1.6} className="shrink-0 text-muted" />
          Skills
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false)
            openSettings('plugins')
          }}
          className="nav-item"
        >
          <Package size={17} strokeWidth={1.6} className="shrink-0 text-muted" />
          Plugins
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false)
            setDeployOpen(true)
          }}
          className="nav-item"
        >
          <Rocket size={17} strokeWidth={1.6} className="shrink-0 text-muted" />
          Deploy
        </button>
        <div className="relative">
          <Search
            size={17}
            strokeWidth={1.6}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-9 w-full rounded-lg border border-transparent bg-transparent pl-[38px] pr-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-ink hover:bg-raised/70 focus:border-line focus:bg-panel focus:placeholder:text-faint"
            aria-label="Search conversations"
          />
        </div>
      </nav>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-5">
        <div className="mb-5">
          <div className="flex items-center justify-between px-2.5 pb-1.5">
            <p className="text-[12.5px] font-medium text-muted">Workspaces</p>
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false)
                setWorkspaceOpen(true)
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-ink"
              title="Open another folder"
              aria-label="Open another folder"
            >
              <Plus size={13} />
            </button>
          </div>
          {workspaces.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false)
                setWorkspaceOpen(true)
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2.5 text-left text-[13px] text-muted transition-colors hover:border-faint/50 hover:text-ink"
            >
              <Folder size={15} strokeWidth={1.6} className="text-faint" />
              Open a project folder
            </button>
          ) : (
            <div className="space-y-0.5">
              {workspaces.map((entry) => {
                const active = entry.path === workspace.root
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => void switchWorkspace(entry.path)}
                    title={entry.path}
                    className={cn(
                      'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] transition-colors',
                      active ? 'bg-raised text-ink' : 'text-ink/80 hover:bg-raised/70 hover:text-ink',
                    )}
                  >
                    <Folder size={15} strokeWidth={1.6} className={cn('shrink-0', active ? 'text-accent' : 'text-faint')} />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {switching === entry.path ? (
                      <LoaderCircle size={11} className="shrink-0 animate-spin text-faint" />
                    ) : active ? (
                      <Check size={11} className="shrink-0 text-accent" />
                    ) : (
                      <span className="shrink-0 text-[10px] tabular-nums text-faint">
                        {formatRelativeTime(entry.lastOpened)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between px-2.5 pb-1.5">
            <p className="text-[12.5px] font-medium text-muted">Recents</p>
            <span className="text-[11px] tabular-nums text-faint">{filtered.length}</span>
          </div>
          {groups.length === 0 && (
            <div className="px-2 py-7 text-center">
              <p className="text-[13px] font-medium text-muted">
                {query ? 'No conversations match' : 'No conversations yet'}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
                {query ? 'Try a shorter search.' : 'Start with a task, a question or a file.'}
              </p>
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-2.5 pb-1 pt-1 text-[11.5px] text-faint">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((session) => (
                  <div key={session.id} className="group/item relative">
                    {editingId === session.id ? (
                      <input
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename()
                          if (event.key === 'Escape') {
                            setEditingId(null)
                            setDraftTitle('')
                          }
                        }}
                        autoFocus
                        className="h-9 w-full rounded-lg border border-accent/40 bg-panel px-2.5 text-[13.5px] text-ink outline-none"
                        aria-label="Rename conversation"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openChat(session.id)}
                          onDoubleClick={() => beginRename(session.id, session.title)}
                          title={`${session.title} · ${formatRelativeTime(session.updatedAt)}`}
                          className={cn('sidebar-item pr-9', activeId === session.id && 'sidebar-item-active')}
                        >
                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                          {streaming[session.id] && (
                            <span
                              className="flex shrink-0 items-center gap-1 text-[10.5px] font-medium text-accent group-hover/item:hidden"
                              title="Agent is running"
                            >
                              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" />
                              running
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (menu?.id === session.id) {
                              setMenu(null)
                              return
                            }
                            const rect = event.currentTarget.getBoundingClientRect()
                            const width = 176
                            const height = 138
                            const x = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
                            const y =
                              rect.bottom + height + 8 > window.innerHeight
                                ? Math.max(8, rect.top - height - 4)
                                : rect.bottom + 4
                            setMenu({ id: session.id, x, y })
                          }}
                          className={cn(
                            'absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-all hover:bg-panel hover:text-ink',
                            menu?.id === session.id
                              ? 'flex bg-panel text-ink opacity-100'
                              : 'opacity-0 group-hover/item:opacity-100 focus:opacity-100',
                          )}
                          aria-label={`Actions for ${session.title}`}
                          title="Conversation actions"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-2">
        <div className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-raised/60">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-display text-[14px] font-medium text-panel">
            {profileName.charAt(0).toUpperCase()}
          </div>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false)
              openSettings('models')
            }}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-[13.5px] font-medium leading-tight text-ink">{profileName}</p>
            <p className="truncate text-[11.5px] leading-tight text-faint">
              {connected
                ? `${getProviderName(settings.provider)}${settings.provider === 'ollama' ? ' · local' : ' · your key'}`
                : 'Add a provider key'}
            </p>
          </button>
          <button
            type="button"
            className="icon-button h-8 w-8"
            onClick={() => {
              setMobileOpen(false)
              openSettings('appearance')
            }}
            title="Preferences"
            aria-label="Preferences"
          >
            <Settings size={16} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      {menu && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close conversation menu"
            className="fixed inset-0 z-[60] cursor-default bg-transparent"
            onClick={() => setMenu(null)}
          />
          <div
            className="surface-lift fixed z-[70] w-[184px] overflow-hidden rounded-xl border border-line p-1 shadow-float"
            style={{ left: menu.x, top: menu.y }}
          >
            {(() => {
              const session = sessions.find((item) => item.id === menu.id)
              if (!session) return null
              return (
                <>
                  <button
                    type="button"
                    onClick={() => beginRename(session.id, session.title)}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-muted hover:bg-raised hover:text-ink"
                  >
                    <Pencil size={12} /> Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => exportChat(session.id)}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-muted hover:bg-raised hover:text-ink"
                  >
                    <Download size={12} /> Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => exportMarkdown(session.id)}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-muted hover:bg-raised hover:text-ink"
                  >
                    <FileText size={12} /> Export Markdown
                  </button>
                  <div className="my-1 border-t border-line" />
                  <button
                    type="button"
                    onClick={() => void removeChat(session.id, session.title)}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-danger hover:bg-danger/[0.06]"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                  <p className="px-2 pb-1 pt-1.5 text-[9px] text-faint">Updated {shortTime(session.updatedAt)}</p>
                </>
              )
            })()}
          </div>
        </>
      )}
    </aside>
  )
}
