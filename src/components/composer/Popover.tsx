import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useClickOutside } from '../../lib/hooks'
import { cn } from '../../lib/utils'

const EDGE = 12
const GAP = 8

/**
 * A trigger plus a floating panel. It opens on the side with room (flipping above/below, and
 * left/right), never grows past `maxHeight` or the viewport, and scrolls inside when longer.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  width = 260,
  placement = 'above',
  maxHeight = 260,
  className,
}: {
  open: boolean
  onClose: () => void
  trigger: ReactNode
  children: ReactNode
  width?: number
  /** Preferred side; flips when the other side has clearly more room. */
  placement?: 'above' | 'below'
  /** Upper bound for the panel height before it scrolls. */
  maxHeight?: number
  className?: string
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ side: placement, height: maxHeight, alignRight: false })
  useClickOutside(wrapperRef, onClose, open)

  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const wrapper = wrapperRef.current
      if (!wrapper) return
      const rect = wrapper.getBoundingClientRect()
      const above = rect.top - EDGE - GAP
      const below = window.innerHeight - rect.bottom - EDGE - GAP
      const natural = Math.min(panelRef.current?.scrollHeight ?? maxHeight, maxHeight)
      const fits = (room: number) => room >= natural
      const preferred = placement === 'above' ? above : below
      const other = placement === 'above' ? below : above
      const side = fits(preferred) || preferred >= other ? placement : placement === 'above' ? 'below' : 'above'
      const room = side === 'above' ? above : below
      setLayout({
        side,
        height: Math.max(96, Math.min(maxHeight, room)),
        alignRight: rect.left + width > window.innerWidth - EDGE,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, placement, maxHeight, width])

  return (
    <div ref={wrapperRef} className="relative">
      {trigger}
      {open && (
        <div
          ref={panelRef}
          style={{ width, maxHeight: layout.height }}
          className={cn(
            'surface-lift thin-scroll animate-scalein absolute z-40 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-2xl border border-line p-1.5 shadow-float',
            layout.alignRight ? 'right-0' : 'left-0',
            layout.side === 'above' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+6px)]',
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-faint">{children}</p>
}

/** A plain-text toolbar button: no border or fill until it is hovered or its panel is open. */
export function TextButton({
  children,
  open,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { open?: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      {...props}
      className={cn(
        'flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
        open && 'text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}
