import { describe, expect, it } from 'vitest'
import { commandKey, createInitialState, createPosition, isInCheck, legalCommands, positionKey, transition } from '../../src/core'
import type { GameState, PieceInput } from '../../src/core'
import { evaluate } from '../../src/engine/evaluate'
import { getPreset, PRESETS } from '../../src/engine/presets'
import { overdriveAdapter, search } from '../../src/engine/search'
const piece = (id: string, side: PieceInput['side'], type: PieceInput['type'], square: string): PieceInput => ({ id, side, type, square })
function tactical(pieces: PieceInput[], energy = 5): GameState {
  return createPosition({ pieces: [
    ...(!pieces.some(p => p.type === 'king' && p.side === 'white') ? [piece('wk', 'white', 'king', 'a1')] : []),
    ...(!pieces.some(p => p.type === 'king' && p.side === 'black') ? [piece('bk', 'black', 'king', 'h8')] : []), ...pieces,
  ], energy: { white: energy } })
}
const deterministic = { ...getPreset(6)!, maxDepth: 2, temperature: 0 }

describe('OVERDRIVE through the shared Engine SDK', () => {
  it('has ten real monotone budgets and explicitly provisional internal anchors', () => {
    expect(PRESETS).toHaveLength(10)
    for (let i = 1; i < PRESETS.length; i++) {
      expect(PRESETS[i].maxNodes).toBeGreaterThan(PRESETS[i - 1].maxNodes)
      expect(PRESETS[i].maxTimeMs).toBeGreaterThan(PRESETS[i - 1].maxTimeMs)
      expect(PRESETS[i].maxDepth).toBeGreaterThanOrEqual(PRESETS[i - 1].maxDepth)
      expect(PRESETS[i].temperature).toBeLessThan(PRESETS[i - 1].temperature)
    }
    expect(PRESETS[9].temperature).toBe(0)
    expect(getPreset(0)).toBeUndefined()
    expect(getPreset(11)).toBeUndefined()
  })
  it('searches real legal continuations and returns them through the generic adapter', () => {
    const state = createInitialState()
    const result = search(state, deterministic, { timeLimitMs: Infinity })
    expect(result.diagnostics.depth).toBe(2)
    expect(result.diagnostics.nodes).toBeGreaterThan(20)
    expect(result.principalVariation.length).toBe(2)
    let continuation = state
    for (const step of result.principalVariation) {
      expect(legalCommands(continuation).map(commandKey)).toContain(commandKey(step.action))
      continuation = transition(continuation, step.action).state
      expect(step.probability).toBe(1)
    }
  })
  it('spends an impulse on a knight raid that wins a queen and removes a pin', () => {
    const state = tactical([piece('wn', 'white', 'knight', 'c3'), piece('bq', 'black', 'queen', 'd4')])
    const result = search(state, deterministic, { timeLimitMs: Infinity })
    expect(result.command).toMatchObject({ type: 'ability', mode: 'impulse', pieceId: 'wn', targetId: 'bq' })
    const next = transition(state, result.command!).state
    expect(next.pieces.some(p => p.id === 'bq')).toBe(false)
    expect(next.energy.white).toBe(1)
  })
  it('finds a pawn sweep as the sole escape from a knight check while keeping a rook blocked', () => {
    const pawns = ['d2', 'd3', 'd4', 'e2', 'e4', 'f2', 'f3', 'f4'].map(square => piece(`wp-${square}`, 'white', 'pawn', square))
    const state = tactical([piece('wk', 'white', 'king', 'e3'), piece('br', 'black', 'rook', 'e8'), piece('bn', 'black', 'knight', 'f5'), ...pawns])
    const expected = { type: 'ability', mode: 'impulse', pieceId: 'wp-e4', targetId: 'bn' }
    expect(isInCheck(state)).toBe(true)
    expect(legalCommands(state)).toEqual([expected])
    const result = search(state, deterministic, { timeLimitMs: Infinity })
    expect(result.command).toEqual(expected)
    expect(isInCheck(transition(state, result.command!).state, 'white')).toBe(false)
  })
  it('finds the bishop battery through a blocker rather than only orthodox moves', () => {
    const state = tactical([piece('wb', 'white', 'bishop', 'c1'), piece('wp', 'white', 'pawn', 'd2'), piece('bq', 'black', 'queen', 'h6')])
    const result = search(state, deterministic, { timeLimitMs: Infinity })
    expect(result.command).toMatchObject({ type: 'ability', mode: 'impulse', pieceId: 'wb', targetId: 'bq' })
  })
  it('uses covered retreat as the only kind of action escaping an otherwise mating net', () => {
    const state = tactical([piece('wk', 'white', 'king', 'c1'), piece('wb', 'white', 'bishop', 'd2'), piece('br', 'black', 'rook', 'a1'), piece('br2', 'black', 'rook', 'b8'), piece('br3', 'black', 'rook', 'c8')])
    const result = search(state, deterministic, { timeLimitMs: Infinity })
    expect(result.command).toMatchObject({ type: 'ability', pieceId: 'wk', targetId: 'wb' })
    expect(isInCheck(transition(state, result.command!).state, 'white')).toBe(false)
  })
  it('treats draws as choices and terminal outcomes as outcomes rather than material', () => {
    const losing = tactical([piece('bq', 'black', 'queen', 'f6'), piece('br', 'black', 'rook', 'g7')], 0)
    const state = { ...losing, quietPly: 100 }
    const result = search(state, deterministic, { timeLimitMs: Infinity })
    expect(result.command).toEqual({ type: 'claimDraw', reason: 'fiftyMoves' })
    const terminal = transition(state, result.command!).state
    expect(search(terminal, deterministic).command).toBe(null)
  })
  it('respects an immediately claimable draw at the search frontier for either perspective', () => {
    const losing = tactical([piece('bq', 'black', 'queen', 'f6')], 0)
    const fifty = { ...losing, quietPly: 100 }
    expect(evaluate(losing, 'white')).toBeLessThan(0)
    expect(evaluate(fifty, 'white')).toBe(0)
    expect(evaluate(fifty, 'black')).toBe(0)
    const repeated = { ...losing, repetition: { [positionKey(losing)]: 3 } }
    expect(evaluate(repeated, 'white')).toBe(0)
    const winningActor = { ...fifty, side: 'black' as const }
    expect(evaluate(winningActor, 'black')).toBeGreaterThan(0)
  })
  it('uses resource and duration in evaluation and all history in safe cache identity', () => {
    const state = tactical([piece('wn', 'white', 'knight', 'c3')], 0)
    const rich = { ...state, energy: { white: 10, black: 0 } }
    expect(evaluate(rich, 'white')).toBeGreaterThan(evaluate(state, 'white'))
    const shaped = { ...state, forms: { ...state.forms, white: { pieceId: 'wn', remainingTurns: 2 } } }
    expect(evaluate(shaped, 'white')).toBeGreaterThan(evaluate(state, 'white'))
    expect(overdriveAdapter.cacheIdentity(rich).position).not.toBe(overdriveAdapter.cacheIdentity(state).position)
    expect(overdriveAdapter.cacheIdentity({ ...state, quietPly: 99 }).position).not.toBe(overdriveAdapter.cacheIdentity(state).position)
    expect(overdriveAdapter.cacheIdentity({ ...state, repetition: { ...state.repetition } }).history).not.toBe(overdriveAdapter.cacheIdentity(state).history)
    expect(evaluate(state, 'white')).toBeCloseTo(-evaluate(state, 'black'), 12)
  })
  it('returns a legal static fallback with honest depth zero when already cancelled', () => {
    const state = createInitialState()
    const result = search(state, getPreset(10)!, { cancelled: () => true })
    expect(result.command).not.toBe(null)
    expect(legalCommands(state).map(commandKey)).toContain(commandKey(result.command!))
    expect(result.diagnostics.depth).toBe(0)
    expect(result.diagnostics.stopReason).toBe('cancelled')
  })
  it('a replayable SDK self-play sequence never emits illegal moves or mutates prior states', () => {
    let state = createInitialState()
    const preset = { ...getPreset(3)!, maxNodes: 180, maxDepth: 2 }
    let seed = 771
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let ply = 0; ply < 80 && !state.outcome; ply++) {
      const before = JSON.stringify(state)
      const result = search(state, preset, { random, timeLimitMs: Infinity })
      expect(result.command).not.toBe(null)
      const next = transition(state, result.command!).state
      expect(JSON.stringify(state)).toBe(before)
      state = next
    }
  }, 30000)
})


describe('queen/rook versus bare king conversion observed in real self-play', () => {
  it('converts the actual unconverted queen position before the opponent can claim fifty moves', () => {
    let state = createPosition({ pieces: [piece('wq', 'white', 'queen', 'g7'), piece('wk', 'white', 'king', 'b2'), piece('bk', 'black', 'king', 'b5')], energy: { white: 10, black: 10 }, quietPly: 51 })
    for (let ply = 0; ply < 48 && !state.outcome; ply++) {
      const result = search(state, getPreset(state.side === 'white' ? 9 : 10)!, { timeLimitMs: Infinity, random: () => .5 })
      expect(result.command).not.toBe(null)
      state = transition(state, result.command!).state
    }
    expect(state.outcome).toEqual({ reason: 'checkmate', winner: 'white' })
  }, 30000)
  it('also converts a rook-and-king position without declaring material alone to be a win', () => {
    let state = createPosition({ pieces: [piece('wr', 'white', 'rook', 'a2'), piece('wk', 'white', 'king', 'c4'), piece('bk', 'black', 'king', 'g6')] })
    expect(state.outcome).toBe(null)
    for (let ply = 0; ply < 48 && !state.outcome; ply++) {
      const result = search(state, getPreset(9)!, { timeLimitMs: Infinity, random: () => .5 })
      expect(result.command).not.toBe(null)
      state = transition(state, result.command!).state
    }
    expect(state.outcome).toEqual({ reason: 'checkmate', winner: 'white' })
  }, 30000)
})
