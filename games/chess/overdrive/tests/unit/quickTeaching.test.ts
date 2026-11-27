import { describe, expect, it } from 'vitest'
import { commandKey, legalCommands, transition, validateState } from '../../src/core'
import { ABILITY_PRACTICE, QUICK_LESSONS } from '../../src/tutorial/quickTeaching'

describe('short native tutorial positions', () => {
  it('offers one legal action for each ordinary piece, with the actual capture reward', () => {
    const basics = QUICK_LESSONS.slice(0, 6)
    expect(basics.map(step => step.state.pieces.find(piece => piece.id === step.expected.pieceId)?.type))
      .toEqual(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'])
    for (const step of basics) {
      expect(step.state.rulesVersion).toBe('overdrive-v2')
      expect(legalCommands(step.state).map(commandKey)).toContain(commandKey(step.expected))
      const result = transition(step.state, step.expected)
      expect(validateState(result.state)).toBe(true)
      expect(result.state.pieces.find(piece => piece.id === step.expected.pieceId)?.square).toBe(step.expected.to)
    }
    const capture = basics[3]
    const result = transition(capture.state, capture.expected)
    expect(capture.state.energy.white).toBe(0)
    expect(result.state.energy.white).toBe(2)
    expect(result.events.find(event => event.type === 'energy')).toMatchObject({ captureEarned: 2 })
  })

  it('spends one bank for the impulse and leaves no form', () => {
    const step = QUICK_LESSONS[6], before = structuredClone(step.state)
    const result = transition(step.state, step.expected)
    expect(step.state).toEqual(before)
    expect(step.state.energy.white).toBe(3)
    expect(result.state.energy.white).toBe(0)
    expect(result.state.forms.white).toBeNull()
    expect(result.state.pieces.find(piece => piece.id === 'bn')?.square).toBe('c7')
  })

  it('plays three own turns in the same position: activation counts, replies do not, another piece expires it', () => {
    const [activation, free, expiry] = QUICK_LESSONS.slice(7)
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

  it('keeps all six optional abilities legal under current rules', () => {
    expect(ABILITY_PRACTICE).toHaveLength(6)
    for (const step of ABILITY_PRACTICE) {
      expect(step.state.rulesVersion).toBe('overdrive-v2')
      expect(legalCommands(step.state).map(commandKey)).toContain(commandKey(step.expected))
      expect(validateState(transition(step.state, step.expected).state)).toBe(true)
    }
  })
})
