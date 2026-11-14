import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Brain, Check, ChevronDown, Eye, KeyRound, Plus, RefreshCw, Search, Settings2, X, Zap } from 'lucide-react'
import { PROVIDERS, PROVIDER_MAP, EFFORT_LABELS, effortLabel } from '../data/providers'
import type { Effort, ModelInfo, ProviderId } from '../types'
import { activeModelId, providerHasCredentials, useSettings } from '../store/settings'
import { useModelCatalog } from '../store/models'
import { useUi } from '../store/ui'
import { defaultEffort, effortOptions, normalizeEffort, reasoningSummary } from '../lib/reasoning'
import { cn } from '../lib/utils'
import { Spinner } from './ui'

const NO_MODELS: ModelInfo[] = []

function connected(providerId: ProviderId) {
  return providerHasCredentials(useSettings.getState(), providerId)
}

function contextLabel(context?: number) {
  if (!context) return ''
  if (context >= 1_000_000) return `${(context / 1_000_000).toFixed(context % 1_000_000 ? 1 : 0)}M`
  return `${Math.round(context / 1000)}k`
}

/** 0–1 on a log scale so a 8k and a 1M window are both readable on one bar. */
function contextFill(context?: number) {
  if (!context) return 0
  return Math.max(0.06, Math.min(1, Math.log10(context / 4000) / Math.log10(2_000_000 / 4000)))
}

function monogram(name: string) {
  const words = name.split(/[\s/.-]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

function EffortThrottle({
  efforts,
  value,
  onChange,
  disabled,
}: {
  efforts: Effort[]
  value: Effort
  onChange: (effort: Effort) => void
  disabled: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const last = Math.max(1, efforts.length - 1)
  const index = Math.max(0, efforts.indexOf(value))
  const pct = (index / last) * 100

  const pick = useCallback(
    (clientY: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || efforts.length === 0) return
      const fraction = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
      const next = efforts[Math.round(fraction * last)]
      if (next && next !== value) onChange(next)
    },
    [efforts, last, onChange, value],
  )

  return (
    <div className={cn('relative flex h-[280px] gap-4 select-none', disabled && 'pointer-events-none opacity-40')}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Reasoning effort"
        aria-valuemin={0}
        aria-valuemax={efforts.length - 1}
        aria-valuenow={index}
        aria-valuetext={effortLabel(value)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            event.preventDefault()
            onChange(efforts[Math.min(efforts.length - 1, index + 1)])
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault()
            onChange(efforts[Math.max(0, index - 1)])
          }
        }}
        onPointerDown={(event) => {
          ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
          setDragging(true)
          pick(event.clientY)
        }}
        onPointerMove={(event) => dragging && pick(event.clientY)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        className="relative w-9 shrink-0 cursor-grab touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:cursor-grabbing"
      >
        <div className="absolute inset-x-[13px] inset-y-1 rounded-full bg-raised shadow-[inset_0_1px_3px_rgba(0,0,0,0.12)]" />
        <div
          className="absolute inset-x-[13px] bottom-1 rounded-full bg-gradient-to-t from-accent/40 via-accent to-accent transition-[height] duration-500 ease-spring"
          style={{ height: `calc((100% - 8px) * ${pct / 100})` }}
        />
        {efforts.map((effort, i) => (
          <span
            key={effort}
            className={cn(
              'absolute left-1/2 h-[7px] w-[7px] -translate-x-1/2 translate-y-1/2 rounded-full border transition-colors duration-300',
              i <= index ? 'border-on-accent/40 bg-on-accent/80' : 'border-line bg-panel',
            )}
            style={{ bottom: `calc(4px + (100% - 8px) * ${i / last})` }}
          />
        ))}
        <span
          className={cn(
            'throttle-knob absolute left-1/2 h-6 w-6 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-accent bg-panel shadow-float transition-[bottom] duration-500 ease-spring',
            dragging && 'scale-110 !duration-75',
          )}
          style={{ bottom: `calc(4px + (100% - 8px) * ${index / last})` }}
        >
          <span className="absolute inset-[5px] rounded-full bg-accent" />
        </span>
      </div>

      <div className="relative min-w-0 flex-1">
        {efforts.map((effort, i) => {
          const active = i === index
          return (
            <button
              key={effort}
              type="button"
              onClick={() => onChange(effort)}
              className={cn(
                'absolute left-0 flex -translate-y-1/2 flex-col items-start text-left transition-all duration-300',
                active ? 'text-ink' : 'text-faint hover:text-ink',
              )}
              style={{ top: `calc(4px + (100% - 8px) * ${1 - i / last})` }}
            >
              <span className={cn('font-mono text-[10.5px] uppercase tracking-[0.14em]', active && 'text-accent')}>
                {effortLabel(effort)}
              </span>
              <span
                className={cn(
                  'overflow-hidden text-[10.5px] leading-tight text-muted transition-all duration-300',
                  active ? 'mt-0.5 max-h-8 opacity-100' : 'max-h-0 opacity-0',
                )}
              >
                {EFFORT_LABELS[effort as keyof typeof EFFORT_LABELS]?.description}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ModelDeck({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings()
  const selectModel = useSettings((state) => state.selectModel)
  const update = useSettings((state) => state.update)
  const openSettings = useUi((state) => state.openSettings)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  // Only keyboard navigation may scroll the list. Hover moves the cursor too, and scrolling
  // under a moving pointer makes the rows jump up and down.
  const keyboardNav = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const railRef = useRef<HTMLElement>(null)
  const provider = settings.provider
  const models = useModelCatalog((state) => state.byProvider[provider]) ?? NO_MODELS
  const loading = useModelCatalog((state) => Boolean(state.loading[provider]))
  const error = useModelCatalog((state) => state.errors[provider] ?? '')
  const note = useModelCatalog((state) => state.notes[provider] ?? '')
  const fetchModels = useModelCatalog((state) => state.fetchModels)

  const modelId = activeModelId(settings)
  const active = models.find((model) => model.id === modelId) ?? null
  const connectedNow = connected(provider)
  const keyless = Boolean(PROVIDER_MAP[provider]?.keyless) || provider === 'custom'
  const efforts = effortOptions(active)

  useEffect(() => {
    if (!open) return
    if (connectedNow || keyless) void fetchModels(provider)
  }, [open, provider, connectedNow, keyless, fetchModels])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setShowManual(false)
      return
    }
    const timer = window.setTimeout(() => searchRef.current?.focus(), 60)
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open])

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase()
    if (!clean) return models
    return models.filter(
      (model) => model.name.toLowerCase().includes(clean) || model.id.toLowerCase().includes(clean),
    )
  }, [models, query])

  useLayoutEffect(() => {
    setCursor(0)
  }, [query, provider])

  useEffect(() => {
    if (!keyboardNav.current) return
    keyboardNav.current = false
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const choose = (model: ModelInfo) => {
    const options = effortOptions(model)
    const effort = options.length > 0 ? normalizeEffort(settings.effort, model) : settings.effort
    selectModel(provider, model.id, options.length > 0 && !options.includes(effort) ? defaultEffort(model) : effort)
  }

  const chooseManual = (event?: FormEvent) => {
    event?.preventDefault()
    const id = manual.trim()
    if (!id) return
    selectModel(provider, id, settings.effort)
    setManual('')
    setShowManual(false)
  }

  const chooseProvider = (next: ProviderId) => {
    if (next === provider) return
    update({ provider: next, model: '' })
    setQuery('')
    void fetchModels(next)
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      keyboardNav.current = true
      setCursor((value) => Math.min(filtered.length - 1, value + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      keyboardNav.current = true
      setCursor((value) => Math.max(0, value - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const model = filtered[cursor]
      if (model && model.id !== modelId) choose(model)
      else onClose()
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Keep the active provider in view: the rail scrolls and the selected one can sit far down.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => railRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [open, provider])

  if (!open) return null

  const needsKey = !connectedNow && !keyless
  const railIndex = Math.max(0, PROVIDERS.findIndex((entry) => entry.id === provider))

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close model deck"
        tabIndex={-1}
        onClick={onClose}
        className="deck-scrim absolute inset-0 cursor-default bg-black/40 backdrop-blur-[6px] dark:bg-black/65"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Model deck"
        className="deck-panel relative flex h-[min(92dvh,640px)] w-full flex-col overflow-hidden rounded-t-[28px] border border-line bg-panel shadow-float sm:w-[min(920px,96vw)] sm:rounded-[28px]"
      >
        <div className="deck-aurora pointer-events-none absolute inset-x-0 top-0 h-40" />

        <header className="relative flex shrink-0 items-end gap-4 px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-faint">Model deck</p>
            <h2 className="mt-1 truncate font-display text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
              {active?.name || modelId || 'Pick a model'}
            </h2>
            <p className="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted">
              <span>{PROVIDER_MAP[provider]?.name ?? provider}</span>
              {efforts.length > 0 && (
                <>
                  <span className="text-faint">·</span>
                  <span className="text-accent">{effortLabel(settings.effort)} effort</span>
                </>
              )}
              {active?.context ? (
                <>
                  <span className="text-faint">·</span>
                  <span>{contextLabel(active.context)} context</span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="icon-button h-8 w-8"
            onClick={() => void fetchModels(provider, true)}
            disabled={loading || needsKey}
            title="Refresh live models"
            aria-label="Refresh live models"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
          <button
            type="button"
            className="icon-button h-8 w-8"
            onClick={() => {
              onClose()
              openSettings('models')
            }}
            title="Provider settings"
            aria-label="Provider settings"
          >
            <Settings2 size={14} />
          </button>
          <button type="button" className="icon-button h-8 w-8" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col border-t border-line md:flex-row">
          {/* Provider rail */}
          <nav
            ref={railRef}
            aria-label="Providers"
            className="thin-scroll relative flex shrink-0 gap-1.5 overflow-x-auto border-b border-line bg-canvas/70 p-2 md:w-[78px] md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r md:p-2.5"
          >
            <span
              aria-hidden
              className="deck-rail-glow pointer-events-none absolute left-2.5 top-2.5 hidden h-[46px] w-[calc(100%-20px)] rounded-2xl bg-accent-soft ring-1 ring-accent/40 transition-transform duration-500 ease-spring md:block"
              style={{ transform: `translateY(${railIndex * 52}px)` }}
            />
            {PROVIDERS.map((entry) => {
              const ready = connected(entry.id) || entry.keyless || entry.id === 'custom'
              const selected = entry.id === provider
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => chooseProvider(entry.id)}
                  disabled={!ready}
                  title={`${entry.name}${ready ? '' : ' · connect to enable'}`}
                  aria-pressed={selected}
                  className={cn(
                    'relative flex h-[46px] min-w-[58px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl transition-colors disabled:cursor-not-allowed disabled:opacity-40 md:min-w-0',
                    selected ? 'text-accent max-md:bg-accent-soft' : 'text-muted hover:bg-raised hover:text-ink',
                  )}
                >
                  <span className="font-display text-[13px] font-semibold tracking-tight">{monogram(entry.name)}</span>
                  <span className="max-w-full truncate px-1 text-[8.5px] leading-none text-faint">{entry.name.split(' ')[0]}</span>
                  <span
                    className={cn(
                      'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full',
                      ready ? 'bg-success' : 'bg-warning/70',
                    )}
                  />
                </button>
              )
            })}
          </nav>

          {/* Models */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {needsKey ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
                <span className="deck-pop flex h-12 w-12 items-center justify-center rounded-2xl bg-warning/10 text-warning">
                  <KeyRound size={20} />
                </span>
                <p className="font-display text-[16px] font-semibold text-ink">Connect {PROVIDER_MAP[provider]?.name ?? provider}</p>
                <p className="max-w-[320px] text-[12px] leading-relaxed text-muted">
                  Keys are encrypted by the local daemon before they touch disk and never come back to this page.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    openSettings('models')
                  }}
                  className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-5 text-[12px] font-medium text-panel transition-transform active:scale-95"
                >
                  Add API key
                </button>
              </div>
            ) : (
              <>
                <div className="shrink-0 px-4 pb-2 pt-3.5">
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={onSearchKey}
                      placeholder={models.length > 0 ? `Search ${models.length} models…` : 'Search models…'}
                      className="h-10 w-full rounded-full border border-line bg-canvas/70 pl-10 pr-14 text-[13px] text-ink outline-none transition-all placeholder:text-faint focus:border-accent/50 focus:bg-panel focus:shadow-[0_0_0_4px_rgb(var(--accent)/0.10)]"
                      aria-label="Search models"
                    />
                    <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-[9.5px] text-faint">
                      ↑↓ ↵
                    </kbd>
                  </div>
                  {error && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-danger/20 bg-danger/[0.04] px-2.5 py-2">
                      <AlertCircle size={12} className="mt-0.5 shrink-0 text-danger" />
                      <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-danger">{error}</p>
                      <button type="button" onClick={() => void fetchModels(provider, true)} className="text-[11px] font-medium text-danger">
                        Retry
                      </button>
                    </div>
                  )}
                  {note && !error && <p className="mt-1.5 px-1 text-[10.5px] leading-relaxed text-faint">{note}</p>}
                </div>

                <div ref={listRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
                  {loading && models.length === 0 && (
                    <p className="flex items-center gap-2 px-3 py-4 text-[12px] text-faint">
                      <Spinner size={12} /> Loading live models…
                    </p>
                  )}
                  {filtered.map((model, i) => {
                    const selected = model.id === modelId
                    const highlighted = i === cursor
                    const thinks = model.reasoningOptions.length > 0
                    return (
                      <button
                        key={model.id}
                        type="button"
                        data-row={i}
                        onClick={() => {
                          setCursor(i)
                          choose(model)
                        }}
                        onMouseEnter={() => setCursor(i)}
                        style={{ animationDelay: `${Math.min(i * 22, 260)}ms` }}
                        className={cn(
                          'deck-row group/row relative mb-1 flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-2.5 text-left transition-colors',
                          selected ? 'bg-accent-soft' : highlighted ? 'bg-raised' : 'hover:bg-raised/70',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-300',
                            selected ? 'scale-100 bg-accent text-on-accent' : 'bg-raised text-faint group-hover/row:bg-panel',
                          )}
                        >
                          {selected ? <Check size={14} strokeWidth={2.4} /> : <Zap size={13} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={cn('truncate text-[13px] font-medium', selected ? 'text-accent' : 'text-ink')}>
                              {model.name || model.id}
                            </span>
                            {model.free && (
                              <span className="rounded-full bg-success/10 px-1.5 py-px text-[9px] font-medium text-success">free</span>
                            )}
                            {!model.toolCall && (
                              <span className="rounded-full bg-warning/10 px-1.5 py-px text-[9px] font-medium text-warning">no tools</span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-faint">{model.id}</span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-2.5 text-faint sm:flex">
                          {thinks && <Brain size={12} className="text-accent/80" aria-label="reasoning" />}
                          {model.vision && <Eye size={12} aria-label="vision" />}
                          {model.context ? (
                            <span className="flex w-[74px] flex-col items-end gap-1">
                              <span className="font-mono text-[10px] tabular-nums">{contextLabel(model.context)}</span>
                              <span className="h-[3px] w-full overflow-hidden rounded-full bg-line">
                                <span
                                  className={cn('block h-full rounded-full', selected ? 'bg-accent' : 'bg-faint/60')}
                                  style={{ width: `${contextFill(model.context) * 100}%` }}
                                />
                              </span>
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })}
                  {!loading && filtered.length === 0 && models.length > 0 && (
                    <p className="px-3 py-6 text-center text-[12px] text-faint">No model matches “{query}”.</p>
                  )}
                  {!loading && models.length === 0 && !error && (
                    <p className="px-3 py-6 text-center text-[12px] text-faint">This provider returned no usable chat models.</p>
                  )}

                  {showManual ? (
                    <form onSubmit={chooseManual} className="deck-row mt-1 flex items-center gap-2 px-1">
                      <input
                        autoFocus
                        value={manual}
                        onChange={(event) => setManual(event.target.value)}
                        placeholder="model-id"
                        className="h-9 min-w-0 flex-1 rounded-full border border-line bg-panel px-4 font-mono text-[11.5px] outline-none focus:border-accent/50"
                        aria-label="Model ID"
                      />
                      <button
                        type="submit"
                        disabled={!manual.trim()}
                        className="h-9 rounded-full bg-ink px-4 text-[11.5px] font-medium text-panel transition-opacity disabled:opacity-40"
                      >
                        Use
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowManual(true)}
                      className="mt-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-[12px] text-faint transition-colors hover:bg-raised/70 hover:text-ink"
                    >
                      <Plus size={13} /> Use a model ID that is not listed
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          {/* Effort throttle */}
          <aside className="deck-throttle relative shrink-0 border-t border-line bg-canvas/70 px-6 py-5 md:w-[258px] md:border-l md:border-t-0">
            <div className="mb-4 flex items-center gap-2">
              <Brain size={13} className="text-accent" />
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Reasoning</p>
            </div>

            {efforts.length > 1 ? (
              <>
                <div className="hidden md:block">
                  <EffortThrottle
                    efforts={efforts}
                    value={normalizeEffort(settings.effort, active)}
                    onChange={(effort) => active && selectModel(provider, active.id, effort)}
                    disabled={!active}
                  />
                </div>
                <div className="flex gap-1 rounded-full bg-raised p-1 md:hidden">
                  {efforts.map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      onClick={() => active && selectModel(provider, active.id, effort)}
                      className={cn(
                        'h-8 min-w-0 flex-1 rounded-full text-[10.5px] font-medium transition-all',
                        settings.effort === effort ? 'bg-accent text-on-accent shadow-pill' : 'text-muted',
                      )}
                    >
                      {effortLabel(effort)}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-[120px] flex-col justify-center rounded-2xl border border-dashed border-line px-4 text-center md:h-[280px]">
                <p className="text-[12px] font-medium text-ink">{active ? 'No effort dial' : 'Pick a model'}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{reasoningSummary(active)}</p>
              </div>
            )}

            {efforts.length > 1 && <p className="mt-4 hidden text-[10.5px] leading-relaxed text-faint md:block">{reasoningSummary(active)}</p>}
          </aside>
        </div>

        <footer className="relative flex shrink-0 items-center gap-3 border-t border-line px-6 py-3 text-[10.5px] text-faint">
          {active?.maxOutput ? <span>max output {contextLabel(active.maxOutput)}</span> : null}
          {active?.apiKind ? <span className="rounded-md border border-line px-1.5 py-px font-mono">{active.apiKind}</span> : null}
          <span className="ml-auto hidden sm:inline">Esc to close</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-full bg-ink px-5 text-[12px] font-medium text-panel transition-transform active:scale-95"
          >
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** Composer trigger: model name with live effort bars, no dropdown chevron. */
/** Plain-text model name for the composer; opens the deck. */
export function ModelDeckTrigger({
  label,
  open,
  disabled,
  onClick,
  triggerRef,
  title,
}: {
  label: string
  open: boolean
  disabled: boolean
  onClick: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  title: string
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={title}
      className={cn(
        'deck-trigger flex h-8 max-w-[180px] items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 sm:max-w-[260px]',
        open && 'text-ink',
      )}
    >
      <span className="truncate">{label}</span>
      <ChevronDown size={11} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
    </button>
  )
}
