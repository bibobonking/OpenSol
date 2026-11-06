import { cn } from '../lib/utils'

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center text-accent', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
        <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="12" cy="11" r="4.4" fill="currentColor" stroke="none" />
          <path d="M12 2.4v2.1M12 17.5v2.1M4.9 11H2.8M21.2 11h-2.1M6.9 5.9 5.4 4.4M17.1 5.9l1.5-1.5M6.9 16.1l-1.5 1.5M17.1 16.1l1.5 1.5" />
          <path d="M3 21.2h18" strokeWidth="1.8" />
        </g>
      </svg>
    </span>
  )
}

export function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {compact ? (
        <LogoMark size={22} />
      ) : (
        <>
          <LogoMark size={22} />
          <span className="font-display text-[21px] font-medium leading-none tracking-[-0.02em] text-ink">OpenSol</span>
        </>
      )}
    </div>
  )
}

export function BrandFooter() {
  return (
    <p className="text-[10.5px] tracking-[0.01em] text-faint">
      OpenSol <span className="px-1 text-line">/</span> an OpenSoft product
    </p>
  )
}
