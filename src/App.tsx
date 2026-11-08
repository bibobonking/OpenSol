import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { WorkspacePanel } from './components/WorkspacePanel'
import { SettingsModal } from './components/SettingsModal'
import { DeployModal } from './components/DeployModal'
<<<<<<< HEAD
import { McpPanel } from './components/McpPanel'
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
import { CommandPalette } from './components/CommandPalette'
import { Splash } from './components/Splash'
import { ConfirmDialog, ToastHost } from './components/ui'
import { useSettings } from './store/settings'
import { useModelSync } from './store/models'
import { useUi } from './store/ui'
import { useBoot } from './lib/boot'
import { resolveTheme, themeIsDark } from './lib/themes'
import { listInstalledPlugins } from './lib/daemon'
import { syncPlugins } from './plugins'

const MIN_SPLASH_MS = 1600

export default function App() {
  const phase = useBoot((state) => state.phase)
  const error = useBoot((state) => state.error)
  const boot = useBoot((state) => state.boot)
  const theme = useSettings((state) => state.theme)
  const chatFontSize = useSettings((state) => state.chatFontSize)
  const mobileSidebarOpen = useUi((state) => state.mobileSidebarOpen)
  const setMobileSidebarOpen = useUi((state) => state.setMobileSidebarOpen)
  const setPaletteOpen = useUi((state) => state.setPaletteOpen)

  useModelSync()

  // Keep the splash up for at least MIN_SPLASH_MS so the intro animation can play,
  // then let it fade out over the app instead of cutting.
  const [splash, setSplash] = useState<'show' | 'leaving' | 'gone'>('show')
  useEffect(() => {
    if (phase !== 'ready' || splash !== 'show') return
    const started = useBoot.getState().startedAt || Date.now()
    const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - started))
    const t1 = window.setTimeout(() => setSplash('leaving'), wait)
    return () => window.clearTimeout(t1)
  }, [phase, splash])
  useEffect(() => {
    if (splash !== 'leaving') return
    const t2 = window.setTimeout(() => setSplash('gone'), 520)
    return () => window.clearTimeout(t2)
  }, [splash])

  useEffect(() => {
    void boot()
  }, [boot])

  // Safe + enabled plugins are loaded once the app knows the daemon answered.
  useEffect(() => {
    if (phase !== 'ready') return
    void listInstalledPlugins()
      .then((result) => syncPlugins(result.plugins))
      .catch(() => undefined)
  }, [phase])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = resolveTheme(theme, media.matches)
      root.dataset.theme = resolved
      root.classList.toggle('dark', themeIsDark(theme, media.matches))
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', themeIsDark(theme, media.matches) ? '#141413' : '#ffffff')
      try {
        localStorage.setItem('opensol.theme', theme)
      } catch {
        // Storage can be unavailable in private mode; the theme still applies.
      }
    }
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-size', `${chatFontSize}px`)
  }, [chatFontSize])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === 'k') {
        event.preventDefault()
        setPaletteOpen(!useUi.getState().paletteOpen)
        return
      }
      if (mod && !event.shiftKey && !event.altKey) {
        if (key === 'b') {
          event.preventDefault()
          useUi.getState().toggleSidebar()
          return
        }
        if (key === ',') {
          event.preventDefault()
          useUi.getState().openSettings('general')
          return
        }
        if (key === '.') {
          event.preventDefault()
          const ui = useUi.getState()
          ui.setWorkspaceOpen(!ui.workspaceOpen)
          return
        }
      }
      if (event.key === 'Escape' && useUi.getState().mobileSidebarOpen) {
        setMobileSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setMobileSidebarOpen, setPaletteOpen])

  const ready = phase === 'ready'

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-canvas text-ink">
      {ready && (
        <>
          <Sidebar />
          {mobileSidebarOpen && (
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={() => setMobileSidebarOpen(false)}
              className="modal-scrim fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-[2px] lg:hidden"
            />
          )}
          <div className="relative flex min-h-0 min-w-0 flex-1 bg-panel lg:my-1.5 lg:mr-1.5 lg:overflow-hidden lg:rounded-xl lg:border lg:border-line lg:shadow-pill">
            <ChatView />
            <WorkspacePanel />
          </div>
          <SettingsModal />
<<<<<<< HEAD
          <McpPanel />
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
          <DeployModal />
          <CommandPalette />
          <ConfirmDialog />
        </>
      )}
      <ToastHost />
      {splash !== 'gone' && (
        <Splash phase={phase} error={error} leaving={splash === 'leaving'} onRetry={() => void boot(true)} />
      )}
    </div>
  )
}
