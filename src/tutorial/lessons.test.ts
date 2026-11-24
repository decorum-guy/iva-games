import { describe, expect, it } from 'vitest'
import { commandRejection, cyclesRemaining } from '../core'
import type { Command } from '../core/types'
import { captureLedger, createContinuation } from '../session/match'
import { nextDie } from '../session/random'
import { restoreMatch } from '../session/save'
import {
  advanceLesson, confirmInspection, guideCommands, instruction, learnerAction, restoreLearning,
  saveLearning, scriptAction, startLesson,
} from './controller'
import type { Learning } from './controller'
import { LESSONS } from './lessons'
import { move } from './lessonTypes'

function restored(progress: Learning): Learning {
  const copy = restoreLearning(JSON.parse(JSON.stringify(saveLearning(progress))))
  expect(copy.session.current).toEqual(progress.session.current)
  expect(copy.session.record.revision).toBe(progress.session.record.revision)
  expect(instruction(copy)?.id).toBe(instruction(progress)?.id)
  return copy
}

function transfer(progress: Learning, command: Command) {
  const result = learnerAction(progress, command)
  return result.progress
}

describe('interactive lesson fixtures', () => {
  it('restores the lesson 3 reading and position boundaries without inventing a required king move', () => {
    let progress = scriptAction(transfer(startLesson(2, 2), move('g2', 'g3')))
    expect(instruction(progress)).toMatchObject({ id: 'removal-material-only', kind: 'read' })
    expect(commandRejection(progress.session.state, move('h1', 'g1'))).toBeNull()

    // Existing v1 saves store the step index, not its copy. Keep their board and
    // progress intact: these are Continue decisions, not broken chess positions.
    for (const expectedStep of ['removal-material-only', undefined]) {
      progress = restored(progress)
      expect(instruction(progress)?.id).toBe(expectedStep)
      expect(guideCommands(progress)).toEqual([])
      const record = progress.session.record
      expect(() => learnerAction(progress, move('h1', 'g1'))).toThrow('tutorialChoice')
      expect(progress.session.record).toBe(record)
      progress = advanceLesson(progress)
    }

    expect(progress).toMatchObject({ lesson: 3, position: 0, index: 0 })
    expect(instruction(progress)?.id).toBe('start-two-cures')
    expect(guideCommands(progress)).toEqual([move('c1', 'e3')])
  })

  it('restores the actual king instruction in lesson 4 and completes both cures', () => {
    const beforeKing = restored(scriptAction(transfer(startLesson(3), move('c1', 'e3'))))
    expect(instruction(beforeKing)?.id).toBe('cure-two-pieces')
    expect(commandRejection(beforeKing.session.state, move('h1', 'g2'))).toBeNull()
    expect(guideCommands(beforeKing)).toEqual([move('h1', 'g1')])
    expect(() => learnerAction(beforeKing, move('h1', 'g2'))).toThrow('tutorialChoice')
    const afterKing = transfer(beforeKing, move('h1', 'g1'))
    expect(afterKing.session.current.events.filter(event => event.type === 'cure')).toHaveLength(2)
    expect(instruction(scriptAction(afterKing))?.id).toBe('bishop-pacifism')
  })

  it.each([0, 1, 2])('teaches every directed step with full state restored and promotion alternative %i', promotionIndex => {
    let progress = startLesson()
    let positions = 1
    let steps = 0
    const focusSteps: string[] = []

    while (!progress.complete) {
      const { session } = progress
      const current = instruction(progress)
      if (!current) {
        progress = advanceLesson(progress)
        positions++
        expect(progress.session.record.rootLedger).toEqual([])
        expect(Object.values(progress.session.state.repetition)).toEqual([1])
      } else {
        steps++
        expect(current.text.en.trim()).not.toBe('')
        expect(current.text.ru.trim()).not.toBe('')
        if (current.focus) {
          focusSteps.push(current.id)
          expect(['read', 'inspect']).toContain(current.kind)
          const piece = session.state.pieces.find(piece => piece.square === current.focus!.square)
          expect(piece, `${current.id} must focus a living piece`).toBeDefined()
          if (current.focus.subject === 'countdown') {
            expect(piece?.affliction).toBe('devastated')
            expect(cyclesRemaining(piece!, session.state)).toBeGreaterThan(0)
          }
        }
        switch (current.kind) {
          case 'inspect':
            expect(session.state.pieces.some(piece => piece.square === current.square)).toBe(true)
            progress = confirmInspection(progress, current.square)
            break
          case 'script':
            progress = scriptAction(progress)
            break
          case 'read':
            progress = advanceLesson(progress)
            break
          case 'move': {
            const choices = guideCommands(progress)
            expect(choices.length).toBeGreaterThan(0)
            const index = current.id === 'promote-inherit' ? promotionIndex : 0
            progress = transfer(progress, choices[index])
            const last = progress.session.record.actions.at(-1)
            expect(last?.roll?.fixed ?? false).toBe(Boolean(current.roll))
            if (current.roll) expect(last?.roll?.face).toBe(current.roll.face)
            break
          }
          case 'illegal': {
            const result = learnerAction(progress, current.move)
            expect(result.explanation).toBe(current.reason)
            expect(result.progress.session).toBe(session)
            progress = result.progress
            break
          }
        }
      }
      progress = restored(progress)
    }

    expect(LESSONS).toHaveLength(9)
    expect(positions).toBe(14)
    expect(steps).toBe(55)
    expect(focusSteps).toEqual(['inspect-countdown', 'promotion-clears-bonus'])
    expect(progress.session.state).toMatchObject({ side: 'white', phase: 'primary', outcome: null })
    expect(captureLedger(progress.session).map(event => event.victim.square)).toEqual(['c5'])
  })

  it('responds legally and exits to a stable position for every accepted open move', () => {
    const fixture = startLesson(LESSONS.length - 1)
    const open = scriptAction(transfer(fixture, move('d4', 'c5')))
    const choices = guideCommands(open)
    expect(choices.length).toBeGreaterThan(8)
    for (const command of choices) {
      const afterReply = scriptAction(transfer(open, command))
      const completed = advanceLesson(afterReply)
      expect(completed.complete).toBe(true)
      expect(completed.session.state).toMatchObject({ side: 'white', phase: 'primary', outcome: null })
      expect(captureLedger(completed.session).map(event => event.victim.square)).toEqual(['c5'])
    }
  })

  it('uses the ordinary seed on a new capture after handoff and keeps the practice root as the undo floor', () => {
    const open = scriptAction(transfer(startLesson(LESSONS.length - 1), move('d4', 'c5')))
    const complete = advanceLesson(scriptAction(transfer(open, move('a1', 'a2'))))
    const handoff = createContinuation(complete.session)
    expect(handoff.record.config).toMatchObject({ mode: 'practice', level: 4, provenance: 'handoff' })
    expect(handoff.record.root).toEqual(complete.session.state)
    expect(handoff.record.rootLedger).toEqual(captureLedger(complete.session))
    expect(handoff.undoTarget()).toBeNull()

    const capture = move('h3', 'g4')
    const result = handoff.submit(handoff.envelope(capture), 'human')
    const actual = result.record.actions[0].roll
    const ordinary = nextDie(handoff.current.seed)
    expect(actual).toEqual({ face: ordinary.face, fixed: false })
    expect(result.current.seed).toBe(ordinary.seed)
    expect(restoreMatch(JSON.parse(JSON.stringify(result.record))).current).toEqual(result.current)
    expect(result.undo().state).toEqual(handoff.state)
    expect(result.undo().undoTarget()).toBeNull()
  })
})
