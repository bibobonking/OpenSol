import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ExternalLink,
  FileJson,
  Globe,
  KeyRound,
  LogOut,
  Pencil,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Unplug,
  Wrench,
  X,
} from 'lucide-react'
import type { McpServer, McpTransport } from '../types'
import { useMcp } from '../store/mcp'
import { useUi } from '../store/ui'
import { cn } from '../lib/utils'
import {
  EMPTY_DRAFT,
  MCP_PRESETS,
  draftFromServer,
  draftIsValid,
  inputFromDraft,
  inputFromServer,
  parseMcpJson,
  type McpDraft,
  type McpServerInput,
} from '../lib/mcp-config'
import { Modal, Segmented, Spinner, Switch } from './ui'

const field =
  'h-9 w-full rounded-xl border border-line bg-panel px-3 text-[12px] text-ink outline-none transition-all placeholder:text-faint focus:border-accent/50 focus:shadow-[0_0_0_3px_rgb(var(--accent)/0.10)] disabled:opacity-50'

const area = field.replace('h-9 ', '')

const TRANSPORTS: Array<{ value: McpTransport; label: string; hint: string }> = [
  { value: 'stdio', label: 'Local · stdio', hint: 'Runs a command on this computer' },
  { value: 'http', label: 'Remote · HTTP', hint: 'Streamable HTTP endpoint' },
  { value: 'sse', label: 'Remote · SSE', hint: 'Legacy HTTP+SSE endpoint' },
]

const TRANSPORT_LABEL: Record<McpTransport, string> = { stdio: 'stdio', http: 'HTTP', sse: 'SSE' }

type View =
  | { kind: 'server'; id: string }
  | { kind: 'new'; draft: McpDraft }
  | { kind: 'edit'; draft: McpDraft }
  | { kind: 'import' }

function TransportIcon({ transport, size = 13 }: { transport: McpTransport; size?: number }) {
  const Icon = transport === 'stdio' ? Terminal : transport === 'sse' ? Radio : Globe
  return <Icon size={size} strokeWidth={1.7} />
}

function StatusDot({ status }: { status: McpServer['status'] }) {
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        status === 'connected' && 'bg-success shadow-[0_0_0_3px_rgb(var(--success)/0.18)]',
        status === 'connecting' && 'animate-breathe bg-warning',
        status === 'needs_auth' && 'bg-warning shadow-[0_0_0_3px_rgb(var(--warning)/0.18)]',
        status === 'error' && 'bg-danger',
        (status === 'disconnected' || status === 'disabled') && 'bg-faint/60',
      )}
    />
  )
}

function statusText(server: McpServer) {
  if (server.reconnecting && server.status !== 'connected') return 'Reconnecting automatically…'
  switch (server.status) {
    case 'connected': {
      const fellBack = server.activeTransport && server.activeTransport !== server.transport && server.transport !== 'stdio'
      return `${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}${server.serverInfo?.name ? ` · ${server.serverInfo.name} ${server.serverInfo.version ?? ''}` : ''}${fellBack ? ` · auto: ${server.activeTransport === 'sse' ? 'HTTP+SSE' : 'Streamable HTTP'}` : ''}`
    }
    case 'connecting':
      return 'Connecting…'
    case 'needs_auth':
      return 'Sign-in required'
    case 'error':
      return server.error || 'Connection failed'
    case 'disabled':
      return 'Turned off'
    default:
      return 'Not connected'
  }
}

export function McpPanel() {
  const open = useUi((state) => state.mcpOpen)
  const setOpen = useUi((state) => state.setMcpOpen)
  const notify = useUi((state) => state.notify)
  const askConfirm = useUi((state) => state.askConfirm)
  const servers = useMcp((state) => state.servers)
  const loaded = useMcp((state) => state.loaded)
  const error = useMcp((state) => state.error)
  const load = useMcp((state) => state.load)
  const save = useMcp((state) => state.save)
  const act = useMcp((state) => state.act)
  const authorize = useMcp((state) => state.authorize)
  const logout = useMcp((state) => state.logout)
  const [view, setView] = useState<View | null>(null)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState<string | null>(null)

  useEffect(() => {
    if (open) void load()
    else {
      setView(null)
      setMobileDetail(false)
    }
  }, [open, load])

  const current: View = useMemo(() => {
    if (view && !(view.kind === 'server' && !servers.some((server) => server.id === view.id))) return view
    return servers[0] ? { kind: 'server', id: servers[0].id } : { kind: 'new', draft: { ...EMPTY_DRAFT } }
  }, [view, servers])
  const selected = current.kind === 'server' ? servers.find((server) => server.id === current.id) : undefined

  const close = () => setOpen(false)
  const show = (next: View) => {
    setView(next)
    setMobileDetail(true)
  }

  const persist = async (next: McpServerInput[], message?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await save(next)
      if (message) notify(message, 'success')
      return true
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Could not save MCP servers.', 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const patch = (id: string, change: Partial<McpServerInput>) =>
    persist(servers.map((server) => (server.id === id ? { ...inputFromServer(server), ...change } : inputFromServer(server))))

  const saveDraft = async (draft: McpDraft, isNew: boolean) => {
    const known = new Set(servers.map((server) => server.id))
    const entry = inputFromDraft(draft, servers.find((server) => server.id === draft.id))
    const next = isNew
      ? [...servers.map(inputFromServer), entry]
      : servers.map((server) => (server.id === draft.id ? entry : inputFromServer(server)))
    if (!(await persist(next, isNew ? `Added ${entry.name}. Connecting…` : `Saved ${entry.name}.`))) return
    const created = useMcp.getState().servers.find((server) => !known.has(server.id))
    const id = isNew ? created?.id : draft.id
    if (id) setView({ kind: 'server', id })
  }

  const importServers = async (incoming: McpServerInput[]) => {
    const known = new Set(servers.map((server) => server.id))
    const ok = await persist([...servers.map(inputFromServer), ...incoming], `Imported ${incoming.length} server${incoming.length === 1 ? '' : 's'}.`)
    if (!ok) return
    const created = useMcp.getState().servers.find((server) => !known.has(server.id))
    setView(created ? { kind: 'server', id: created.id } : null)
  }

  const remove = async (server: McpServer) => {
    const ok = await askConfirm({
      title: `Remove ${server.name}?`,
      body: 'The server is disconnected, its saved sign-in is deleted and its tools disappear from the agent.',
      confirmLabel: 'Remove server',
      tone: 'danger',
    })
    if (!ok) return
    if (await persist(servers.filter((item) => item.id !== server.id).map(inputFromServer), `Removed ${server.name}.`)) {
      setView(null)
      setMobileDetail(false)
    }
  }

  const startSignIn = async (server: McpServer) => {
    setSigningIn(server.id)
    try {
      await authorize(server.id)
      notify(`Finish signing in to ${server.name} in the new window.`, 'info')
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Could not start sign-in.', 'error')
    } finally {
      setSigningIn(null)
    }
  }

  const connectedCount = servers.filter((server) => server.status === 'connected').length
  const toolCount = servers.reduce((sum, server) => sum + (server.status === 'connected' ? server.tools.length - server.disabledTools.length : 0), 0)

  return (
    <Modal
      open={open}
      onClose={close}
      labelledBy="mcp-title"
      className="settings-shell h-[94dvh] p-0 sm:h-[min(88dvh,780px)] sm:w-[min(1080px,96vw)] sm:!rounded-[28px]"
    >
      <header className="relative flex shrink-0 items-end gap-3 border-b border-line bg-canvas px-5 pb-4 pt-5 sm:px-7">
        <div className="settings-glow pointer-events-none absolute inset-x-0 top-0 h-32" />
        <div className="relative min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-faint">Model Context Protocol</p>
          <h2 id="mcp-title" className="mt-1 font-display text-[26px] font-semibold leading-none tracking-[-0.035em] text-ink">
            MCP servers
          </h2>
          <p className="mt-1.5 text-[11.5px] text-muted">
            {servers.length === 0
              ? 'Give the agent new tools from local programs or remote services.'
              : `${connectedCount} of ${servers.length} connected · ${toolCount} tool${toolCount === 1 ? '' : 's'} available to the agent`}
          </p>
        </div>
        <div className="relative flex shrink-0 items-center gap-1.5">
          <button type="button" className="chip hidden h-8 rounded-full px-3.5 text-[11.5px] sm:inline-flex" onClick={() => show({ kind: 'import' })}>
            <FileJson size={13} /> Import JSON
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[11.5px] font-medium text-panel transition-transform active:scale-95"
            onClick={() => show({ kind: 'new', draft: { ...EMPTY_DRAFT } })}
          >
            <Plus size={13} /> Add server
          </button>
          <button type="button" className="icon-button h-8 w-8 rounded-full" onClick={close} aria-label="Close MCP panel">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Server list */}
        <aside className={cn('thin-scroll min-h-0 w-full shrink-0 overflow-y-auto bg-canvas/60 p-3 md:block md:w-[300px] md:border-r md:border-line', mobileDetail ? 'hidden' : 'block')}>
          {error && <p className="mb-2 rounded-xl border border-danger/25 bg-danger/[0.05] px-3 py-2 text-[11.5px] text-danger">{error}</p>}
          {!loaded && (
            <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-faint">
              <Spinner size={12} /> Loading servers…
            </p>
          )}
          {loaded && servers.length === 0 && (
            <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-muted">No servers yet.</p>
          )}
          <ul className="space-y-1">
            {servers.map((server) => {
              const active = current.kind === 'server' && current.id === server.id
              return (
                <li key={server.id}>
                  <button
                    type="button"
                    onClick={() => show({ kind: 'server', id: server.id })}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all',
                      active ? 'border-line bg-panel shadow-pill' : 'border-transparent hover:bg-raised/70',
                    )}
                  >
                    <StatusDot status={server.status} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                        <span className="truncate">{server.name}</span>
                        {server.oauth?.enabled && (
                          <KeyRound size={11} className={cn('shrink-0', server.oauth.authorized ? 'text-success' : 'text-warning')} aria-label="OAuth" />
                        )}
                      </span>
                      <span className={cn('mt-0.5 block truncate text-[11px]', server.status === 'needs_auth' ? 'text-warning' : server.status === 'error' ? 'text-danger' : 'text-muted')}>
                        {statusText(server)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-raised px-2 py-0.5 font-mono text-[9.5px] text-faint">
                      <TransportIcon transport={server.transport} size={10} />
                      {TRANSPORT_LABEL[server.transport]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <button type="button" className="chip mt-3 h-8 w-full justify-center rounded-xl text-[11.5px] sm:hidden" onClick={() => show({ kind: 'import' })}>
            <FileJson size={13} /> Import JSON
          </button>
        </aside>

        {/* Detail */}
        <section className={cn('min-w-0 flex-1 flex-col bg-panel md:flex', mobileDetail ? 'flex' : 'hidden')}>
          <button type="button" className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-3 text-[12px] text-muted md:hidden" onClick={() => setMobileDetail(false)}>
            <ChevronLeft size={15} /> All servers
          </button>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {!loaded ? null : current.kind === 'new' ? (
              <ServerForm
                key={`new-${JSON.stringify(current.draft)}`}
                title="New MCP server"
                initial={current.draft}
                busy={busy}
                presets
                submitLabel="Save and connect"
                onCancel={servers.length > 0 ? () => setView(null) : undefined}
                onSubmit={(draft) => void saveDraft(draft, true)}
              />
            ) : current.kind === 'edit' ? (
              <ServerForm
                key={`edit-${current.draft.id}`}
                title={`Edit ${current.draft.name}`}
                initial={current.draft}
                busy={busy}
                submitLabel="Save changes"
                onCancel={() => setView({ kind: 'server', id: current.draft.id ?? '' })}
                onSubmit={(draft) => void saveDraft(draft, false)}
              />
            ) : current.kind === 'import' ? (
              <ImportView busy={busy} onCancel={() => setView(null)} onImport={(items) => void importServers(items)} />
            ) : selected ? (
              <ServerDetail
                server={selected}
                signingIn={signingIn === selected.id}
                onEdit={() => show({ kind: 'edit', draft: draftFromServer(selected) })}
                onPatch={(change) => void patch(selected.id, change)}
                onAct={(action) => void act(selected.id, action)}
                onAuthorize={() => void startSignIn(selected)}
                onSignOut={() => void logout(selected.id).catch((failure) => notify(failure instanceof Error ? failure.message : 'Could not sign out.', 'error'))}
                onRemove={() => void remove(selected)}
              />
            ) : null}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function ServerDetail({
  server,
  signingIn,
  onEdit,
  onPatch,
  onAct,
  onAuthorize,
  onSignOut,
  onRemove,
}: {
  server: McpServer
  signingIn: boolean
  onEdit: () => void
  onPatch: (change: Partial<McpServerInput>) => void
  onAct: (action: 'connect' | 'disconnect' | 'refresh') => void
  onAuthorize: () => void
  onSignOut: () => void
  onRemove: () => void
}) {
  const [query, setQuery] = useState('')
  const live = server.status === 'connected' || server.status === 'connecting'
  const tools = server.tools.filter((tool) => !query.trim() || `${tool.name} ${tool.description}`.toLowerCase().includes(query.trim().toLowerCase()))
  const allOff = server.tools.length > 0 && server.disabledTools.length >= server.tools.length

  return (
    <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2.5 font-display text-[22px] font-semibold leading-tight tracking-[-0.03em] text-ink">
            <StatusDot status={server.status} />
            <span className="truncate">{server.name}</span>
          </h3>
          <p className={cn('mt-1 text-[12px]', server.status === 'error' ? 'text-danger' : server.status === 'needs_auth' ? 'text-warning' : 'text-muted')}>
            {statusText(server)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {live ? (
            <>
              <button type="button" className="icon-button h-8 w-8" title="Reload tools" aria-label="Reload tools" onClick={() => onAct('refresh')}>
                <RefreshCw size={14} className={cn(server.status === 'connecting' && 'animate-spin')} />
              </button>
              <button type="button" className="icon-button h-8 w-8" title="Disconnect" aria-label="Disconnect" onClick={() => onAct('disconnect')}>
                <Unplug size={14} />
              </button>
            </>
          ) : (
            server.status !== 'needs_auth' && (
              <button type="button" className="chip h-8 rounded-full px-3.5 text-[11.5px]" disabled={!server.enabled} onClick={() => onAct('connect')}>
                <Plug size={13} /> Connect
              </button>
            )
          )}
          <button type="button" className="icon-button h-8 w-8" title="Edit connection" aria-label="Edit connection" onClick={onEdit}>
            <Pencil size={14} />
          </button>
          <Switch checked={server.enabled} onChange={(enabled) => onPatch({ enabled })} label={`Enable ${server.name}`} />
        </div>
      </div>

      {server.oauth?.enabled && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3.5',
            server.oauth.authorized ? 'border-success/25 bg-success/[0.05]' : 'border-warning/30 bg-warning/[0.06]',
          )}
        >
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', server.oauth.authorized ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
            {server.oauth.authorized ? <ShieldCheck size={17} /> : <KeyRound size={17} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-ink">{server.oauth.authorized ? 'Signed in with OAuth' : 'Sign-in required'}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
              {server.oauth.authorized
                ? 'Tokens are stored encrypted by the local daemon and refreshed automatically.'
                : 'Approve access in your browser. OpenSol registers itself with the server and keeps the tokens encrypted on this machine.'}
            </p>
          </div>
          {server.oauth.authorized ? (
            <button type="button" className="chip h-8 rounded-full px-3.5 text-[11.5px]" onClick={onSignOut}>
              <LogOut size={13} /> Sign out
            </button>
          ) : (
            <button
              type="button"
              disabled={signingIn || !server.enabled}
              onClick={onAuthorize}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[11.5px] font-medium text-on-accent transition-transform active:scale-95 disabled:opacity-40"
            >
              {signingIn ? <Spinner size={12} /> : <ExternalLink size={12} />} Authorize
            </button>
          )}
        </div>
      )}

      {server.status === 'error' && server.error && (
        <p className="rounded-xl border border-danger/25 bg-danger/[0.05] px-3 py-2 text-[11.5px] leading-relaxed text-danger">{server.error}</p>
      )}

      <div className="grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <TransportIcon transport={server.transport} /> {TRANSPORTS.find((item) => item.value === server.transport)?.label}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-ink">
            {server.transport === 'stdio' ? `${server.command} ${(server.args ?? []).join(' ')}` : server.url}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">Tool calls</span>
          <Segmented
            options={[
              { value: 'ask', label: 'Ask first' },
              { value: 'auto', label: 'Auto-run' },
            ]}
            value={server.approval}
            onChange={(approval) => onPatch({ approval })}
          />
        </div>
      </div>

      {server.tools.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <p className="mr-auto text-[12px] font-medium text-ink">
              Tools <span className="font-normal text-faint">{server.tools.length - server.disabledTools.length}/{server.tools.length} on</span>
            </p>
            <button type="button" className="text-[11px] font-medium text-muted transition-colors hover:text-ink" onClick={() => onPatch({ disabledTools: allOff ? [] : server.tools.map((tool) => tool.name) })}>
              {allOff ? 'Enable all' : 'Disable all'}
            </button>
          </div>
          {server.tools.length > 6 && (
            <div className="relative mb-2">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className={cn(field, 'pl-8')} placeholder="Filter tools" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          )}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {tools.map((tool) => {
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
                    onChange={(on) => onPatch({ disabledTools: on ? server.disabledTools.filter((name) => name !== tool.name) : [...server.disabledTools, tool.name] })}
                  />
                </li>
              )
            })}
            {tools.length === 0 && <li className="px-3 py-4 text-center text-[11.5px] text-faint">No tools match.</li>}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={onRemove} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-faint transition-colors hover:text-danger">
          <Trash2 size={12} /> Remove server
        </button>
      </div>
    </div>
  )
}

function ServerForm({
  title,
  initial,
  busy,
  presets = false,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  title: string
  initial: McpDraft
  busy: boolean
  presets?: boolean
  submitLabel: string
  onCancel?: () => void
  onSubmit: (draft: McpDraft) => void
}) {
  const [draft, setDraft] = useState<McpDraft>(initial)
  const [advanced, setAdvanced] = useState(Boolean(initial.clientId || initial.scope))
  const remote = draft.transport !== 'stdio'
  const set = (change: Partial<McpDraft>) => setDraft((state) => ({ ...state, ...change }))

  return (
    <form
      className="space-y-4 px-5 py-5 sm:px-7 sm:py-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (draftIsValid(draft) && !busy) onSubmit(draft)
      }}
    >
      <h3 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.03em] text-ink">{title}</h3>

      {presets && (
        <div>
          <p className="mb-2 text-[11px] font-medium text-muted">Start from a template</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {MCP_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setDraft({ ...EMPTY_DRAFT, ...preset.draft })}
                className="rounded-xl border border-line px-3 py-2 text-left transition-all hover:border-accent/40 hover:bg-raised/60 active:scale-[0.98]"
              >
                <span className="block text-[12px] font-medium text-ink">{preset.label}</span>
                <span className="mt-0.5 block truncate text-[10.5px] text-muted">{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3">
        <input data-autofocus className={field} placeholder="Name (e.g. GitHub)" value={draft.name} onChange={(event) => set({ name: event.target.value })} />
        <div>
          <Segmented options={TRANSPORTS.map(({ value, label }) => ({ value, label }))} value={draft.transport} onChange={(transport) => set({ transport })} size="md" />
          <p className="mt-1.5 text-[11px] text-faint">{TRANSPORTS.find((item) => item.value === draft.transport)?.hint}</p>
        </div>
      </div>

      {!remote ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <input className={cn(field, 'font-mono')} placeholder="command" value={draft.command} onChange={(event) => set({ command: event.target.value })} />
            <input className={cn(field, 'font-mono')} placeholder="arguments" value={draft.args} onChange={(event) => set({ args: event.target.value })} />
          </div>
          <textarea className={cn(area, 'h-20 resize-none py-2 font-mono')} placeholder={'Environment, one per line\nAPI_KEY=…'} value={draft.env} onChange={(event) => set({ env: event.target.value })} />
          <p className="text-[11px] leading-relaxed text-faint">Local servers run as a process on this computer with your permissions, so only add servers you trust.</p>
        </>
      ) : (
        <>
          <input className={cn(field, 'font-mono')} placeholder={draft.transport === 'sse' ? 'https://example.com/sse' : 'https://example.com/mcp'} value={draft.url} onChange={(event) => set({ url: event.target.value })} />
          <div className="rounded-2xl border border-line p-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <KeyRound size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink">Sign in with OAuth</p>
                <p className="text-[11px] text-muted">For services that ask you to approve access in the browser (Linear, Notion, Sentry…).</p>
              </div>
              <Switch checked={draft.oauth} onChange={(oauth) => set({ oauth })} label="Sign in with OAuth" />
            </div>
            {draft.oauth && (
              <div className="mt-3 border-t border-line pt-3">
                <button type="button" className="text-[11px] font-medium text-muted transition-colors hover:text-ink" onClick={() => setAdvanced((value) => !value)}>
                  {advanced ? 'Hide' : 'Show'} advanced client settings
                </button>
                {advanced && (
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <input className={cn(field, 'font-mono')} placeholder="Client ID (optional)" value={draft.clientId} onChange={(event) => set({ clientId: event.target.value })} />
                    <input className={cn(field, 'font-mono')} type="password" autoComplete="off" placeholder="Client secret (optional)" value={draft.clientSecret} onChange={(event) => set({ clientSecret: event.target.value })} />
                    <input className={cn(field, 'font-mono sm:col-span-2')} placeholder="Scopes (optional, space separated)" value={draft.scope} onChange={(event) => set({ scope: event.target.value })} />
                    <p className="text-[10.5px] leading-relaxed text-faint sm:col-span-2">
                      Leave the client empty to register automatically. Redirect URI to allow: <span className="font-mono">{`${window.location.origin}/oauth/mcp/callback`}</span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          <textarea className={cn(area, 'h-20 resize-none py-2 font-mono')} placeholder={'Headers, one per line (API keys, bearer tokens)\nAuthorization: Bearer …'} value={draft.headers} onChange={(event) => set({ headers: event.target.value })} />
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" className="chip h-8 rounded-full px-4" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !draftIsValid(draft)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[11.5px] font-medium text-on-accent transition-transform active:scale-95 disabled:opacity-40"
        >
          {busy && <Spinner size={11} />} {submitLabel}
        </button>
      </div>
    </form>
  )
}

function ImportView({ busy, onCancel, onImport }: { busy: boolean; onCancel: () => void; onImport: (servers: McpServerInput[]) => void }) {
  const [text, setText] = useState('')
  const result = useMemo(() => {
    if (!text.trim()) return null
    try {
      return { ...parseMcpJson(text), error: '' }
    } catch (failure) {
      return { servers: [] as McpServerInput[], skipped: [] as string[], error: failure instanceof Error ? failure.message : 'Could not read that JSON.' }
    }
  }, [text])

  return (
    <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6">
      <div>
        <h3 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.03em] text-ink">Import from JSON</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Paste the <span className="font-mono">mcpServers</span> block from Claude Desktop, Cursor or VS Code. Local commands and remote URLs (HTTP or SSE) both work.
        </p>
      </div>
      <textarea
        data-autofocus
        className={cn(area, 'h-48 resize-none py-2.5 font-mono text-[11.5px]')}
        placeholder={'{\n  "mcpServers": {\n    "github": { "url": "https://api.githubcopilot.com/mcp/" },\n    "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }\n  }\n}'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
      />
      {result?.error && <p className="rounded-xl border border-danger/25 bg-danger/[0.05] px-3 py-2 text-[11.5px] text-danger">{result.error}</p>}
      {result && result.servers.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {result.servers.map((server) => (
            <li key={server.name} className="flex items-center gap-3 px-3 py-2">
              <span className="text-faint">
                <TransportIcon transport={server.transport ?? 'stdio'} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-ink">{server.name}</span>
                <span className="block truncate font-mono text-[10.5px] text-muted">{server.transport === 'stdio' ? `${server.command} ${(server.args ?? []).join(' ')}` : server.url}</span>
              </span>
              {server.oauth?.enabled && <span className="rounded-full bg-accent-soft px-2 py-px text-[9.5px] text-accent">OAuth</span>}
            </li>
          ))}
        </ul>
      )}
      {result && result.skipped.length > 0 && <p className="text-[11px] text-faint">Skipped (no command or url): {result.skipped.join(', ')}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="chip h-8 rounded-full px-4" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !result || result.servers.length === 0}
          onClick={() => result && onImport(result.servers)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[11.5px] font-medium text-on-accent transition-transform active:scale-95 disabled:opacity-40"
        >
          {busy && <Spinner size={11} />} Import {result && result.servers.length > 0 ? `${result.servers.length} server${result.servers.length === 1 ? '' : 's'}` : ''}
        </button>
      </div>
    </div>
  )
}
