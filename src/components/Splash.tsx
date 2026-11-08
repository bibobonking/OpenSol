import { useEffect, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { BrandFooter } from './Logo'
import { cn } from '../lib/utils'

const STATUS = ['Waking the local daemon', 'Unlocking your keys', 'Loading workspace', 'Almost there']

const RAYS_PLUS = ['M32 7v8', 'M32 49v8', 'M7 32h8', 'M49 32h8']
const RAYS_DIAG = ['M14.3 14.3l5.5 5.5', 'M44.2 44.2l5.5 5.5', 'M14.3 49.7l5.5-5.5', 'M44.2 19.8l5.5-5.5']

function SunDraw({ size = 64 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size * 1.7, height: size * 1.7 }}>
      <span className="absolute inset-0 m-auto animate-ping rounded-full bg-accent/20" style={{ width: size * 0.7, height: size * 0.7 }} />
      <span
        className="absolute inset-0 m-auto rounded-full bg-accent/10 blur-2xl"
        style={{ width: size * 1.4, height: size * 1.4 }}
      />
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className="splash-sun absolute inset-0 m-auto text-accent">
        <circle className="core" cx="32" cy="32" r="12" fill="currentColor" />
        <g className="rays" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round">
          {RAYS_PLUS.map((d, i) => (
            <path key={d} d={d} className="ray" pathLength={8} style={{ animationDelay: `${0.35 + i * 0.07}s` }} />
          ))}
          {RAYS_DIAG.map((d, i) => (
            <path key={d} d={d} className="ray" pathLength={8} opacity={0.55} style={{ animationDelay: `${0.65 + i * 0.07}s` }} />
          ))}
        </g>
      </svg>
    </div>
  )
}

export function Splash({
  phase,
  error,
  leaving,
  onRetry,
}: {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  leaving: boolean
  onRetry: () => void
}) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (phase === 'error') return
    const timer = window.setInterval(() => setStep((value) => Math.min(STATUS.length - 1, value + 1)), 650)
    return () => window.clearInterval(timer)
  }, [phase])

  return (
    <div className={cn('splash', leaving && 'is-leaving')} role="status" aria-live="polite">
      <div className="hero-wash pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative flex w-full max-w-[400px] flex-col items-center px-6 text-center">
        <SunDraw />
        <h1 className="splash-word -mt-1 text-[26px] font-semibold leading-none tracking-[-0.04em] text-ink" aria-label="OpenSol">
          {'OpenSol'.split('').map((char, index) => (
            <span key={index} style={{ animationDelay: `${0.5 + index * 0.05}s` }} className={index >= 4 ? 'text-accent' : undefined}>
              {char}
            </span>
          ))}
        </h1>
        <p className="mt-2 animate-fade text-[11px] font-medium uppercase tracking-[0.22em] text-faint [animation-delay:1s]">
          by OpenSoftX
        </p>

        {phase === 'error' ? (
          <div className="mt-8 w-full animate-rise">
            <div className="w-full rounded-xl border border-danger/25 bg-danger/[0.05] px-4 py-3 text-left">
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                <AlertCircle size={14} className="text-danger" />
                The local daemon did not answer
              </p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted">{error}</p>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-[12.5px] font-medium text-panel transition-all hover:opacity-85 active:scale-95"
            >
              <RefreshCw size={13} />
              Try again
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              Start OpenSol with <code className="rounded bg-raised px-1 py-0.5 font-mono text-[10.5px]">npm start</code> in the
              OpenSol folder, then reload this page.
            </p>
          </div>
        ) : (
          <div className="mt-9 flex animate-fade flex-col items-center gap-3 [animation-delay:0.8s]">
            <div className="loading-bar h-[2px] w-32 rounded-full" />
            <p key={step} className="animate-rise text-[12px] text-muted">
              {STATUS[step]}…
            </p>
          </div>
        )}
        <div className="mt-12 animate-fade [animation-delay:1.2s]">
          <BrandFooter />
        </div>
      </div>
    </div>
  )
}
