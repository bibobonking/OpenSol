import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { MASCOT_LABELS, type MascotMood } from '../lib/mascot'
import { cn } from '../lib/utils'

interface Sheet {
  name: string
  frames: number
  box: readonly [number, number, number, number]
  still: number
}

const SHEETS: Record<MascotMood, Sheet> = {
  wave: { name: 'idle-wave', frames: 12, box: [24, 15, 24, 21], still: 0 },
  idle: { name: 'idle', frames: 24, box: [24, 20, 24, 16], still: 0 },
  thinking: { name: 'thinking', frames: 48, box: [20, 0, 30, 36], still: 24 },
  working: { name: 'building', frames: 6, box: [15, 19, 28, 17], still: 0 },
  typing: { name: 'typing', frames: 6, box: [15, 22, 28, 14], still: 0 },
  happy: { name: 'happy', frames: 32, box: [18, 6, 34, 30], still: 3 },
  alert: { name: 'notification', frames: 16, box: [24, 8, 24, 28], still: 0 },
  error: { name: 'error', frames: 24, box: [23, 11, 26, 25], still: 4 },
  sleepy: { name: 'sleeping', frames: 32, box: [18, 1, 31, 35], still: 0 },
  party: { name: 'happy', frames: 32, box: [18, 6, 34, 30], still: 3 },
}

const COLUMNS = 8
const FRAME_MS = 80

export function Clawd({
  mood = 'idle',
  size = 40,
  className,
}: {
  mood?: MascotMood
  size?: number
  className?: string
}): ReactNode {
  const stripRef = useRef<HTMLSpanElement>(null)
  const sheet = SHEETS[mood]
  const scale = size / sheet.box[3]
  const cellW = sheet.box[2] * scale
  const cellH = sheet.box[3] * scale
  const rows = Math.ceil(sheet.frames / COLUMNS)

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const offset = (frame: number) =>
      `translate(${-((frame % COLUMNS) * cellW)}px, ${-Math.floor(frame / COLUMNS) * cellH}px)`
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      strip.style.transform = offset(sheet.still)
      return
    }
    strip.style.transform = offset(0)
    const keyframes = Array.from({ length: sheet.frames }, (_, frame) => ({ transform: offset(frame) }))
    const animation = strip.animate(keyframes, {
      duration: sheet.frames * FRAME_MS,
      iterations: Infinity,
    })
    return () => animation.cancel()
  }, [cellW, cellH, sheet])

  const style = {
    width: cellW,
    height: cellH,
    '--clawd-sheet': `url('/mascots/clawd/${sheet.name}.png')`,
    '--clawd-ink': `url('/mascots/clawd/${sheet.name}-ink.png')`,
    '--clawd-strip-w': `${COLUMNS * cellW}px`,
    '--clawd-strip-h': `${rows * cellH}px`,
  } as CSSProperties

  return (
    <span
      className={cn('clawd', className)}
      style={style}
      role="img"
      aria-label={`Clawd — ${MASCOT_LABELS[mood]}`}
      title={`Clawd — ${MASCOT_LABELS[mood]}`}
    >
      <span ref={stripRef} className="clawd-strip" />
    </span>
  )
}
