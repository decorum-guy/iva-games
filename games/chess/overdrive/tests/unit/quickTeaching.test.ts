import { describe, expect, it } from 'vitest'
import { commandKey, isInCheck, legalCommands, RULES_VERSION, transition, validateState } from '../../src/core'
import { ABILITY_PRACTICE, BASIC_LESSON_COUNT, QUICK_LESSONS, abilityExercise } from '../../src/tutorial/quickTeaching'

describe('short native tutorial positions', () => {
  it('offers one legal action for each ordinary piece, with the actual capture reward', () => {
    const basics = QUICK_LESSONS.slice(0, BASIC_LESSON_COUNT)
    expect(basics.map(step => step.state.pieces.find(piece => piece.id === step.expected.pieceId)?.type))
      .toEqual(['pawn', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'])
    for (const step of basics) {
      expect(step.state.rulesVersion).toBe(RULES_VERSION)
      expect(legalCommands(step.state).map(commandKey)).toContain(commandKey(step.expected))
      const result = transition(step.state, step.expected)
      expect(validateState(result.state)).toBe(true)
      expect(result.state.pieces.find(piece => piece.id === step.expected.pieceId)?.square).toBe(step.expected.to)
    }
    const capture = basics.find(step => step.id === 'rook')!
    const result = transition(capture.state, capture.expected)
    expect(capture.state.energy.white).toBe(0)
    expect(result.state.energy.white).toBe(2)
    expect(result.events.find(event => event.type === 'energy')).toMatchObject({ captureEarned: 2 })
  })

  it('spends one bank for the impulse and leaves no form', () => {
    const step = QUICK_LESSONS.find(step => step.id === 'impulse')!, before = structuredClone(step.state)
    const result = transition(step.state, step.expected)
    expect(step.state).toEqual(before)
    expect(step.state.energy.white).toBe(3)
    expect(result.state.energy.white).toBe(0)
    expect(result.state.forms.white).toBeNull()
    expect(result.state.pieces.find(piece => piece.id === 'bn')?.square).toBe('c7')
  })

  it('plays three own turns in the same position: activation counts, replies do not, another piece expires it', () => {
    const [activation, free, expiry] = QUICK_LESSONS.slice(-3)
    let state = activation.state
    expect(state.energy.white).toBe(6)
    state = transition(state, activation.expected).state
    expect(state.energy.white).toBe(0)
    expect(state.forms.white).toEqual({ pieceId: 'wr', remainingTurns: 2 })
    state = transition(state, activation.reply!).state
    expect(state.forms.white?.remainingTurns).toBe(2)
    expect(state).toEqual(free.state)
    state = transition(state, free.expected).state
    expect(state.energy.white).toBe(0)
    expect(state.forms.white).toEqual({ pieceId: 'wr', remainingTurns: 1 })
    state = transition(state, free.reply!).state
    expect(state.forms.white?.remainingTurns).toBe(1)
    expect(state).toEqual(expiry.state)
    expect(expiry.expected.pieceId).not.toBe(state.forms.white?.pieceId)
    state = transition(state, expiry.expected).state
    expect(state.forms.white).toBeNull()
    expect(state.turnSerial).toBe(5)
    expect(state.pieces.find(piece => piece.id === 'wr')?.square).toBe('c6')
    expect(state.pieces.find(piece => piece.id === 'wp')?.square).toBe('a3')
  })

  it('models the charged bishop check and the legal second blocker', () => {
    const step = QUICK_LESSONS.find(item => item.id === 'battery-check')!
    expect(isInCheck(step.state)).toBe(true)
    expect(isInCheck({ ...step.state, energy: { white: 0, black: 2 } })).toBe(false)
    expect(isInCheck({ ...step.state, energy: { white: 0, black: 0 }, forms: {
      white: null, black: { pieceId: 'bb', remainingTurns: 2 },
    } })).toBe(true)
    const { state } = transition(step.state, step.expected)
    expect(isInCheck(state, 'white')).toBe(false)
    expect(state.energy.black).toBe(3)
  })

  it('lets the player try an illegal board-edge Ram and then play a valid chain', () => {
    const edge = QUICK_LESSONS.find(item => item.id === 'ram-edge')!
    expect(legalCommands(edge.state).map(commandKey)).not.toContain(commandKey(edge.expected))
    expect(() => transition(edge.state, edge.expected)).toThrow('illegalMovement')
    expect(edge.state.energy.white).toBe(3)
    const chain = QUICK_LESSONS.find(item => item.id === 'ram-chain')!
    const { events, state } = transition(chain.state, chain.expected)
    expect(events.filter(event => event.type === 'move' && event.forced)).toHaveLength(2)
    expect(state.energy.white).toBe(0)
  })

  it('keeps all six optional abilities legal as Impulse, activation, and a free form action', () => {
    expect(ABILITY_PRACTICE).toHaveLength(6)
    for (const [index] of ABILITY_PRACTICE.entries()) {
      for (const mode of ['impulse', 'activate', 'form'] as const) {
        const step = abilityExercise(index, mode)
        expect(step.state.rulesVersion).toBe(RULES_VERSION)
        expect(legalCommands(step.state).map(commandKey)).toContain(commandKey(step.expected))
        const { state } = transition(step.state, step.expected)
        expect(validateState(state)).toBe(true)
        expect(state.forms.white?.remainingTurns ?? 0).toBe(mode === 'form' ? 1 : mode === 'activate' ? 2 : 0)
      }
    }
  })
})
