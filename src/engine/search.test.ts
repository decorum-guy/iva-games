import { describe, expect, it } from 'vitest'
import { createInitialState, createPosition, enumerateOutcomes, legalCommands,
  positionKey, transitionKnownLegal } from '../core'
import type { Command, GameState } from '../core/types'
import { evaluate } from './evaluate'
import { getPreset, PRESETS } from './presets'
import { search } from './search'

const strongest = { ...getPreset(1)!, temperature: 0 }
const fixed = { timeLimitMs: Infinity, random: () => 0.43 }

function chancePosition() {
  return createPosition({
    pieces: [
      { side: 'white', type: 'king', square: 'h1' },
      { side: 'white', type: 'rook', square: 'c3' },
      { side: 'black', type: 'king', square: 'a8' },
      { side: 'black', type: 'queen', square: 'c5' },
      { side: 'black', type: 'pawn', square: 'c7' },
      { side: 'black', type: 'pawn', square: 'g7' },
    ],
  })
}

function referenceValue(state: GameState): number {
  if (state.outcome) {
    if (!state.outcome.winner) return 0
    return state.outcome.winner === 'white' ? 999_999 : -999_999
  }
  return evaluate(state, 'white')
}

describe('Remorse Engine', () => {
  it('scores the weighted first-capture outcomes and the same-side berserk action within one turn', () => {
    const source = chancePosition()
    const capture = { type: 'move', from: 'c3', to: 'c5' } as const
    const children = enumerateOutcomes(source, capture).map(({ face, weight }) => ({
      face, weight, state: transitionKnownLegal(source, capture, face).state,
    }))
    const berserk = children.find(child => child.face === 6)!.state
    const continuations = legalCommands(berserk)
    const end = transitionKnownLegal(berserk, { type: 'endTurn' }).state
    expect(berserk.side).toBe('white')
    expect(berserk.turnSerial).toBe(0)
    const bonusBest = Math.max(...continuations.map(reply =>
      referenceValue(transitionKnownLegal(berserk, reply).state)))
    expect(bonusBest).toBeGreaterThan(referenceValue(end))
    const expected = children.reduce((sum, child) =>
      sum + child.weight * (child.face === 6 ? bonusBest : referenceValue(child.state)), 0)
    const result = search(source, { ...strongest, maxNodes: 600 }, fixed)
    expect(result.command).toEqual(capture)
    expect(result.diagnostics.depth).toBe(1)
    expect(result.diagnostics.score).toBeCloseTo(expected, 10)
  })

  it('takes a discovered forced win even on the warmest profile', () => {
    const source = createPosition({
      pieces: [
        { side: 'white', type: 'king', square: 'c6' },
        { side: 'white', type: 'queen', square: 'b6' },
        { side: 'black', type: 'king', square: 'a8' },
      ],
    })
    const best = search(source, getPreset(1)!, { ...fixed, random: () => 0.999 })
    const after = transitionKnownLegal(source, best.command!).state
    expect(after.outcome).toEqual({ reason: 'checkmate', winner: 'white' })
  })

  it('uses the actual history to claim a draw on an otherwise losing root', () => {
    const source = createPosition({
      pieces: [
        { side: 'white', type: 'king', square: 'h1' },
        { side: 'black', type: 'king', square: 'a8' },
        { side: 'black', type: 'queen', square: 'd4' },
        { side: 'black', type: 'pawn', square: 'a7' },
      ],
    })
    const repeated = { ...source, repetition: { ...source.repetition, [positionKey(source)]: 3 } }
    expect(positionKey(repeated)).toBe(positionKey(source))
    expect(search(source, strongest, fixed).command?.type).toBe('move')
    expect(search(repeated, strongest, fixed).command).toEqual({ type: 'claimRepetitionDraw' })
  })

  it('counts a newly completed hypothetical turn once and avoids offering the opponent a repetition claim', () => {
    const source = createPosition({
      pieces: [
        { side: 'white', type: 'king', square: 'h1' },
        { side: 'white', type: 'queen', square: 'a2' },
        { side: 'black', type: 'king', square: 'h8' },
        { side: 'black', type: 'pawn', square: 'g7' },
      ],
    })
    const best = search(source, strongest, fixed).command!
    const next = transitionKnownLegal(source, best).state
    const key = positionKey(next)
    expect(next.outcome).toBeNull()
    const prepared = { ...source, repetition: { ...source.repetition, [key]: 2 } }
    const snapshot = structuredClone(prepared)
    expect(transitionKnownLegal(prepared, best).state.repetition[key]).toBe(3)
    const adjusted = search(prepared, strongest, fixed)
    expect(adjusted.command).not.toEqual(best)
    expect(adjusted.diagnostics.score).toBeGreaterThan(0)
    expect(prepared).toEqual(snapshot)
  })

  it('retains the completed shallow decision when a later iteration hits the node budget', () => {
    const source = createInitialState()
    const shallow = search(source, getPreset(1)!, fixed)
    const result = search(source, getPreset(2)!, fixed)
    const interrupted = search(source, { ...getPreset(1)!, maxDepth: 3 }, {
      ...fixed, nodeLimit: shallow.diagnostics.nodes + 3,
    })
    expect(interrupted.diagnostics).toMatchObject({
      depth: 1, stopReason: 'node-limit', nodes: shallow.diagnostics.nodes + 3,
      score: shallow.diagnostics.score,
    })
    expect(interrupted.command).toEqual(shallow.command)
    expect(legalCommands(source)).toContainEqual(result.command)
  })

  it('returns a scored legal fallback for an expired deadline or canceled request', () => {
    const source = createInitialState()
    const legal = legalCommands(source)
    const deadline = search(source, strongest, { timeLimitMs: 0 })
    const cancelled = search(source, strongest, { cancelled: () => true })
    expect(deadline.diagnostics).toMatchObject({ depth: 0, nodes: 0, stopReason: 'deadline' })
    expect(cancelled.diagnostics).toMatchObject({ depth: 0, nodes: 0, stopReason: 'cancelled' })
    expect(legal).toContainEqual(deadline.command)
    expect(legal).toContainEqual(cancelled.command)
    expect(Number.isFinite(deadline.diagnostics.score)).toBe(true)
  })

  it('scores friendly bloodlust captures as the loss of their own piece', () => {
    const source = createPosition({
      pieces: [
        { side: 'white', type: 'king', square: 'h1' },
        { side: 'white', type: 'rook', square: 'd4', affliction: 'bloodlust', captureReaction: 'berserk',
          capturesSinceRebirth: 3 },
        { side: 'white', type: 'queen', square: 'd6' },
        { side: 'black', type: 'king', square: 'a8' },
        { side: 'black', type: 'pawn', square: 'a4' },
      ],
    })
    const friendly: Command = { type: 'move', from: 'd4', to: 'd6' }
    const enemy: Command = { type: 'move', from: 'd4', to: 'a4' }
    const legal = legalCommands(source)
    expect(legal).toContainEqual(friendly)
    expect(legal).toContainEqual(enemy)
    expect(search(source, strongest, fixed).command).not.toEqual(friendly)
  })

  it.each(PRESETS)('profile $id makes a legal evaluated decision without modifying live state', preset => {
    const source = chancePosition()
    const snapshot = structuredClone(source)
    const result = search(source, preset, fixed)
    expect(legalCommands(source)).toContainEqual(result.command)
    expect(result.diagnostics.depth).toBeGreaterThanOrEqual(1)
    expect(result.diagnostics.nodes).toBeGreaterThan(1)
    expect(result.diagnostics.nodes).toBeLessThanOrEqual(preset.maxNodes)
    expect(source).toEqual(snapshot)
  }, 30_000)

  it('weakens only within each profile’s band and preserves stable strongest decisions', () => {
    const source = createInitialState()
    const hardFirst = search(source, strongest, { ...fixed, random: () => 0 })
    const hardLast = search(source, strongest, { ...fixed, random: () => 0.999 })
    expect(hardFirst.command).toEqual(hardLast.command)

    const easy = getPreset(1)!
    const easyLast = search(source, easy, { ...fixed, random: () => 0.999 })
    expect(easyLast.command).not.toEqual(hardFirst.command)
    expect(easyLast.diagnostics.score!).toBeGreaterThanOrEqual(hardFirst.diagnostics.score! - easy.temperature * 3)
  })
})
