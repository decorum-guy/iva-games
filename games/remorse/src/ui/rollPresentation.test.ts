import { describe, expect, it } from 'vitest'
import { applyResolvedCommand, createPosition, pieceAt } from '../core'
import type { GameState } from '../core'
import { maskRollResult, rollSceneEvents } from './rollPresentation'

const capture = { type: 'move', from: 'd4', to: 'd5' } as const

function capturePosition(king = 'a1'): GameState {
  return createPosition({ pieces: [
    { side: 'white', type: 'king', square: king },
    { side: 'black', type: 'king', square: 'h8' },
    { side: 'white', type: 'rook', square: 'd4' },
    { side: 'black', type: 'pawn', square: 'd5' },
    { side: 'white', type: 'knight', square: 'f2', affliction: 'devastated', devastationDue: 1 },
  ] })
}

describe('unrevealed die presentation', () => {
  it('shows the committed capture but conceals guilt without reviving captured or expired pieces', () => {
    const before = capturePosition()
    const result = applyResolvedCommand(before, capture, 2)
    const snapshot = structuredClone(result)
    const original = structuredClone(before)
    expect(pieceAt(result.state, 'd5')).toMatchObject({ affliction: 'guilt', captureReaction: 'guilt', capturesSinceRebirth: 1 })
    expect(result.events.some(event => event.type === 'remove')).toBe(true)

    const shown = maskRollResult(result.state, before)
    expect(pieceAt(shown, 'd4')).toBeUndefined()
    expect(pieceAt(shown, 'd5')).toMatchObject({
      id: 'w-d4', type: 'rook', side: 'white', affliction: 'neutral', captureReaction: 'unassigned', capturesSinceRebirth: 0,
    })
    expect(shown.pieces.map(piece => piece.id)).toEqual(result.state.pieces.map(piece => piece.id))
    expect(shown.pieces.some(piece => piece.id === 'b-d5' || piece.id === 'w-f2')).toBe(false)
    expect(shown.turnSerial).toBe(result.state.turnSerial)
    expect(shown.repetition).toBe(result.state.repetition)
    expect(before).toEqual(original)
    expect(result).toEqual(snapshot)
  })

  it('conceals a new berserk reaction near a king without treating rally as a berserk cure', () => {
    const before = capturePosition('c4')
    const result = applyResolvedCommand(before, capture, 6)
    expect(result.state.phase).toBe('bonus')
    expect(pieceAt(result.state, 'd5')?.affliction).toBe('berserk')
    expect(result.events.some(event => event.type === 'cure')).toBe(false)
    const shown = maskRollResult(result.state, before)
    expect(pieceAt(shown, 'd5')?.affliction).toBe('neutral')
    expect(shown.phase).toBe('bonus') // Projection only: commands still use the authoritative state.
    expect(pieceAt(result.state, 'd5')?.affliction).toBe('berserk')
  })

  it('does not expose newly armed devastation and bishop-cure timers before the die settles', () => {
    const base = capturePosition()
    const before = createPosition({ pieces: [...base.pieces, { side: 'white', type: 'bishop', square: 'c4' }] })
    const result = applyResolvedCommand(before, capture, 1)
    expect(pieceAt(result.state, 'd5')).toMatchObject({ affliction: 'devastated', devastationDue: 7, cureArmedAt: 1 })
    expect(pieceAt(maskRollResult(result.state, before), 'd5')).toMatchObject({
      affliction: 'neutral', captureReaction: 'unassigned', devastationDue: null, cureArmedAt: null,
    })
  })

  it('defers both a rolled reaction and its immediate king rally, preserving event identities in disjoint phases', () => {
    const before = capturePosition('c4')
    const result = applyResolvedCommand(before, capture, 2)
    expect(pieceAt(result.state, 'd5')).toMatchObject({ affliction: 'neutral', captureReaction: 'guilt' })
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'cure', cause: 'rally' }))
    expect(pieceAt(maskRollResult(result.state, before), 'd5')?.captureReaction).toBe('unassigned')

    const throwing = rollSceneEvents(result.events, 'concealed')
    const revealed = rollSceneEvents(result.events, 'revealed')
    expect(throwing.map(event => event.type)).toEqual(['move', 'capture'])
    expect(revealed.some(event => event.type === 'reaction')).toBe(true)
    expect(revealed.some(event => event.type === 'cure')).toBe(true)
    expect(revealed.some(event => event.type === 'move' || event.type === 'capture')).toBe(false)
    expect(new Set([...throwing, ...revealed].map(event => event.id)).size).toBe(result.events.length)
    expect([...throwing, ...revealed].map(event => event.id)).toEqual(result.events.map(event => event.id))
    for (const event of [...throwing, ...revealed]) expect(result.events.find(original => original.id === event.id)).toBe(event)
  })

  it('preserves the promoted type and current rights while hiding the capture reaction', () => {
    const before = createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'a1' },
      { side: 'black', type: 'king', square: 'a8' },
      { side: 'white', type: 'pawn', square: 'g7' },
      { side: 'black', type: 'rook', square: 'h8' },
    ] })
    const result = applyResolvedCommand(before, { type: 'move', from: 'g7', to: 'h8', promotion: 'queen' }, 2)
    expect(pieceAt(result.state, 'h8')).toMatchObject({ type: 'queen', affliction: 'guilt' })
    expect(pieceAt(maskRollResult(result.state, before), 'h8')).toMatchObject({
      id: 'w-g7', type: 'queen', affliction: 'neutral', captureReaction: 'unassigned',
      pawnDoubleStepEligible: false, castleEligible: false,
    })
  })

  it('conceals a real capture checkmate until reveal without changing the committed result', () => {
    const before = createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'f6' },
      { side: 'white', type: 'queen', square: 'g6' },
      { side: 'black', type: 'king', square: 'h8' },
      { side: 'black', type: 'pawn', square: 'g7' },
    ] })
    const result = applyResolvedCommand(before, { type: 'move', from: 'g6', to: 'g7' }, 4)
    expect(result.state.outcome).toEqual({ reason: 'checkmate', winner: 'white' })
    expect(maskRollResult(result.state, before).outcome).toBeNull()
    expect(rollSceneEvents(result.events, 'concealed').some(event => event.type === 'outcome')).toBe(false)
    expect(rollSceneEvents(result.events, 'revealed')).toContainEqual(expect.objectContaining({ type: 'outcome' }))
    expect(result.state.outcome).toEqual({ reason: 'checkmate', winner: 'white' })
  })
})
