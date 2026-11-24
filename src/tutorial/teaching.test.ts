import { describe, expect, it } from 'vitest'
import { commandRejection } from '../core'
import {
  acknowledgeTeaching, advanceLesson, confirmInspection, guideCommands, instruction, learnerAction,
  restoreLearning, saveLearning, scriptAction, startLesson, teachingBeat,
} from './controller'
import type { Learning } from './controller'
import { LESSONS } from './lessons'
import { move } from './lessonTypes'

function acknowledgeAll(progress: Learning): Learning {
  while (progress.pendingTeaching) progress = acknowledgeTeaching(progress)
  return progress
}

const captureWithGuilt = () => learnerAction(startLesson(1), move('c3', 'c4')).progress

describe('required explanations follow the committed event', () => {
  it('holds the first guilt result before the opponent demonstrates its consequence', () => {
    const progress = captureWithGuilt()
    expect(progress.pendingTeaching).toEqual({ stepId: 'guilt-roll', beatIndex: 0 })
    expect(instruction(progress)?.id).toBe('guilty-still-blocks')
    expect(teachingBeat(progress)?.focus).toEqual({ square: 'c4', subject: 'piece' })
    expect(progress.session.current.events).toContainEqual(expect.objectContaining({ type: 'reaction', face: 2, affliction: 'guilt' }))
    expect(progress.session.state).toMatchObject({ side: 'black', turnSerial: 1 })
    expect(progress.complete).toBe(false)
    expect(guideCommands(progress)).toEqual([])
    expect(() => scriptAction(progress)).toThrow('tutorialChoice')
    expect(() => learnerAction(progress, move('c8', 'c7'))).toThrow('tutorialChoice')
    expect(confirmInspection(progress, 'c4')).toBe(progress)

    const after = acknowledgeAll(progress)
    expect(after.index).toBe(progress.index)
    expect(after.session).toBe(progress.session)
    expect(after.pendingTeaching).toBeUndefined()
    const replied = scriptAction(after)
    expect(replied.session.record.cursor).toBe(2)
    expect(replied.session.state.pieces.find(piece => piece.type === 'king' && piece.side === 'black')?.square).toBe('c7')
  })

  it('keeps each first-roll explanation separate without changing the recorded result or turn', () => {
    let progress = scriptAction(learnerAction(startLesson(), move('e2', 'e4')).progress)
    progress = learnerAction(progress, move('e4', 'd5')).progress
    const source = LESSONS[0].positions[0].steps.find(step => step.id === 'capture-and-roll')!
    expect(source.after!.length).toBeGreaterThanOrEqual(2)
    const session = progress.session
    const originalIndex = progress.index
    const seen: string[] = []
    while (progress.pendingTeaching) {
      const beat = teachingBeat(progress)!
      seen.push(beat.id)
      const saved = saveLearning(progress)
      const loaded = restoreLearning(JSON.parse(JSON.stringify(saved)))
      expect(loaded.pendingTeaching).toEqual(progress.pendingTeaching)
      expect(loaded.session.current).toEqual(session.current)
      expect(teachingBeat(loaded)?.id).toBe(beat.id)
      expect(loaded.complete).toBe(false)
      progress = advanceLesson(progress)
      expect(progress.index).toBe(originalIndex)
      expect(progress.session).toBe(session)
    }
    expect(seen).toEqual(source.after!.map(beat => beat.id))
    expect(source.after!.some(beat => beat.diceLegend)).toBe(true)
    expect(session.record.actions.filter(action => action.roll)).toHaveLength(1)
    expect(session.record.actions.at(-1)?.roll?.face).toBe(4)
    expect(instruction(progress)?.id).toBe('faces-and-material')
    expect(() => acknowledgeTeaching(progress)).toThrow('tutorialChoice')
  })

  it('reports a requested illegal attempt as a successful rule experiment with no new action', () => {
    const before = acknowledgeAll(scriptAction(acknowledgeAll(captureWithGuilt())))
    expect(instruction(before)?.id).toBe('guilt-forbids-capture')
    expect(commandRejection(before.session.state, move('c4', 'd4'))).toBe('guiltCapture')
    const result = learnerAction(before, move('c4', 'd4'))
    expect(result.explanation).toBeUndefined()
    expect(result.progress.pendingTeaching?.stepId).toBe('guilt-forbids-capture')
    expect(teachingBeat(result.progress)?.text.ru).toBeTruthy()
    expect(result.progress.session).toBe(before.session)
    expect(result.progress.session.state).toBe(before.session.state)
    const loaded = restoreLearning(JSON.parse(JSON.stringify(saveLearning(result.progress))))
    expect(loaded.session.current).toEqual(before.session.current)
    expect(acknowledgeAll(loaded).index).toBe(result.progress.index)
  })
})

describe('teaching checkpoint validation and compatibility', () => {
  it('keeps a legacy v1 checkpoint at the same next instruction without injecting an old result', () => {
    const fresh = saveLearning(captureWithGuilt())
    const legacy = { ...fresh }
    delete legacy.pendingTeaching
    const restored = restoreLearning(legacy)
    expect(restored.index).toBe(fresh.index)
    expect(restored.pendingTeaching).toBeUndefined()
    expect(teachingBeat(restored)).toBeUndefined()
    expect(restored.session.record).toMatchObject(fresh.match)
    expect(instruction(restored)?.id).toBe('guilty-still-blocks')
    expect(scriptAction(restored).session.record.cursor).toBe(fresh.match.cursor + 1)
  })

  it.each([
    null,
    'guilt-roll',
    { stepId: 'guilt-roll', beatIndex: -1 },
    { stepId: 'guilt-roll', beatIndex: 0.5 },
    { stepId: 'guilt-roll', beatIndex: 100 },
    { stepId: 'guilty-still-blocks', beatIndex: 0 },
    { stepId: 'capture-and-roll', beatIndex: 0 },
    { stepId: 'guilt-roll', beatIndex: '0' },
  ])('rejects an invalid or unrelated pending explanation: %j', pendingTeaching => {
    expect(() => restoreLearning({ ...saveLearning(captureWithGuilt()), pendingTeaching })).toThrow('invalidSave')
  })

  it('rejects a result relinked to an uncommitted command or marked complete before acknowledgement', () => {
    const saved = saveLearning(captureWithGuilt())
    expect(() => restoreLearning({ ...saved, complete: true })).toThrow('invalidSave')
    expect(() => restoreLearning({ ...saved, match: {
      ...saved.match, actions: saved.match.actions.map(action => ({ ...action, id: 'not-the-authored-step' })),
    } })).toThrow('invalidSave')
    expect(() => restoreLearning({ ...saved, index: 0 })).toThrow('invalidSave')
  })
})
