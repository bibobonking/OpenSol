import { Service, type Context } from 'cordis'
import { registerTheme as registerThemeInApp, unregisterTheme as unregisterThemeInApp } from '../../lib/themes'

export interface UiCommand {
  id: string
  label: string
  run: () => void
}

export interface UiPanel {
  id: string
  label: string
  render: (host: HTMLElement) => void
}

export interface UiTheme {
  id: string
  label: string
  palette: Record<string, string>
}

const STYLE_ID = (id: string) => `maxcode-plugin-theme-${id}`

function tokens(palette: Record<string, string>): Array<[string, string]> {
  return Object.entries(palette).filter(
    ([token, value]) => /^[a-z][a-z0-9-]*$/.test(token) && /^[\d\s.]+$/.test(value),
  )
}

function isDarkPalette(palette: Record<string, string>): boolean {
  const canvas = (palette.canvas ?? '').trim().split(/\s+/).map(Number)
  const [r, g, b] = canvas.length === 3 ? canvas : [255, 255, 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
}

function themeCss(themeId: string, palette: Record<string, string>): string {
  const entries = tokens(palette).map(([token, value]) => `--${token}:${value.trim()}`)
  return entries.length === 0 ? '' : `[data-theme='${themeId}']{${entries.join(';')}}`
}

function applyThemeStyles(id: string, css: string) {
  if (typeof document === 'undefined') return
  let node = document.getElementById(STYLE_ID(id)) as HTMLStyleElement | null
  if (!node) {
    node = document.createElement('style')
    node.id = STYLE_ID(id)
    document.head.append(node)
  }
  node.textContent = css
}

function removeThemeStyles(id: string) {
  if (typeof document === 'undefined') return
  document.getElementById(STYLE_ID(id))?.remove()
}

export class UiService extends Service {
  static provide = 'ui'
  private _commands = new Map<string, UiCommand>()
  private _panels = new Map<string, UiPanel>()
  private _themes = new Map<string, UiTheme>()

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerCommand(id: string, label: string, run: () => void): () => void {
    const cmd = { id, label, run }
    this._commands.set(id, cmd)
    return () => {
      if (this._commands.get(id) === cmd) this._commands.delete(id)
    }
  }

  registerPanel(id: string, label: string, render: (host: HTMLElement) => void): () => void {
    const panel = { id, label, render }
    this._panels.set(id, panel)
    return () => {
      if (this._panels.get(id) === panel) this._panels.delete(id)
    }
  }

  registerTheme(id: string, label: string, palette: Record<string, string>): () => void {
    const theme = { id, label, palette }
    this._themes.set(id, theme)
    registerThemeInApp({ id, label, dark: isDarkPalette(palette) })
    applyThemeStyles(id, themeCss(id, palette))

    return () => {
      if (this._themes.get(id) === theme) {
        this._themes.delete(id)
        unregisterThemeInApp(id)
        removeThemeStyles(id)
      }
    }
  }

  commands(): UiCommand[] {
    return [...this._commands.values()]
  }

  panels(): UiPanel[] {
    return [...this._panels.values()]
  }

  themes(): Array<{ id: string; label: string }> {
    return [...this._themes.values()].map((t) => ({ id: t.id, label: t.label }))
  }
}
