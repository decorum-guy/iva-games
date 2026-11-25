import type { GameEvent } from '../core'
import { sceneTiming } from './motion'

export const OVERDRIVE_AUDIO_BANK = 'overdrive-original-dsp-v1'
export const OVERDRIVE_CUES = [
  'ui', 'move', 'capture', 'sweep', 'raid', 'battery', 'ram', 'rotation', 'cover',
  'energy', 'spend', 'cellfull', 'activate', 'expire', 'promotion', 'check', 'mate', 'finish',
] as const
export type OverdriveCueName = typeof OVERDRIVE_CUES[number]
export interface OverdriveCue { readonly name: OverdriveCueName; readonly at: number }
export interface OverdriveAudioOptions { readonly mute: boolean; readonly volume: number; readonly reducedMotion?: boolean }

const CUE_GAIN: Record<OverdriveCueName, number> = {
  ui: .5, move: .7, capture: .76, sweep: .8, raid: .78, battery: .8, ram: .8, rotation: .8, cover: .8,
  energy: .66, spend: .66, cellfull: .75, activate: .8, expire: .65, promotion: .8, check: .85, mate: .9, finish: .75,
}
const CUE_PRIORITY: Record<OverdriveCueName, number> = {
  ui: 0, move: 1, capture: 2, sweep: 3, raid: 3, battery: 3, ram: 3, rotation: 3, cover: 3,
  energy: 1, spend: 1, cellfull: 2, activate: 4, expire: 2, promotion: 4, check: 5, mate: 6, finish: 5,
}
export const MAX_OVERDRIVE_VOICES = 8

/** One semantic action: physical cue, resource feedback, then check/result. */
export function planOverdriveCues(events: readonly GameEvent[], reducedMotion = false, bank = 5): readonly OverdriveCue[] {
  if (!events.length) return []
  const cues: OverdriveCue[] = []
  const ability = events.find(event => event.type === 'ability')
  const activation = events.some(event => event.type === 'form' && event.cause === 'activate')
  const capture = events.some(event => event.type === 'capture')
  const moving = events.some(event => event.type === 'move')
  const promotion = events.some(event => event.type === 'promotion')
  const resources = events.filter(event => event.type === 'energy')
  const outcome = events.find(event => event.type === 'outcome')
  const timing = sceneTiming(events, reducedMotion)
  if (activation) cues.push({ name: 'activate', at: 0 })
  else if (resources.some(event => event.spent > 0)) cues.push({ name: 'spend', at: 0 })
  if (ability) cues.push({ name: ability.ability, at: timing.abilityCue })
  if (capture) cues.push({ name: 'capture', at: timing.contact })
  else if (moving && !ability) cues.push({ name: 'move', at: timing.land })
  if (promotion) cues.push({ name: 'promotion', at: timing.promotionStart })
  if (events.some(event => event.type === 'form' && (event.cause === 'expire' || event.cause === 'capture'))) {
    cues.push({ name: 'expire', at: events.some(event => event.type === 'form' && event.cause === 'capture') ? timing.contact : timing.land })
  }
  const earned = resources.filter(event => event.captureEarned + event.checkEarned > 0 &&
    event.after > Math.max(0, event.before - event.spent))
  if (earned.length) {
    cues.push({ name: 'energy', at: timing.energy })
    if (earned.some(event => Math.floor(event.after / bank) > Math.floor(Math.max(0, event.before - event.spent) / bank))) {
      cues.push({ name: 'cellfull', at: timing.cellFull })
    }
  }
  if (outcome) cues.push({ name: outcome.outcome.reason === 'checkmate' ? 'mate' : 'finish', at: timing.result })
  else if (events.some(event => event.type === 'turn' && event.check)) cues.push({ name: 'check', at: timing.result })
  return cues.sort((a, b) => a.at - b.at).map(cue => ({ ...cue, at: cue.at / 1000 }))
}

interface AudioEnvironment {
  createContext(): AudioContext
  fetcher: typeof fetch
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null
}
interface Voice { readonly source: AudioBufferSourceNode; readonly gain: GainNode; readonly priority: number }
const isCue = (value: string): value is OverdriveCueName => (OVERDRIVE_CUES as readonly string[]).includes(value)

/** Pre-rendered original samples only; no runtime oscillator fallback or ambient loop. */
export class OverdriveAudio {
  private readonly env: AudioEnvironment
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private readonly buffers = new Map<OverdriveCueName, AudioBuffer>()
  private readonly loading = new Map<OverdriveCueName, Promise<AudioBuffer | null>>()
  private readonly voices = new Set<Voice>()
  private readonly seen = new Set<string>()
  private options: OverdriveAudioOptions = { mute: true, volume: .65 }
  private generation = 0
  private unlocked = false
  private disposed = false
  private readonly abort = new AbortController()

  constructor(environment: Partial<AudioEnvironment> = {}) {
    this.env = {
      createContext: () => new AudioContext({ latencyHint: 'interactive' }),
      fetcher: (...args) => fetch(...args),
      document: typeof document === 'undefined' ? null : document,
      ...environment,
    }
    this.env.document?.addEventListener('visibilitychange', this.onVisibility)
  }

  setOptions(options: OverdriveAudioOptions): void {
    if (this.disposed) return
    this.options = { ...options, volume: Number.isFinite(options.volume) ? Math.min(1, Math.max(0, options.volume)) : 0 }
    if (this.options.mute || this.options.volume === 0) this.halt()
    this.updateGain()
  }

  /** Call from a user's pointer/key gesture. Unlocking never plays a sound. */
  async unlock(): Promise<void> {
    if (this.disposed || this.hidden()) return
    try {
      if (!this.context) {
        const context = this.env.createContext()
        const master = context.createGain()
        const compressor = context.createDynamicsCompressor()
        compressor.threshold.value = -14
        compressor.knee.value = 10
        compressor.ratio.value = 12
        compressor.attack.value = .003
        compressor.release.value = .16
        compressor.connect(master)
        master.connect(context.destination)
        this.context = context
        this.master = master
        this.compressor = compressor
        this.updateGain()
      }
      await this.context.resume()
      if (this.disposed || this.hidden()) return
      this.unlocked = this.context.state === 'running'
      // Loading a bank is silent. A failure is retried on the next explicit unlock.
      await Promise.allSettled(OVERDRIVE_CUES.map(name => this.load(name)))
    } catch { /* Autoplay restrictions or unavailable audio must not interrupt a game. */ }
  }

  playEvents(events: readonly GameEvent[], bank = 5): void {
    if (this.disposed) return
    const fresh = events.filter(event => {
      if (this.seen.has(event.id)) return false
      this.seen.add(event.id)
      if (this.seen.size > 8192) this.seen.delete(this.seen.values().next().value!)
      return true
    })
    if (!this.canPlay()) return // Muted/hidden history is consumed, never queued for later.
    this.schedule(planOverdriveCues(fresh, this.options.reducedMotion, bank))
  }

  playCue(name: string): void {
    if (isCue(name) && this.canPlay()) this.schedule([{ name, at: 0 }])
  }

  /** Cancel the current scene and start a fresh event-ID scope (new game/lesson/undo). */
  stop(): void {
    this.halt()
    this.seen.clear()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.halt()
    this.abort.abort()
    this.env.document?.removeEventListener('visibilitychange', this.onVisibility)
    this.buffers.clear()
    this.loading.clear()
    this.seen.clear()
    this.master?.disconnect()
    this.compressor?.disconnect()
    void this.context?.close().catch(() => {})
    this.context = this.master = this.compressor = null
  }

  private hidden(): boolean { return this.env.document?.visibilityState === 'hidden' }
  private canPlay(): boolean {
    return !this.disposed && this.unlocked && !this.options.mute && this.options.volume > 0 &&
      !this.hidden() && this.context?.state === 'running'
  }
  private updateGain(): void {
    if (!this.master || !this.context) return
    const gain = this.options.mute ? 0 : this.options.volume * .54
    this.master.gain.cancelScheduledValues(this.context.currentTime)
    this.master.gain.setTargetAtTime(gain, this.context.currentTime, .012)
  }
  private readonly onVisibility = () => {
    if (this.hidden()) {
      this.halt()
      void this.context?.suspend().catch(() => {})
    } else if (this.unlocked && this.context && !this.disposed) {
      void this.context.resume().catch(() => {})
    }
  }

  private load(name: OverdriveCueName): Promise<AudioBuffer | null> {
    if (this.buffers.has(name)) return Promise.resolve(this.buffers.get(name)!)
    if (this.loading.has(name)) return this.loading.get(name)!
    const context = this.context
    if (!context || this.disposed) return Promise.resolve(null)
    const loaded = this.env.fetcher(`/assets/overdrive/audio/${name}.wav?bank=${OVERDRIVE_AUDIO_BANK}`, { signal: this.abort.signal })
      .then(async response => {
        if (!response.ok) return null
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        if (this.disposed || context !== this.context) return null
        this.buffers.set(name, buffer)
        return buffer
      }).catch(() => null).finally(() => { this.loading.delete(name) })
    this.loading.set(name, loaded)
    return loaded
  }

  private schedule(cues: readonly OverdriveCue[]): void {
    const context = this.context
    if (!context || !this.canPlay()) return
    const started = context.currentTime + .008
    const generation = this.generation
    for (const cue of cues) {
      const fire = (buffer: AudioBuffer | null) => {
        if (!buffer || generation !== this.generation || context !== this.context || !this.canPlay()) return
        const due = started + cue.at
        // A slow download must not replay an old click, impact or result in a new scene.
        if (context.currentTime - due > .15) return
        this.voice(cue.name, buffer, Math.max(context.currentTime, due))
      }
      const ready = this.buffers.get(cue.name)
      if (ready) fire(ready)
      else void this.load(cue.name).then(fire)
    }
  }

  private voice(name: OverdriveCueName, buffer: AudioBuffer, at: number): void {
    const context = this.context!
    const priority = CUE_PRIORITY[name]
    if (this.voices.size >= MAX_OVERDRIVE_VOICES) {
      const oldest = [...this.voices].sort((a, b) => a.priority - b.priority)[0]
      if (oldest.priority > priority) return
      this.release(oldest)
    }
    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    gain.gain.value = CUE_GAIN[name]
    source.connect(gain)
    gain.connect(this.compressor!)
    const voice: Voice = { source, gain, priority }
    this.voices.add(voice)
    source.onended = () => {
      this.voices.delete(voice)
      source.disconnect()
      gain.disconnect()
    }
    source.start(at)
  }

  private release(voice: Voice): void {
    this.voices.delete(voice)
    voice.source.onended = null
    try { voice.source.stop() } catch { /* The scheduled source may already have ended. */ }
    voice.source.disconnect()
    voice.gain.disconnect()
  }
  private halt(): void {
    this.generation++
    for (const voice of [...this.voices]) this.release(voice)
  }
}
