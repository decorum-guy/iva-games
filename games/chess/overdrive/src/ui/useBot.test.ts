import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../core'
import type { Command } from '../core'
import type { SearchRequest, SearchResponse } from '../engine/protocol'
import { BotController } from './useBot'
import type { BotEnvironment, BotWorkerPort } from './useBot'

const command: Command = { type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'e4' }
const position = () => ({ state: createInitialState(), gameId: 'test-game', level: 4, humanSide: 'black' as const, enabled: true })

class FakeWorker implements BotWorkerPort {
  request: SearchRequest | null = null
  terminated = false
  message: (value: unknown) => void = () => {}
  error: () => void = () => {}
  start(request: SearchRequest, onMessage: (message: unknown) => void, onError: () => void) {
    this.request = request
    this.message = onMessage
    this.error = onError
  }
  terminate() { this.terminated = true }
  result(changes: Partial<SearchResponse> = {}) {
    this.message({ ...this.request, type: 'result', command,
      diagnostics: { depth: 1, score: 0, nodes: 20, elapsedMs: 10, stopReason: 'max-depth' }, ...changes })
  }
}

const controllers: BotController[] = []
function harness(visible = true) {
  const workers: FakeWorker[] = []
  const callbacks = { onCommand: vi.fn(), onError: vi.fn(), onThinking: vi.fn() }
  const environment: BotEnvironment = {
    now: () => Date.now(), random: () => .5,
    makeWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker },
    setDelay: (callback, ms) => setTimeout(callback, ms), clearDelay: timer => clearTimeout(timer),
  }
  const controller = new BotController(callbacks, environment, visible)
  controllers.push(controller)
  return { controller, workers, callbacks, environment }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); vi.useRealTimers() })

describe('Overdrive Worker lifecycle and visible thinking delay', () => {
  it('starts real worker work immediately and holds a fast answer for the full visible delay', () => {
    const { controller, workers, callbacks } = harness()
    const source = position()
    controller.start(source)
    expect(workers).toHaveLength(1)
    expect(workers[0].request).toMatchObject({ publicState: source.state, gameId: 'test-game',
      gameRevision: 0, presetId: 4, rulesVersion: 'overdrive-v2' })
    expect(callbacks.onThinking).toHaveBeenLastCalledWith(true)
    workers[0].result()
    expect(workers[0].terminated).toBe(true)
    vi.advanceTimersByTime(674)
    expect(callbacks.onCommand).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callbacks.onCommand).toHaveBeenCalledExactlyOnceWith(command)
    expect(callbacks.onThinking).toHaveBeenLastCalledWith(false)
  })

  it('does not add another full artificial delay after a slower real search', () => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    vi.advanceTimersByTime(900)
    workers[0].result()
    vi.advanceTimersByTime(0)
    expect(callbacks.onCommand).toHaveBeenCalledExactlyOnceWith(command)
  })

  it.each([
    { requestId: 'stale' }, { gameId: 'different' }, { gameRevision: 99 }, { sessionGeneration: 0 },
    { rulesVersion: 'old' }, { engineVersion: 'old' }, { presetId: 10 }, { presetVersion: 'old' },
  ])('ignores replies with mismatched identity %j', change => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    workers[0].result(change)
    vi.advanceTimersByTime(1000)
    expect(callbacks.onCommand).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
    workers[0].result()
    vi.advanceTimersByTime(0)
    expect(callbacks.onCommand).toHaveBeenCalledExactlyOnceWith(command)
  })

  it('cancels a ready answer when the game changes, and ignores the old worker thereafter', () => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    workers[0].result()
    vi.advanceTimersByTime(100)
    controller.start({ ...position(), gameId: 'new-game' })
    workers[0].result()
    workers[1].result()
    vi.advanceTimersByTime(575)
    expect(callbacks.onCommand).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(callbacks.onCommand).toHaveBeenCalledExactlyOnceWith(command)
    expect(workers[0].terminated).toBe(true)
  })

  it('cancels a hidden search and waits a fresh full interval after returning to the tab', () => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    vi.advanceTimersByTime(200)
    controller.setVisible(false)
    workers[0].result()
    expect(workers[0].terminated).toBe(true)
    expect(callbacks.onThinking).toHaveBeenLastCalledWith(false)
    vi.advanceTimersByTime(10_000)
    expect(callbacks.onCommand).not.toHaveBeenCalled()
    controller.setVisible(true)
    expect(workers).toHaveLength(2)
    expect(workers[1].request?.sessionGeneration).toBeGreaterThan(workers[0].request!.sessionGeneration)
    workers[1].result()
    vi.advanceTimersByTime(674)
    expect(callbacks.onCommand).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callbacks.onCommand).toHaveBeenCalledExactlyOnceWith(command)
  })

  it('also cancels an already computed delayed move when hidden', () => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    workers[0].result()
    controller.setVisible(false)
    vi.advanceTimersByTime(5000)
    expect(callbacks.onCommand).not.toHaveBeenCalled()
  })

  it('does not start a worker until an initially hidden tab becomes visible', () => {
    const { controller, workers } = harness(false)
    controller.start(position())
    expect(workers).toHaveLength(0)
    controller.setVisible(true)
    expect(workers).toHaveLength(1)
  })

  it('never searches on the human turn, while disabled or after a final result', () => {
    const { controller, workers } = harness()
    controller.start({ ...position(), humanSide: 'white' })
    controller.start({ ...position(), enabled: false })
    controller.start({ ...position(), state: { ...createInitialState(), outcome: { reason: 'resignation', winner: 'black' } } })
    expect(workers).toHaveLength(0)
  })

  it('rejects illegal returned actions instead of executing an engine mistake', () => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    workers[0].result({ command: { type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'e8' } })
    vi.advanceTimersByTime(5000)
    expect(callbacks.onError).toHaveBeenCalledOnce()
    expect(callbacks.onCommand).not.toHaveBeenCalled()
    expect(workers[0].terminated).toBe(true)
  })

  it('reports worker failure once without running a synchronous replacement engine', () => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    workers[0].error()
    workers[0].error()
    vi.advanceTimersByTime(5000)
    expect(callbacks.onError).toHaveBeenCalledOnce()
    expect(callbacks.onCommand).not.toHaveBeenCalled()
    expect(workers).toHaveLength(1)
  })

  it('accepts at most one answer and ignores duplicate errors after a valid result', () => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    workers[0].result()
    workers[0].result()
    workers[0].error()
    vi.advanceTimersByTime(675)
    expect(callbacks.onCommand).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('disposes both worker and ready-result timers on unmount', () => {
    const { controller, workers, callbacks } = harness()
    controller.start(position())
    workers[0].result()
    controller.dispose()
    workers[0].result()
    controller.setVisible(true)
    vi.advanceTimersByTime(5000)
    expect(callbacks.onCommand).not.toHaveBeenCalled()
    expect(workers).toHaveLength(1)
    expect(workers[0].terminated).toBe(true)
  })
})
