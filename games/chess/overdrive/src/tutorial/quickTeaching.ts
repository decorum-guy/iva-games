import { createPosition } from '../core/state'
import { transition } from '../core/rules'
import type { Action, GameState, PieceInput } from '../core/types'
import { energyBankSize, RULES_VERSION } from '../core/types'
import { TEACHING_FIXTURES } from '../core/teaching'

export type QuickLessonId = 'pawn' | 'pawn-capture' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king'
  | 'impulse' | 'battery-check' | 'ram-edge' | 'ram-chain' | 'activate' | 'free' | 'expire'
export type PracticeMode = 'impulse' | 'activate' | 'form'
export interface QuickLesson {
  readonly id: QuickLessonId
  readonly state: GameState
  readonly expected: Action
  readonly reply?: Action
  readonly continues?: boolean
  readonly focusSquares?: readonly string[]
  readonly blockedAttempt?: boolean
}
const piece = (id: string, type: PieceInput['type'], square: string, side: PieceInput['side'] = 'white'): PieceInput => ({ id, type, square, side })
function position(pieces: readonly PieceInput[], energy: Partial<GameState['energy']> = {}): GameState {
  return createPosition({ pieces: [
    ...(!pieces.some(p => p.type === 'king' && p.side === 'white') ? [piece('wk', 'king', 'a1')] : []),
    piece('bk', 'king', 'h8', 'black'), ...pieces,
  ], energy })
}
const move = (pieceId: string, to: string): Action => ({ type: 'move', mode: 'normal', pieceId, to })
const formState = position([piece('wr', 'rook', 'c3'), piece('bn', 'knight', 'c5', 'black'),
  piece('wp', 'pawn', 'a2'), piece('bp', 'pawn', 'h7', 'black')], { white: 6 })
const activate: Action = { type: 'ability', mode: 'activate', pieceId: 'wr', targetId: 'bn' }
const free: Action = { type: 'ability', mode: 'form', pieceId: 'wr', targetId: 'bn' }
const reply1 = move('bp', 'h6'), reply2 = move('bp', 'h5')
// The continuing frames come from ordinary rules transitions, including the
// opponent's moves. No timer or energy is rewritten by the teaching controller.
const freeState = transition(transition(formState, activate).state, reply1).state
const expireState = transition(transition(freeState, free).state, reply2).state
const impulse = TEACHING_FIXTURES.find(fixture => fixture.id === 'ram')!
const chain = {
  id: 'ram-chain',
  state: position([piece('wr', 'rook', 'c3'), piece('bp', 'pawn', 'c5', 'black'), piece('wn', 'knight', 'c6')], { white: 3 }),
  expected: { type: 'ability', mode: 'impulse', pieceId: 'wr', targetId: 'bp' },
  focusSquares: ['c3', 'c5', 'c6', 'c7'],
} satisfies QuickLesson
const currentPosition = (state: GameState) => createPosition({ ...state, rulesVersion: RULES_VERSION, repetition: undefined })

const basics: readonly QuickLesson[] = [
  { id: 'pawn', state: position([{ ...piece('wp', 'pawn', 'e2'), pawnDoubleStepEligible: true }, piece('bp', 'pawn', 'f5', 'black')]), expected: move('wp', 'e4') },
  { id: 'pawn-capture', state: position([piece('wp', 'pawn', 'e4'), piece('bp', 'pawn', 'f5', 'black')]), expected: move('wp', 'f5') },
  { id: 'knight', state: position([piece('wn', 'knight', 'c3'), piece('wp', 'pawn', 'd3'), piece('wp2', 'pawn', 'c4')]), expected: move('wn', 'e4') },
  { id: 'bishop', state: position([piece('wb', 'bishop', 'c1'), piece('wp', 'pawn', 'b2'), piece('bp', 'pawn', 'h7', 'black')]), expected: move('wb', 'f4') },
  { id: 'rook', state: currentPosition(TEACHING_FIXTURES[0].state), expected: TEACHING_FIXTURES[0].expected },
  { id: 'queen', state: position([piece('wq', 'queen', 'd3'), piece('bp', 'pawn', 'h7', 'black')]), expected: move('wq', 'g6') },
  { id: 'king', state: position([piece('wk', 'king', 'c1'), piece('br', 'rook', 'd8', 'black')]), expected: move('wk', 'b2') },
]
export const BASIC_LESSON_COUNT = basics.length

export const QUICK_LESSONS: readonly QuickLesson[] = [
  ...basics,
  { id: 'impulse', state: currentPosition(impulse.state), expected: impulse.expected },
  {
    id: 'battery-check',
    state: position([piece('wk', 'king', 'e1'), piece('wb', 'bishop', 'c1'), piece('wn', 'knight', 'c3'),
      piece('bb', 'bishop', 'b4', 'black')], { black: 3 }),
    expected: move('wb', 'd2'),
    focusSquares: ['b4', 'c3', 'd2', 'e1'],
  },
  {
    id: 'ram-edge',
    state: position([piece('wr', 'rook', 'd4'), piece('bp', 'pawn', 'h4', 'black')], { white: 3 }),
    expected: { type: 'ability', mode: 'impulse', pieceId: 'wr', targetId: 'bp' },
    blockedAttempt: true,
  },
  chain,
  { id: 'activate', state: formState, expected: activate, reply: reply1 },
  { id: 'free', state: freeState, expected: free, reply: reply2, continues: true },
  { id: 'expire', state: expireState, expected: move('wp', 'a3'), continues: true },
]

export const ABILITY_PRACTICE = TEACHING_FIXTURES.filter(fixture =>
  ['sweep', 'raid', 'battery', 'ram', 'rotation', 'cover'].includes(fixture.id))
  .map(fixture => fixture.id === 'ram'
    ? { ...fixture, state: chain.state, expected: chain.expected, focusSquares: chain.focusSquares }
    : { ...fixture, state: currentPosition(fixture.state) })

export function abilityExercise(index: number, mode: PracticeMode) {
  const fixture = ABILITY_PRACTICE[index]
  const bank = energyBankSize(fixture.state.rulesVersion)
  return {
    ...fixture,
    state: createPosition({
      ...fixture.state,
      energy: { ...fixture.state.energy, white: mode === 'activate' ? bank * 2 : mode === 'impulse' ? bank : 0 },
      forms: { ...fixture.state.forms, white: mode === 'form' ? { pieceId: fixture.expected.pieceId, remainingTurns: 2 } : null },
      repetition: undefined,
    }),
    expected: { ...fixture.expected, mode },
  }
}
