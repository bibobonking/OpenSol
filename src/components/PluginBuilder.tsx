import { useState } from 'react'
import { Hammer } from 'lucide-react'
import { buildPluginArchive, validatePluginManifest } from '../../shared/plugin-package.mjs'
import type { PluginCapability, PluginManifest } from '../../shared/plugin-package.mjs'
import { installPluginArchive, type InstalledPlugin } from '../lib/daemon'
import { useUi } from '../store/ui'

const CAPABILITIES: PluginCapability[] = [
  'workspace.list',
  'workspace.read',
  'workspace.write',
  'workspace.edit',
  'ui.commands',
  'ui.panels',
  'ui.themes',
  'network.request',
]

const STARTER_JS = `maxcode.registerCommand('hello', 'Say hello', () => {
  maxcode.log('Hello from this plugin.')
})
`

const STARTER_CSS = `/* Scoped to the panels your plugin renders. */\n`

const fieldClass =
  'h-8 w-full rounded-lg border border-line bg-panel px-2.5 text-[12px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/50'

export function PluginBuilder({ onInstalled }: { onInstalled?: (plugin: InstalledPlugin) => void }) {
  const notify = useUi((state) => state.notify)
  const [id, setId] = useState('my-plugin')
  const [name, setName] = useState('My plugin')
  const [version, setVersion] = useState('1.0.0')
  const [capabilities, setCapabilities] = useState<PluginCapability[]>(['ui.commands'])
  const [domains, setDomains] = useState('')
  const [js, setJs] = useState(STARTER_JS)
  const [css, setCss] = useState(STARTER_CSS)

  const sources = () => {
    const manifest: PluginManifest = {
      id: id.trim(),
      name: name.trim(),
      version: version.trim(),
      apiVersion: 1,
      entry: 'main.js',
      stylesheet: 'main.css',
      capabilities,
      domains: domains
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    }
    validatePluginManifest(manifest)
    return { manifest, files: { 'main.js': js, 'main.css': css } }
  }

  const build = (install: boolean) => {
    try {
      const archive = buildPluginArchive(sources())
      return { archive }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That package could not be built.', 'error')
      return null
    }
  }

  const download = () => {
    const built = build(false)
    if (!built) return
    const url = URL.createObjectURL(new Blob([built.archive as BlobPart], { type: 'application/zip' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${id.trim() || 'plugin'}.pluginmax`
    link.click()
    URL.revokeObjectURL(url)
  }

  const install = async () => {
    const built = build(true)
    if (!built) return
    try {
      const { plugin } = await installPluginArchive(built.archive)
      onInstalled?.(plugin)
      notify(`${plugin.manifest.name} installed. It starts sandboxed and disabled.`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The daemon rejected this package.', 'error')
    }
  }

  return (
    <details className="rounded-xl border border-line bg-raised/20">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[11.5px] font-medium text-ink">
        <Hammer size={13} className="text-faint" />
        Build a .pluginmax
      </summary>
      <div className="space-y-2.5 border-t border-line px-3 py-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="text-[10px] font-medium text-muted">Id</span>
            <input className={fieldClass} value={id} onChange={(event) => setId(event.target.value)} />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium text-muted">Name</span>
            <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium text-muted">Version</span>
            <input className={fieldClass} value={version} onChange={(event) => setVersion(event.target.value)} />
          </label>
        </div>

        <div>
          <span className="text-[10px] font-medium text-muted">Capabilities</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CAPABILITIES.map((capability) => {
              const on = capabilities.includes(capability)
              return (
                <button
                  key={capability}
                  type="button"
                  onClick={() =>
                    setCapabilities((current) =>
                      on ? current.filter((entry) => entry !== capability) : [...current, capability],
                    )
                  }
                  className={`rounded-full border px-2 py-1 font-mono text-[9.5px] ${
                    on ? 'border-accent/40 bg-accent-soft text-ink' : 'border-line text-faint'
                  }`}
                >
                  {capability}
                </button>
              )
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-[10px] font-medium text-muted">Network domains (comma separated)</span>
          <input
            className={fieldClass}
            value={domains}
            placeholder="api.example.com"
            onChange={(event) => setDomains(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-[10px] font-medium text-muted">main.js</span>
          <textarea
            value={js}
            spellCheck={false}
            onChange={(event) => setJs(event.target.value)}
            className="thin-scroll mt-1 h-40 w-full rounded-lg border border-line bg-panel p-2.5 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-accent/50"
          />
        </label>

        <label className="block">
          <span className="text-[10px] font-medium text-muted">main.css</span>
          <textarea
            value={css}
            spellCheck={false}
            onChange={(event) => setCss(event.target.value)}
            className="thin-scroll mt-1 h-20 w-full rounded-lg border border-line bg-panel p-2.5 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-accent/50"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={download}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[10.5px] font-medium text-on-accent hover:bg-accent/90"
          >
            Download .pluginmax
          </button>
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[10.5px] font-medium text-ink hover:bg-raised"
          >
            Build and install
          </button>
        </div>
      </div>
    </details>
  )
}
