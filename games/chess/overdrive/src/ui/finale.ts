import type { GameEvent, GameState, Piece } from '../core'
import { squarePoint } from './motion'
import baked from './finale-contacts.json'

interface Direction {
  dx: number
  dz: number
  rim: number
  floor: number
  bounds: number[]
  contacts: Record<string, Record<string, number> | undefined>
}
const directions = baked as Direction[]

export interface KingFall {
  king: string
  support: string | null
  dx: number
  dz: number
  rim: number
  angle: number
  contactMs: number
  duration: number
}

/** Contacts are swept triangle pairs from the production GLBs; the table also
 * includes the outer footprint through the entire tip, in board coordinates. */
export function planKingFall(state: GameState): KingFall | null {
  const result = state.outcome
  if (result?.reason !== 'checkmate' || !result.winner) return null
  const king = state.pieces.find(p => p.type === 'king' && p.side !== result.winner)
  if (!king) return null
  const origin = squarePoint(king.square)
  const neighbours = new Map<string, Piece>()
  for (const piece of state.pieces) {
    const at = squarePoint(piece.square)
    neighbours.set([at.x-origin.x, at.z-origin.z].join(','), piece)
  }
  let best: KingFall | null = null
  for (const direction of directions) {
    const {dx, dz, rim, bounds} = direction
    if (origin.x+bounds[0] < -4 || origin.x+bounds[1] > 4 || origin.z+bounds[2] < -4 || origin.z+bounds[3] > 4) continue
    let angle = direction.floor
    let support: string | null = null
    for (const [cell, stops] of Object.entries(direction.contacts)) {
      const piece = neighbours.get(cell)
      if (!piece || !stops) continue
      const hit = stops[piece.type === 'knight' ? 'knight-'+piece.side : piece.type]
      if (hit < angle) { angle = hit; support = piece.id }
    }
    if (best && support && angle <= best.angle) continue
    const contactMs = 930 * Math.sqrt(angle / direction.floor)
    best = {king: king.id, support, dx, dz, rim, angle, contactMs, duration: contactMs+480}
    if (!support) break
  }
  return best
}

/** A terminal snapshot has a pose, but only this edge gets a playback key. */
export function checkmateEdge(gameId: string, before: GameState, after: GameState, events: readonly GameEvent[]) {
  if (before.outcome || after.outcome?.reason !== 'checkmate') return null
  const result = events.find(e => e.type === 'outcome' && e.outcome.reason === 'checkmate' && e.outcome.winner === after.outcome?.winner)
  return result ? JSON.stringify([gameId, result.id]) : null
}

export function rimPose(dx: number, dz: number, rim: number, angle: number, drop: number) {
  const travel = rim * (1-Math.cos(angle))
  return {x: dx*travel, y: rim*Math.sin(angle)-drop, z: dz*travel, angle}
}

export function fallAngles(plan: KingFall, elapsed: number) {
  if (elapsed >= plan.duration) return {king: plan.angle, neighbour: 0}
  const t = Math.min(1, Math.max(0, elapsed / plan.contactMs))
  if (t < 1) return {king: plan.angle * t*t*(.34+.66*t), neighbour: 0}
  // Each rebound leaves the contact plane, then returns with less energy.
  // The neighbour rocks away from the incoming king and returns to its foot.
  const since = elapsed-plan.contactMs
  const rebound = (start: number, length: number) => {
    const u = Math.max(0, Math.min(1, (since-start)/length))
    return 4*u*(1-u)
  }
  return {
    king: plan.angle - .059*rebound(0, 220) - .011*rebound(220, 128),
    neighbour: plan.support ? .078*rebound(0, 300) + .013*rebound(300, 180) : 0,
  }
}

export interface FallPlayback {
  readonly key: string
  readonly startsAt: number
  readonly onContact: (support: boolean) => void
  elapsed: number
  previousFrame: number | null
  settled: boolean
}

export function stepFall(playback: FallPlayback, plan: KingFall, now: number) {
  if (playback.settled || now < playback.startsAt) return
  const previous = Math.max(playback.startsAt, playback.previousFrame ?? now)
  playback.previousFrame = now
  const was = playback.elapsed
  // Analytic motion has no integration drift. Cap visual advance after stalls.
  playback.elapsed = Math.min(plan.duration, was + Math.max(0, Math.min(48, now-previous)))
  if (was < plan.contactMs && playback.elapsed >= plan.contactMs) playback.onContact(!!plan.support)
  playback.settled = playback.elapsed >= plan.duration
}
