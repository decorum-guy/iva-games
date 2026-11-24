import { actionPlan, pieceTravelMs } from './actionPresentation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameEvent, Piece } from '../core/types'
import { getDieMotionTiming } from './diceMotion'
import { sampleWindow } from './audioSamples'
import { learnerAction, startLesson } from '../tutorial/controller'

const piece: Piece = {
  id: 'white-rook', side: 'white', type: 'rook', square: 'd4', affliction: 'neutral',
  captureReaction: 'unassigned', capturesSinceRebirth: 0, pawnDoubleStepEligible: false,
  castleEligible: false, devastationDue: null, cureArmedAt: null, shameArmedAt: null,
}
const move = (id = 'match/action/move'): GameEvent => ({ id, type: 'move', piece, from: 'd1', to: 'd4' })
const capture: GameEvent = {
  id: 'match/action/capture', type: 'capture', capturer: piece,
  victim: { ...piece, id: 'black-pawn', side: 'black', type: 'pawn' }, landing: 'd4',
  friendly: false, mercy: false, kind: 'ordinary',
}
const reaction: GameEvent = {
  id: 'match/action/reaction', type: 'reaction', piece, affliction: 'guilt', face: 2, cause: 'roll',
}
const check: GameEvent = { id: 'match/action/turn', type: 'turn', side: 'black', turnSerial: 2, check: true }
const ending: GameEvent = { id: 'match/action/outcome', type: 'outcome', outcome: { reason: 'checkmate', winner: 'white' } }

class FakeParam {
  value = 0
  setValueAtTime(value: number) { this.value = value }
  linearRampToValueAtTime(value: number) { this.value = value }
  exponentialRampToValueAtTime(value: number) { this.value = value }
  setTargetAtTime(value: number) { this.value = value }
  cancelScheduledValues() { /* Automation is irrelevant to the lifecycle assertions. */ }
}
class FakeNode {
  disconnect = vi.fn()
  connect<T>(node: T) { return node }
}
class FakeSource extends FakeNode {
  frequency = new FakeParam()
  playbackRate = new FakeParam()
  type = 'sine'
  buffer: unknown
  onended: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  sampleRate = 8000
  currentTime = 0
  destination = new FakeNode()
  sources: FakeSource[] = []
  completeResume: () => void = () => { throw new Error('No resume pending') }
  failResume: () => void = () => { throw new Error('No resume pending') }
  constructor() { FakeAudioContext.instances.push(this) }
  resume = vi.fn(() => new Promise<void>((resolve, reject) => {
    this.completeResume = () => { this.state = 'running'; resolve() }
    this.failResume = () => reject(new Error('Device unavailable'))
  }))
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }) }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(),
      attack: new FakeParam(), release: new FakeParam(),
    })
  }
  createOscillator() { const source = new FakeSource(); this.sources.push(source); return source }
  createBufferSource() { return this.createOscillator() }
}

let audio: typeof import('./audio')
let documentStub: EventTarget & { visibilityState: string }

beforeEach(async () => {
  vi.resetModules()
  FakeAudioContext.instances = []
  documentStub = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('document', documentStub)
  audio = await import('./audio')
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function unlock() {
  const ready = audio.unlockAudio()
  const context = FakeAudioContext.instances[0]
  context.completeResume()
  expect(await ready).toBe(true)
  return context
}

describe('semantic scene sounds', () => {
  it.each([false, true])('schedules only the owed promotion sounds through the lesson hold (reduced=%s)', reducedMotion => {
    const { progress } = learnerAction(startLesson(7, 1), { type: 'move', from: 'g7', to: 'h8', promotion: 'bishop' })
    const events = progress.session.current.events
    const before = audio.planSceneCues(events, { reducedMotion, playback: 'reaction' })
    const after = audio.planSceneCues(events, { reducedMotion, playback: 'formation' })
    expect(before.map(cue => cue.kind)).toEqual(['capture', 'dice', 'berserk'])
    expect(after.map(cue => cue.kind)).toEqual(['promotionFormation'])
    expect(after[0].at).toBeCloseTo(reducedMotion ? .055 : .15)
  })

  it('only rattles dice for a committed roll, not a remembered reaction', () => {
    expect(audio.planSceneCues([move(), capture, reaction]).map(cue => cue.kind)).toEqual(['capture', 'dice', 'guilt'])
    const remembered: GameEvent = { ...reaction, face: undefined, cause: 'memory' }
    expect(audio.planSceneCues([move(), capture, remembered]).map(cue => cue.kind)).toEqual(['capture', 'guilt'])
  })

  it('collapses simultaneous passive transformations to one distinctive cue', () => {
    const events: GameEvent[] = [move(),
      { id: 'cure1', type: 'cure', piece, cause: 'bishop' },
      { id: 'cure2', type: 'cure', piece, cause: 'rally' },
      { id: 'convert', type: 'convert', piece, side: 'black' },
    ]
    expect(audio.planSceneCues(events).map(cue => cue.kind)).toEqual(['move', 'convert'])
  })

  it('announces the outcome instead of check and respects the human perspective', () => {
    const events = [move(), check, ending]
    expect(audio.planSceneCues(events, { humanSide: 'white' }).map(cue => cue.kind)).toEqual(['move', 'win'])
    expect(audio.planSceneCues(events, { humanSide: 'black' }).at(-1)?.kind).toBe('loss')
    expect(audio.planSceneCues([ending]).map(cue => cue.kind)).toEqual(['finish'])
    expect(audio.planSceneCues([{ ...ending, outcome: { reason: 'agreement', winner: null } }]).map(cue => cue.kind)).toEqual(['draw'])
  })

  it('reserves the post-die cue for check and keeps reduced timing aligned', () => {
    expect(audio.planSceneCues([check]).map(cue => cue.kind)).toEqual(['check'])
    const normal = audio.planSceneCues([capture, reaction, check])
    const reduced = audio.planSceneCues([capture, reaction, check], { reducedMotion: true })
    expect(normal.map(cue => cue.kind)).toEqual(['capture', 'dice', 'check'])
    expect(reduced.map(cue => cue.kind)).toEqual(normal.map(cue => cue.kind))
    reduced.forEach((cue, index) => expect(cue.at).toBeLessThanOrEqual(normal[index].at))
    expect(reduced.find(cue => cue.kind === 'check')?.at).toBeLessThan(normal.find(cue => cue.kind === 'check')!.at)
  })

  it.each([false, true])('uses the visible die impacts and waits for settling before its state cue (reduced=%s)', async reducedMotion => {
    const timing = getDieMotionTiming(reducedMotion)
    const context = await unlock()
    const events = [move(), capture, reaction]
    const plan = actionPlan(events, true, reducedMotion, false)
    const planned = audio.planSceneCues(events, { plan })
    const lead = reducedMotion ? 105 : pieceTravelMs(3) + 130
    expect(plan.roll!.start).toBe(lead)
    expect(planned.find(cue => cue.kind === 'guilt')?.at).toBeCloseTo((lead + timing.motionMs + (reducedMotion ? 140 : 240)) / 1000)
    expect(audio.playSceneCue(events, { plan, reducedMotion })).toBe(true)
    const starts = context.sources.flatMap(source => source.start.mock.calls.map(call => call[0] as number))
    for (const impactMs of timing.impactsMs) {
      expect(starts.some(at => Math.abs(at - (.008 + (lead + impactMs) / 1000)) < .00001)).toBe(true)
    }
  })
})

describe('audio user activation and cancellation', () => {
  it('does not create a device from settings or gameplay before an explicit unlock', () => {
    audio.setAudioVolume(.8)
    expect(audio.playSceneCue([move()])).toBe(false)
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('preserves a live cue during resume and schedules the batch once', async () => {
    const ready = audio.unlockAudio()
    const context = FakeAudioContext.instances[0]
    const concurrentUnlock = audio.unlockAudio()
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(audio.playSceneCue([move()])).toBe(true)
    expect(context.sources).toHaveLength(0)
    context.completeResume()
    expect(await ready).toBe(true)
    expect(await concurrentUnlock).toBe(true)
    expect(context.sources.length).toBeGreaterThan(0)
    const voiceCount = context.sources.length
    expect(audio.playSceneCue([move()])).toBe(false)
    expect(context.sources).toHaveLength(voiceCount)
  })

  it.each(['muteAudio', 'stopSceneAudio'] as const)('%s cancels a pending resume cue across a later unlock', async method => {
    const ready = audio.unlockAudio()
    const context = FakeAudioContext.instances[0]
    expect(audio.playSceneCue([move()])).toBe(true)
    audio[method]()
    context.completeResume()
    expect(await ready).toBe(method !== 'muteAudio')
    expect(await audio.unlockAudio()).toBe(true)
    expect(context.sources).toHaveLength(0)
    expect(audio.playSceneCue([move('new-match/new-action/move')])).toBe(true)
    expect(context.sources.length).toBeGreaterThan(0)
  })

  it('can deliver the first new-session AI action after navigation cancels an old cue during resume', async () => {
    const ready = audio.unlockAudio()
    const context = FakeAudioContext.instances[0]
    expect(audio.playSceneCue([move()])).toBe(true)
    audio.stopSceneAudio()
    expect(audio.playSceneCue([move('new-match/AI-first-move')])).toBe(true)
    context.completeResume()
    expect(await ready).toBe(true)
    expect(context.sources.length).toBeGreaterThan(0)
    const voices = context.sources.length
    expect(audio.playSceneCue([move('new-match/AI-first-move')])).toBe(false)
    expect(context.sources).toHaveLength(voices)
  })

  it('drops an overdue resume cue rather than playing old history', async () => {
    let time = 100
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const ready = audio.unlockAudio()
    const context = FakeAudioContext.instances[0]
    expect(audio.playSceneCue([move()])).toBe(true)
    time = 2100
    context.completeResume()
    expect(await ready).toBe(true)
    expect(context.sources).toHaveLength(0)
  })

  it('keeps a partially elapsed die throw synchronized after device wake-up without replaying past impacts', async () => {
    let time = 100
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const ready = audio.unlockAudio()
    const context = FakeAudioContext.instances[0]
    audio.playSceneCue([capture, reaction])
    time += 900
    context.completeResume()
    expect(await ready).toBe(true)
    const starts = context.sources.flatMap(source => source.start.mock.calls.map(call => call[0] as number))
    expect(Math.min(...starts)).toBeCloseTo(.008 + 1.210 - .900)
    expect(starts.some(at => Math.abs(at - (.008 + 1.870 - .900)) < .00001)).toBe(true)
  })

  it('uses commit time for a 900ms delayed effect even when the context is already running', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const context = await unlock()
    expect(audio.playSceneCue([capture, reaction], { startedAt: 100 })).toBe(true)
    const starts = context.sources.flatMap(source => source.start.mock.calls.map(call => call[0] as number))
    expect(Math.min(...starts)).toBeCloseTo(.008 + 1.210 - .900)
    expect(starts.some(at => Math.abs(at - (.008 + 1.870 - .900)) < .00001)).toBe(true)
  })

  it('plays the recorded impact slices at the five shared contacts once the bank decodes', async () => {
    const buffer = { duration: 1 };
    const bank = new Uint8Array([1, 2, 3]);
    const fetch = vi.fn(async (url: string) => url.endsWith('/board.wav')
      ? new Response(bank) : new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const decode = vi.fn(async () => buffer);
    vi.stubGlobal('AudioContext', class extends FakeAudioContext { decodeAudioData = decode });
    await audio.prepareSceneAudio();
    const context = await unlock();
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(11);
    expect(audio.playSceneCue([reaction])).toBe(true);
    const impacts = ['diceBody', 'diceBounce', 'diceEdge', 'diceBounce', 'diceSettle'] as const;
    for (const [index, impact] of impacts.entries()) {
      expect(context.sources[index].buffer).toBe(buffer);
      const { offset, duration } = sampleWindow(impact);
      const calls = context.sources[index].start.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBeCloseTo(.008 + (130 + getDieMotionTiming(false).impactsMs[index]) / 1000, 7);
      expect(calls[0].slice(1)).toEqual([offset, duration]);
    }
    expect(context.sources).toHaveLength(6); // five impacts plus one state accent
  });

  it('fades and cancels an older action as soon as a new action owns the sound bus', async () => {
    const context = await unlock();
    expect(audio.playSceneCue([capture, reaction])).toBe(true);
    const oldVoices = [...context.sources];
    context.currentTime = .30;
    expect(audio.playSceneCue([move('next/player/move')])).toBe(true);
    for (const source of oldVoices) expect(source.stop).toHaveBeenLastCalledWith(.318);
    expect(context.sources.slice(oldVoices.length)).toHaveLength(1);
  });

  it('retains commit time across both a delayed effect and a pending device resume', async () => {
    let time = 600
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const ready = audio.unlockAudio()
    const context = FakeAudioContext.instances[0]
    audio.playSceneCue([capture, reaction], { startedAt: 100 })
    time = 1000
    context.completeResume()
    expect(await ready).toBe(true)
    const starts = context.sources.flatMap(source => source.start.mock.calls.map(call => call[0] as number))
    expect(Math.min(...starts)).toBeCloseTo(.008 + 1.210 - .900)
  })

  it.each([undefined, NaN, Infinity, -10, 2000])('normalizes absent, invalid or future startedAt=%s to current time', async startedAt => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const context = await unlock()
    expect(audio.playSceneCue([move()], { startedAt })).toBe(true)
    const starts = context.sources.flatMap(source => source.start.mock.calls.map(call => call[0] as number))
    expect(Math.min(...starts)).toBeCloseTo(.008 + .160)
  })

  it('drops stale commit timestamps instead of replaying history in an active context', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(2200)
    const context = await unlock()
    expect(audio.playSceneCue([capture, reaction], { startedAt: 100 })).toBe(false)
    expect(context.sources).toHaveLength(0)
  })

  it('contains resume failure and permits a later fresh gesture without replaying events', async () => {
    const failed = audio.unlockAudio()
    const context = FakeAudioContext.instances[0]
    audio.playSceneCue([move()])
    context.failResume()
    expect(await failed).toBe(false)
    const ready = audio.unlockAudio()
    context.completeResume()
    expect(await ready).toBe(true)
    expect(context.sources).toHaveLength(0)
  })

  it('cancels scheduled notes on stop and never queues events from a hidden tab', async () => {
    const context = await unlock()
    expect(audio.playSceneCue([capture, reaction])).toBe(true)
    const scheduled = [...context.sources]
    audio.stopSceneAudio()
    for (const source of scheduled) expect(source.stop).toHaveBeenLastCalledWith(context.currentTime + .018)
    documentStub.visibilityState = 'hidden'
    documentStub.dispatchEvent(new Event('visibilitychange'))
    expect(audio.playSceneCue([move('hidden-action')])).toBe(false)
    documentStub.visibilityState = 'visible'
    expect(context.sources).toHaveLength(scheduled.length)
  })

  it('does not override mute with a volume change, and accepts a new live cue after unmuting', async () => {
    const context = await unlock()
    audio.muteAudio()
    audio.setAudioVolume(1)
    expect(audio.playSceneCue([move()])).toBe(false)
    expect(context.sources).toHaveLength(0)
    expect(await audio.unlockAudio()).toBe(true)
    audio.setAudioVolume(0)
    expect(audio.playSceneCue([move()])).toBe(false)
    audio.setAudioVolume(.7)
    expect(audio.playSceneCue([move()])).toBe(true)
  })
})
