import { cn } from '../lib/utils'

/**
 * The OpenSol mark: an "O" ring left open, a small sun resting in the opening, and a command prompt
 * inside. Open + Sol + a place to type. Inherits `currentColor`.
 */
export function LogoMark({ size = 28, className, spin = false }: { size?: number; className?: string; spin?: boolean }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center text-accent', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" width={size} height={size} fill="none" className={cn(spin && 'animate-spin-slow')}>
        <path d="M25.66 13.41A10 10 0 1 1 18.59 6.34" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
        <circle cx="23.07" cy="8.93" r="2.5" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.6 12.8L17 16l-4.4 3.2" />
          <path d="M18.8 19.6h3" opacity="0.6" />
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
