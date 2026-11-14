import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Cloud,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe2,
  Hammer,
  PackageOpen,
  Play,
  Rocket,
  ScanSearch,
  ShieldCheck,
  Square,
  Terminal,
  Triangle,
  UploadCloud,
  X,
} from 'lucide-react'
import type { DeployDetection, DeployProviderId, DeployResult } from '../types'
import { detectDeployProject, streamDeploy } from '../lib/daemon'
import { cn } from '../lib/utils'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { FolderIcon } from './FileIcon'
import { Modal, Spinner } from './ui'

const PROVIDERS: Array<{
  id: DeployProviderId
  label: string
  icon: typeof Cloud
  tint: string
  blurb: string
  needs: string
}> = [
  { id: 'cloudflare', label: 'Cloudflare Pages', icon: Cloud, tint: '#f6821f', blurb: 'Global edge, generous free tier', needs: 'API token + account id' },
  { id: 'netlify', label: 'Netlify', icon: Globe2, tint: '#00c7b7', blurb: 'Creates the site once, then reuses it', needs: 'Personal access token' },
  { id: 'vercel', label: 'Vercel', icon: Triangle, tint: '#8b95a5', blurb: 'Production deploy through the CLI', needs: 'Access token' },
]

const STEPS = [
  { id: 'prepare', label: 'Inspect', icon: ScanSearch },
  { id: 'build', label: 'Build', icon: Hammer },
  { id: 'publish', label: 'Publish', icon: UploadCloud },
] as const

type StepId = (typeof STEPS)[number]['id']
type StepState = 'idle' | 'active' | 'done' | 'error'

interface LogLine {
  id: number
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

const inputClass =
  'h-9 w-full rounded-lg border border-line bg-panel px-2.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/50 disabled:opacity-60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-baseline gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
        {label}
        {hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}
      </p>
      {children}
    </div>
  )
}

const IDLE: Record<StepId, StepState> = { prepare: 'idle', build: 'idle', publish: 'idle' }

export function DeployModal() {
  const open = useUi((state) => state.deployOpen)
  const setOpen = useUi((state) => state.setDeployOpen)
  const openSettings = useUi((state) => state.openSettings)
  const notify = useUi((state) => state.notify)
  const workspaceRoot = useWorkspace((state) => state.root)
  const workspaceName = useWorkspace((state) => state.info.name)
  const workspaceAvailable = useWorkspace((state) => state.info.available)
  const deployTools = useSettings((state) => state.deployTools)
  const deploySecrets = useSettings((state) => state.deploySecrets)

  const [provider, setProvider] = useState<DeployProviderId>('cloudflare')
  const [path, setPath] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [buildCommand, setBuildCommand] = useState('')
  const [projectName, setProjectName] = useState('')
  const [detected, setDetected] = useState<DeployDetection | null>(null)
  const [detectError, setDetectError] = useState('')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Record<StepId, StepState>>(IDLE)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [result, setResult] = useState<DeployResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const logId = useRef(0)
  const currentStep = useRef<StepId | null>(null)

  const meta = PROVIDERS.find((entry) => entry.id === provider) ?? PROVIDERS[0]
  const tool = deployTools?.[provider]
  const configured = Boolean(deploySecrets?.[provider]?.configured)

  useEffect(() => {
    if (!open) return
    setPath(workspaceRoot)
    setResult(null)
    setError('')
    setLogs([])
    setRunning(false)
    setCopied(false)
    setSteps(IDLE)
  }, [open, workspaceRoot])

  // Look at the folder so the build command and output folder are suggested instead of guessed.
  useEffect(() => {
    if (!open || !path.trim()) {
      setDetected(null)
      setDetectError('')
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      detectDeployProject(path.trim())
        .then((project) => {
          if (cancelled) return
          setDetected(project)
          setDetectError('')
        })
        .catch((cause) => {
          if (cancelled) return
          setDetected(null)
          setDetectError(cause instanceof Error ? cause.message : 'Could not read that folder.')
        })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, path])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logs])

  useEffect(() => () => abortRef.current?.abort(), [])

  const append = (stream: LogLine['stream'], text: string) => {
    const clean = text.trimEnd()
    if (!clean) return
    logId.current += 1
    const id = logId.current
    setLogs((current) => [...current.slice(-600), { id, stream, text: clean }])
  }

  const startStep = (id: string) => {
    const mapped: StepId = id === 'prepare' || id === 'publish' ? id : 'build'
    setSteps((current) => {
      const next = { ...current }
      for (const step of STEPS) {
        if (step.id === mapped) next[step.id] = 'active'
        else if (next[step.id] === 'active') next[step.id] = 'done'
      }
      if (mapped === 'publish' && next.build === 'idle') next.build = 'done'
      return next
    })
    currentStep.current = mapped
  }

  const close = () => {
    abortRef.current?.abort()
    setOpen(false)
  }

  const deploy = async () => {
    if (running) return
    if (!path.trim()) {
      setError('Choose the project folder to deploy.')
      return
    }
    setRunning(true)
    setResult(null)
    setError('')
    setLogs([])
    setSteps({ ...IDLE, prepare: 'active' })
    currentStep.current = 'prepare'
    const controller = new AbortController()
    abortRef.current = controller
    append('meta', `Deploying ${path.trim()} to ${meta.label}`)
    let failed = false
    try {
      for await (const event of streamDeploy(
        {
          provider,
          path: path.trim(),
          outputDir: outputDir.trim() || undefined,
          buildCommand: buildCommand.trim() || undefined,
          projectName: projectName.trim() || undefined,
        },
        controller.signal,
      )) {
        if (event.type === 'step') startStep(event.id)
        else if (event.type === 'log') append(event.stream, event.text)
        else if (event.type === 'done') {
          setResult(event.result)
          setSteps({ prepare: 'done', build: 'done', publish: 'done' })
          append('meta', `Live at ${event.result.url}`)
          break
        } else if (event.type === 'error') {
          failed = true
          setError(event.message)
          append('stderr', event.message)
          break
        }
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        append('meta', 'Deployment stopped.')
        setSteps(IDLE)
      } else {
        failed = true
        const message = cause instanceof Error ? cause.message : 'The deployment failed.'
        setError(message)
        append('stderr', message)
      }
    } finally {
      if (failed && currentStep.current) {
        const failedStep = currentStep.current
        setSteps((current) => ({ ...current, [failedStep]: 'error' }))
      }
      abortRef.current = null
      setRunning(false)
    }
  }

  const copyUrl = async () => {
    if (!result?.url) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      notify('Clipboard access was blocked by the browser.', 'error')
    }
  }

  const folderName = path.trim().split(/[\\/]/).filter(Boolean).pop() ?? ''

  return (
    <Modal open={open} onClose={close} labelledBy="deploy-title" wide className="h-[92dvh] p-0 sm:h-[min(90dvh,780px)]">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent shadow-pill">
            <Rocket size={17} />
          </span>
          <div className="min-w-0">
            <h2 id="deploy-title" className="font-display text-[19px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              Deploy
            </h2>
            <p className="truncate text-[11.5px] text-muted">Build and publish a folder to a live URL. Tokens stay encrypted on this machine.</p>
          </div>
        </div>
        <button type="button" className="icon-button shrink-0" onClick={close} aria-label="Close deploy panel">
          <X size={16} />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
        <div className="thin-scroll min-h-0 overflow-y-auto border-b border-line lg:border-b-0 lg:border-r">
          <div className="space-y-5 p-5">
            <Field label="Host">
              <div className="grid grid-cols-3 gap-1.5">
                {PROVIDERS.map((entry) => {
                  const Icon = entry.icon
                  const active = provider === entry.id
                  const ready = deploySecrets?.[entry.id]?.configured
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setProvider(entry.id)}
                      disabled={running}
                      aria-pressed={active}
                      className={cn(
                        'relative flex flex-col items-start gap-2 rounded-xl border p-2.5 text-left transition-all disabled:opacity-60',
                        active ? 'border-accent/50 bg-accent-soft/50 shadow-pill' : 'border-line bg-panel hover:bg-raised/60',
                      )}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ backgroundColor: entry.tint }}>
                        <Icon size={14} />
                      </span>
                      <span className="text-[11.5px] font-medium leading-tight text-ink">{entry.label}</span>
                      <span
                        className={cn('absolute right-2 top-2 h-1.5 w-1.5 rounded-full', ready ? 'bg-success' : 'bg-warning')}
                        title={ready ? 'Credentials saved' : 'Needs credentials'}
                      />
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-faint">{meta.blurb}</p>
            </Field>

            {!configured && (
              <div className="rounded-xl border border-warning/25 bg-warning/[0.05] p-3">
                <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted">
                  <ShieldCheck size={12} className="mt-0.5 shrink-0 text-warning" />
                  {meta.label} needs {meta.needs}. Add it once in Settings → Deploy; it is encrypted and never shown again.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    openSettings('deploy')
                  }}
                  className="mt-2 inline-flex h-7 items-center rounded-lg bg-ink px-2.5 text-[10.5px] font-medium text-panel"
                >
                  Add {meta.label} credentials
                </button>
              </div>
            )}

            <Field label="Project folder">
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                disabled={running}
                placeholder="/absolute/path/to/project or ~/Projects/site"
                spellCheck={false}
                className={inputClass}
                aria-label="Project folder"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[10px] text-faint">
                  {workspaceAvailable ? `Open workspace: ${workspaceName}` : 'No workspace open.'}
                </p>
                {workspaceAvailable && path !== workspaceRoot && (
                  <button
                    type="button"
                    onClick={() => setPath(workspaceRoot)}
                    disabled={running}
                    className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-accent disabled:opacity-40"
                  >
                    <FolderOpen size={10} /> Use workspace
                  </button>
                )}
              </div>

              {detected && (
                <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-line bg-raised/40 p-2.5">
                  <FolderIcon name={detected.outputDir || 'src'} open size={22} />
                  <div className="min-w-0 flex-1 text-[10.5px] leading-relaxed">
                    <p className="font-medium text-ink">
                      {detected.framework || 'Folder'}
                      {detected.packageManager && <span className="ml-1.5 font-normal text-faint">{detected.packageManager}</span>}
                    </p>
                    <p className="text-muted">
                      {detected.buildCommand ? (
                        <>
                          build <code className="font-mono text-ink">{detected.buildCommand}</code>
                        </>
                      ) : (
                        'no build step'
                      )}
                      {' → '}
                      {detected.outputDir ? (
                        <code className="font-mono text-ink">{detected.outputDir}</code>
                      ) : detected.expectedOutputDir ? (
                        <>
                          <code className="font-mono text-ink">{detected.expectedOutputDir}</code> <span className="text-faint">(after build)</span>
                        </>
                      ) : (
                        <span className="text-warning">no output folder found</span>
                      )}
                    </p>
                  </div>
                </div>
              )}
              {detectError && (
                <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-danger">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {detectError}
                </p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Output folder" hint="auto">
                <input
                  value={outputDir}
                  onChange={(event) => setOutputDir(event.target.value)}
                  disabled={running}
                  placeholder={detected?.outputDir || detected?.expectedOutputDir || 'auto'}
                  spellCheck={false}
                  className={inputClass}
                  aria-label="Output folder"
                />
              </Field>
              <Field label="Project name" hint="auto">
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  disabled={running}
                  placeholder={detected?.name || 'my-site'}
                  spellCheck={false}
                  className={inputClass}
                  aria-label="Project name"
                />
              </Field>
            </div>

            <Field label="Build command" hint="auto when the output folder is missing">
              <input
                value={buildCommand}
                onChange={(event) => setBuildCommand(event.target.value)}
                disabled={running}
                placeholder={detected?.buildCommand || 'npm run build'}
                spellCheck={false}
                className={inputClass}
                aria-label="Build command"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {['npm run build', 'pnpm build', 'yarn build'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBuildCommand(value)}
                    disabled={running}
                    className="rounded-md border border-line px-1.5 py-0.5 text-[9.5px] text-faint transition-colors hover:text-ink"
                  >
                    {value}
                  </button>
                ))}
                {(buildCommand || outputDir) && (
                  <button
                    type="button"
                    onClick={() => {
                      setBuildCommand('')
                      setOutputDir('')
                    }}
                    disabled={running}
                    className="px-1.5 py-0.5 text-[9.5px] text-faint hover:text-danger"
                  >
                    reset to auto
                  </button>
                )}
              </div>
            </Field>

            <div className="flex items-start gap-1.5 rounded-lg border border-line bg-raised/40 px-2.5 py-2 text-[10px] leading-relaxed text-faint">
              <Terminal size={11} className="mt-0.5 shrink-0" />
              {tool?.installed
                ? `${tool.label}${tool.version ? ` ${tool.version}` : ''} found on this machine.`
                : `${tool?.label ?? 'The CLI'} is not installed; OpenSol will fetch it with npx for this deploy.`}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
            <ol className="flex min-w-0 flex-1 items-center gap-1.5">
              {STEPS.map((step, index) => {
                const state = steps[step.id]
                const Icon = step.icon
                return (
                  <li key={step.id} className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10.5px] font-medium transition-colors',
                        state === 'active' && 'border-accent/40 bg-accent-soft text-accent',
                        state === 'done' && 'border-success/30 bg-success/10 text-success',
                        state === 'error' && 'border-danger/30 bg-danger/10 text-danger',
                        state === 'idle' && 'border-line text-faint',
                      )}
                    >
                      {state === 'active' ? (
                        <Spinner size={11} />
                      ) : state === 'done' ? (
                        <Check size={11} />
                      ) : state === 'error' ? (
                        <AlertTriangle size={11} />
                      ) : (
                        <Icon size={11} />
                      )}
                      <span className="hidden sm:inline">{step.label}</span>
                    </span>
                    {index < STEPS.length - 1 && <span className={cn('h-px w-4 shrink-0', state === 'done' ? 'bg-success/40' : 'bg-line')} />}
                  </li>
                )
              })}
            </ol>
            {running ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[11px] font-medium text-muted hover:text-ink"
              >
                <Square size={9} fill="currentColor" /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void deploy()}
                disabled={!configured || !path.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[11.5px] font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play size={10} fill="currentColor" />
                {result || error ? 'Deploy again' : 'Deploy'}
              </button>
            )}
          </div>

          {result && (
            <div className="shrink-0 border-b border-line bg-success/[0.05] px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                  <Check size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-muted">Live on {meta.label}</p>
                  <a href={result.url} target="_blank" rel="noreferrer" className="block truncate text-[14px] font-semibold text-accent hover:underline">
                    {result.url}
                  </a>
                </div>
                <button type="button" onClick={copyUrl} className="icon-button h-8 w-8" title="Copy URL" aria-label="Copy URL">
                  {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                </button>
                <a href={result.url} target="_blank" rel="noreferrer" className="icon-button h-8 w-8" title="Open site" aria-label="Open site">
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>
          )}

          {error && (
            <div className="flex shrink-0 items-start gap-2 border-b border-danger/20 bg-danger/[0.05] px-4 py-2.5 text-[11px] leading-relaxed text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div ref={logRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas/40 px-4 py-3">
            {logs.length === 0 && !running ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-6 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-raised text-faint">
                  <PackageOpen size={18} />
                </span>
                <p className="text-[12px] font-medium text-muted">Ready when you are</p>
                <p className="max-w-[280px] text-[10.5px] leading-relaxed text-faint">
                  Leave the fields on auto: OpenSol installs dependencies, builds if there is no output folder yet, then publishes it. Tokens never appear in the log.
                </p>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.7] text-muted">
                {logs.map((line) => (
                  <span
                    key={line.id}
                    className={cn('block', line.stream === 'stderr' && 'text-danger', line.stream === 'meta' && 'font-medium text-accent')}
                  >
                    {line.stream === 'meta' ? '› ' : ''}
                    {line.text}
                  </span>
                ))}
                {running && (
                  <span className="mt-1 flex items-center gap-1.5 text-accent">
                    <Spinner size={10} /> working…
                  </span>
                )}
              </pre>
            )}
          </div>

          <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-4 text-[10px] text-faint">
            <ShieldCheck size={10} />
            Tokens encrypted at rest
            <span className="ml-auto truncate">{folderName || 'No folder'}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
