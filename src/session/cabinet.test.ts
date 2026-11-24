import 'fake-indexeddb/auto'
import { forceCloseDatabase } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPosition } from '../core'
import type { Command } from '../core'
import type { SearchRequest, SearchResponse } from '../engine/protocol'
import { getDieMotionTiming } from '../scene/diceMotion'
import { CAMERA_TRAVEL_MS } from '../scene/cameraFocus'
import * as database from '../storage/database'
import { acknowledgeTeaching, advanceLesson, confirmInspection, guideCommands, instruction, learnerAction, saveLearning, scriptAction, startLesson, teachingBeat } from '../tutorial/controller'
import type { Learning } from '../tutorial/controller'
import { Cabinet } from './cabinet'
import { createMatch, SessionError } from './match'
import { nextDie } from './random'
import { exportMatch } from './save'

const hotseat = { mode: 'hotseat', human: null, level: null, provenance: 'standard' } as const
const move = (from: string, to: string): Command => ({ type: 'move', from, to })
const realOpenGameStore = database.openGameStore

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
let databaseName: string
let extraStores: database.GameStore[]

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
  databaseName = `cabinet-audio-${crypto.randomUUID()}`
  extraStores = []
  store = await realOpenGameStore(databaseName)
  vi.spyOn(database, 'openGameStore').mockResolvedValue(store)
  cabinet = new Cabinet()
  cabinets = [cabinet]
  await cabinet.initialize()
  expect(cabinet.getSnapshot().durable).toBe(true)
})

afterEach(async () => {
  for (const current of cabinets) await current.home()
  store.close()
  for (const connection of extraStores) connection.close()
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

async function savedLearning() {
  const connection = await realOpenGameStore(databaseName)
  try { return await connection.getLearning() } finally { connection.close() }
}

function enableRealRecovery() {
  vi.mocked(database.openGameStore).mockImplementation(async (_name, options) => {
    const connection = await realOpenGameStore(databaseName, options)
    extraStores.push(connection)
    return connection
  })
}

describe('Cabinet live audio delivery', () => {
  it('restores the canonical match after another tab settles it while the overview is stale', async () => {
    const other = await realOpenGameStore(databaseName)
    extraStores.push(other)
    let prior = await store.reserveRated('black', 4)
    for (const command of [move('f2', 'f3'), move('e7', 'e5'), move('g2', 'g4')]) {
      const next = prior.submit(prior.envelope(command), prior.state.side === 'black' ? 'human' : 'bot')
      await store.commit(prior, next)
      prior = next
    }
    await cabinet.resumeGame(prior.record.id)
    const datedList = await store.overview()
    const mate = move('d8', 'h4')
    const final = prior.submit(prior.envelope(mate), 'human')
    await other.commit(prior, final)
    vi.spyOn(store, 'overview').mockResolvedValueOnce(datedList)

    expect(await cabinet.command(mate)).toBe(false)
    expect(cabinet.getSnapshot().game?.record).toMatchObject({
      id: final.record.id, revision: final.record.revision, status: 'finished', actions: final.record.actions,
    })
    expect(cabinet.getSnapshot().game?.state.outcome).toEqual(final.state.outcome)
    expect(cabinet.getSnapshot()).toMatchObject({ animating: false, royalCue: null, rollId: null, audioCue: null })
    expect((await other.overview()).ledger).toHaveLength(1)
  })

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

  it('unlocks a committed move while an obsolete overview is still pending', async () => {
    await cabinet.startGame(hotseat)
    const oldOverview = await store.overview()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const oldRefresh = gate.then(() => oldOverview)
    vi.spyOn(store, 'overview').mockReturnValueOnce(oldRefresh)
    expect(await cabinet.command(move('e2', 'e4'))).toBe(true)
    expect(cabinet.getSnapshot().busy).toBe(false)
    expect(cabinet.getSnapshot().animating).toBe(true)
    expect(cabinet.getSnapshot().audioCue?.events).toEqual(cabinet.getSnapshot().game?.current.events)
    await finishMotion()
    expect(await cabinet.command(move('e7', 'e5'))).toBe(true)
    const committed = cabinet.getSnapshot().game!
    release()
    await oldRefresh
    await Promise.resolve()
    expect(cabinet.getSnapshot().game).toBe(committed)
    expect(cabinet.getSnapshot().matches.find(match => match.id === committed.record.id)?.revision).toBe(2)
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

  function finalReading(lesson: number, position = 0) {
    let progress = startLesson(lesson, position)
    for (let stepCount = 0; stepCount < 30; stepCount++) {
      progress = acknowledgeAll(progress)
      const step = instruction(progress)
      if (step?.kind === 'read') return progress
      if (step?.kind === 'move') progress = learnerAction(progress, guideCommands(progress)[0]).progress
      else if (step?.kind === 'script') progress = scriptAction(progress)
      else if (step?.kind === 'illegal') progress = learnerAction(progress, step.move).progress
      else if (step?.kind === 'inspect') progress = confirmInspection(progress, step.square)
      else throw new Error('Expected a final reading in this fixture')
    }
    throw new Error('The fixture never reached its final reading')
  }

  it.each([
    { lesson: 0, position: 0, nextLesson: 1, nextPosition: 0 },
    { lesson: 2, position: 2, nextLesson: 3, nextPosition: 0 },
    { lesson: 7, position: 0, nextLesson: 7, nextPosition: 1 },
    { lesson: 7, position: 1, nextLesson: 8, nextPosition: 0 },
  ])('commits the final reading and next fixture together ($lesson/$position)', async ({ lesson, position, nextLesson, nextPosition }) => {
    const reading = finalReading(lesson, position)
    const current = await tutorialReady(reading)
    const before = current.getSnapshot().learning!
    const persisted: Learning[] = []
    current.subscribe(() => { if (!current.getSnapshot().busy) persisted.push(current.getSnapshot().learning!) })
    const putLearning = store.putLearning.bind(store)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const writes = vi.spyOn(store, 'putLearning').mockImplementationOnce(async saved => { await gate; return putLearning(saved) })
    const action = current.advance()
    expect(current.getSnapshot().learning).toMatchObject({ lesson, position, index: reading.index })
    expect(await current.advance()).toBe(false)
    expect(await store.getLearning()).toEqual(saveLearning(before))
    release()
    expect(await action).toBe(true)
    expect(writes).toHaveBeenCalledTimes(1)
    const next = current.getSnapshot().learning!
    expect(next).toMatchObject({ lesson: nextLesson, position: nextPosition, index: 0, complete: false })
    expect(next.session.record.id).not.toBe(reading.session.record.id)
    expect(await store.getLearning()).toEqual(saveLearning(next))
    expect(persisted.every(progress => progress.lesson !== lesson || progress.position !== position || progress.index === reading.index)).toBe(true)
  })

  it('preserves a final reading when its combined transition cannot be saved', async () => {
    const current = await tutorialReady(finalReading(2, 2))
    const before = current.getSnapshot()
    const saved = await store.getLearning()
    vi.spyOn(store, 'putLearning').mockRejectedValueOnce(new SessionError('storage'))
    expect(await current.advance()).toBe(false)
    expect(current.getSnapshot().learning).toBe(before.learning)
    expect(current.getSnapshot().motionKey).toBe(before.motionKey)
    expect(current.getSnapshot().error).toBe('storage')
    expect(await savedLearning()).toEqual(saved)
  })

  it('still resumes a legacy position-complete save and advances it once', async () => {
    const legacy = advanceLesson(finalReading(2, 2))
    expect(instruction(legacy)).toBeUndefined()
    const current = await tutorialReady(legacy)
    expect(current.getSnapshot().learning?.session.current).toEqual(legacy.session.current)
    expect(instruction(current.getSnapshot().learning!)).toBeUndefined()
    await current.advance()
    expect(current.getSnapshot().learning).toMatchObject({ lesson: 3, position: 0, index: 0 })
    expect(await store.getLearning()).toEqual(saveLearning(current.getSnapshot().learning!))
  })

  it('finishes after the final choice feedback without altering the position for continuation', async () => {
    const current = await tutorialReady(finalReading(8))
    const before = current.getSnapshot().learning!
    expect(instruction(before)?.id).toBe('practice-ready')
    const writes = vi.spyOn(store, 'putLearning')
    await current.advance()
    const complete = current.getSnapshot().learning!
    expect(complete.complete).toBe(true)
    expect(complete.session).toBe(before.session)
    expect(complete.index).toBe(before.index + 1)
    expect(writes).toHaveBeenCalledTimes(1)
    expect(await store.getLearning()).toEqual(saveLearning(complete))
  })

  it.each([
    { reduced: false, camera: true }, { reduced: true, camera: true }, { reduced: false, camera: false },
  ])('waits for acknowledgement and any camera return before the opponent moves ($reduced, $camera)', async ({ reduced, camera }) => {
    const current = await tutorialReady()
    current.setShortMotion(reduced)
    current.setTeachingCamera(camera)
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
    const cameraReturn = camera && !reduced
    expect(acknowledged.teachingReturning).toBe(cameraReturn)
    if (cameraReturn) {
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

  it('releases the pending script once if the learner switches to 2D during the return', async () => {
    const current = await tutorialReady()
    await current.command(move('c3', 'c4'))
    await finishMotion()
    await current.advance()
    expect(current.getSnapshot().teachingReturning).toBe(true)
    current.setTeachingCamera(false)
    expect(current.getSnapshot().teachingReturning).toBe(false)
    await vi.advanceTimersByTimeAsync(320)
    await settled(current)
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(2)
    await vi.advanceTimersByTimeAsync(CAMERA_TRAVEL_MS + 1000)
    expect(current.getSnapshot().learning?.session.record.cursor).toBe(2)
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
    expect(await savedLearning()).toEqual(saveLearning(before.learning!))
  })
})

describe('Cabinet storage recovery', () => {
  it('pauses an uncertain save and recovers its committed revision without replaying the move', async () => {
    await cabinet.startGame(hotseat)
    const before = cabinet.getSnapshot().game!
    const commit = store.commit.bind(store)
    vi.spyOn(store, 'commit').mockImplementationOnce(async (previous, next) => {
      await commit(previous, next)
      // The transaction succeeded, but its completion was not delivered in time.
      throw new database.StorageError('storageTimeout')
    })
    expect(await cabinet.command(move('e2', 'e4'))).toBe(false)
    expect(cabinet.getSnapshot()).toMatchObject({ busy: false, storageProblem: 'storageTimeout' })
    expect(cabinet.getSnapshot().game).toBe(before)
    expect(await cabinet.command(move('d2', 'd4'))).toBe(false)
    expect(await cabinet.loadFile(exportMatch(before))).toBe(false)
    expect(cabinet.getSnapshot().game).toBe(before)
    enableRealRecovery()
    await cabinet.retryStorage()
    expect(cabinet.getSnapshot()).toMatchObject({ ready: true, durable: true, storageProblem: null, view: 'game', audioCue: null })
    expect(cabinet.getSnapshot().game?.record).toMatchObject({ id: before.record.id, revision: 1, cursor: 1 })
    expect(cabinet.getSnapshot().game?.state.pieces.find(piece => piece.id === 'w-e2')?.square).toBe('e4')
    expect(await cabinet.command(move('e7', 'e5'))).toBe(true)
    expect(cabinet.getSnapshot().game?.record.revision).toBe(2)
  })

  it('allows a distinct unsaved practice game without mutating the paused saved match', async () => {
    await cabinet.startGame(hotseat)
    const saved = cabinet.getSnapshot().game!
    vi.spyOn(store, 'commit').mockRejectedValueOnce(new database.StorageError('storageTimeout'))
    expect(await cabinet.command(move('e2', 'e4'))).toBe(false)
    expect(await cabinet.startGame(hotseat)).toBe(true)
    const memory = cabinet.getSnapshot().game!
    expect(memory.record.id).not.toBe(saved.record.id)
    expect(cabinet.getSnapshot()).toMatchObject({ durable: false, storageProblem: null })
    expect(await cabinet.command(move('d2', 'd4'))).toBe(true)

    const connection = await realOpenGameStore(databaseName)
    try {
      expect(await connection.getMatch(saved.record.id)).toEqual(saved.record)
      expect(await connection.getMatch(memory.record.id)).toBeUndefined()
    } finally { connection.close() }
  })

  it('keeps tutorial start and resume unavailable in unsaved practice without changing its checkpoint', async () => {
    await cabinet.learn()
    const learning = cabinet.getSnapshot().learning
    const checkpoint = await store.getLearning()
    await cabinet.startGame(hotseat)
    vi.spyOn(store, 'commit').mockRejectedValueOnce(new database.StorageError('storageTimeout'))
    await cabinet.command(move('e2', 'e4'))
    await cabinet.startGame(hotseat)
    const memory = cabinet.getSnapshot().game

    expect(await cabinet.learn()).toBe(false)
    expect(await cabinet.learn(true)).toBe(false)
    expect(cabinet.getSnapshot()).toMatchObject({ durable: false, storageProblem: null, view: 'game' })
    expect(cabinet.getSnapshot().game).toBe(memory)
    expect(cabinet.getSnapshot().learning).toBe(learning)
    expect(await savedLearning()).toEqual(checkpoint)
    expect(await cabinet.command(move('d2', 'd4'))).toBe(true)
  })

  it.each([false, true])('saves the current unsaved game on reconnect and preserves older saves (uncertain first save: %s)', async uncertain => {
    await cabinet.startGame(hotseat)
    const older = cabinet.getSnapshot().game!
    vi.spyOn(store, 'commit').mockRejectedValueOnce(new database.StorageError('storageTimeout'))
    expect(await cabinet.command(move('e2', 'e4'))).toBe(false)
    expect(await cabinet.startGame(hotseat)).toBe(true)
    expect(await cabinet.command(move('d2', 'd4'))).toBe(true)
    await finishMotion()
    const memory = cabinet.getSnapshot().game!
    enableRealRecovery()

    if (uncertain) {
      const save = database.GameStore.prototype.savePracticeOnReconnect
      vi.spyOn(database.GameStore.prototype, 'savePracticeOnReconnect').mockImplementationOnce(async function (this: database.GameStore, game) {
        await save.call(this, game)
        throw new database.StorageError('storageTimeout')
      })
      await cabinet.retryStorage()
      expect(cabinet.getSnapshot()).toMatchObject({ durable: false, storageProblem: 'storageTimeout', view: 'game' })
      expect(cabinet.getSnapshot().game).toBe(memory)
    }

    await cabinet.retryStorage()
    expect(cabinet.getSnapshot()).toMatchObject({ durable: true, storageProblem: null, view: 'game', audioCue: null })
    expect(cabinet.getSnapshot().game?.record).toMatchObject({ id: memory.record.id, revision: 1, cursor: 1 })
    expect(cabinet.getSnapshot().game?.state.pieces.find(piece => piece.id === 'w-d2')?.square).toBe('d4')
    const connection = await realOpenGameStore(databaseName)
    try {
      const overview = await connection.overview()
      expect(overview.matches).toHaveLength(2)
      expect(await connection.getMatch(older.record.id)).toEqual(older.record)
      expect(await connection.getMatch(memory.record.id)).toEqual(memory.record)
      expect(overview.ledger).toHaveLength(0)
      expect(await cabinet.command(move('e7', 'e5'))).toBe(true)
      expect((await connection.getMatch(memory.record.id))?.revision).toBe(2)
    } finally { connection.close() }
  })

  it('preserves both versions after another tab changes a recovery save, including an uncertain copy save', async () => {
    await cabinet.startGame(hotseat)
    const older = cabinet.getSnapshot().game!
    vi.spyOn(store, 'commit').mockRejectedValueOnce(new database.StorageError('storageTimeout'))
    await cabinet.command(move('e2', 'e4'))
    await cabinet.startGame(hotseat)
    await cabinet.command(move('d2', 'd4'))
    await finishMotion()
    const memory = cabinet.getSnapshot().game!
    enableRealRecovery()
    const save = database.GameStore.prototype.savePracticeOnReconnect
    const saveSpy = vi.spyOn(database.GameStore.prototype, 'savePracticeOnReconnect')
    saveSpy.mockImplementationOnce(async function (this: database.GameStore, game) {
      await save.call(this, game)
      throw new database.StorageError('storageTimeout')
    })
    await cabinet.retryStorage()

    const other = await realOpenGameStore(databaseName)
    try {
      const advanced = memory.submit(memory.envelope(move('c7', 'c5')), 'human')
      await other.commit(memory, advanced)
      let loseCopyCompletion = true
      saveSpy.mockImplementation(async function (this: database.GameStore, game) {
        await save.call(this, game)
        if (game.record.id !== memory.record.id && loseCopyCompletion) {
          loseCopyCompletion = false
          throw new database.StorageError('storageTimeout')
        }
      })
      await cabinet.retryStorage()
      const copy = cabinet.getSnapshot().game!
      expect(copy.record.id).not.toBe(memory.record.id)
      expect(copy.state).toEqual(memory.state)
      expect(cabinet.getSnapshot().storageProblem).toBe('storageTimeout')

      await cabinet.retryStorage()
      expect(cabinet.getSnapshot()).toMatchObject({ durable: true, storageProblem: null, view: 'game', error: 'practiceCopied' })
      expect(cabinet.getSnapshot().game?.record.id).toBe(copy.record.id)
      expect(cabinet.getSnapshot().game?.state).toEqual(memory.state)
      const overview = await other.overview()
      expect(overview.matches).toHaveLength(3)
      expect(await other.getMatch(older.record.id)).toEqual(older.record)
      expect(await other.getMatch(memory.record.id)).toEqual(advanced.record)
      expect(await other.getMatch(copy.record.id)).toEqual(copy.record)
      expect(overview.ledger).toHaveLength(0)
      expect(await cabinet.command(move('e7', 'e5'))).toBe(true)
    } finally { other.close() }
  })

  it('closes a late initialization connection after a newer attempt has restored play', async () => {
    const lateStore = await realOpenGameStore(databaseName)
    extraStores.push(lateStore)
    const closeLate = vi.spyOn(lateStore, 'close')
    let release!: (store: database.GameStore) => void
    const opening = new Promise<database.GameStore>(resolve => { release = resolve })
    vi.mocked(database.openGameStore).mockReturnValueOnce(opening)
    const current = new Cabinet()
    cabinets.push(current)
    const abandoned = current.initialize()
    expect(current.getSnapshot().ready).toBe(false)
    enableRealRecovery()
    await current.retryStorage()
    await current.startGame(hotseat)
    const active = current.getSnapshot().game
    release(lateStore)
    await abandoned
    expect(closeLate).toHaveBeenCalledTimes(1)
    expect(current.getSnapshot().game).toBe(active)
    expect(current.getSnapshot()).toMatchObject({ ready: true, durable: true, storageProblem: null })
  })

  it('pauses on an unexpectedly closed connection and reopens the same saved match', async () => {
    await cabinet.startGame(hotseat)
    await cabinet.command(move('e2', 'e4'))
    await finishMotion()
    const saved = cabinet.getSnapshot().game!
    const nativeOpen = indexedDB.open
    let raw: IDBDatabase | undefined
    vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      const request = nativeOpen.call(indexedDB, name, version)
      request.addEventListener('success', () => { raw = request.result })
      return request
    })
    enableRealRecovery()
    const current = new Cabinet()
    cabinets.push(current)
    await current.initialize()
    if (!raw) throw new Error('Expected a native database connection')
    // The utility's declaration names the constructor type, but it closes an instance.
    forceCloseDatabase(raw as unknown as Parameters<typeof forceCloseDatabase>[0])
    await until(current, () => current.getSnapshot().storageProblem === 'storageClosed')
    expect(await current.command(move('e7', 'e5'))).toBe(false)
    await current.retryStorage()
    expect(current.getSnapshot().game?.record).toMatchObject({ id: saved.record.id, revision: saved.record.revision })
    expect(current.getSnapshot()).toMatchObject({ durable: true, storageProblem: null })
    expect(await current.command(move('e7', 'e5'))).toBe(true)
  })
})
