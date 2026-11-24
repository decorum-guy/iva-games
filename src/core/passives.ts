import { NEARBY, opposite, squareIndex } from './geometry'
import type { CoreEventData, GameState, Piece } from './types'

export const CYCLE = 2
export const DEVASTATION_DURATION = 3 * CYCLE

export const isFrenzied = (piece: Piece) => piece.affliction === 'berserk' || piece.affliction === 'bloodlust'
const isAfflicted = (piece: Piece) => piece.affliction === 'guilt' || piece.affliction === 'devastated'
const isSusceptible = (piece: Piece) => piece.type !== 'king' && !isFrenzied(piece)
const sideBit = (piece: Piece) => piece.side === 'white' ? 1 : 2

export function clearAffliction(piece: Piece): Piece {
  return {
    ...piece,
    affliction: 'neutral',
    devastationDue: null,
    cureArmedAt: null,
    shameArmedAt: null,
  }
}

export function rebirth(piece: Piece): Piece {
  return {
    ...clearAffliction(piece),
    captureReaction: 'unassigned',
    capturesSinceRebirth: 0,
    castleEligible: false,
    pawnDoubleStepEligible: false,
  }
}

export function setAffliction(piece: Piece, affliction: Piece['affliction'], armedAt: number): Piece {
  if (piece.affliction === affliction) return piece
  return {
    ...piece,
    affliction,
    devastationDue: affliction === 'devastated' ? armedAt + DEVASTATION_DURATION : null,
    cureArmedAt: null,
    shameArmedAt: null,
  }
}

function coverage(pieces: readonly Piece[]) {
  const masks = new Uint8Array(64)
  for (const piece of pieces) {
    if (piece.type !== 'bishop' && piece.type !== 'king') continue
    const bit = sideBit(piece) << (piece.type === 'king' ? 2 : 0)
    for (const index of NEARBY[squareIndex(piece.square)]) masks[index] |= bit
  }
  return masks
}

interface Contact {
  rally: boolean
  friendlyBishop: boolean
  hostileBishop: boolean
}

export function contactFor(piece: Piece, masks: Uint8Array): Contact {
  const mask = masks[squareIndex(piece.square)]
  const friendly = sideBit(piece)
  return {
    rally: !!(mask & (friendly << 2)),
    friendlyBishop: !!(mask & friendly),
    hostileBishop: !!(mask & (3 ^ friendly)),
  }
}

export function refreshContacts(
  pieces: readonly Piece[],
  armedAt: number,
  events?: CoreEventData[],
): readonly Piece[] {
  const masks = coverage(pieces)
  const cures: Extract<CoreEventData, { type: 'cure' }>[] = []
  let changed = false
  const updated = pieces.map(piece => {
    if (!isSusceptible(piece)) return piece
    const { rally, friendlyBishop, hostileBishop } = contactFor(piece, masks)
    if (rally && isAfflicted(piece)) {
      changed = true
      if (events) cures.push({ type: 'cure', piece, cause: 'rally' })
      return clearAffliction(piece)
    }
    const cureArmedAt = !rally && friendlyBishop && isAfflicted(piece) ? piece.cureArmedAt ?? armedAt : null
    const shameArmedAt = !rally && !friendlyBishop && hostileBishop ? piece.shameArmedAt ?? armedAt : null
    if (piece.cureArmedAt === cureArmedAt && piece.shameArmedAt === shameArmedAt) return piece
    changed = true
    return { ...piece, cureArmedAt, shameArmedAt }
  })
  if (events && cures.length) {
    // Sort events by board square so changing array iteration order has no visual consequence.
    events.push(...cures.sort((a, b) => squareIndex(a.piece.square) - squareIndex(b.piece.square)))
  }
  return changed ? updated : pieces
}

export function contactsAreValid(state: GameState): boolean {
  const masks = coverage(state.pieces)
  for (const piece of state.pieces) {
    if (!isSusceptible(piece)) {
      if (piece.cureArmedAt !== null || piece.shameArmedAt !== null) return false
      continue
    }
    const { rally, friendlyBishop, hostileBishop } = contactFor(piece, masks)
    if (rally && isAfflicted(piece)) return false
    const canCure = !rally && friendlyBishop && isAfflicted(piece)
    const canShame = !rally && !friendlyBishop && hostileBishop
    if (canCure !== (piece.cureArmedAt !== null) || canShame !== (piece.shameArmedAt !== null)) return false
  }
  return true
}

const matures = (armedAt: number | null, serial: number) => armedAt !== null && armedAt + CYCLE <= serial
const expires = (piece: Piece, serial: number) => piece.devastationDue !== null && piece.devastationDue <= serial

export function settlePassives(
  pieces: readonly Piece[],
  serial: number,
  events?: CoreEventData[],
): readonly Piece[] {
  // Contact and rally have already been refreshed after the action. Until a
  // deadline matures, advancing the turn cannot change that snapshot.
  if (!pieces.some(piece => expires(piece, serial) || matures(piece.cureArmedAt, serial) ||
    matures(piece.shameArmedAt, serial))) return pieces

  const updated: Piece[] = []
  const rescues: (Extract<CoreEventData, { type: 'cure' | 'affliction' | 'convert' }>)[] = []
  const removals: Extract<CoreEventData, { type: 'remove' }>[] = []
  for (const piece of pieces) {
    if (matures(piece.cureArmedAt, serial)) {
      updated.push(clearAffliction(piece))
      if (events) rescues.push({ type: 'cure', piece, cause: 'bishop' })
    } else if (matures(piece.shameArmedAt, serial)) {
      if (piece.affliction === 'devastated') {
        const side = opposite(piece.side)
        updated.push({ ...rebirth(piece), side })
        if (events) rescues.push({ type: 'convert', piece, side })
      } else {
        const afflicted = setAffliction(piece, piece.affliction === 'neutral' ? 'guilt' : 'devastated', serial)
        updated.push(afflicted)
        if (events) rescues.push({ type: 'affliction', piece: afflicted, affliction: afflicted.affliction, cause: 'shame' })
      }
    } else if (expires(piece, serial)) {
      if (events) removals.push({ type: 'remove', piece })
    } else {
      updated.push(piece)
    }
  }
  if (events) {
    const bySquare = (a: (typeof rescues)[number] | (typeof removals)[number], b: typeof a) =>
      squareIndex(a.piece.square) - squareIndex(b.piece.square)
    events.push(...rescues.sort(bySquare), ...removals.sort(bySquare))
  }
  return refreshContacts(updated, serial, events)
}

export function cyclesRemaining(piece: Piece, state: GameState): number | null {
  if (piece.devastationDue === null) return null
  return Math.min(3, Math.max(0, Math.ceil((piece.devastationDue - state.turnSerial) / CYCLE)))
}
