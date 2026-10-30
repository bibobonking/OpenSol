import type { InstalledPlugin } from '../lib/daemon'
import { getInstalledPluginArchive } from '../lib/daemon'
import type { PluginContribution } from './types'
import { createPluginApi, emptyContributions, type PluginHostCalls } from './api'

const STYLE_ID = (id: string) => `maxcode-plugin-style-${id}`

export const PLUGIN_THEME_PREFIX = 'plugin-'

/** Plugin theme palettes become `[data-theme='plugin-<id>']` custom properties. */
export function themeCss(pluginId: string, palette: Record<string, string>): string {
  const tokens = Object.entries(palette)
    .filter(([token, value]) => /^[a-z][a-z0-9-]*$/.test(token) && /^[\d\s.]+$/.test(value))
    .map(([token, value]) => `--${token}:${value.trim()}`)
  return tokens.length === 0 ? '' : `[data-theme='plugin-${pluginId}']{${tokens.join(';')}}`
}

export function styleElement(id: string): HTMLStyleElement | null {
  return document.getElementById(STYLE_ID(id)) as HTMLStyleElement | null
}

export function applyStyles(id: string, css: string) {
  let node = styleElement(id)
  if (!node) {
    node = document.createElement('style')
    node.id = STYLE_ID(id)
    document.head.append(node)
  }
  node.textContent = css
}

export function removeStyles(id: string) {
  styleElement(id)?.remove()
}

export interface PluginRuntime {
  contributions: Map<string, PluginContribution>
  themes(): Array<{ id: string; label: string }>
  contributionsFor(id: string): PluginContribution
  commands(): Array<{ pluginId: string; id: string; label: string; run: () => void }>
  activate(plugin: InstalledPlugin, calls: PluginHostCalls): Promise<void>
  deactivate(id: string): void
  deactivateAll(): void
}

/**
 * Same-realm execution for plugins the user marked Safe. Anything not Safe stays
 * out; disabling or uninstalling drops its styles, commands, panels and themes.
 */
export function createPluginRuntime(): PluginRuntime {
  const contributions = new Map<string, PluginContribution>()

  const deactivate = (id: string) => {
    contributions.delete(id)
    removeStyles(id)
  }

  return {
    contributions,
    contributionsFor: (id) => contributions.get(id) ?? emptyContributions(),
    themes() {
      const out: Array<{ id: string; label: string }> = []
      for (const [pluginId, entry] of contributions) {
        for (const [id, theme] of entry.themes) {
          out.push({ id: `${PLUGIN_THEME_PREFIX}${pluginId}:${id}`, label: theme.label })
        }
      }
      return out
    },
    commands() {
      const out: Array<{ pluginId: string; id: string; label: string; run: () => void }> = []
      for (const [pluginId, entry] of contributions) {
        for (const [id, command] of entry.commands) out.push({ pluginId, id, label: command.label, run: command.run })
      }
      return out
    },
    async activate(plugin, calls) {
      deactivate(plugin.id)
      if (!plugin.safe || !plugin.enabled) return

      const archive = await getInstalledPluginArchive(plugin.id)
      const { readPluginArchive } = await import('../../shared/plugin-package.mjs')
      const { files, manifest } = readPluginArchive(archive)
      const entry = contributions.get(plugin.id) ?? emptyContributions()
      contributions.set(plugin.id, entry)

      const api = createPluginApi(plugin, plugin.grants, calls, entry)
      try {
        const run = new Function('maxcode', `"use strict";\n${files[manifest.entry]}\n`)
        run(Object.freeze(api))
        const themes = [...entry.themes.entries()]
          .map(([id, theme]) => themeCss(`${plugin.id}:${id}`, theme.palette))
          .join('\n')
        applyStyles(plugin.id, `${files[manifest.stylesheet] ?? ''}\n${themes}`)
      } catch (error) {
        deactivate(plugin.id)
        throw new Error(`Plugin ${plugin.id} failed to start: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    deactivate,
    deactivateAll() {
      for (const id of [...contributions.keys()]) deactivate(id)
    },
  }
}
