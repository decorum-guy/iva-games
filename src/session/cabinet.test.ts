import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPosition } from '../core'
import type { Command } from '../core'
import type { SearchRequest, SearchResponse } from '../engine/protocol'
import { getDieMotionTiming } from '../scene/diceMotion'
import { CAMERA_TRAVEL_MS } from '../scene/cameraFocus'
import * as database from '../storage/database'
import { acknowledgeTeaching, learnerAction, saveLearning, scriptAction, startLesson, teachingBeat } from '../tutorial/controller'
import type { Learning } from '../tutorial/controller'
import { Cabinet } from './cabinet'
import { createMatch, SessionError } from './match'
import { nextDie } from './random'
import { exportMatch } from './save'

const hotseat = { mode: 'hotseat', human: null, level: null, provenance: 'standard' } as const
const move = (from: string, to: string): Command => ({ type: 'move', from, to })

class TestWorker {
  static instances: TestWorker[] = []
  request: SearchRequest | undefined
  onmessage: ((event: MessageEvent<SearchResponse>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  constructor() { TestWorker.instances.push(this) }
  postMessage(request: SearchRequest) { this.request = request }
  reply(command: Command) {
    if (!this.request) throw new Error('No search request')
    this.onmessage?.(new MessageEvent<SearchResponse>('message', { data: {
      ...this.request, type: 'result', command,
      diagnostics: { depth: 1, nodes: 1, elapsedMs: 1, stopReason: 'max-depth', score: 0 },
    } }))
  }
}

let store: database.GameStore
let cabinet: Cabinet
let cabinets: Cabinet[]

beforeEach(async () => {
  // Keep fake IndexedDB's real asynchronous tasks; control only presentation/worker deadlines.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const preferences = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => { preferences.set(key, value) },
  })
  vi.stubGlobal('BroadcastChannel', undefined)
  vi.stubGlobal('Worker', TestWorker)
  TestWorker.instances = []
  store = await database.openGameStore(`cabinet-audio-${crypto.randomUUID()}`)
  vi.spyOn(database, 'openGameStore').mockResolvedValue(store)
  cabinet = new Cabinet()
  cabinets = [cabinet]
  await cabinet.initialize()
  expect(cabinet.getSnapshot().durable).toBe(true)
})

afterEach(async () => {
  for (const current of cabinets) await current.home()
  store.close()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function observeCues(current = cabinet) {
  const ids: string[] = []
  let last = current.getSnapshot().audioCue
  current.subscribe(() => {
    const cue = current.getSnapshot().audioCue
    if (cue && cue !== last) ids.push(cue.id)
    last = cue
  })
  return ids
}

function settled(current: Cabinet) {
  if (!current.getSnapshot().busy) return Promise.resolve()
  return new Promise<void>(resolve => {
    const unsubscribe = current.subscribe(() => {
      if (!current.getSnapshot().busy) { unsubscribe(); resolve() }
    })
  })
}

function until(current: Cabinet, predicate: () => boolean) {
  if (predicate()) return Promise.resolve()
  return new Promise<void>(resolve => {
    const unsubscribe = current.subscribe(() => {
      if (predicate()) { unsubscribe(); resolve() }
    })
  })
}

async function finishMotion() {
  await vi.advanceTimersByTimeAsync(2000)
}

describe('Cabinet live audio delivery', () => {
  it('emits one move cue only after persistence commits, including during concurrent input', async () => {
    await cabinet.startGame(hotseat)
    const ids = observeCues()
    const commit = store.commit.bind(store)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(store, 'commit').mockImplementationOnce(async (before, after) => {
      await gate
      return commit(before, after)
    })

    const action = cabinet.command(move('e2', 'e4'))
    expect(cabinet.getSnapshot().audioCue).toBeNull()
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(0)
    expect(await cabinet.command(move('d2', 'd4'))).toBe(false)
    release()
    expect(await action).toBe(true)

    const snap = cabinet.getSnapshot()
    expect(snap.audioCue?.events).toEqual(snap.game?.current.events)
    expect(snap.audioCue?.events).toContainEqual(expect.objectContaining({ type: 'move', from: 'e2', to: 'e4' }))
    expect(snap.audioCue?.human).toBeNull()
    expect(snap.animating).toBe(true)
    expect(ids).toHaveLength(1)
    await finishMotion()
    cabinet.dismissError()
    expect(ids).toHaveLength(1)
    expect(cabinet.getSnapshot().animating).toBe(false)
  })

  it.each(['resign', 'agreeDraw'] as const)('delivers a %s outcome with no movement animation', async type => {
    await cabinet.startGame(hotseat)
    const ids = observeCues()
    expect(await cabinet.command({ type })).toBe(true)
    const snap = cabinet.getSnapshot()
    expect(snap.animating).toBe(false)
    expect(snap.audioCue?.events).toEqual([expect.objectContaining({ type: 'outcome', outcome: {
      reason: type === 'resign' ? 'resignation' : 'agreement', winner: type === 'resign' ? 'black' : null,
    } })])
    expect(ids).toHaveLength(1)
    await finishMotion()
    expect(ids).toHaveLength(1)
  })

  it('starts committed presentation without waiting for a slow overview refresh', async () => {
    await cabinet.startGame(hotseat)
    const overview = store.overview.bind(store)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(store, 'overview').mockImplementationOnce(async () => { await gate; return overview() })
    const displayed = until(cabinet, () => cabinet.getSnapshot().game?.record.cursor === 1)
    const action = cabinet.command(move('e2', 'e4'))
    await displayed
    expect(cabinet.getSnapshot().busy).toBe(true)
    expect(cabinet.getSnapshot().animating).toBe(true)
    expect(cabinet.getSnapshot().audioCue?.events).toEqual(cabinet.getSnapshot().game?.current.events)
    release()
    expect(await action).toBe(true)
  })

  it('replaces a move cue on immediate resignation and cancels the old presentation timer', async () => {
    await cabinet.startGame(hotseat)
    const ids = observeCues()
    await cabinet.command(move('e2', 'e4'))
    const previous = cabinet.getSnapshot()
    await cabinet.command({ type: 'resign' })
    const ended = cabinet.getSnapshot()
    expect(ended.motionKey).not.toBe(previous.motionKey)
    expect(ended.audioCue?.id).not.toBe(previous.audioCue?.id)
    expect(ended.audioCue?.events.some(event => event.type === 'outcome')).toBe(true)
    expect(ended.animating).toBe(false)
    await finishMotion()
    expect(ids).toHaveLength(2)
    expect(cabinet.getSnapshot().audioCue).toBe(ended.audioCue)
  })

  it('does not announce a move rejected by storage or by the rules', async () => {
    await cabinet.startGame(hotseat)
    await cabinet.command(move('e2', 'e4'))
    await finishMotion()
    const before = cabinet.getSnapshot()
    const ids = observeCues()
    cabinet.dismissError()
    vi.spyOn(store, 'commit').mockRejectedValueOnce(new SessionError('storage'))
    expect(await cabinet.command(move('e7', 'e5'))).toBe(false)
    expect(cabinet.getSnapshot().game).toBe(before.game)
    expect(cabinet.getSnapshot().audioCue).toBe(before.audioCue)
    expect(await cabinet.command(move('e7', 'e4'))).toBe(false)
    expect(cabinet.getSnapshot().audioCue).toBe(before.audioCue)
    expect(ids).toHaveLength(0)
  })

  it('keeps restore, import and auto-resume silent even when saved events contain a move', async () => {
    await cabinet.startGame(hotseat)
    await cabinet.command(move('e2', 'e4'))
    const game = cabinet.getSnapshot().game!
    const ids = observeCues()
    await cabinet.home()
    await cabinet.resumeGame(game.record.id)
    expect(cabinet.getSnapshot().game?.current.events.length).toBeGreaterThan(0)
    expect(cabinet.getSnapshot().audioCue).toBeNull()
    const reloaded = new Cabinet()
    cabinets.push(reloaded)
    await reloaded.initialize()
    expect(reloaded.getSnapshot().view).toBe('game')
    expect(reloaded.getSnapshot().game?.record.cursor).toBe(1)
    expect(reloaded.getSnapshot().audioCue).toBeNull()
    await cabinet.loadFile(exportMatch(game))
    expect(cabinet.getSnapshot().game?.record.config.provenance).toBe('import')
    expect(cabinet.getSnapshot().audioCue).toBeNull()
    expect(ids).toEqual([])
  })

  it('keeps undo and redo silent, then gives a newly committed branch a new cue', async () => {
    await cabinet.startGame(hotseat)
    const ids = observeCues()
    await cabinet.command(move('e2', 'e4'))
    await finishMotion()
    await cabinet.command(move('e7', 'e5'))
    await cabinet.edit('undo')
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
    expect(cabinet.getSnapshot().audioCue).toBeNull()
    await cabinet.edit('redo')
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(2)
    expect(cabinet.getSnapshot().audioCue).toBeNull()
    await cabinet.edit('undo')
    await cabinet.command(move('c7', 'c5'))
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(cabinet.getSnapshot().audioCue?.events).toContainEqual(expect.objectContaining({ type: 'move', from: 'c7', to: 'c5' }))
  })

  it('delivers the first AI move once for a human playing black and ignores duplicate worker replies', async () => {
    const ids = observeCues()
    await cabinet.startGame({ mode: 'practice', human: 'black', level: 4, provenance: 'standard' })
    expect(cabinet.getSnapshot().audioCue).toBeNull()
    const worker = TestWorker.instances.at(-1)!
    worker.reply(move('e2', 'e4'))
    await settled(cabinet)
    expect(cabinet.getSnapshot().audioCue?.human).toBe('black')
    expect(cabinet.getSnapshot().audioCue?.events).toContainEqual(expect.objectContaining({ type: 'move', from: 'e2', to: 'e4' }))
    worker.reply(move('e2', 'e4'))
    expect(ids).toHaveLength(1)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
  })

  it('ignores a late AI answer after leaving its session', async () => {
    const ids = observeCues()
    await cabinet.startGame({ mode: 'practice', human: 'black', level: 4, provenance: 'standard' })
    const worker = TestWorker.instances.at(-1)!
    await cabinet.home()
    worker.reply(move('e2', 'e4'))
    expect(cabinet.getSnapshot().audioCue).toBeNull()
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(0)
    expect(ids).toEqual([])
  })
})

describe('Cabinet shared die presentation timeline', () => {
  async function captureReady() {
    // Pick an ordinary reproducible stream whose first roll passes the turn to the AI.
    const seed = Array.from({ length: 100 }, (_, value) => value).find(value => nextDie(value).face === 4)
    if (seed === undefined) throw new Error('Missing unaffected test seed')
    const game = createMatch({ mode: 'practice', human: 'white', level: 4, provenance: 'standard' }, {
      seed,
      root: createPosition({ pieces: [
        { type: 'king', side: 'white', square: 'h1' },
        { type: 'king', side: 'black', square: 'a8' },
        { type: 'rook', side: 'white', square: 'd4' },
        { type: 'pawn', side: 'black', square: 'd5' },
      ] }),
    })
    await store.addPractice(game)
    expect(await cabinet.resumeGame(game.record.id)).toBe(true)
    return game
  }

  it.each([false, true])('reveals the committed face on settle and releases AI after the hold (reduced=%s)', async reduced => {
    await captureReady()
    cabinet.setShortMotion(reduced)
    const timing = getDieMotionTiming(reduced)
    await cabinet.command(move('d4', 'd5'))
    const committed = cabinet.getSnapshot()
    expect(committed.game?.current.events).toContainEqual(expect.objectContaining({ type: 'reaction', face: 4 }))
    expect(committed.game?.state.side).toBe('black')
    expect(committed.rollPhase).toBe('throwing')
    expect(committed.rollReduced).toBe(reduced)
    expect(committed.animating).toBe(true)
    expect(TestWorker.instances).toHaveLength(0)

    // A preference change cannot retime a throw already in progress.
    cabinet.setShortMotion(!reduced)
    await vi.advanceTimersByTimeAsync(timing.motionMs - 1)
    expect(cabinet.getSnapshot().rollPhase).toBe('throwing')
    expect(cabinet.getSnapshot().rollReduced).toBe(reduced)
    await vi.advanceTimersByTimeAsync(1)
    expect(cabinet.getSnapshot().rollPhase).toBe('settled')
    expect(cabinet.getSnapshot().animating).toBe(true)
    expect(TestWorker.instances).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(timing.holdMs - 1)
    expect(cabinet.getSnapshot().animating).toBe(true)
    expect(TestWorker.instances).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(cabinet.getSnapshot().rollPhase).toBe('idle')
    expect(cabinet.getSnapshot().animating).toBe(false)
    expect(TestWorker.instances).toHaveLength(1)
  })

  it.each([false, true])('cancels both die timers and the transient cue when undo interrupts a throw (reduced=%s)', async reduced => {
    const original = await captureReady()
    cabinet.setShortMotion(reduced)
    const timing = getDieMotionTiming(reduced)
    const ids = observeCues()
    await cabinet.command(move('d4', 'd5'))
    const motionKey = cabinet.getSnapshot().motionKey
    await vi.advanceTimersByTimeAsync(timing.motionMs / 2)
    expect(await cabinet.edit('undo')).toBe(true)
    const undone = cabinet.getSnapshot()
    expect(undone.game?.state).toEqual(original.state)
    expect(undone.motionKey).not.toBe(motionKey)
    expect(undone.audioCue).toBeNull()
    expect(undone.rollPhase).toBe('idle')
    expect(undone.animating).toBe(false)
    await vi.advanceTimersByTimeAsync(timing.totalMs + 1000)
    expect(cabinet.getSnapshot().rollPhase).toBe('idle')
    expect(cabinet.getSnapshot().audioCue).toBeNull()
    expect(TestWorker.instances).toHaveLength(0)
    expect(ids).toHaveLength(1)
  })
})

describe('Cabinet acknowledged tutorial results', () => {
  function acknowledgeAll(progress: Learning): Learning {
    while (progress.pendingTeaching) progress = acknowledgeTeaching(progress)
    return progress
  }

  async function tutorialReady(progress = startLesson(1)) {
    await store.putLearning(saveLearning(progress))
    const current = new Cabinet()
    cabinets.push(current)
    await current.initialize()
    await current.learn()
    return current
  }

  async function acknowledgeResults(current: Cabinet) {
    while (current.getSnapshot().learning?.pendingTeaching) {
      await current.advance()
      if (current.getSnapshot().learning?.pendingTeaching && current.getSnapshot().teachingReturning) {
        await vi.advanceTimersByTimeAsync(CAMERA_TRAVEL_MS)
      }
    }
  }

  it.each([false, true])('waits for the result acknowledgement and camera return before the opponent moves (reduced=%s)', async reduced => {
    const current = await tutorialReady()
    current.setShortMotion(reduced)
    const timing = getDieMotionTiming(reduced)
    await current.command(move('c3', 'c4'))
    const committed = current.getSnapshot().learning!
    expect(committed.pendingTeaching?.stepId).toBe('guilt-roll')
    expect(teachingBeat(committed)?.focus?.square).toBe('c4')
    expect(current.getSnapshot().rollPhase).toBe('throwing')
    const saved = await store.getLearning()
    expect(saved).toEqual(saveLearning(committed))

    // A premature click cannot consume result text while its die still spins.
    await current.advance()
    expect(current.getSnapshot().learning).toBe(committed)
    await vi.advanceTimersByTimeAsync(timing.motionMs)
    expect(current.getSnapshot().rollPhase).toBe('settled')
    expect(current.getSnapshot().learning).toBe(committed)
    await vi.advanceTimersByTimeAsync(timing.holdMs + 5000)
    expect(current.getSnapshot().animating).toBe(false)
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(1)
    expect(current.getSnapshot().learning?.pendingTeaching).toEqual(committed.pendingTeaching)

    await acknowledgeResults(current)
    const acknowledged = current.getSnapshot()
    expect(acknowledged.learning?.session).toBe(committed.session)
    expect(acknowledged.learning?.index).toBe(committed.index)
    expect(acknowledged.teachingReturning).toBe(!reduced)
    if (!reduced) {
      await current.command(move('c8', 'c7'))
      expect(current.getSnapshot().learning?.session.record.cursor).toBe(1)
      expect(current.getSnapshot().error).toBeNull()
      await vi.advanceTimersByTimeAsync(CAMERA_TRAVEL_MS - 1)
      expect(current.getSnapshot().teachingReturning).toBe(true)
      expect(current.getSnapshot().learning?.session.record.cursor).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(current.getSnapshot().teachingReturning).toBe(false)
    }
    const scriptDelay = reduced ? 100 : 320
    await vi.advanceTimersByTimeAsync(scriptDelay - 1)
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await settled(current)
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(2)
    expect(current.getSnapshot().learning?.session.state.pieces.find(piece => piece.type === 'king' && piece.side === 'black')?.square).toBe('c7')
    expect(current.getSnapshot().learning?.session.record.actions.filter(action => action.roll)).toHaveLength(1)
  })

  it('restores a pending explanation without another roll, sound or scripted opponent action', async () => {
    const current = await tutorialReady()
    await current.command(move('c3', 'c4'))
    const committed = current.getSnapshot().learning!
    const loaded = new Cabinet()
    cabinets.push(loaded)
    await loaded.initialize()
    expect(loaded.getSnapshot().view).toBe('learn')
    expect(loaded.getSnapshot().learning?.pendingTeaching).toEqual(committed.pendingTeaching)
    expect(loaded.getSnapshot().learning?.session.current).toEqual(committed.session.current)
    expect(loaded.getSnapshot().audioCue).toBeNull()
    expect(loaded.getSnapshot().rollPhase).toBe('idle')
    expect(loaded.getSnapshot().teachingReturning).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(loaded.getSnapshot().learning?.session.record.cursor).toBe(1)
    expect(loaded.getSnapshot().audioCue).toBeNull()
    expect(loaded.getSnapshot().learning?.session.state.repetition).toEqual(committed.session.state.repetition)
  })

  it.each(['home', 'restartLesson'] as const)('cancels the camera return and delayed script when %s interrupts', async action => {
    const current = await tutorialReady()
    await current.command(move('c3', 'c4'))
    await finishMotion()
    await acknowledgeResults(current)
    expect(current.getSnapshot().teachingReturning).toBe(true)
    await current[action]()
    const stopped = current.getSnapshot()
    // Restart may own a fresh return for its new board; the old script and
    // previous generation's timer must still be canceled.
    expect(stopped.teachingReturning).toBe(action === 'restartLesson')
    expect(stopped.audioCue).toBeNull()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(current.getSnapshot().learning).toBe(stopped.learning)
    expect(current.getSnapshot().teachingReturning).toBe(false)
    expect(current.getSnapshot().audioCue).toBeNull()
  })

  it('treats the requested illegal capture as success without replaying the preceding action', async () => {
    const guilty = acknowledgeAll(learnerAction(startLesson(1), move('c3', 'c4')).progress)
    const before = acknowledgeAll(scriptAction(guilty))
    const current = await tutorialReady(before)
    const ids = observeCues(current)
    const session = current.getSnapshot().learning!.session
    expect(await current.command(move('c4', 'd4'))).toBe(true)
    expect(current.getSnapshot().error).toBeNull()
    expect(current.getSnapshot().animating).toBe(false)
    expect(current.getSnapshot().audioCue).toBeNull()
    expect(current.getSnapshot().learning?.session).toBe(session)
    expect(current.getSnapshot().learning?.pendingTeaching?.stepId).toBe('guilt-forbids-capture')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ids).toEqual([])
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(session.record.cursor)
  })

  it('does not hand a still-unacknowledged tutorial result to ordinary play', async () => {
    const current = await tutorialReady()
    await current.command(move('c3', 'c4'))
    await finishMotion()
    const pending = current.getSnapshot().learning
    expect(await current.handoff()).toBe(false)
    expect(current.getSnapshot().view).toBe('learn')
    expect(current.getSnapshot().learning).toBe(pending)
    expect(current.getSnapshot().game).toBeNull()
  })

  it('uses the last result CTA to enter the next example once without replacing a normal game', async () => {
    await cabinet.startGame(hotseat)
    await cabinet.command(move('e2', 'e4'))
    await finishMotion()
    const game = cabinet.getSnapshot().game!
    const current = await tutorialReady(startLesson(2, 1))
    await current.command(move('c3', 'c4'))
    await finishMotion()
    const completedExample = current.getSnapshot().learning!
    expect(completedExample.pendingTeaching?.stepId).toBe('mercy-capture')
    expect(completedExample.index).toBe(1)
    await current.advance()
    const next = current.getSnapshot()
    expect(next.learning).toMatchObject({ lesson: 2, position: 2, index: 0, complete: false })
    expect(next.learning?.pendingTeaching).toBeUndefined()
    expect(next.learning?.session.record.id).not.toBe(completedExample.session.record.id)
    expect(next.learning?.session.record.cursor).toBe(0)
    expect(next.teachingReturning).toBe(true)
    expect(await store.getLearning()).toEqual(saveLearning(next.learning!))
    expect(await store.getMatch(game.record.id)).toMatchObject(game.record)
    expect(cabinet.getSnapshot().game).toBe(game)
    await current.command(move('g2', 'g3'))
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(0)
    await vi.advanceTimersByTimeAsync(CAMERA_TRAVEL_MS - 1)
    expect(current.getSnapshot().teachingReturning).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(current.getSnapshot().teachingReturning).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(current.getSnapshot().learning).toBe(next.learning)
  })

  it('returns from a focused result before accepting a move in the restarted lesson', async () => {
    const current = await tutorialReady()
    await current.command(move('c3', 'c4'))
    await finishMotion()
    const oldKey = current.getSnapshot().motionKey
    await current.restartLesson()
    expect(current.getSnapshot().motionKey).not.toBe(oldKey)
    expect(current.getSnapshot().learning).toMatchObject({ lesson: 1, position: 0, index: 0 })
    expect(current.getSnapshot().teachingReturning).toBe(true)
    await current.command(move('c3', 'c4'))
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(0)
    await vi.advanceTimersByTimeAsync(CAMERA_TRAVEL_MS)
    expect(current.getSnapshot().teachingReturning).toBe(false)
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(0)
  })

  it.each(['advance', 'restartLesson'] as const)('does not discard a focused result when saving %s fails', async action => {
    const current = await tutorialReady()
    await current.command(move('c3', 'c4'))
    await finishMotion()
    const before = current.getSnapshot()
    vi.spyOn(store, 'putLearning').mockRejectedValueOnce(new SessionError('storage'))
    expect(await current[action]()).toBe(false)
    expect(current.getSnapshot().learning).toBe(before.learning)
    expect(current.getSnapshot().motionKey).toBe(before.motionKey)
    expect(current.getSnapshot().teachingReturning).toBe(false)
    expect(current.getSnapshot().error).toBe('storage')
    await vi.advanceTimersByTimeAsync(5000)
    expect(current.getSnapshot().learning).toBe(before.learning)
    expect(await store.getLearning()).toEqual(saveLearning(before.learning!))
  })
})
