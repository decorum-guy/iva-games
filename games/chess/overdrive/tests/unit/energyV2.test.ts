import { describe, expect, it } from 'vitest'
import { createPosition, isInCheck, transition, validateState, type PieceType } from '../../src/core'

function capture(victim: PieceType, initial = 0, rulesVersion: 'overdrive-v1' | 'overdrive-v2' = 'overdrive-v2') {
  const state = createPosition({ rulesVersion, energy: { white: initial }, pieces: [
    { id: 'wk', side: 'white', type: 'king', square: 'h1' },
    { id: 'bk', side: 'black', type: 'king', square: 'h8' },
    { id: 'wr', side: 'white', type: 'rook', square: 'a2' },
    { id: 'victim', side: 'black', type: victim, square: 'a7' },
  ] })
  return transition(state, { type: 'move', mode: 'normal', pieceId: 'wr', to: 'a7' })
}
describe('versioned energy rules', () => {
  it.each([['pawn',1], ['knight',2], ['bishop',2], ['rook',3], ['queen',4]] as const)('awards %s %i energy', (piece, amount) => {
    const result = capture(piece)
    expect(result.state.energy.white).toBe(amount)
    expect(result.events.find(event => event.type === 'energy')).toMatchObject({ captureEarned: amount })
  })
  it('caps at six and preserves the legacy capture rule', () => {
    expect(capture('queen', 4).state.energy.white).toBe(6)
    expect(capture('queen', 4, 'overdrive-v1').state.energy.white).toBe(5)
    expect(validateState({ ...capture('pawn').state, energy: { white: 7, black: 0 } })).toBe(false)
  })
  it('uses the bank threshold when checking enhanced attacks', () => {
    const make = (rulesVersion: 'overdrive-v1' | 'overdrive-v2') => createPosition({ rulesVersion, energy: { white: 3 }, pieces: [
      { id: 'wk', side: 'white', type: 'king', square: 'a1' }, { id: 'bk', side: 'black', type: 'king', square: 'd4' },
      { id: 'wn', side: 'white', type: 'knight', square: 'c3' },
    ] })
    expect(isInCheck(make('overdrive-v2'), 'black')).toBe(true)
    expect(isInCheck(make('overdrive-v1'), 'black')).toBe(false)
  })
})
