import type { Affliction, GameEvent, PieceType, Side, Square } from '../core/types'
import type { RoyalCue } from './royalMotion'
import type { PromotionCue } from './promotionMotion'

export interface ScenePiece {
  id: string
  square: Square
  side: Side
  kind: PieceType
  affliction: Affliction
  countdown?: number
  exposed?: boolean
  curePending?: boolean
}

export interface SceneMark {
  square: Square
  kind: 'selected' | 'move' | 'capture' | 'friendly' | 'last' | 'check' | 'lesson' | 'focus'
}

export interface SceneFocus {
  readonly square: Square
  readonly subject: 'piece' | 'countdown'
  readonly holdEmphasis?: boolean
  /** Stable lesson/step identity; changing the locale must not replay the focus. */
  readonly key: string
}

export interface BoardSceneProps {
  pieces: readonly ScenePiece[]
  marks?: readonly SceneMark[]
  /** Only the latest committed decision's events. A new motion key snaps historical cues. */
  events?: readonly GameEvent[]
  flipped?: boolean
  camera?: 'studio' | 'tactical' | 'top'
  quality?: 'high' | 'low'
  reducedMotion?: boolean
  motionKey?: string
  /** Explicit teaching focus only. Removing it restores the whole-board camera. */
  focus?: SceneFocus
  royal?: RoyalCue
  promotion?: PromotionCue
  onSquare: (square: Square) => void
  onDragSquare?: (from: Square, to: Square) => void
  onFailure: () => void
  loadingLabel?: string
}

export function squarePoint(square: Square): [x: number, z: number] {
  return [square.charCodeAt(0) - 100.5, 4.5 - Number(square[1])]
}

export function worldSquare(x: number, z: number): Square | null {
  const file = Math.floor(x + 4)
  const rank = 8 - Math.floor(z + 4)
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null
  return String.fromCharCode(97 + file) + rank
}

export const stateColors = {
  neutral: '#aaa69a',
  guilt: '#edb65a',
  devastated: '#79bde8',
  berserk: '#ef8758',
  bloodlust: '#e95d7b',
}
