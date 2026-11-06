import type { ReactNode } from 'react'
import type { MascotMood } from '../lib/mascot'
import { cn } from '../lib/utils'

export type Px = readonly [x: number, y: number, w: number, h: number, color: string]

export const MOOD_ANIMATION: Record<MascotMood, string> = {
  wave: 'animate-bob',
  idle: 'animate-float-slow',
  thinking: 'animate-float',
  working: 'animate-bob-fast',
  typing: 'animate-bob',
  happy: 'animate-pop',
  alert: 'animate-bounce',
  error: 'animate-shake',
  sleepy: 'animate-float-slow',
  party: 'animate-pop',
}

export function PixelMascot({
  palette,
  frame,
  size = 40,
  className,
  label,
  mood = 'idle',
  animate = true,
}: {
  palette: Record<string, string>
  frame: readonly Px[]
  size?: number
  className?: string
  label: string
  mood?: MascotMood
  animate?: boolean
}): ReactNode {
  return (
    <span
      className={cn('inline-flex shrink-0 select-none', animate && MOOD_ANIMATION[mood], className)}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
        {frame.map(([x, y, w, h, color], index) => (
          <rect key={index} x={x} y={y} width={w} height={h} fill={palette[color] ?? color} />
        ))}
      </svg>
    </span>
  )
}
