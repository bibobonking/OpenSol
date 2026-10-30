import type { InstalledPlugin } from '../lib/daemon'
import { getInstalledPluginArchive } from '../lib/daemon'
import type { PluginContribution } from './types'
import { createPluginApi, emptyContributions, type PluginHostCalls } from './api'

const STYLE_ID = (id: string) => `maxcode-plugin-style-${id}`

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
        applyStyles(plugin.id, files[manifest.stylesheet] ?? '')
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
