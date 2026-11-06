import type { ReactNode } from 'react'
import { HELIUM_LABELS, type HeliumMood } from '../lib/helium'
import { PixelMascot, type Px } from './PixelMascot'

/**
 * Helium is OpenSol's pixel balloon, drawn on the same 16x16 crisp grid as the
 * other mascots.
 */
const PALETTE: Record<string, string> = {
  outline: '#4a3527',
  body: '#ffd9a8',
  shade: '#e9b878',
  highlight: '#fff3dc',
  eye: '#2f241c',
  white: '#ffffff',
  cheek: '#ff9f8a',
  spark: '#ffcf5c',
  ok: '#7ee2b8',
  shadow: 'rgba(0,0,0,0.08)',
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
      return [...halfEyes, [7, 8, 2, 1, 'eye'], [12, 2, 1, 3, 'eye'], [12, 6, 1, 1, 'eye']]
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
      return [...xEyes, [7, 9, 2, 1, 'eye'], [6, 8, 1, 1, 'eye'], [9, 8, 1, 1, 'eye'], [10, 7, 1, 1, 'cheek']]
    case 'sleepy':
      return [...closedEyes, [7, 8, 2, 1, 'eye'], [12, 2, 2, 1, 'shade'], [13, 3, 1, 1, 'shade'], [12, 4, 1, 1, 'shade']]
    default:
      return [...normalEyes, [7, 8, 2, 1, 'eye']]
  }
}

function frame(mood: HeliumMood): Px[] {
  return [
    [5, 15, 6, 1, 'shadow'],
    [3, 1, 10, 11, 'outline'],
    [4, 2, 8, 9, 'body'],
    [5, 3, 2, 1, 'highlight'],
    [5, 4, 1, 2, 'highlight'],
    [4, 10, 8, 1, 'shade'],
    [7, 12, 2, 1, 'outline'],
    [6, 13, 4, 1, 'outline'],
    [8, 14, 1, 1, 'shade'],
    ...face(mood),
  ]
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
    <PixelMascot
      palette={PALETTE}
      frame={frame(mood)}
      size={size}
      className={className}
      label={`Helium — ${label}`}
      mood={mood}
      animate={animate}
    />
  )
}
