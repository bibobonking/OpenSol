import type { ReactNode } from 'react'
import { PIXLE_LABELS, type PixleMood } from '../lib/pixlesol'
import { cn } from '../lib/utils'

/**
 * PixleSol is OpenSol's pixel sun. Everything is drawn on one 16×16 crisp-edges
 * grid so the sprite stays sharp at any size. Rays are split into two sets
 * (plus / diagonal) that swap in "busy" moods to give a pixel-art twinkle
 * without ever rotating (rotation would blur the pixels).
 */
const PALETTE = {
  outline: '#6b3410',
  body: '#fbbf24',
  shade: '#f59e0b',
  highlight: '#fef3c7',
  ray: '#f59e0b',
  eye: '#1a0f06',
  mark: '#4a2508',
  blush: '#fb7185',
  sweat: '#38bdf8',
  mint: '#34d399',
  sky: '#60a5fa',
  rose: '#fb7185',
} as const

type Px = readonly [x: number, y: number, w: number, h: number, color: keyof typeof PALETTE]

const MOOD_ANIMATION: Record<PixleMood, string> = {
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

const TWINKLE = new Set<PixleMood>(['thinking', 'working', 'typing', 'party', 'wave'])

// Body mask: a rounded 8×8 disc centred on (8, 8).
const BODY_ROWS: Array<[y: number, x0: number, x1: number]> = [
  [4, 6, 9],
  [5, 5, 10],
  [6, 4, 11],
  [7, 4, 11],
  [8, 4, 11],
  [9, 4, 11],
  [10, 5, 10],
  [11, 6, 9],
]

const BODY = new Set<string>()
for (const [y, x0, x1] of BODY_ROWS) for (let x = x0; x <= x1; x++) BODY.add(`${x},${y}`)

const OUTLINE: Array<[number, number]> = []
for (let y = 2; y <= 13; y++) {
  for (let x = 2; x <= 13; x++) {
    if (BODY.has(`${x},${y}`)) continue
    const touches =
      BODY.has(`${x - 1},${y}`) || BODY.has(`${x + 1},${y}`) || BODY.has(`${x},${y - 1}`) || BODY.has(`${x},${y + 1}`)
    if (touches) OUTLINE.push([x, y])
  }
}

const RAYS_PLUS: Px[] = [
  [7, 0, 2, 2, 'ray'],
  [7, 14, 2, 2, 'ray'],
  [0, 7, 2, 2, 'ray'],
  [14, 7, 2, 2, 'ray'],
]
const RAYS_DIAG: Px[] = [
  [2, 2, 1, 1, 'ray'],
  [13, 2, 1, 1, 'ray'],
  [2, 13, 1, 1, 'ray'],
  [13, 13, 1, 1, 'ray'],
  [3, 3, 1, 1, 'ray'],
  [12, 3, 1, 1, 'ray'],
  [3, 12, 1, 1, 'ray'],
  [12, 12, 1, 1, 'ray'],
]

/**
 * PixleSol has no mouth. Its eyes are always plain black dots; mood is carried by
 * where the dots look, how big they are, small marks beside the sun (?, !, z,
 * a sweat drop, confetti) and how the rays behave.
 */
type EyeSize = 'sm' | 'md' | 'lg' | 'flat'

function eyes(size: EyeSize, dx = 0, dy = 0): Px[] {
  const [w, h] = size === 'sm' ? [1, 1] : size === 'md' ? [1, 2] : size === 'lg' ? [2, 2] : [2, 1]
  const y = (size === 'sm' ? 8 : size === 'flat' ? 8 : 7) + dy
  const left = size === 'lg' || size === 'flat' ? 5 : 6
  const right = size === 'lg' || size === 'flat' ? 9 : 9
  return [
    [left + dx, y, w, h, 'eye'],
    [right + dx, y, w, h, 'eye'],
  ]
}

const BLUSH: Px[] = [
  [4, 9, 1, 1, 'blush'],
  [11, 9, 1, 1, 'blush'],
]

interface Look {
  eyes: Px[]
  extras: Px[]
  /** Hide the diagonal rays so marks beside the sun stay readable. */
  clearCorner?: boolean
  /** Extra class on the eye group (blink / scan animation). */
  eyeClass?: string
}

function look(mood: PixleMood): Look {
  switch (mood) {
    case 'wave':
      return { eyes: eyes('md'), extras: BLUSH, eyeClass: 'pxs-blink' }
    case 'happy':
      return {
        eyes: eyes('lg'),
        extras: [...BLUSH, [13, 1, 1, 3, 'ray'], [12, 2, 3, 1, 'ray']],
        clearCorner: true,
      }
    case 'party':
      return {
        eyes: eyes('lg'),
        extras: [
          [1, 3, 1, 1, 'rose'],
          [14, 2, 1, 1, 'mint'],
          [0, 11, 1, 1, 'sky'],
          [15, 12, 1, 1, 'rose'],
          [4, 0, 1, 1, 'mint'],
          [11, 0, 1, 1, 'sky'],
          [2, 14, 1, 1, 'mint'],
          [13, 14, 1, 1, 'rose'],
        ],
        clearCorner: true,
      }
    case 'thinking':
      return {
        eyes: eyes('md', 1, -1),
        extras: [
          [10, 1, 1, 1, 'mark'],
          [12, 1, 1, 1, 'mark'],
          [14, 1, 1, 1, 'mark'],
        ],
        clearCorner: true,
      }
    case 'working':
      return { eyes: eyes('sm', 0, 1), extras: [], eyeClass: 'pxs-scan' }
    case 'typing':
      return { eyes: eyes('md', 0, 1), extras: [], eyeClass: 'pxs-scan' }
    case 'alert':
      return {
        eyes: eyes('lg'),
        extras: [
          [13, 0, 1, 3, 'mark'],
          [13, 4, 1, 1, 'mark'],
        ],
        clearCorner: true,
      }
    case 'error':
      return {
        eyes: eyes('sm', 0, 1),
        extras: [
          [12, 3, 1, 1, 'sweat'],
          [12, 4, 1, 2, 'sweat'],
        ],
        clearCorner: true,
      }
    case 'sleepy':
      return {
        eyes: eyes('flat'),
        extras: [
          [12, 1, 4, 1, 'mark'],
          [14, 2, 1, 1, 'mark'],
          [13, 3, 1, 1, 'mark'],
          [12, 4, 4, 1, 'mark'],
        ],
        clearCorner: true,
      }
    default:
      return { eyes: eyes('md'), extras: [], eyeClass: 'pxs-blink' }
  }
}

export function PixleSol({
  mood = 'idle',
  size = 40,
  className,
  animate = true,
}: {
  mood?: PixleMood
  size?: number
  className?: string
  animate?: boolean
}): ReactNode {
  const label = PIXLE_LABELS[mood]
  const twinkle = animate && TWINKLE.has(mood)
  const face = look(mood)
  return (
    <span
      className={cn('inline-flex shrink-0 select-none', animate && MOOD_ANIMATION[mood], className)}
      role="img"
      aria-label={`PixleSol — ${label}`}
      title={`PixleSol — ${label}`}
    >
      <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
        <g className={twinkle ? 'pxs-a' : undefined}>
          {RAYS_PLUS.map(([x, y, w, h, c], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} fill={PALETTE[c]} />
          ))}
        </g>
        <g className={twinkle ? 'pxs-b' : undefined} opacity={face.clearCorner ? 0.35 : undefined}>
          {RAYS_DIAG.map(([x, y, w, h, c], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} fill={PALETTE[c]} />
          ))}
        </g>
        {OUTLINE.map(([x, y]) => (
          <rect key={`o${x},${y}`} x={x} y={y} width={1} height={1} fill={PALETTE.outline} />
        ))}
        {BODY_ROWS.map(([y, x0, x1]) => (
          <rect key={`b${y}`} x={x0} y={y} width={x1 - x0 + 1} height={1} fill={PALETTE.body} />
        ))}
        <rect x={5} y={11} width={6} height={1} fill={PALETTE.shade} />
        <rect x={9} y={10} width={2} height={1} fill={PALETTE.shade} />
        <rect x={6} y={4} width={2} height={1} fill={PALETTE.highlight} />
        <rect x={5} y={5} width={1} height={1} fill={PALETTE.highlight} />
        <g className={animate ? face.eyeClass : undefined}>
          {face.eyes.map(([x, y, w, h, color], index) => (
            <rect key={index} x={x} y={y} width={w} height={h} fill={PALETTE[color]} />
          ))}
        </g>
        {face.extras.map(([x, y, w, h, color], index) => (
          <rect key={`x${index}`} x={x} y={y} width={w} height={h} fill={PALETTE[color]} />
        ))}
      </svg>
    </span>
  )
}
