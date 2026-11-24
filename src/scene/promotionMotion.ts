import type { Promotion, Side, Square } from '../core/types'
import { clampUnit, easeRange } from './royalMotion'
import type { RoyalAction } from './royalMotion'

export interface PromotionCue {
  readonly id: string
  readonly pieceId: string
  readonly square: Square
  readonly side: Side
  readonly kind: Promotion
  readonly startedAt: number
  readonly reduced: boolean
  readonly intoRoyal: boolean
  readonly royalFollowup?: Pick<RoyalAction, 'kind' | 'square'>
}

export function promotionFamily(kind: Promotion) {
  return kind === 'queen' ? 'queen' : kind === 'rook' ? 'rook' : 'formation'
}

export function promotionTiming(kind: Promotion, reduced: boolean) {
  if (reduced) {
    return kind === 'queen' ? { impact: 180, duration: 1040 }
      : kind === 'rook' ? { impact: 135, duration: 590 } : { impact: 180, duration: 390 }
  }
  return kind === 'queen' ? { impact: 690, duration: 2260 }
    : kind === 'rook' ? { impact: 550, duration: 1380 } : { impact: 670, duration: 960 }
}

/** All renderers sample the same committed clock, including after resizing or switching view. */
export function samplePromotion(cue: PromotionCue, elapsed: number, limitMotion = cue.reduced) {
  const { impact, duration } = promotionTiming(cue.kind, cue.reduced)
  const family = promotionFamily(cue.kind)
  const formation = family === 'formation'
  const queen = family === 'queen'
  const after = elapsed - impact
  const charge = easeRange(0, impact, elapsed)
  const contact = easeRange(-37, 28, after) * (1 - easeRange(80, queen ? 690 : 365, after))
  const wave = clampUnit(after / (queen ? 1050 : 610))
  const waveLight = (limitMotion ? .55 : 1) * easeRange(0, 55, after) * (1 - easeRange(.24, 1, wave))
  const crackAlpha = queen
    ? easeRange(-12, 55, after) * (1 - easeRange(cue.reduced ? 225 : 680, duration - impact - 36, after)) : 0
  const crackReach = limitMotion ? 1 : clampUnit(after / 270)
  const height = limitMotion ? 0 : formation
    ? .18 * Math.sin(charge * Math.PI) * (1 - easeRange(0, 190, after))
    : (queen ? 1.64 : 1.34) * (1 - clampUnit((elapsed - impact * .30) / (impact * .70)) ** 2.85)
      + (queen ? .059 : .046) * easeRange(0, 64, after) * (1 - easeRange(64, 186, after))
  const recoil = limitMotion ? 0 : easeRange(0, 38, after) * (1 - easeRange(45, 215, after))
  const approach = easeRange(0, impact, elapsed) * (1 - easeRange(impact + (queen ? 360 : 80), duration - 20, elapsed))
  const reveal = limitMotion ? easeRange(0, impact + 120, elapsed)
    : formation ? easeRange(40, impact + 38, elapsed) : easeRange(20, impact * .72, elapsed)
  const arc = queen && !limitMotion
    ? easeRange(-95, 8, after) * (1 - easeRange(32, 338, after)) : 0
  const airLight = limitMotion ? 0 : easeRange(28, 182, elapsed) * easeRange(.12, .92, height)
  const depthView = queen && !limitMotion
    ? easeRange(-100, 390, after) * (1 - easeRange(720, duration - impact - 35, after)) : 0
  return { family, charge, contact, wave, waveLight, crackAlpha, crackReach, height, recoil, reveal, arc, airLight,
    depthView, handoff: limitMotion ? 0 : easeRange(duration - 510, duration - 12, elapsed),
    approach: limitMotion ? 0 : approach, flight: limitMotion ? -1 : after / 1000,
  }
}

export type FloorPoint = readonly [number, number]
export interface FracturePoint {
  readonly position: FloorPoint
  readonly at: number
  readonly width: number
}
export type Fracture = readonly (readonly FracturePoint[])[]

export function sceneRandom(id: string) {
  let seed = 2166136261
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619)
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const inlay = (v: number) => Math.max(-3.98, Math.min(3.98, v))

export function fractureBanks(path: readonly FracturePoint[]) {
  return path.map(({ position: [x, z], width }, i) => {
    const [ax, az] = path[Math.max(0, i - 1)].position
    const [bx, bz] = path[Math.min(path.length - 1, i + 1)].position
    const span = Math.hypot(bx - ax, bz - az) || 1
    const nx = (az - bz) / span
    const nz = (bx - ax) / span
    return [-1.39, -.65, .49, 1.44].map(side =>
      [inlay(x + side * width * nx), inlay(z + side * width * nz)] as FloorPoint)
  })
}
