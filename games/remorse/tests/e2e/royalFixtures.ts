import { createPosition } from '../../src/core'
import type { PieceInput, Side } from '../../src/core'
import { createMatch } from '../../src/session/match'
import type { SessionConfig } from '../../src/session/match'
import { nextDie } from '../../src/session/random'

export const localDuel = { mode: 'hotseat', human: null, level: null, provenance: 'standard' } as const
const face4 = Array.from({ length: 100 }, (_, n) => n).find(n => nextDie(n).face === 4)!
const face6 = Array.from({ length: 100 }, (_, n) => n).find(n => nextDie(n).face === 6)!

function mirror(pieces: PieceInput[], side: Side) {
  return side === 'white' ? pieces : pieces.map(piece => ({
    ...piece, side: piece.side === 'white' ? 'black' as const : 'white' as const,
    square: piece.square[0] + String(9 - Number(piece.square[1])),
  }))
}

export function ordinaryCheck(side: Side = 'white') {
  const pieces = mirror([
    { side: 'white', type: 'king', square: 'e1' }, { side: 'black', type: 'king', square: 'e8' },
    { side: 'white', type: 'rook', square: 'a2' }, { side: 'black', type: 'pawn', square: 'h7' },
    { side: 'white', type: 'knight', square: 'b1' }, { side: 'black', type: 'bishop', square: 'f8' },
  ], side)
  return createMatch(localDuel, { root: createPosition({ pieces, side }) })
}

export function cornerMate(side: Side = 'white', rolled = false, config: SessionConfig = localDuel) {
  const pieces: PieceInput[] = [
    { side: 'white', type: 'king', square: 'f6' }, { side: 'black', type: 'king', square: 'h8' },
    { side: 'white', type: 'queen', square: 'g6' }, { side: 'black', type: 'bishop', square: 'e7' },
    { side: 'black', type: 'pawn', square: 'h6' }, { side: 'white', type: 'rook', square: 'e2', affliction: 'guilt' },
  ]
  if (rolled) pieces.push({ side: 'black', type: 'pawn', square: 'g7' })
  return createMatch(config, { root: createPosition({ pieces: mirror(pieces, side), side }), seed: face4 })
}

export function optionalMate() {
  return createMatch(localDuel, { root: createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'c6' }, { side: 'white', type: 'queen', square: 'c7' },
    { side: 'black', type: 'king', square: 'a8' }, { side: 'black', type: 'pawn', square: 'b7' },
  ] }), seed: face6 })
}

export function passiveMate() {
  // The immobile knight holds the last file closed until the next completed turn.
  return createMatch(localDuel, { root: createPosition({ pieces: [
    { side: 'black', type: 'king', square: 'h8' }, { side: 'white', type: 'king', square: 'f7' },
    { side: 'white', type: 'rook', square: 'h4' }, { side: 'white', type: 'pawn', square: 'a2' },
    { side: 'black', type: 'knight', square: 'h6', affliction: 'devastated', devastationDue: 1 },
  ] }) })
}
