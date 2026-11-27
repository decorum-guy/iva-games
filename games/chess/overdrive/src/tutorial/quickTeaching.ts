import { createPosition } from '../core/state'
import { transition } from '../core/rules'
import type { Action, GameState, PieceInput } from '../core/types'
import { TEACHING_FIXTURES } from '../core/teaching'

export type QuickLessonId = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king' | 'impulse' | 'activate' | 'free' | 'expire'
export interface QuickLesson {
  readonly id: QuickLessonId
  readonly state: GameState
  readonly expected: Action
  readonly reply?: Action
  readonly continues?: boolean
}
const piece = (id: string, type: PieceInput['type'], square: string, side: PieceInput['side'] = 'white'): PieceInput => ({ id, type, square, side })
function position(pieces: readonly PieceInput[], energy = 0): GameState {
  return createPosition({ pieces: [
    ...(!pieces.some(p => p.type === 'king' && p.side === 'white') ? [piece('wk', 'king', 'a1')] : []),
    piece('bk', 'king', 'h8', 'black'), ...pieces,
  ], energy: { white: energy } })
}
const move = (pieceId: string, to: string): Action => ({ type: 'move', mode: 'normal', pieceId, to })
const formState = position([piece('wr', 'rook', 'c3'), piece('bn', 'knight', 'c5', 'black'),
  piece('wp', 'pawn', 'a2'), piece('bp', 'pawn', 'h7', 'black')], 6)
const activate: Action = { type: 'ability', mode: 'activate', pieceId: 'wr', targetId: 'bn' }
const free: Action = { type: 'ability', mode: 'form', pieceId: 'wr', targetId: 'bn' }
const reply1 = move('bp', 'h6'), reply2 = move('bp', 'h5')
// The continuing frames come from ordinary rules transitions, including the
// opponent's moves. No timer or energy is rewritten by the teaching controller.
const freeState = transition(transition(formState, activate).state, reply1).state
const expireState = transition(transition(freeState, free).state, reply2).state
const impulse = TEACHING_FIXTURES.find(fixture => fixture.id === 'ram')!

export const QUICK_LESSONS: readonly QuickLesson[] = [
  { id: 'pawn', state: position([{ ...piece('wp', 'pawn', 'e2'), pawnDoubleStepEligible: true }, piece('bp', 'pawn', 'f5', 'black')]), expected: move('wp', 'e4') },
  { id: 'knight', state: position([piece('wn', 'knight', 'c3'), piece('wp', 'pawn', 'd3'), piece('wp2', 'pawn', 'c4')]), expected: move('wn', 'e4') },
  { id: 'bishop', state: position([piece('wb', 'bishop', 'c1'), piece('bp', 'pawn', 'h7', 'black')]), expected: move('wb', 'f4') },
  { id: 'rook', state: TEACHING_FIXTURES[0].state, expected: TEACHING_FIXTURES[0].expected },
  { id: 'queen', state: position([piece('wq', 'queen', 'd3'), piece('bp', 'pawn', 'h7', 'black')]), expected: move('wq', 'g6') },
  { id: 'king', state: position([piece('wk', 'king', 'c1'), piece('bp', 'pawn', 'h7', 'black')]), expected: move('wk', 'd2') },
  { id: 'impulse', state: impulse.state, expected: impulse.expected },
  { id: 'activate', state: formState, expected: activate, reply: reply1 },
  { id: 'free', state: freeState, expected: free, reply: reply2, continues: true },
  { id: 'expire', state: expireState, expected: move('wp', 'a3'), continues: true },
]

export const ABILITY_PRACTICE = TEACHING_FIXTURES.filter(fixture =>
  ['sweep', 'raid', 'battery', 'ram', 'rotation', 'cover'].includes(fixture.id))
