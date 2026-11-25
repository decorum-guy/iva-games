import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPosition } from '../../src/core'
import type { Command } from '../../src/core'
import type { SearchRequest, SearchResponse } from '../../src/engine/protocol'
import { Cabinet } from '../../src/session/cabinet'
import { createMatch } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import * as database from '../../src/storage/database'

class WorkerStub {
  static instances: WorkerStub[] = []
  request: SearchRequest | undefined
  onmessage: ((event: MessageEvent<SearchResponse>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  constructor() { WorkerStub.instances.push(this) }
  postMessage(request: SearchRequest) { this.request = request }
  terminate() {}
  reply(command: Command) {
    if (!this.request) throw new Error('No search request')
    this.onmessage?.(new MessageEvent<SearchResponse>('message', { data: {
      ...this.request, type: 'result', command,
      diagnostics: { depth: 1, nodes: 1, elapsedMs: 1, stopReason: 'max-depth', score: 0 },
    } }))
  }
}

const openStore = database.openGameStore
const move = (from: string, to: string): Command => ({ type: 'move', from, to })
const worker = () => WorkerStub.instances.at(-1)!
let cabinet: Cabinet
let store: database.GameStore

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
  vi.stubGlobal('BroadcastChannel', undefined)
  vi.stubGlobal('Worker', WorkerStub)
  WorkerStub.instances = []
  store = await openStore('visible-result-' + crypto.randomUUID())
  vi.spyOn(database, 'openGameStore').mockResolvedValue(store)
  cabinet = new Cabinet()
  await cabinet.initialize()
})

afterEach(async () => {
  await cabinet.home()
  store.close()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function settled() {
  if (!cabinet.getSnapshot().busy) return
  await new Promise<void>(resolve => {
    const unsubscribe = cabinet.subscribe(() => {
      if (!cabinet.getSnapshot().busy) { unsubscribe(); resolve() }
    })
  })
}

function captureGame(rolled = false) {
  const seed = Array.from({ length: 100 }, (_, value) => value).find(value => nextDie(value).face === 6)!
  return createMatch({ mode: 'practice', human: 'white', level: 8, provenance: 'standard' }, {
    seed,
    root: createPosition({ side: 'black', pieces: [
      { type: 'king', side: 'black', square: 'a8' },
      { type: 'king', side: 'white', square: 'h1' },
      { type: 'rook', side: 'black', square: 'd4', capturesSinceRebirth: 2,
        ...(rolled ? {} : { affliction: 'berserk', captureReaction: 'berserk' }) },
      { type: 'queen', side: 'white', square: 'd5' },
      { type: 'pawn', side: 'white', square: 'f5' },
      { type: 'pawn', side: 'white', square: 'g2' },
    ] }),
  })
}

async function readyCapture(rolled = false) {
  const game = captureGame(rolled)
  await store.addPractice(game)
  await cabinet.resumeGame(game.record.id)
  return game
}

async function firstCapture(rolled = false) {
  await readyCapture(rolled)
  worker().reply(move('d4', 'd5'))
  await vi.advanceTimersByTimeAsync(330)
  await settled()
  // Fake IndexedDB uses real async tasks. Drain the overview read before tests
  // jump the presentation clock past the independent storage timeout.
  await store.overview()
  expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
  return cabinet.getSnapshot().audioCue!
}

describe('reading a live result before an AI reply', () => {
  it.each([false, true])('keeps the full reading interval after overdue callbacks and a late visible frame (reduced=%s)', async reduced => {
    cabinet.setShortMotion(reduced)
    const cue = await firstCapture()
    const now = performance.now.bind(performance)
    const stallEndsAt = now() + 5000
    const clock = vi.spyOn(performance, 'now').mockReturnValue(stallEndsAt)
    // Overdue reveal/end callbacks drain before the view can paint anything.
    await vi.advanceTimersByTimeAsync(cue.plan.end)
    const drainedTime = now()
    clock.mockImplementation(() => stallEndsAt + now() - drainedTime)
    worker().reply(move('d5', 'f5'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)

    const read = cabinet.getSnapshot().resultRead!
    expect(read.durationMs).toBe(reduced ? 650 : 840)
    cabinet.acknowledgeResult(read.id)
    await vi.advanceTimersByTimeAsync(read.durationMs - 1)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
    // A duplicate frame notification cannot keep extending the deadline.
    cabinet.acknowledgeResult(read.id)
    await vi.advanceTimersByTimeAsync(1)
    await settled()
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(2)
  })

  it('requires a fresh acknowledgment for bloodlust after the six first reveals berserk', async () => {
    const cue = await firstCapture(true)
    await vi.advanceTimersByTimeAsync(cue.plan.roll!.reveal)
    const first = cabinet.getSnapshot().resultRead!
    cabinet.acknowledgeResult(first.id)
    await vi.advanceTimersByTimeAsync(cue.plan.end - cue.plan.roll!.reveal)
    const last = cabinet.getSnapshot().resultRead!
    expect(last.id).not.toBe(first.id)
    worker().reply(move('d5', 'f5'))
    cabinet.acknowledgeResult(first.id)
    await vi.advanceTimersByTimeAsync(2000)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
    cabinet.acknowledgeResult(last.id)
    await vi.advanceTimersByTimeAsync(last.durationMs)
    await settled()
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(2)
  })

  it.each([false, true])('preserves a hidden result and gives it a full reading interval on return (already seen=%s)', async seen => {
    const cue = await firstCapture()
    if (seen) {
      await vi.advanceTimersByTimeAsync(cue.plan.end)
      cabinet.acknowledgeResult(cabinet.getSnapshot().resultRead!.id)
      await vi.advanceTimersByTimeAsync(100)
    }
    const documentState = { hidden: true }
    vi.stubGlobal('document', documentState)
    cabinet.setPageVisible(false)
    const hiddenRead = cabinet.getSnapshot().resultRead!
    expect(cabinet.getSnapshot().animating).toBe(false)
    worker().reply(move('d5', 'f5'))
    cabinet.acknowledgeResult(hiddenRead.id)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
    expect(cabinet.getSnapshot().audioCue).toBe(cue)

    documentState.hidden = false
    cabinet.setPageVisible(true)
    const returnedRead = cabinet.getSnapshot().resultRead!
    expect(returnedRead.id).not.toBe(hiddenRead.id)
    cabinet.acknowledgeResult(hiddenRead.id)
    await vi.advanceTimersByTimeAsync(1000)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
    cabinet.acknowledgeResult(returnedRead.id)
    await vi.advanceTimersByTimeAsync(returnedRead.durationMs - 1)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await settled()
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(2)
  })

  it('does not consume an answer if the document hides before its visibility event is handled', async () => {
    await cabinet.startGame({ mode: 'practice', human: 'black', level: 4, provenance: 'standard' })
    worker().reply(move('e2', 'e4'))
    vi.stubGlobal('document', { hidden: true })
    expect(cabinet.getSnapshot().pageVisible).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(0)
    cabinet.setPageVisible(false)
    vi.stubGlobal('document', { hidden: false })
    cabinet.setPageVisible(true)
    await settled()
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
  })

  it('starts hidden without applying an AI move before the first visibility event', async () => {
    vi.stubGlobal('document', { hidden: true })
    cabinet = new Cabinet()
    await cabinet.initialize()
    await cabinet.startGame({ mode: 'practice', human: 'black', level: 4, provenance: 'standard' })
    worker().reply(move('e2', 'e4'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(cabinet.getSnapshot()).toMatchObject({ pageVisible: false, game: { record: { cursor: 0 } } })
  })

  it('keeps a capture static when its in-flight save completes after the tab hides', async () => {
    await readyCapture()
    const commit = store.commit.bind(store)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(store, 'commit').mockImplementationOnce(async (...args) => {
      await held
      return commit(...args)
    })
    worker().reply(move('d4', 'd5'))
    await vi.advanceTimersByTimeAsync(330)
    expect(cabinet.getSnapshot().busy).toBe(true)
    vi.stubGlobal('document', { hidden: true })
    cabinet.setPageVisible(false)
    release()
    await settled()
    expect(cabinet.getSnapshot()).toMatchObject({ pageVisible: false, animating: false, waitingForBloodlust: false,
      game: { record: { cursor: 1 } } })
    expect(cabinet.getSnapshot().resultRead).not.toBeNull()
    worker().reply(move('d5', 'f5'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
  })

  it('restarts the interval when a covering view interrupts reading', async () => {
    const cue = await firstCapture()
    await vi.advanceTimersByTimeAsync(cue.plan.end)
    worker().reply(move('d5', 'f5'))
    const read = cabinet.getSnapshot().resultRead!
    cabinet.acknowledgeResult(read.id)
    await vi.advanceTimersByTimeAsync(400)
    cabinet.deferResultReading(read.id)
    await vi.advanceTimersByTimeAsync(5000)
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(1)
    cabinet.acknowledgeResult(read.id)
    await vi.advanceTimersByTimeAsync(read.durationMs)
    await settled()
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(2)
  })

  it('discards a queued bonus and late frame notifications when leaving the game', async () => {
    const cue = await firstCapture()
    await vi.advanceTimersByTimeAsync(cue.plan.end)
    const reply = worker()
    reply.reply(move('d5', 'f5'))
    const read = cabinet.getSnapshot().resultRead!
    const id = cabinet.getSnapshot().game!.record.id
    await cabinet.home()
    cabinet.acknowledgeResult(read.id)
    reply.reply(move('d5', 'f5'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(cabinet.getSnapshot().resultRead).toBeNull()
    expect((await store.getMatch(id))?.cursor).toBe(1)
  })

  it('restores a bonus without waiting for an acknowledgment of a nonexistent live cue', async () => {
    const initial = captureGame()
    const captured = initial.submit(initial.envelope(move('d4', 'd5')), 'bot')
    await store.addPractice(captured)
    await cabinet.resumeGame(captured.record.id)
    expect(cabinet.getSnapshot()).toMatchObject({ audioCue: null, resultRead: null })
    worker().reply(move('d5', 'f5'))
    await vi.advanceTimersByTimeAsync(330)
    await settled()
    expect(cabinet.getSnapshot().game?.record.cursor).toBe(2)
  })
})
