import type { Promotion } from '../core/types'
import { promotionTiming } from './promotionMotion'

const reactionEdits: Readonly<Record<string, readonly [start: number, end: number, gainDb: number, fadeOut: number]>> = {
  'r1-guilt': [0, 1.40, -8, .23],
  'r1-devastated': [.29, 1.67, -8, .24],
  'r1-berserk': [.40, 1.66, -12, .24],
  'r1-bloodlust': [.57, 1.98, -8, .25],
  'r2-guilt': [.22, 1.433, -8, .25],
  'r2-devastated': [.16, 1.20, -2, .20],
  'r2-berserk': [.36, 1.20, -2, .20],
  'r2-bloodlust': [0, 1.54, -7, .24],
}

export const promotionGain: Readonly<Record<string, number>> = {
  'p1-formation': -8, 'p2-formation': -5, 'p1-rook': -6, 'p2-rook': -8,
  'p1-queen': -6, 'p2-queen': -8, 'p1-queen-fracture-only': -6,
}

export function reactionMontage(id: string, at: number) {
  const edit = reactionEdits[id]
  if (!edit) return undefined
  const [offset, end, decibels, fadeOut] = edit
  return { at, offset, duration: end - offset, decibels, fadeIn: .014, fadeOut }
}

export function promotionMontage(kind: Promotion, reduced: boolean, formationAt: number, clip: {
  seconds: number; marker: number; decibels: number; formation: boolean;
}) {
  const { impact, duration } = promotionTiming(kind, reduced)
  const target = clip.formation ? reduced ? .055 : .15 : impact / 1000
  const lead = Math.max(0, target - clip.marker)
  const offset = Math.max(0, clip.marker - target)
  return { at: formationAt / 1000 + lead, offset,
    duration: Math.min(clip.seconds - offset, duration / 1000 - lead),
    decibels: clip.decibels, fadeIn: .014,
    fadeOut: reduced ? .14 : kind === 'queen' ? .32 : .22 }
}
