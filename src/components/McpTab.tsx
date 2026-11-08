import { useEffect, useState } from 'react'
import { ChevronDown, Plug, Plus, RefreshCw, Trash2, Unplug, Wrench } from 'lucide-react'
import type { McpServer } from '../types'
import { useMcp } from '../store/mcp'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'
import { Segmented, Spinner, Switch } from './ui'
import type { McpServerInput } from '../lib/daemon'

const field =
  'h-9 w-full rounded-xl border border-line bg-panel px-3 text-[12px] text-ink outline-none transition-all placeholder:text-faint focus:border-accent/50 focus:shadow-[0_0_0_3px_rgb(var(--accent)/0.10)]'

const PRESETS: Array<{ label: string; draft: Draft }> = [
  { label: 'Filesystem', draft: { name: 'Filesystem', transport: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem .', env: '', url: '', headers: '' } },
  { label: 'Memory', draft: { name: 'Memory', transport: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-memory', env: '', url: '', headers: '' } },
  { label: 'Fetch', draft: { name: 'Fetch', transport: 'stdio', command: 'uvx', args: 'mcp-server-fetch', env: '', url: '', headers: '' } },
]

interface Draft {
  name: string
  transport: 'stdio' | 'http'
  command: string
  args: string
  env: string
  url: string
  headers: string
}

const EMPTY: Draft = { name: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '' }

/** Shell-like split that keeps quoted segments together. */
function splitArgs(value: string): string[] {
  const out: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) out.push(match[1] ?? match[2] ?? match[3])
  return out
}

function parsePairs(value: string, separator: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const index = line.indexOf(separator)
    if (index < 1) continue
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return out
}

function toInput(server: McpServer): McpServerInput {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    approval: server.approval,
    disabledTools: server.disabledTools,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    headers: server.headers,
  }
}

function StatusDot({ status }: { status: McpServer['status'] }) {
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        status === 'connected' && 'bg-success shadow-[0_0_0_3px_rgb(var(--success)/0.18)]',
        status === 'connecting' && 'animate-breathe bg-warning',
        status === 'error' && 'bg-danger',
        (status === 'disconnected' || status === 'disabled') && 'bg-faint/60',
      )}
    />
  )
}

export function McpTab() {
  const servers = useMcp((state) => state.servers)
  const loaded = useMcp((state) => state.loaded)
  const loading = useMcp((state) => state.loading)
  const error = useMcp((state) => state.error)
  const load = useMcp((state) => state.load)
  const save = useMcp((state) => state.save)
  const act = useMcp((state) => state.act)
  const notify = useUi((state) => state.notify)
  const askConfirm = useUi((state) => state.askConfirm)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const persist = async (next: McpServerInput[], message?: string) => {
    setBusy(true)
    try {
      await save(next)
      if (message) notify(message, 'success')
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Could not save MCP servers.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const addServer = async () => {
    if (!draft || !draft.name.trim()) return
    const entry: McpServerInput =
      draft.transport === 'stdio'
        ? { name: draft.name.trim(), transport: 'stdio', command: draft.command.trim(), args: splitArgs(draft.args), env: parsePairs(draft.env, '=') }
        : { name: draft.name.trim(), transport: 'http', url: draft.url.trim(), headers: parsePairs(draft.headers, ':') }
    await persist([...servers.map(toInput), { ...entry, enabled: true, approval: 'ask' }], `Added ${entry.name}. Connecting…`)
    setDraft(null)
  }

  const patch = (id: string, change: Partial<McpServerInput>) =>
    persist(servers.map((server) => (server.id === id ? { ...toInput(server), ...change } : toInput(server))))

  const remove = async (server: McpServer) => {
    const ok = await askConfirm({
      title: `Remove ${server.name}?`,
      body: 'The server is disconnected and its tools disappear from the agent. Nothing on disk is deleted.',
      confirmLabel: 'Remove server',
      tone: 'danger',
    })
    if (ok) await persist(servers.filter((item) => item.id !== server.id).map(toInput), `Removed ${server.name}.`)
  }

  return (
    <div className="space-y-5 px-5 py-6 sm:px-8">
      <div className="settings-card">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Plug size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="settings-label">Model Context Protocol</p>
            <p className="settings-hint">
              Connect MCP servers and their tools show up for the agent as <span className="font-mono">mcp__server__tool</span>. Local
              (stdio) servers run as a process on this computer with your permissions, so only add servers you trust.
            </p>
          </div>
          {!draft && (
            <button
              type="button"
              onClick={() => setDraft({ ...EMPTY })}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[11.5px] font-medium text-panel transition-transform active:scale-95"
            >
              <Plus size={13} /> Add server
            </button>
          )}
        </div>
      </div>

      {draft && (
        <div className="settings-card animate-scalein space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="settings-label mr-auto">New MCP server</p>
            {PRESETS.map((preset) => (
              <button key={preset.label} type="button" className="chip h-7 rounded-full px-3 text-[11px]" onClick={() => setDraft({ ...preset.draft })}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input className={field} placeholder="Name (e.g. GitHub)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Segmented
              options={[
                { value: 'stdio', label: 'Local · stdio' },
                { value: 'http', label: 'Remote · HTTP' },
              ]}
              value={draft.transport}
              onChange={(value) => setDraft({ ...draft, transport: value })}
              size="md"
            />
          </div>
          {draft.transport === 'stdio' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <input className={cn(field, 'font-mono')} placeholder="command" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
                <input className={cn(field, 'font-mono')} placeholder="arguments" value={draft.args} onChange={(e) => setDraft({ ...draft, args: e.target.value })} />
              </div>
              <textarea
                className={cn(field, 'h-20 resize-none py-2 font-mono')}
                placeholder={'Environment, one per line\nAPI_KEY=…'}
                value={draft.env}
                onChange={(e) => setDraft({ ...draft, env: e.target.value })}
              />
            </>
          ) : (
            <>
              <input className={cn(field, 'font-mono')} placeholder="https://example.com/mcp" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
              <textarea
                className={cn(field, 'h-20 resize-none py-2 font-mono')}
                placeholder={'Headers, one per line\nAuthorization: Bearer …'}
                value={draft.headers}
                onChange={(e) => setDraft({ ...draft, headers: e.target.value })}
              />
            </>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="chip h-8 rounded-full px-4" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !draft.name.trim() || (draft.transport === 'stdio' ? !draft.command.trim() : !draft.url.trim())}
              onClick={() => void addServer()}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[11.5px] font-medium text-on-accent transition-transform active:scale-95 disabled:opacity-40"
            >
              {busy && <Spinner size={11} />} Save and connect
            </button>
          </div>
        </div>
      )}

      {error && <p className="rounded-xl border border-danger/25 bg-danger/[0.05] px-3 py-2 text-[11.5px] text-danger">{error}</p>}
      {!loaded && loading && (
        <p className="flex items-center gap-2 text-[12px] text-faint">
          <Spinner size={12} /> Loading servers…
        </p>
      )}
      {loaded && servers.length === 0 && !draft && (
        <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-[12px] text-muted">
          No MCP servers yet. Add one to give the agent new tools.
        </p>
      )}

      {servers.map((server, index) => {
        const expanded = open === server.id
        return (
          <div key={server.id} style={{ animationDelay: `${index * 50}ms` }} className="settings-card animate-rise !p-0">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <StatusDot status={server.status} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded ? null : server.id)}>
                <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <span className="truncate">{server.name}</span>
                  <span className="rounded-full bg-raised px-2 py-px font-mono text-[9.5px] text-faint">{server.transport}</span>
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted">
                  {server.status === 'connected'
                    ? `${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}${server.serverInfo?.name ? ` · ${server.serverInfo.name} ${server.serverInfo.version ?? ''}` : ''}`
                    : server.status === 'connecting'
                      ? 'Connecting…'
                      : server.status === 'error'
                        ? server.error || 'Connection failed'
                        : server.status === 'disabled'
                          ? 'Turned off'
                          : 'Not connected'}
                </p>
              </button>
              {server.status === 'connected' || server.status === 'connecting' ? (
                <>
                  <button type="button" className="icon-button h-8 w-8" title="Reload tools" aria-label="Reload tools" onClick={() => void act(server.id, 'refresh')}>
                    <RefreshCw size={13} className={cn(server.status === 'connecting' && 'animate-spin')} />
                  </button>
                  <button type="button" className="icon-button h-8 w-8" title="Disconnect" aria-label="Disconnect" onClick={() => void act(server.id, 'disconnect')}>
                    <Unplug size={13} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="chip h-8 rounded-full px-3.5 text-[11.5px]"
                  disabled={!server.enabled}
                  onClick={() => void act(server.id, 'connect')}
                >
                  Connect
                </button>
              )}
              <Switch checked={server.enabled} onChange={(enabled) => void patch(server.id, { enabled })} label={`Enable ${server.name}`} />
              <button type="button" className="icon-button h-8 w-8" aria-label="Expand" onClick={() => setOpen(expanded ? null : server.id)}>
                <ChevronDown size={14} className={cn('transition-transform duration-300', expanded && 'rotate-180')} />
              </button>
            </div>
            {expanded && (
              <div className="animate-fade space-y-3 border-t border-line px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10.5px] text-faint">
                    {server.transport === 'stdio' ? `${server.command} ${(server.args ?? []).join(' ')}` : server.url}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted">Tool calls</span>
                    <Segmented
                      options={[
                        { value: 'ask', label: 'Ask first' },
                        { value: 'auto', label: 'Auto-run' },
                      ]}
                      value={server.approval}
                      onChange={(approval) => void patch(server.id, { approval })}
                    />
                  </div>
                </div>
                {server.status === 'error' && server.error && <p className="text-[11.5px] text-danger">{server.error}</p>}
                {server.tools.length > 0 && (
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {server.tools.map((tool) => {
                      const off = server.disabledTools.includes(tool.name)
                      return (
                        <li key={tool.name} className="flex items-center gap-3 px-3 py-2">
                          <Wrench size={12} className={cn('shrink-0', off ? 'text-faint' : 'text-accent')} />
                          <div className="min-w-0 flex-1">
                            <p className={cn('truncate font-mono text-[11.5px]', off ? 'text-faint line-through' : 'text-ink')}>{tool.name}</p>
                            {tool.description && <p className="truncate text-[10.5px] text-muted">{tool.description}</p>}
                          </div>
                          {tool.readOnly && <span className="rounded-full bg-success/10 px-1.5 py-px text-[9px] text-success">read-only</span>}
                          <Switch
                            checked={!off}
                            label={`Enable ${tool.name}`}
                            onChange={(on) =>
                              void patch(server.id, {
                                disabledTools: on ? server.disabledTools.filter((n) => n !== tool.name) : [...server.disabledTools, tool.name],
                              })
                            }
                          />
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="flex justify-end">
                  <button type="button" onClick={() => void remove(server)} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-faint transition-colors hover:text-danger">
                    <Trash2 size={12} /> Remove server
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
