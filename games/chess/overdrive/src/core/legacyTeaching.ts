import { createPosition } from './state'
import type { Action, GameState, PieceInput, PositionInput } from './types'

/** Independent teaching positions; no tutorial-specific rule changes or energy subsidies in live games. */
interface TeachingFixture {
  readonly id: 'capture' | 'check' | 'sweep' | 'raid' | 'battery' | 'ram' | 'rotation' | 'cover' | 'form'
  readonly state: GameState
  readonly expected: Action
  readonly focusSquares: readonly string[]
}
const piece = (id: string, side: PieceInput['side'], type: PieceInput['type'], square: string): PieceInput => ({ id, side, type, square })
function position(pieces: PieceInput[], extra: Omit<PositionInput, 'pieces'> = {}): GameState {
  return createPosition({ rulesVersion: 'overdrive-v1', pieces: [
    ...(!pieces.some(p => p.type === 'king' && p.side === 'white') ? [piece('wk', 'white', 'king', 'a1')] : []),
    ...(!pieces.some(p => p.type === 'king' && p.side === 'black') ? [piece('bk', 'black', 'king', 'h8')] : []), ...pieces,
  ], ...extra })
}
export const LEGACY_TEACHING_FIXTURES: readonly TeachingFixture[] = [
  { id: 'capture', state: position([piece('wr', 'white', 'rook', 'd3'), piece('bn', 'black', 'knight', 'd6')]), expected: { type: 'move', mode: 'normal', pieceId: 'wr', to: 'd6' }, focusSquares: ['d3', 'd6'] },
  { id: 'check', state: position([piece('wr', 'white', 'rook', 'd3')]), expected: { type: 'move', mode: 'normal', pieceId: 'wr', to: 'h3' }, focusSquares: ['d3', 'h3', 'h8'] },
  { id: 'sweep', state: position([piece('wp', 'white', 'pawn', 'e4'), piece('bn', 'black', 'knight', 'f5')], { energy: { white: 5 } }), expected: { type: 'ability', mode: 'impulse', pieceId: 'wp', targetId: 'bn' }, focusSquares: ['e4', 'f5', 'e5'] },
  { id: 'raid', state: position([piece('wn', 'white', 'knight', 'c3'), piece('br', 'black', 'rook', 'd4')], { energy: { white: 5 } }), expected: { type: 'ability', mode: 'impulse', pieceId: 'wn', targetId: 'br', to: 'e4' }, focusSquares: ['c3', 'd4', 'e4'] },
  { id: 'battery', state: position([piece('wb', 'white', 'bishop', 'c1'), piece('wp', 'white', 'pawn', 'd2'), piece('br', 'black', 'rook', 'h6')], { energy: { white: 5 } }), expected: { type: 'ability', mode: 'impulse', pieceId: 'wb', targetId: 'br' }, focusSquares: ['c1', 'd2', 'h6'] },
  { id: 'ram', state: position([piece('wr', 'white', 'rook', 'c3'), piece('bn', 'black', 'knight', 'c6')], { energy: { white: 5 } }), expected: { type: 'ability', mode: 'impulse', pieceId: 'wr', targetId: 'bn' }, focusSquares: ['c3', 'c6', 'c7'] },
  { id: 'rotation', state: position([piece('wq', 'white', 'queen', 'c3'), piece('wn', 'white', 'knight', 'f6')], { energy: { white: 5 } }), expected: { type: 'ability', mode: 'impulse', pieceId: 'wq', targetId: 'wn' }, focusSquares: ['c3', 'f6'] },
  { id: 'cover', state: position([piece('wk', 'white', 'king', 'c1'), piece('wn', 'white', 'knight', 'd2'), piece('br', 'black', 'rook', 'a1')], { energy: { white: 5 } }), expected: { type: 'ability', mode: 'impulse', pieceId: 'wk', targetId: 'wn', to: 'd1' }, focusSquares: ['a1', 'c1', 'd2', 'd1'] },
  { id: 'form', state: position([piece('wn', 'white', 'knight', 'c3'), piece('br', 'black', 'rook', 'd4'), piece('wp', 'white', 'pawn', 'f2'), piece('bp', 'black', 'pawn', 'g7')], { energy: { white: 10 } }), expected: { type: 'ability', mode: 'activate', pieceId: 'wn', targetId: 'br', to: 'e4' }, focusSquares: ['c3', 'd4', 'e4'] },
]
