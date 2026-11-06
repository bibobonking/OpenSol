import { cn } from '../lib/utils'

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center text-accent', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
        <g stroke="currentColor" strokeWidth="2.15" strokeLinecap="round">
          <path d="M12 2.6v18.8" />
          <path d="M2.6 12h18.8" />
          <path d="M5.35 5.35 18.65 18.65" />
          <path d="M18.65 5.35 5.35 18.65" />
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
        <span className="font-display text-[23px] font-medium leading-none tracking-[-0.02em] text-ink">MaxCode</span>
      )}
    </div>
  )
}

export function BrandFooter() {
  return (
    <p className="text-[10.5px] tracking-[0.01em] text-faint">
      MaxCode <span className="px-1 text-line">/</span> a DevSoft product
    </p>
  )
}
