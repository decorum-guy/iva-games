import type { GameEvent, GameState } from '../core/types'

/**
 * A temporary Board-only view while a committed die result is concealed.
 * Coordinates, membership, type, side and movement rights remain current;
 * the previous identities supply only the not-yet-revealed condition.
 * This is deliberately not an authoritative/necessarily legal position.
 */
export function maskRollResult(current: GameState, previous: GameState): GameState {
  const beforeById = new Map(previous.pieces.map(piece => [piece.id, piece]))
  return {
    ...current,
    outcome: null,
    pieces: current.pieces.map(piece => {
      const before = beforeById.get(piece.id)
      if (!before) return piece
      return {
        ...piece,
        affliction: before.affliction,
        captureReaction: before.captureReaction,
        capturesSinceRebirth: before.capturesSinceRebirth,
        devastationDue: before.devastationDue,
        cureArmedAt: before.cureArmedAt,
        shameArmedAt: before.shameArmedAt,
      }
    }),
  }
}

/** Keep these disjoint slices for the action's lifetime, so reveal cannot replay a capture ghost. */
export function rollSceneEvents(events: readonly GameEvent[], phase: 'concealed' | 'revealed'): readonly GameEvent[] {
  return events.filter(event => (event.type === 'move' || event.type === 'capture') === (phase === 'concealed'))
}

/** A rolled six can briefly show rage before the third capture escalates it. */
export function maskBloodlust(current: GameState, events: readonly GameEvent[]): GameState {
  const reaction = events.find(event => event.type === 'reaction' && event.affliction === 'berserk')
  if (reaction?.type !== 'reaction') return current
  return {
    ...current,
    pieces: current.pieces.map(piece => piece.id === reaction.piece.id ? { ...piece, affliction: 'berserk' } : piece),
  }
}
