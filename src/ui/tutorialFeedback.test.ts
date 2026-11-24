import { describe, expect, it } from 'vitest'
import { applyResolvedCommand, legalCommands } from '../core'
import type { Move } from '../core'
import { acknowledgeTeaching, guideCommands, instruction, learnerAction, scriptAction, startLesson } from '../tutorial/controller'
import type { Learning } from '../tutorial/controller'
import { move } from '../tutorial/lessonTypes'
import { effectTiming } from './effectTiming'
import { tutorialChoiceFeedback } from './tutorialFeedback'

function acknowledged(learning: Learning) {
  while (learning.pendingTeaching) learning = acknowledgeTeaching(learning)
  return learning
}

function lastChoice(command: Move) {
  let learning = acknowledged(learnerAction(startLesson(8), move('d4', 'c5')).progress)
  learning = acknowledged(scriptAction(learning))
  expect(instruction(learning)?.id).toBe('open-quiet-choice')
  expect(guideCommands(learning)).toContainEqual(command)
  learning = acknowledged(learnerAction(learning, command).progress)
  learning = acknowledged(scriptAction(learning))
  expect(instruction(learning)?.id).toBe('practice-ready')
  return learning
}

describe('feedback for the final free decision', () => {
  it('explains that the bishop cures the knight after White’s next turn, before its two-turn removal deadline', () => {
    const learning = lastChoice(move('f1', 'd3'))
    const state = learning.session.state
    const knight = state.pieces.find(piece => piece.square === 'c3')!
    expect(state.turnSerial).toBe(4)
    expect(effectTiming(knight, state)).toEqual({ removal: 2, cure: 1, shame: null })
    const ru = tutorialChoiceFeedback(learning, 'ru')!
    expect(ru.kind).toBe('healing')
    expect(ru.text).toContain('Слон начал лечить коня c3')
    expect(ru.text).toContain('после следующего хода белых')
    expect(ru.rule).toContain('2 хода игроков')
    expect(tutorialChoiceFeedback(learning, 'en')?.text).toContain('after White’s next turn')
    const next = applyResolvedCommand(state, move('g1', 'h2'))
    expect(next.events).toContainEqual(expect.objectContaining({ type: 'cure', piece: expect.objectContaining({ id: knight.id }) }))
    expect(next.state.pieces.find(piece => piece.id === knight.id)?.affliction).toBe('neutral')
  })

  it('states the actual risk after another legal quiet move, without praising it as a correct rescue', () => {
    const learning = lastChoice(move('a1', 'a2'))
    const state = learning.session.state
    const knight = state.pieces.find(piece => piece.square === 'c3')!
    expect(effectTiming(knight, state)).toEqual({ removal: 2, cure: null, shame: null })
    const ru = tutorialChoiceFeedback(learning, 'ru')!
    expect(ru.kind).toBe('unassisted')
    expect(ru.text).toContain('Без помощи он исчезнет после хода белых и ответа чёрных')
    expect(ru.text).not.toMatch(/правильн|отличн|молодец|спасли/i)
    expect(ru.rule).toBeUndefined()
    expect(tutorialChoiceFeedback(learning, 'en')?.text).toContain('after White’s turn and Black’s reply')
    const next = applyResolvedCommand(state, move('g1', 'h2')).state
    expect(next.pieces.some(piece => piece.id === knight.id)).toBe(true)
    const reply = legalCommands(next).find((command): command is Move => command.type === 'move'
      && !next.pieces.some(piece => piece.square === command.to))!
    const expired = applyResolvedCommand(next, reply)
    expect(expired.events).toContainEqual(expect.objectContaining({ type: 'remove', piece: expect.objectContaining({ id: knight.id }) }))
    expect(expired.state.pieces.some(piece => piece.id === knight.id)).toBe(false)
  })

  it('does not replace earlier explanations or the open decision with feedback from a future position', () => {
    const start = startLesson(8)
    expect(tutorialChoiceFeedback(start, 'ru')).toBeUndefined()
    const pending = learnerAction(startLesson(1), move('c3', 'c4')).progress
    expect(pending.pendingTeaching).toBeDefined()
    expect(tutorialChoiceFeedback(pending, 'ru')).toBeUndefined()
    const choice = acknowledged(scriptAction(acknowledged(learnerAction(start, move('d4', 'c5')).progress)))
    expect(instruction(choice)?.id).toBe('open-quiet-choice')
    expect(tutorialChoiceFeedback(choice, 'en')).toBeUndefined()
  })
})
