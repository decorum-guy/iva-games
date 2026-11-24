import type { GameEvent, GameState, Side, Square } from '../core/types'

export interface RoyalAction {
  readonly id: string
  readonly kind: 'check' | 'mate'
  readonly square: Square
  readonly pieceId: string
  readonly side: Side
  readonly tone: 'win' | 'loss' | 'neutral'
  readonly reduced: boolean
  readonly fromPromotion?: boolean
  readonly continuingCamera?: boolean
}

export interface RoyalCue extends RoyalAction {
  readonly startedAt: number
}

/** Only a live, completed turn can originate an episode. Position review uses the resting mark. */
export function royalAction(state: GameState, events: readonly GameEvent[], human: Side | null, reduced: boolean): RoyalAction | null {
  const boundary = events.find(event => event.type === 'turn' && event.check)
  if (!boundary || boundary.type !== 'turn' || state.phase !== 'primary') return null
  const king = state.pieces.find(piece => piece.type === 'king' && piece.side === boundary.side)
  if (!king) return null
  const mate = state.outcome?.reason === 'checkmate' ? state.outcome : null
  return {
    id: boundary.id, kind: mate ? 'mate' : 'check', square: king.square, pieceId: king.id, side: king.side, reduced,
    tone: mate && human ? mate.winner === human ? 'win' : 'loss' : 'neutral',
  }
}

/** Board movement and material transitions get their own time before the king takes focus. */
export function royalLeadIn(events: readonly GameEvent[], baseMs: number, rollSettledAt: number | null, reduced: boolean) {
  if (reduced) return baseMs
  if (rollSettledAt !== null) return Math.max(baseMs, rollSettledAt + 615)
  if (events.every(event => event.type === 'turn' || event.type === 'outcome')) return 145
  return 625
}

export function royalTiming({ kind, reduced, fromPromotion }: RoyalAction) {
  if (kind === 'check') return reduced ? { duration: 880, impact: 280, resolution: 680 }
    : { duration: 990, impact: 243, resolution: 760 }
  if (fromPromotion && !reduced) return { duration: 2820, impact: 715, resolution: 1930 }
  return reduced ? { duration: 2680, impact: 1020, resolution: 2080 }
    : { duration: 3330, impact: 1030, resolution: 2370 }
}

export const clampUnit = (value: number) => Math.max(0, Math.min(1, value))
export const promotionRoyalLead = (kind: RoyalAction['kind']) => kind === 'mate' ? .22 : .12
export function easeRange(from: number, to: number, value: number) {
  const t = clampUnit((value - from) / (to - from))
  return t * t * (3 - 2 * t)
}

/** Sample the same wall clock in every renderer, including when resized or mounted mid-episode. */
export function sampleRoyal(cue: RoyalAction, elapsed: number) {
  const { duration, impact, resolution } = royalTiming(cue)
  const mate = cue.kind === 'mate'
  const reduced = cue.reduced
  const afterImpact = elapsed - impact
  const charge = easeRange(0, impact, elapsed)
  const discharge = easeRange(reduced ? -75 : -26, reduced ? 185 : 22, afterImpact) *
    (1 - easeRange(reduced ? 220 : 58, reduced ? 650 : mate ? 640 : 303, afterImpact))
  const decay = 1 - easeRange(impact + (mate ? 165 : 20), resolution, elapsed)
  const surface = (charge * (mate ? .68 : .73) * decay + discharge * (mate ? 1.13 : .77)) *
    (reduced ? .78 : 1)
  const wave = clampUnit(afterImpact / (mate ? 1170 : 485))
  const cameraLead = cue.continuingCamera ? promotionRoyalLead(cue.kind) : 0
  const camera = reduced ? 0 : (cameraLead + (1 - cameraLead) * easeRange(0, mate ? impact - 10 : 292, elapsed)) *
    (1 - easeRange(mate ? resolution - 280 : 425, duration - 20, elapsed))
  const recoil = reduced || !mate ? 0 :
    easeRange(0, 66, afterImpact) * (1 - easeRange(69, 265, afterImpact))
  return {
    surface, sweep: charge, discharge, camera, recoil,
    dusk: mate ? easeRange(0, impact * .84, elapsed) * (1 - easeRange(resolution - 350, duration - 60, elapsed)) : 0,
    contact: (.35 * charge * decay + .90 * discharge) * (reduced ? .65 : 1),
    wave, waveStrength: reduced ? 0 : easeRange(0, 46, afterImpact) * (1 - easeRange(.24, 1, wave)),
    flight: reduced ? -1 : afterImpact * .001,
  }
}

/** The body meets the board after the crown discharge, on its own audio marker. */
export function mateGroundContact(cue: RoyalAction) {
  return royalTiming(cue).impact + (cue.reduced ? 410 : 670)
}

/** Fraction of the support angle. Impact carries angular velocity into a small rebound. */
export function sampleMateFall(cue: RoyalAction, elapsed: number) {
  if (cue.kind !== 'mate') return 0
  const { impact } = royalTiming(cue)
  const contact = mateGroundContact(cue)
  if (cue.reduced) return easeRange(impact + 160, contact, elapsed)
  if (elapsed < impact) return .028 * easeRange(impact - 180, impact, elapsed)
  const t = clampUnit((elapsed - impact) / (contact - impact))
  if (elapsed <= contact) return .028 + .972 * (.055 * t + .945 * t * t)
  const age = elapsed - contact
  if (age >= 310) return 1
  return 1 - .072 * Math.abs(Math.sin(age * Math.PI / 155)) * Math.exp(-age / 110)
}
