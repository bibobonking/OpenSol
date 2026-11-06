import {
  FolderOpen,
  ListChecks,
  Menu,
  Moon,
  PanelLeftOpen,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react'
import type { ChatSession } from '../types'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { useActiveModel } from '../store/models'
import { cn } from '../lib/utils'
import { themeIsDark } from '../lib/themes'
import { LogoMark } from './Logo'
import { ContextBar } from './ContextBar'

export type ChatViewMode = 'chat' | 'trajectory'

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function TopBar({
  session,
  view,
  onViewChange,
}: {
  session: ChatSession | null
  view: ChatViewMode
  onViewChange: (view: ChatViewMode) => void
}) {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const toggleSidebar = useUi((state) => state.toggleSidebar)
  const setMobileOpen = useUi((state) => state.setMobileSidebarOpen)
  const setPaletteOpen = useUi((state) => state.setPaletteOpen)
  const openSettings = useUi((state) => state.openSettings)
  const workspaceOpen = useUi((state) => state.workspaceOpen)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const setDeployOpen = useUi((state) => state.setDeployOpen)
  const workspace = useWorkspace((state) => state.info)
  const activeModel = useActiveModel()

  // Go through the theme registry so Night Owl, Claude Code, Flame and plugin themes count as dark.
  const isDark = themeIsDark(
    settings.theme,
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const hasConversation = Boolean(session && session.messages.length > 0)
  const turns = session?.messages.filter((message) => message.role === 'user').length ?? 0

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-2 border-b border-line/50 bg-panel/80 px-3 backdrop-blur-md sm:px-4">
      <button
        type="button"
        className="icon-button lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {sidebarCollapsed && (
        <button
          type="button"
          className="icon-button hidden lg:inline-flex"
          onClick={toggleSidebar}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {!session && <LogoMark size={19} className="lg:hidden" />}
        <h1 className="min-w-0 truncate text-[14.5px] font-medium tracking-[-0.005em] text-ink">
          {session?.title ?? 'New conversation'}
        </h1>
        {hasConversation && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-raised/70 px-2 py-0.5 text-[11px] text-muted sm:inline-flex">
            {settings.mode === 'plan' ? <ListChecks size={11} /> : <Sparkles size={11} />}
            {settings.mode === 'plan' ? 'Plan mode' : 'Build mode'}
          </span>
        )}
        {hasConversation && (
          <span className="hidden shrink-0 text-[11.5px] tabular-nums text-faint md:inline">
            {turns} turn{turns === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {hasConversation && (
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center rounded-lg border border-line/60 bg-raised/70 p-0.5 md:inline-flex">
          {(['chat', 'trajectory'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onViewChange(value)}
              aria-pressed={view === value}
              className={cn(
                'h-7 rounded-[6px] px-3 text-[11.5px] font-medium capitalize transition-colors',
                view === value ? 'bg-panel text-ink shadow-pill' : 'text-muted hover:text-ink',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        {hasConversation && (
          <div className="mr-1.5 hidden sm:block">
            <ContextBar messages={session?.messages ?? []} model={activeModel} sessionId={session?.id ?? null} />
          </div>
        )}
        <button
          type="button"
          onClick={() => setWorkspaceOpen(!workspaceOpen)}
          title={workspace.available ? workspace.root : 'Choose a workspace folder'}
          className={cn(
            'mr-1 hidden min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors sm:inline-flex',
            workspaceOpen
              ? 'border-accent/30 bg-accent-soft/60 text-accent'
              : 'border-line/80 text-muted hover:bg-raised/60 hover:text-ink',
          )}
        >
          <FolderOpen size={13} className="shrink-0" />
          <span className="max-w-[140px] truncate">{workspace.available ? workspace.name : 'No folder'}</span>
        </button>
        <button
          type="button"
          className="icon-button hidden sm:inline-flex"
          onClick={() => setDeployOpen(true)}
          title="Deploy the open workspace or another project"
          aria-label="Deploy"
        >
          <Rocket size={16} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setPaletteOpen(true)}
          title={`Search and commands (${isApple ? '⌘' : 'Ctrl'} K)`}
          aria-label="Open search and commands"
        >
          <Search size={16} />
        </button>
        <button
          type="button"
          className="icon-button hidden sm:inline-flex"
          onClick={() => update({ theme: isDark ? 'light' : 'dark' })}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => openSettings('general')}
          title="Settings"
          aria-label="Open settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
