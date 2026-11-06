import type { ReactNode } from 'react'
import { MASCOTS, MASCOT_LABELS, type MascotId, type MascotMood } from '../lib/mascot'
import { PixelMascot, type Px } from './PixelMascot'
import { Helium } from './Helium'
import { Clawd } from './Clawd'

type Expression = 'neutral' | 'focus' | 'happy' | 'alarm' | 'sleepy'

function expression(mood: MascotMood): Expression {
  switch (mood) {
    case 'wave':
    case 'happy':
    case 'party':
      return 'happy'
    case 'thinking':
    case 'working':
    case 'typing':
      return 'focus'
    case 'alert':
    case 'error':
      return 'alarm'
    case 'sleepy':
      return 'sleepy'
    default:
      return 'neutral'
  }
}

const SOL_PALETTE: Record<string, string> = {
  outline: '#8a5a1f',
  body: '#ffcf5c',
  ray: '#e9a23b',
  highlight: '#fff3c4',
  eye: '#3a2a16',
  cheek: '#ff9f8a',
  spark: '#fff7d6',
}

function solFace(kind: Expression): Px[] {
  const eyes: Px[] =
    kind === 'sleepy'
      ? [
          [6, 8, 2, 1, 'eye'],
          [10, 8, 2, 1, 'eye'],
        ]
      : kind === 'happy'
        ? [
            [6, 7, 1, 1, 'eye'],
            [7, 8, 1, 1, 'eye'],
            [10, 8, 1, 1, 'eye'],
            [11, 7, 1, 1, 'eye'],
          ]
        : [
            [6, 7, 1, 2, 'eye'],
            [11, 7, 1, 2, 'eye'],
          ]
  const mouth: Px[] =
    kind === 'alarm'
      ? [[8, 10, 2, 2, 'eye']]
      : kind === 'happy'
        ? [
            [7, 10, 4, 1, 'eye'],
            [8, 11, 2, 1, 'cheek'],
          ]
        : kind === 'focus'
          ? [[8, 11, 3, 1, 'eye']]
          : [[8, 11, 2, 1, 'eye']]
  const extras: Px[] =
    kind === 'alarm'
      ? [
          [2, 2, 1, 2, 'spark'],
          [14, 2, 1, 2, 'spark'],
        ]
      : kind === 'focus'
        ? [[13, 4, 1, 1, 'spark']]
        : []
  return [...eyes, ...mouth, ...extras]
}

function solFrame(mood: MascotMood): Px[] {
  const kind = expression(mood)
  return [
    [2, 5, 2, 2, 'ray'],
    [12, 5, 2, 2, 'ray'],
    [5, 2, 2, 2, 'ray'],
    [9, 2, 2, 2, 'ray'],
    [4, 4, 8, 8, 'outline'],
    [5, 5, 6, 6, 'body'],
    [5, 5, 2, 1, 'highlight'],
    [4, 8, 1, 1, 'cheek'],
    [11, 8, 1, 1, 'cheek'],
    ...solFace(kind),
  ]
}

const BYTE_PALETTE: Record<string, string> = {
  outline: '#33415c',
  body: '#d8e6ff',
  shade: '#a9c3e8',
  screen: '#2f3a4d',
  glow: '#9fd6ff',
  antenna: '#e9a23b',
  cheek: '#ff9f8a',
  spark: '#fff3c4',
}

function byteFace(kind: Expression): Px[] {
  const eyes: Px[] =
    kind === 'sleepy'
      ? [
          [6, 8, 3, 1, 'glow'],
          [10, 8, 3, 1, 'glow'],
        ]
      : kind === 'happy'
        ? [
            [6, 7, 1, 1, 'glow'],
            [7, 8, 1, 1, 'glow'],
            [10, 8, 1, 1, 'glow'],
            [11, 7, 1, 1, 'glow'],
          ]
        : [
            [6, 7, 1, 2, 'glow'],
            [11, 7, 1, 2, 'glow'],
          ]
  const mouth: Px[] =
    kind === 'alarm'
      ? [[8, 10, 2, 2, 'cheek']]
      : kind === 'happy'
        ? [
            [7, 10, 4, 1, 'glow'],
            [8, 11, 2, 1, 'glow'],
          ]
        : [[8, 11, 3, 1, 'glow']]
  const extra: Px[] = kind === 'alarm' ? [[14, 2, 1, 2, 'spark']] : []
  return [...eyes, ...mouth, ...extra]
}

function byteFrame(mood: MascotMood): Px[] {
  const kind = expression(mood)
  return [
    [7, 1, 2, 1, 'antenna'],
    [8, 2, 1, 2, 'antenna'],
    [3, 4, 10, 9, 'outline'],
    [4, 5, 8, 7, 'body'],
    [5, 6, 6, 4, 'screen'],
    [4, 10, 1, 2, 'shade'],
    [11, 10, 1, 2, 'shade'],
    [3, 12, 2, 1, 'outline'],
    [11, 12, 2, 1, 'outline'],
    ...byteFace(kind),
  ]
}

export function Mascot({
  id,
  mood = 'idle',
  size = 40,
  className,
  animate = true,
}: {
  id: MascotId
  mood?: MascotMood
  size?: number
  className?: string
  animate?: boolean
}): ReactNode {
  if (id === 'off') return null
  if (id === 'helium') return <Helium mood={mood} size={size} className={className} animate={animate} />
  if (id === 'clawd') return <Clawd mood={mood} size={size} className={className} />
  const sprite = id === 'sol' ? { palette: SOL_PALETTE, frame: solFrame } : { palette: BYTE_PALETTE, frame: byteFrame }
  return (
    <PixelMascot
      palette={sprite.palette}
      frame={sprite.frame(mood)}
      size={size}
      className={className}
      label={`${MASCOTS[id].label} — ${MASCOT_LABELS[mood]}`}
      mood={mood}
      animate={animate}
    />
  )
}
