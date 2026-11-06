import type { ReactNode } from 'react'
import { HELIUM_LABELS, type HeliumMood } from '../lib/helium'
import { cn } from '../lib/utils'

/**
 * Helium is MaxCode's little pixel balloon. Every mood is drawn on the same
 * 16×16 crisp-edges grid so the sprite never blurs as it scales.
 */
const PALETTE = {
  outline: '#3b3a55',
  body: '#b9c6ff',
  shade: '#93a4ef',
  highlight: '#e3e9ff',
  eye: '#2a2938',
  white: '#ffffff',
  cheek: '#ffaec0',
  spark: '#ffd166',
  ok: '#7ee2b8',
} as const

type Px = readonly [x: number, y: number, w: number, h: number, color: keyof typeof PALETTE]

const MOOD_ANIMATION: Record<HeliumMood, string> = {
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

const normalEyes: Px[] = [
  [5, 5, 2, 2, 'white'],
  [9, 5, 2, 2, 'white'],
  [6, 6, 1, 1, 'eye'],
  [9, 6, 1, 1, 'eye'],
]

const arcEyes: Px[] = [
  [5, 6, 1, 1, 'eye'],
  [6, 5, 1, 1, 'eye'],
  [10, 6, 1, 1, 'eye'],
  [9, 5, 1, 1, 'eye'],
]

const closedEyes: Px[] = [
  [5, 6, 2, 1, 'eye'],
  [9, 6, 2, 1, 'eye'],
]

const halfEyes: Px[] = [
  [5, 5, 2, 2, 'white'],
  [6, 6, 1, 1, 'eye'],
  [9, 6, 2, 1, 'white'],
  [10, 6, 1, 1, 'eye'],
]

const xEyes: Px[] = [
  [5, 5, 1, 1, 'eye'],
  [6, 6, 1, 1, 'eye'],
  [6, 5, 1, 1, 'eye'],
  [5, 6, 1, 1, 'eye'],
  [9, 5, 1, 1, 'eye'],
  [10, 6, 1, 1, 'eye'],
  [10, 5, 1, 1, 'eye'],
  [9, 6, 1, 1, 'eye'],
]

function face(mood: HeliumMood): Px[] {
  switch (mood) {
    case 'wave':
      return [
        ...arcEyes,
        [6, 8, 4, 1, 'eye'],
        [7, 9, 2, 1, 'eye'],
        [4, 8, 1, 1, 'cheek'],
        [11, 8, 1, 1, 'cheek'],
        [12, 5, 1, 1, 'body'],
        [13, 4, 1, 2, 'body'],
        [12, 3, 1, 1, 'body'],
      ]
    case 'happy':
      return [
        ...arcEyes,
        [6, 8, 4, 1, 'eye'],
        [7, 9, 2, 1, 'cheek'],
        [4, 7, 1, 1, 'cheek'],
        [11, 7, 1, 1, 'cheek'],
      ]
    case 'party':
      return [
        ...arcEyes,
        [6, 8, 4, 1, 'eye'],
        [7, 9, 2, 1, 'eye'],
        [7, 0, 2, 1, 'spark'],
        [6, 1, 4, 1, 'spark'],
        [1, 3, 1, 1, 'cheek'],
        [14, 2, 1, 1, 'ok'],
        [2, 12, 1, 1, 'spark'],
        [13, 11, 1, 1, 'cheek'],
      ]
    case 'thinking':
      return [
        ...halfEyes,
        [7, 8, 2, 1, 'eye'],
        [12, 2, 1, 3, 'eye'],
        [12, 6, 1, 1, 'eye'],
      ]
    case 'working':
      return [
        ...halfEyes,
        [7, 8, 2, 1, 'eye'],
        [1, 6, 1, 1, 'spark'],
        [1, 7, 1, 1, 'spark'],
        [14, 6, 1, 1, 'spark'],
        [14, 7, 1, 1, 'spark'],
        [11, 3, 1, 1, 'spark'],
      ]
    case 'typing':
      return [
        ...normalEyes,
        [7, 8, 2, 1, 'eye'],
        [8, 9, 1, 1, 'eye'],
        [13, 2, 1, 1, 'spark'],
        [2, 3, 1, 1, 'spark'],
        [13, 10, 1, 1, 'spark'],
      ]
    case 'alert':
      return [
        [5, 5, 2, 2, 'white'],
        [9, 5, 2, 2, 'white'],
        [6, 5, 1, 1, 'eye'],
        [10, 5, 1, 1, 'eye'],
        [7, 8, 2, 2, 'eye'],
        [4, 8, 1, 1, 'cheek'],
        [11, 8, 1, 1, 'cheek'],
        [12, 2, 1, 3, 'spark'],
        [12, 6, 1, 1, 'spark'],
      ]
    case 'error':
      return [
        ...xEyes,
        [7, 9, 2, 1, 'eye'],
        [6, 8, 1, 1, 'eye'],
        [9, 8, 1, 1, 'eye'],
        [10, 7, 1, 1, 'cheek'],
      ]
    case 'sleepy':
      return [
        ...closedEyes,
        [7, 8, 2, 1, 'eye'],
        [12, 2, 2, 1, 'shade'],
        [13, 3, 1, 1, 'shade'],
        [12, 4, 1, 1, 'shade'],
      ]
    default:
      return [...normalEyes, [7, 8, 2, 1, 'eye']]
  }
}

export function Helium({
  mood = 'idle',
  size = 40,
  className,
  animate = true,
}: {
  mood?: HeliumMood
  size?: number
  className?: string
  animate?: boolean
}): ReactNode {
  const label = HELIUM_LABELS[mood]
  return (
    <span
      className={cn('inline-flex shrink-0 select-none', animate && MOOD_ANIMATION[mood], className)}
      role="img"
      aria-label={`Helium — ${label}`}
      title={`Helium — ${label}`}
    >
      <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
        <rect x={5} y={15} width={6} height={1} fill="#000000" opacity={0.07} />
        <rect x={3} y={1} width={10} height={11} fill={PALETTE.outline} />
        <rect x={4} y={2} width={8} height={9} fill={PALETTE.body} />
        <rect x={5} y={3} width={2} height={1} fill={PALETTE.highlight} />
        <rect x={5} y={4} width={1} height={2} fill={PALETTE.highlight} />
        <rect x={4} y={10} width={8} height={1} fill={PALETTE.shade} />
        <rect x={7} y={12} width={2} height={1} fill={PALETTE.outline} />
        <rect x={6} y={13} width={4} height={1} fill={PALETTE.outline} />
        <rect x={8} y={14} width={1} height={1} fill={PALETTE.shade} />
        {face(mood).map(([x, y, w, h, color], index) => (
          <rect key={index} x={x} y={y} width={w} height={h} fill={PALETTE[color]} />
        ))}
      </svg>
    </span>
  )
}
