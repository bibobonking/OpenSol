import { cn } from '../lib/utils'

/** The OpenSol aperture: a broken solar ring around a solid core. Inherits `currentColor`. */
export function LogoMark({ size = 28, className, spin = false }: { size?: number; className?: string; spin?: boolean }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center text-accent', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" width={size} height={size} fill="none" className={cn(spin && 'animate-spin-slow')}>
        <circle cx="16" cy="16" r="5.1" fill="currentColor" />
        <circle cx="16" cy="16" r="8.4" stroke="currentColor" strokeWidth="0.9" opacity="0.22" />
        <g stroke="currentColor" strokeWidth="2.15" strokeLinecap="round">
          <path d="M16 4.4a11.6 11.6 0 0 1 9.7 5.5" />
          <path d="M27.6 16a11.6 11.6 0 0 1-5.5 9.7" opacity="0.6" />
          <path d="M16 27.6a11.6 11.6 0 0 1-9.7-5.5" opacity="0.32" />
          <path d="M4.4 16a11.6 11.6 0 0 1 5.5-9.7" opacity="0.8" />
        </g>
        <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M16 1.5v2.2M30.5 16h-2.2M16 30.5v-2.2M1.5 16h2.2" opacity="0.9" />
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
      OpenSol <span className="px-1 text-line">/</span> by OpenSoftX
    </p>
  )
}
