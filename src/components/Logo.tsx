import { cn } from '../lib/utils'

/** The OpenSol sun: a solid core with eight round-capped rays. Inherits `currentColor`. */
export function LogoMark({ size = 28, className, spin = false }: { size?: number; className?: string; spin?: boolean }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center text-accent', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" width={size} height={size} fill="none" className={cn(spin && 'animate-spin-slow')}>
        <circle cx="16" cy="16" r="6.2" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M16 3.6v3.2M16 25.2v3.2M3.6 16h3.2M25.2 16h3.2" />
          <path d="M7.2 7.2l2.2 2.2M22.6 22.6l2.2 2.2M7.2 24.8l2.2-2.2M22.6 9.4l2.2-2.2" opacity="0.55" />
        </g>
      </svg>
    </span>
  )
}

export function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="group/logo flex items-center gap-2">
      <LogoMark size={compact ? 20 : 22} className="transition-transform duration-500 ease-out group-hover/logo:rotate-90" />
      {!compact && (
        <span className="text-[15px] font-semibold leading-none tracking-[-0.025em] text-ink">
          Open<span className="text-accent">Sol</span>
        </span>
      )}
    </div>
  )
}

export function BrandFooter() {
  return (
    <p className="text-[11px] tracking-[0.01em] text-faint">
      OpenSol <span className="px-1 text-line">/</span> by OpenSoft
    </p>
  )
}
