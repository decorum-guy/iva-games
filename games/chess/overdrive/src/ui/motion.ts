import type { GameEvent, GameState, PieceType } from '../core'
export interface BoardMotion {
  id: number
  before: GameState
  after: GameState
  events: readonly GameEvent[]
  startedAt: number
  duration: number
}
export interface BoardPoint { readonly x: number; readonly z: number }
export interface PiecePose extends BoardPoint {
  readonly lift: number
  readonly opacity: number
  readonly scale: number
  readonly presentationType: PieceType
  readonly visible: boolean
}
/** All times are milliseconds from BoardMotion.startedAt, shared with audio. */
export interface SceneTiming {
  readonly duration: number
  readonly moveStart: number
  readonly contact: number
  readonly land: number
  readonly followStart: number
  readonly promotionStart: number
  readonly promotionSwap: number
  readonly promotionEnd: number
  readonly captureEnd: number
  readonly resolved: number
  readonly energy: number
  readonly cellFull: number
  readonly result: number
  readonly effectEnd: number
  readonly abilityCue: number
}
export const squarePoint = (square: string): BoardPoint => ({ x: square.charCodeAt(0) - 100.5, z: 4.5 - Number(square[1]) })
const clamp = (value: number) => Math.max(0, Math.min(1, value))
export const progressAt = (elapsed: number, start: number, end: number) => end <= start ? Number(elapsed >= end) : clamp((elapsed - start) / (end - start))
const smooth = (value: number) => value * value * (3 - 2 * value)
const phase = (elapsed: number, start: number, end: number) => smooth(progressAt(elapsed, start, end))
const mix = (from: BoardPoint, to: BoardPoint, step: number): BoardPoint => ({ x: from.x + (to.x - from.x) * step, z: from.z + (to.z - from.z) * step })

export function sceneTiming(events: readonly GameEvent[], reduced = false): SceneTiming {
  const ability = events.find(event => event.type === 'ability')
  const activation = events.some(event => event.type === 'form' && event.cause === 'activate')
  const moving = events.some(event => event.type === 'move')
  const captured = events.some(event => event.type === 'capture')
  const promoted = events.some(event => event.type === 'promotion')
  const earned = events.some(event => event.type === 'energy' && event.captureEarned + event.checkEarned > 0 && event.after > Math.max(0, event.before - event.spent))
  const outcome = events.some(event => event.type === 'outcome')
  const checked = events.some(event => event.type === 'turn' && event.check)
  const factor = reduced ? .25 : 1
  const moveStart = (moving || ability ? activation ? 250 : ability ? 130 : 40 : 0) * factor
  let land = moveStart + (moving ? 310 : 0) * factor
  let contact = land
  let followStart = moveStart
  if (ability) {
    const span = ({ sweep: 560, raid: 680, battery: 730, ram: 690, rotation: 700, cover: 680 } as const)[ability.ability] * factor
    land = moveStart + span
    contact = ability.ability === 'raid' ? moveStart + 330 * factor : ability.ability === 'ram' ? moveStart + 390 * factor : ability.ability === 'sweep' ? moveStart : land
    followStart = ability.ability === 'cover' ? moveStart + span * .58 : ability.ability === 'ram' ? contact : moveStart
  }
  const captureEnd = contact + (captured ? reduced ? 65 : 145 : 0)
  const promotionStart = promoted ? Math.max(land + (reduced ? 70 : 0), captured ? contact + (reduced ? 80 : 86) : land) : land
  const promotionEnd = promotionStart + (promoted ? reduced ? 90 : 240 : 0)
  const promotionSwap = promotionStart + (promotionEnd - promotionStart) * .42
  const resolved = Math.max(land, captureEnd, promotionEnd)
  const energy = resolved + (reduced ? 30 : 55)
  const cellFull = energy + (reduced ? 50 : 130)
  const result = earned ? cellFull + (reduced ? 40 : 120) : resolved + (reduced ? 35 : 80)
  const effectEnd = Math.max(land + (reduced ? 80 : 190), promotionEnd + (reduced ? 40 : 100))
  const duration = Math.max(reduced ? 220 : 420, effectEnd, earned ? cellFull + (reduced ? 50 : 120) : 0, outcome || checked ? result + (reduced ? 100 : outcome ? 340 : 220) : 0)
  return { duration, moveStart, contact, land, followStart, promotionStart, promotionSwap, promotionEnd, captureEnd, resolved, energy, cellFull, result, effectEnd, abilityCue: ability?.ability === 'ram' ? contact : moveStart }
}

export const motionDuration = (events: readonly GameEvent[], reduced: boolean) => sceneTiming(events, reduced).duration
export const readingDuration = (events: readonly GameEvent[], reduced: boolean) => events.some(event => event.type === 'ability' || (event.type === 'form' && event.cause === 'activate')) ? reduced ? 480 : 680 : 180

/** Actor and forced targets share the same event clock; no move is inferred from piece type alone. */
export function piecePoseAt(motion: BoardMotion, pieceId: string, elapsedMs: number, reduced = false): PiecePose | null {
  const before = motion.before.pieces.find(piece => piece.id === pieceId)
  const after = motion.after.pieces.find(piece => piece.id === pieceId)
  const piece = after ?? before
  if (!piece) return null
  const timing = sceneTiming(motion.events, reduced)
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0)
  const movement = motion.events.find((event): event is Extract<GameEvent, { type: 'move' }> => event.type === 'move' && event.pieceId === pieceId)
  const ability = motion.events.find(event => event.type === 'ability')
  const capture = motion.events.find((event): event is Extract<GameEvent, { type: 'capture' }> => event.type === 'capture' && event.victim.id === pieceId)
  const promotion = motion.events.find((event): event is Extract<GameEvent, { type: 'promotion' }> => event.type === 'promotion' && event.pieceId === pieceId)
  const from = squarePoint(before?.square ?? piece.square)
  const to = squarePoint(after?.square ?? piece.square)
  let point = to, lift = 0, opacity = 1, scale = 1
  let presentationType = before?.type ?? piece.type
  if (movement) {
    if (reduced) {
      point = elapsed < timing.land ? from : to
      opacity = elapsed < timing.land ? 1 - progressAt(elapsed, timing.moveStart, timing.land) : progressAt(elapsed, timing.land, timing.land + 70)
    } else if (ability?.ability === 'ram') {
      if (pieceId === ability.targetId) {
        point = mix(from, to, phase(elapsed, timing.contact, timing.land))
      } else {
        const distance = Math.hypot(to.x - from.x, to.z - from.z)
        const touch = { x: to.x - (to.x - from.x) / distance * .64, z: to.z - (to.z - from.z) / distance * .64 }
        point = elapsed < timing.contact ? mix(from, touch, phase(elapsed, timing.moveStart, timing.contact)) : mix(touch, to, phase(elapsed, timing.contact, timing.land))
      }
    } else if (ability?.ability === 'rotation') {
      const step = phase(elapsed, timing.moveStart, timing.land)
      point = mix(from, to, step)
      // Reversed directions give opposite lateral arcs. The pair never occupies the same point.
      const length = Math.hypot(to.x - from.x, to.z - from.z)
      const bow = Math.sin(step * Math.PI) * .38
      point = { x: point.x - (to.z - from.z) / length * bow, z: point.z + (to.x - from.x) / length * bow }
    } else if (ability?.ability === 'cover') {
      const actor = pieceId === ability.pieceId
      const start = actor ? timing.moveStart : timing.followStart
      const end = actor ? timing.moveStart + (timing.land - timing.moveStart) * .52 : timing.land
      point = mix(from, to, phase(elapsed, start, end))
    } else if (ability?.ability === 'battery' && pieceId === ability.pieceId) {
      // Rise in the origin cell before traversing: the foot clears even the 1.1-cell king.
      const riseEnd = timing.moveStart + 130
      const dropStart = timing.land - 140
      point = mix(from, to, phase(elapsed, riseEnd, dropStart))
      lift = 1.35 * phase(elapsed, timing.moveStart, riseEnd) * (1 - phase(elapsed, dropStart, timing.land))
    } else if (ability?.ability === 'raid' && pieceId === ability.pieceId) {
      const victim = motion.events.find((event): event is Extract<GameEvent, { type: 'capture' }> => event.type === 'capture' && event.pieceId === pieceId)
      const middle = victim ? squarePoint(victim.victim.square) : mix(from, to, .5)
      point = elapsed <= timing.contact ? mix(from, middle, phase(elapsed, timing.moveStart, timing.contact)) : mix(middle, to, phase(elapsed, timing.contact, timing.land))
      lift = Math.sin(progressAt(elapsed, timing.moveStart, timing.land) * Math.PI) * .88
    } else {
      const step = phase(elapsed, timing.moveStart, timing.land)
      point = mix(from, to, step)
      const castleRook = movement.forced && movement.pieceType === 'rook' && !ability && motion.events.some(event =>
        event.type === 'move' && !event.forced && event.pieceType === 'king' && event.side === movement.side &&
        Math.abs(event.from.charCodeAt(0) - event.to.charCodeAt(0)) === 2)
      if (castleRook) {
        const span = timing.land - timing.moveStart
        const clearAt = timing.moveStart + span * .18
        const returnAt = timing.moveStart + span * .82
        point = mix(from, to, phase(elapsed, clearAt, returnAt))
        // The outward lane avoids both the king and second-rank pieces. The .31-cell
        // foot radius stays inside the 4.56-cell chassis edge: 3.5 + .72 + .31 = 4.53.
        const lane = phase(elapsed, timing.moveStart, clearAt) * (1 - phase(elapsed, returnAt, timing.land))
        point = { ...point, z: point.z + (movement.side === 'white' ? 1 : -1) * .72 * lane }
      }
      if (!movement.forced && movement.pieceType === 'knight') lift = Math.sin(step * Math.PI) * .76
    }
  }
  if (capture || !after) {
    point = from
    const fade = progressAt(elapsed, timing.contact, timing.captureEnd)
    opacity = 1 - fade
    scale = reduced ? 1 : 1 - fade * .12
    lift = 0
  }
  if (promotion && before) {
    const changeAt = timing.promotionSwap
    if (elapsed < timing.promotionStart) presentationType = before.type
    else if (elapsed < changeAt) {
      presentationType = before.type
      opacity = 1 - progressAt(elapsed, timing.promotionStart, changeAt)
    } else {
      presentationType = after?.type ?? promotion.promotion
      const appear = progressAt(elapsed, changeAt, timing.promotionEnd)
      opacity = appear
      scale = reduced ? 1 : .92 + .08 * smooth(appear)
    }
  } else if (after) presentationType = after.type
  return { ...point, lift, opacity, scale, presentationType, visible: opacity > .001 }
}

/** Contact particles and trails fade completely before the scene releases input. */
export function effectStrengthAt(timing: SceneTiming, elapsedMs: number): number {
  const attack = Math.min(75, (timing.effectEnd - timing.moveStart) / 5)
  return progressAt(elapsedMs, timing.moveStart, timing.moveStart + attack) * (1 - progressAt(elapsedMs, timing.land, timing.effectEnd))
}

/** Expands the actual power collar and drives its material; unrelated pieces stay still. */
export function activationPulseAt(motion: BoardMotion, pieceId: string, elapsedMs: number, reduced = false): number {
  if (!motion.events.some(event => event.type === 'form' && event.cause === 'activate' && event.pieceId === pieceId)) return 0
  const timing = sceneTiming(motion.events, reduced)
  const end = Math.min(timing.land, reduced ? 150 : 520)
  const progress = progressAt(elapsedMs, 0, end)
  return progress <= 0 || progress >= 1 ? 0 : Math.sin(progress * Math.PI) ** 2
}

export interface MotionTrail {
  readonly pieceId: string
  readonly showAt: number
  readonly points: readonly (BoardPoint & { readonly lift: number })[]
}
/** Trails are sampled from the very same trajectories as the pieces, including sweep's target. */
export function motionTrails(motion: BoardMotion, reduced = false): readonly MotionTrail[] {
  const ability = motion.events.find(event => event.type === 'ability')
  if (!ability || reduced) return []
  const timing = sceneTiming(motion.events, false)
  return motion.events.filter(event => event.type === 'move').map(event => {
    const showAt = ability.ability === 'ram' && event.forced ? timing.contact : ability.ability === 'cover' && event.forced ? timing.followStart : timing.moveStart
    const points = Array.from({ length: 33 }, (_, index) => {
      const pose = piecePoseAt(motion, event.pieceId, showAt + (timing.land - showAt) * index / 32)!
      return { x: pose.x, z: pose.z, lift: pose.lift }
    })
    return { pieceId: event.pieceId, showAt, points }
  })
}
