import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { GameEvent } from '../../src/core'
import { transition } from '../../src/core'
import { TEACHING_FIXTURES } from '../../src/core/teaching'
import { sceneTiming } from '../../src/ui/motion'
import { MAX_OVERDRIVE_VOICES, OVERDRIVE_AUDIO_BANK, OVERDRIVE_CUES, OverdriveAudio, planOverdriveCues } from '../../src/ui/audio'

const move: GameEvent = { id: 'game-one/1/move', type: 'move', pieceId: 'white-pawn', side: 'white', pieceType: 'pawn', from: 'e2', to: 'e4', forced: false }
const gain: GameEvent = { id: 'game-one/1/energy', type: 'energy', side: 'white', before: 4, after: 7, spent: 0, captureEarned: 1, checkEarned: 2 }
const check: GameEvent = { id: 'game-one/1/turn', type: 'turn', side: 'black', turnSerial: 1, check: true }
const ability: GameEvent = { id: 'game-one/1/ability', type: 'ability', ability: 'raid', pieceId: 'white-knight', mode: 'impulse', from: 'c3', to: 'e4', targetId: 'victim' }
const capture: GameEvent = { id: 'game-one/1/capture', type: 'capture', pieceId: 'white-knight', victim: { id: 'victim', side: 'black', type: 'rook', square: 'd4', castleEligible: false, pawnDoubleStepEligible: false } }
const activation: GameEvent = { id: 'game-one/1/form', type: 'form', side: 'white', pieceId: 'white-pawn', remainingTurns: 3, cause: 'activate' }

describe('Overdrive semantic sound score', () => {
  it('assigns all six abilities a distinct sample and does not duplicate the generic move contact', () => {
    for (const name of ['sweep', 'raid', 'battery', 'ram', 'rotation', 'cover'] as const) {
      const cues = planOverdriveCues([move, { ...ability, ability: name }])
      expect(cues.map(cue => cue.name)).toEqual([name])
    }
  })
  it('orders spending, special action, capture, actual energy income, and check', () => {
    const cues = planOverdriveCues([ability, move, capture, { ...gain, before: 5, after: 3, spent: 5 }, check])
    expect(cues.map(cue => cue.name)).toEqual(['spend', 'raid', 'capture', 'energy', 'check'])
    expect(cues.map(cue => cue.at)).toEqual([...cues.map(cue => cue.at)].sort((a, b) => a - b))
    expect(cues.find(cue => cue.name === 'check')!.at).toBeGreaterThan(cues.find(cue => cue.name === 'energy')!.at)
  })
  it('announces a newly full cell but stays quiet about income lost to a full bank', () => {
    expect(planOverdriveCues([move, gain, check]).map(cue => cue.name)).toEqual(['move', 'energy', 'cellfull', 'check'])
    expect(planOverdriveCues([{ ...gain, before: 10, after: 10, captureEarned: 0 }]).map(cue => cue.name)).toEqual([])
  })
  it('plays activation once, keeps form ticks silent and gives expiration its own cue', () => {
    const payment: GameEvent = { ...gain, before: 10, after: 0, spent: 10, captureEarned: 0, checkEarned: 0 }
    expect(planOverdriveCues([activation, move, payment, { ...activation, remainingTurns: 2, cause: 'tick' }]).map(cue => cue.name)).toEqual(['activate', 'move'])
    expect(planOverdriveCues([{ ...activation, remainingTurns: 1, cause: 'tick' }])).toEqual([])
    expect(planOverdriveCues([{ ...activation, remainingTurns: 0, cause: 'expire' }]).map(cue => cue.name)).toEqual(['expire'])
  })
  it('preserves capture, promotion and income before mate while avoiding a redundant check warning', () => {
    const promotion: GameEvent = { id: 'promotion', type: 'promotion', pieceId: 'white-pawn', side: 'white', promotion: 'queen', square: 'h8', forced: false }
    const outcome: GameEvent = { id: 'mate', type: 'outcome', outcome: { reason: 'checkmate', winner: 'white' } }
    const cues = planOverdriveCues([move, capture, promotion, gain, check, outcome])
    expect(cues.map(cue => cue.name)).toEqual(['capture', 'promotion', 'energy', 'cellfull', 'mate'])
    for (const reduce of [false, true]) {
      const events = [move, capture, promotion, gain, check, outcome]
      const plan = planOverdriveCues(events, reduce)
      const swap = plan.find(cue => cue.name === 'promotion')!
      expect(swap.at*1000).toBeCloseTo(sceneTiming(events, reduce).promotionSwap)
      expect(swap.at-plan[0].at).toBeGreaterThan(.11)
      expect(plan.find(cue => cue.name === 'cellfull')!.gain).toBeLessThan(swap.gain!)
    }
    const reduced = planOverdriveCues([move, capture, promotion, gain, check, outcome], true)
    expect(reduced.map(cue => cue.name)).toEqual(cues.map(cue => cue.name))
    expect(reduced.at(-1)!.at).toBeLessThan(cues.at(-1)!.at)
    expect(planOverdriveCues([{ ...outcome, outcome: { reason: 'agreement', winner: null } }])[0].name).toBe('finish')
  })
  it('uses the renderer contact and landing clock for actual core actions in both motion modes', () => {
    for (const fixture of TEACHING_FIXTURES) for (const reduced of [false, true]) {
      const events = transition(fixture.state, fixture.expected).events
      const timing = sceneTiming(events, reduced)
      const cues = planOverdriveCues(events, reduced)
      const action = events.find(event => event.type === 'ability')
      if (action) expect(cues.find(cue => cue.name === action.ability)!.at * 1000).toBeCloseTo(timing.abilityCue)
      if (events.some(event => event.type === 'capture')) {
        expect(cues.find(cue => cue.name === 'capture')!.at * 1000).toBeCloseTo(timing.contact)
      } else if (!action) expect(cues.find(cue => cue.name === 'move')!.at * 1000).toBeCloseTo(timing.land)
      for (const [name, at] of [['energy', timing.energy], ['cellfull', timing.cellFull], ['check', timing.result], ['mate', timing.result]] as const) {
        const cue = cues.find(cue => cue.name === name)
        if (cue) expect(cue.at * 1000).toBeCloseTo(at)
      }
    }
  })
})

class FakeParam {
  value = 1
  cancelScheduledValues = vi.fn()
  setTargetAtTime = vi.fn((value: number) => { this.value = value })
}
class FakeGain {
  gain = new FakeParam()
  connect = vi.fn()
  disconnect = vi.fn()
}
class FakeSource {
  buffer: (AudioBuffer & { name: string }) | null = null
  onended: (() => void) | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}
class FakeContext {
  state = 'suspended'
  currentTime = 10
  destination = {}
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  compressor = { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam(), connect: vi.fn(), disconnect: vi.fn() }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source }
  createDynamicsCompressor() { return this.compressor }
  resume = vi.fn(async () => { this.state = 'running' })
  suspend = vi.fn(async () => { this.state = 'suspended' })
  close = vi.fn(async () => { this.state = 'closed' })
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({ name: new TextDecoder().decode(data), duration: .4 } as unknown as AudioBuffer))
}
function harness(fetcher?: typeof fetch) {
  const context = new FakeContext()
  let onVisibility = () => {}
  const document = { visibilityState: 'visible',
    addEventListener: vi.fn((_name: string, handler: () => void) => { onVisibility = handler }),
    removeEventListener: vi.fn(),
  }
  const load = fetcher ?? vi.fn<typeof fetch>(async input => new Response(String(input).split('/').at(-1)!.split('.')[0]))
  const create = vi.fn(() => context as unknown as AudioContext)
  const audio = new OverdriveAudio({ createContext: create, fetcher: load,
    document: document as unknown as Document })
  audio.setOptions({ mute: false, volume: .65 })
  return { audio, context, create, load, document,
    visibility(value: 'visible' | 'hidden') { document.visibilityState = value; onVisibility() },
  }
}

describe('Overdrive pre-rendered audio transport', () => {
  it('contacts belong to an audible visible 3D scene and are consumed once, including across mute and hiding', async () => {
    const h = harness()
    await h.audio.unlock()
    let boardVisible = false
    const covered = h.audio.contactPlayer(()=>boardVisible)
    covered(false); boardVisible=true; covered(false)
    expect(h.context.sources).toHaveLength(0)
    const free = h.audio.contactPlayer(()=>true)
    free(false); free(false)
    expect(h.context.sources.map(s=>s.buffer?.name)).toEqual(['board-contact'])
    const blocked = h.audio.contactPlayer(()=>true)
    h.audio.setOptions({mute:true,volume:1})
    const muted = h.audio.contactPlayer(()=>true)
    h.audio.setOptions({mute:false,volume:1}); blocked(true); muted(false)
    const hidden = h.audio.contactPlayer(()=>true); h.visibility('hidden'); h.visibility('visible'); hidden(false)
    const reset = h.audio.contactPlayer(()=>true); h.audio.stop(); reset(false)
    h.audio.setOptions({mute:false,volume:1,reducedMotion:true}); h.audio.contactPlayer(()=>true)(false)
    expect(h.context.sources).toHaveLength(1)
    h.audio.setOptions({mute:false,volume:.5}); h.audio.contactPlayer(()=>true)(true)
    expect(h.context.sources.at(-1)?.buffer?.name).toBe('piece-contact')
    h.audio.dispose()
  })
  it('does not make a context or sound without a gesture, and never replays pre-unlock history', async () => {
    const h = harness()
    h.audio.playEvents([move])
    expect(h.create).not.toHaveBeenCalled()
    await h.audio.unlock()
    expect(h.context.sources).toHaveLength(0)
    expect(h.load).toHaveBeenCalledTimes(OVERDRIVE_CUES.length)
    h.audio.playEvents([move])
    expect(h.context.sources).toHaveLength(0)
    h.audio.playEvents([{ ...move, id: 'game-one/2/move' }])
    expect(h.context.sources[0].buffer?.name).toBe('move')
    h.audio.dispose()
  })
  it('deduplicates committed events and schedules the actual named buffers on the audio clock', async () => {
    const h = harness()
    await h.audio.unlock()
    const events = [move, gain, check]
    h.audio.playEvents(events)
    h.audio.playEvents(structuredClone(events))
    expect(h.context.sources.map(source => source.buffer?.name)).toEqual(['move', 'energy', 'cellfull', 'check'])
    const starts = h.context.sources.map(source => source.start.mock.calls[0][0] as number)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(starts[0]).toBeGreaterThan(h.context.currentTime)
    h.audio.dispose()
  })
  it('schedules the real raid impact at its midway capture clock, before its landing', async () => {
    const h = harness()
    await h.audio.unlock()
    const fixture = TEACHING_FIXTURES.find(item => item.id === 'raid')!
    const events = transition(fixture.state, fixture.expected).events
    const timing = sceneTiming(events)
    h.audio.playEvents(events)
    const source = h.context.sources.find(item => item.buffer?.name === 'capture')!
    const at = source.start.mock.calls[0][0] as number
    expect(at - h.context.currentTime).toBeCloseTo(.008 + timing.contact / 1000)
    expect(at - h.context.currentTime).toBeLessThan(timing.land / 1000)
    h.audio.dispose()
  })
  it('mute cancels every scheduled voice and consumes muted events without a later burst', async () => {
    const h = harness()
    await h.audio.unlock()
    h.audio.playEvents([move, gain, check])
    const before = h.context.sources.length
    h.audio.setOptions({ mute: true, volume: .65 })
    expect(h.context.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true)
    expect(h.context.gains[0].gain.value).toBe(0)
    const muted = { ...move, id: 'muted-move' }
    h.audio.playEvents([muted])
    h.audio.setOptions({ mute: false, volume: .65 })
    h.audio.playEvents([muted])
    expect(h.context.sources).toHaveLength(before)
    h.audio.playEvents([{ ...move, id: 'new-move' }])
    expect(h.context.sources).toHaveLength(before + 1)
    h.audio.dispose()
  })
  it('tab hiding cancels pending sounds, suspends the context and does not replay hidden actions on return', async () => {
    const h = harness()
    await h.audio.unlock()
    h.audio.playEvents([move, check])
    h.visibility('hidden')
    expect(h.context.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true)
    expect(h.context.suspend).toHaveBeenCalledOnce()
    const hidden = { ...move, id: 'hidden' }
    h.audio.playEvents([hidden])
    h.visibility('visible')
    await Promise.resolve()
    h.audio.playEvents([hidden])
    expect(h.context.sources).toHaveLength(2)
    h.audio.playCue('ui')
    expect(h.context.sources).toHaveLength(3)
    h.audio.dispose()
  })
  it('stop cancels late loading callbacks and starts a fresh event scope for a new game', async () => {
    const requests: { input: string; resolve: (response: Response) => void }[] = []
    const fetcher = vi.fn<typeof fetch>(input => new Promise(resolve => requests.push({ input: String(input), resolve })))
    const h = harness(fetcher)
    const unlocking = h.audio.unlock()
    await Promise.resolve()
    h.audio.playEvents([move])
    h.audio.stop()
    for (const request of requests) request.resolve(new Response(request.input.split('/').at(-1)!.split('.')[0]))
    await unlocking
    await Promise.resolve()
    expect(h.context.sources).toHaveLength(0)
    h.audio.playEvents([move])
    expect(h.context.sources).toHaveLength(1)
    h.audio.dispose()
  })
  it('drops delayed download cues instead of playing an obsolete impact', async () => {
    const requests: ((response: Response) => void)[] = []
    const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => requests.push(resolve)))
    const h = harness(fetcher)
    const unlocking = h.audio.unlock()
    await Promise.resolve()
    h.audio.playCue('move')
    h.context.currentTime += 2
    for (const resolve of requests) resolve(new Response('move'))
    await unlocking
    await Promise.resolve()
    expect(h.context.sources).toHaveLength(0)
    h.audio.dispose()
  })
  it('bounds polyphony and keeps a result cue when low-priority UI clicks arrive', async () => {
    const h = harness()
    await h.audio.unlock()
    h.audio.playCue('mate')
    const result = h.context.sources[0]
    for (let index = 0; index < 40; index++) h.audio.playCue('ui')
    expect(h.context.sources.filter(source => source.stop.mock.calls.length === 0)).toHaveLength(MAX_OVERDRIVE_VOICES)
    expect(result.stop).not.toHaveBeenCalled()
    h.audio.dispose()
  })
  it('retries a failed bank load on the next gesture and handles unavailable Web Audio without throwing', async () => {
    let fail = true
    const fetcher = vi.fn<typeof fetch>(async () => fail ? new Response('', { status: 503 }) : new Response('move'))
    const h = harness(fetcher)
    await h.audio.unlock()
    expect(h.context.decodeAudioData).not.toHaveBeenCalled()
    fail = false
    await h.audio.unlock()
    h.audio.playCue('move')
    expect(h.context.sources).toHaveLength(1)
    h.audio.playCue('not-a-cue')
    expect(h.context.sources).toHaveLength(1)
    h.audio.dispose()
    const unavailable = new OverdriveAudio({ createContext: () => { throw new Error('Not supported') }, document: null })
    await expect(unavailable.unlock()).resolves.toBeUndefined()
    expect(() => unavailable.playCue('move')).not.toThrow()
    unavailable.dispose()
  })
  it('clamps only its own gain, and dispose aborts loads, closes the graph and removes listeners', async () => {
    const h = harness()
    await h.audio.unlock()
    h.audio.setOptions({ mute: false, volume: 900 })
    expect(h.context.gains[0].gain.value).toBe(.54)
    h.audio.playCue('move')
    h.audio.setOptions({ mute: false, volume: Number.NaN })
    expect(h.context.gains[0].gain.value).toBe(0)
    h.audio.dispose()
    h.audio.dispose()
    expect(h.context.close).toHaveBeenCalledOnce()
    expect(h.document.removeEventListener).toHaveBeenCalledOnce()
    expect((h.load as ReturnType<typeof vi.fn>).mock.calls[0][1].signal.aborted).toBe(true)
    await h.audio.unlock()
    h.audio.playCue('mate')
    expect(h.context.sources).toHaveLength(1)
  })
})

describe('shipped original PCM bank', () => {
  it('ships distinct, reproducible stereo PCM files below 2MB with measured headroom and silent edges', () => {
    const root = fileURLToPath(new URL('../../public/assets/overdrive/audio/', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as {
      bank: string; totalBytes: number; cues: Record<string, { sha256: string; durationSeconds: number; bytes: number; clippedSamples: number }>
    }
    expect(manifest.bank).toBe(OVERDRIVE_AUDIO_BANK)
    expect(Object.keys(manifest.cues).sort()).toEqual([...OVERDRIVE_CUES].sort())
    expect(new Set(Object.values(manifest.cues).map(item => item.sha256)).size).toBe(OVERDRIVE_CUES.length)
    let bytes = 0
    for (const name of OVERDRIVE_CUES) {
      const file = readFileSync(resolve(root, `${name}.wav`))
      const entry = manifest.cues[name]
      bytes += file.byteLength
      expect(createHash('sha256').update(file).digest('hex')).toBe(entry.sha256)
      expect(file.subarray(0, 4).toString()).toBe('RIFF')
      expect(file.subarray(8, 12).toString()).toBe('WAVE')
      expect(file.readUInt16LE(20)).toBe(1)
      expect(file.readUInt16LE(22)).toBe(2)
      expect(file.readUInt32LE(24)).toBe(32000)
      expect(file.readUInt16LE(34)).toBe(16)
      expect(file.readUInt32LE(40) / (32000 * 4)).toBe(entry.durationSeconds)
      expect(file.readInt16LE(44)).toBe(0)
      expect(file.readInt16LE(file.length - 2)).toBe(0)
      let peak = 0
      for (let index = 44; index < file.length; index += 2) peak = Math.max(peak, Math.abs(file.readInt16LE(index)))
      expect(peak).toBeGreaterThan(500)
      expect(peak / 32768).toBeLessThan(.67)
      expect(entry.clippedSamples).toBe(0)
      expect(file.byteLength).toBe(entry.bytes)
    }
    expect(bytes).toBe(manifest.totalBytes)
    expect(bytes).toBeLessThan(2_000_000)
  })
})
