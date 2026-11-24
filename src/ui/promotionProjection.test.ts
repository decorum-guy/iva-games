import { describe, expect, it } from 'vitest'
import { applyResolvedCommand, createPosition, enumerateOutcomes, legalCommands, pieceAt } from '../core'
import type { DieFace, PieceInput, Promotion } from '../core'
import { actionPlan } from '../scene/actionPresentation'
import { planSceneCues } from '../scene/audio'
import { promotionEvents, projectPromotion } from './promotionProjection'

const base = [
  { side: 'white', type: 'king', square: 'h2' },
  { side: 'black', type: 'king', square: 'h6' },
  { side: 'white', type: 'pawn', square: 'b7' },
  { side: 'black', type: 'rook', square: 'a8' },
] as const satisfies readonly PieceInput[]
const choices = ['queen', 'rook', 'bishop', 'knight'] as const
const faces = [1, 2, 3, 4, 5, 6] as const
const cases = choices.flatMap(kind => faces.map(face => ({ kind, face })))

function capture(kind: Promotion, face?: DieFace, pieces: readonly PieceInput[] = base) {
  const state = createPosition({ pieces })
  const move = { type: 'move' as const, from: 'b7', to: 'a8', promotion: kind }
  const committed = applyResolvedCommand(state, move, face)
  const schedule = actionPlan(committed.events, face !== undefined, false, false)
  return { state, move, committed, schedule, plan: schedule.promotion! }
}

describe('promotion presents the committed action in causal stages', () => {
  it.each(cases)('keeps the pawn through capture and face $face before forming $kind', ({ kind, face }) => {
    const { state, committed, schedule, plan } = capture(kind, face)
    const before = pieceAt(state, 'b7')!
    const afterContact = projectPromotion(committed.state, state, plan, 'contact')
    const shown = projectPromotion(committed.state, state, plan, 'reaction')
    const formed = projectPromotion(committed.state, state, plan, 'formation')
    expect(pieceAt(afterContact, 'a8')).toMatchObject({ id: before.id, type: 'pawn', affliction: 'neutral' })
    expect(pieceAt(afterContact, 'b7')).toBeUndefined()
    expect(pieceAt(afterContact, 'a8')?.side).toBe('white')
    expect(afterContact.turnSerial).toBe(state.turnSerial)
    expect(pieceAt(shown, 'a8')).toEqual(plan.event.piece)
    expect(pieceAt(formed, 'a8')).toMatchObject({ id: before.id, type: kind })
    expect(pieceAt(committed.state, 'a8')).toMatchObject({ type: kind, id: before.id })
    expect(projectPromotion(committed.state, state, plan, 'aftermath')).toBe(committed.state)

    if (kind === 'bishop') {
      expect(pieceAt(formed, 'a8')).toMatchObject({ affliction: 'neutral', captureReaction: 'unassigned', capturesSinceRebirth: 0 })
      expect(committed.state.phase).toBe('primary')
      expect(committed.events.some(event => event.type === 'cure')).toBe(false)
    } else {
      expect(pieceAt(formed, 'a8')).toMatchObject({ affliction: plan.event.piece.affliction,
        captureReaction: plan.event.piece.captureReaction, capturesSinceRebirth: 1 })
      if (face === 6) {
        expect(committed.state.phase).toBe('bonus')
        expect(legalCommands(committed.state)).toContainEqual({ type: 'endTurn' })
        expect(legalCommands(committed.state).some(command => command.type === 'move' && command.from === 'a8')).toBe(true)
      }
    }
    expect(schedule.roll!.start).toBeGreaterThan(0)
    expect(plan.reactionAt).toBe(schedule.roll!.settle)
    expect(plan.formationAt).toBeGreaterThan(schedule.roll!.settle)
    expect(promotionEvents(plan, 'contact').map(event => event.type)).toEqual(['move', 'capture'])
    expect(promotionEvents(plan, 'reaction')).toEqual([expect.objectContaining({ type: 'reaction', face })])
  })

  it('reveals a remembered reaction and a bishop penalty without inventing a roll', () => {
    for (const cause of ['memory', 'bishop'] as const) {
      const root = base.map(piece => {
        if (cause === 'bishop' && piece.square === 'a8') return { ...piece, type: 'bishop' } as const
        if (cause === 'memory' && piece.square === 'b7') return { ...piece, captureReaction: 'guilt', capturesSinceRebirth: 1 } as const
        return piece
      })
      const { committed, schedule, plan } = capture('rook', undefined, root)
      expect(schedule.roll).toBeNull()
      expect(plan.reactionAt).not.toBeNull()
      const reaction = promotionEvents(plan, 'reaction')[0]
      expect(reaction).toMatchObject({ type: 'reaction', cause })
      expect(reaction?.type === 'reaction' ? reaction.face : null).toBeUndefined()
      expect(planSceneCues(committed.events, { plan: schedule }).map(cue => cue.kind)).toEqual([
        'capture', cause === 'bishop' ? 'devastated' : 'guilt', 'promotionRookApproach', 'promotionRookImpact',
      ])
    }
  })

  it('keeps the reaction before the coronation, followed by the real rally', () => {
    const pieces = base.map(piece => piece.square === 'h2' ? { ...piece, square: 'b8' } : piece)
    const { state, move, committed, schedule, plan } = capture('queen', 2, pieces)
    expect(enumerateOutcomes(state, move)).toHaveLength(4)
    expect(plan.formed.affliction).toBe('guilt')
    expect(pieceAt(committed.state, 'a8')?.affliction).toBe('neutral')
    expect(plan.aftermathAt).toBeLessThan(schedule.end)
    const cure = promotionEvents(plan, 'aftermath').find(event => event.type === 'cure')
    expect(cure).toMatchObject({ type: 'cure', cause: 'rally', piece: { type: 'queen' } })
    const cues = planSceneCues(committed.events, { plan: schedule })
    expect(cues.map(cue => cue.kind)).toEqual([
      'capture', 'dice', 'guilt', 'promotionQueenApproach', 'promotionQueenImpact',
      'promotionQueenFracture', 'promotionQueenArc', 'heal',
    ])
    expect(cues.every((cue, index) => !index || cue.at > cues[index - 1].at)).toBe(true)
  })

  it('escalates the rolled six to bloodlust on the pawn before birth', () => {
    const pieces = base.map(piece => piece.square === 'b7' ? { ...piece, capturesSinceRebirth: 2 } : piece)
    const { state, committed, schedule, plan } = capture('rook', 6, pieces)
    expect(plan.reactingPawn.affliction).toBe('berserk')
    expect(pieceAt(projectPromotion(committed.state, state, plan, 'surge'), 'a8')).toMatchObject({
      type: 'pawn', affliction: 'bloodlust', capturesSinceRebirth: 3,
    })
    expect(plan.formed).toMatchObject({ type: 'rook', affliction: 'bloodlust' })
    const cues = planSceneCues(committed.events, { plan: schedule })
    expect(cues.map(cue => cue.kind)).toEqual(['capture', 'dice', 'berserk', 'bloodlust', 'promotionRookApproach', 'promotionRookImpact'])
    expect(cues[3].at).toBeGreaterThan(cues[2].at)
  })

  it('keeps a previously guilty pawn guilty on a quiet promotion without a new effect', () => {
    const state = createPosition({ pieces: base.filter(piece => piece.square !== 'a8')
      .map(piece => piece.square === 'b7' ? { ...piece, affliction: 'guilt', captureReaction: 'guilt' } : piece) })
    const result = applyResolvedCommand(state, { type: 'move', from: 'b7', to: 'b8', promotion: 'knight' })
    const plan = actionPlan(result.events, false, true, false)
    expect(plan.promotion?.formed).toMatchObject({ type: 'knight', affliction: 'guilt' })
    expect(planSceneCues(result.events, { plan }).map(cue => cue.kind)).toEqual(['move', 'promotionFormation'])
  })
})
