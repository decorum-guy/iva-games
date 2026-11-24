import type { Affliction, GameEvent, Side } from '../core/types'
import { getDieMotionTiming } from './diceMotion'

export interface SceneAudioOptions {
  readonly reducedMotion?: boolean
  readonly humanSide?: Side | null
  /** performance.now() at the live presentation commit, shared with its animation. */
  readonly startedAt?: number
}

type CueKind = 'move' | 'capture' | 'mercy' | 'friendlyCapture' | 'dice' | 'unaffected'
  | 'guilt' | 'devastated' | 'berserk' | 'bloodlust' | 'heal' | 'convert' | 'remove'
  | 'promotion' | 'bonus' | 'check' | 'turn' | 'win' | 'loss' | 'draw' | 'finish'

interface SceneCue {
  readonly kind: CueKind
  readonly at: number
}

/** One contact, one important transformation and one alert, not a chorus for every affected piece. */
export function planSceneCues(events: readonly GameEvent[], options: SceneAudioOptions = {}): readonly SceneCue[] {
  const cues: SceneCue[] = []
  const speed = options.reducedMotion ? .38 : 1
  const add = (kind: CueKind, at: number) => cues.push({ kind, at })
  const capture = events.find(event => event.type === 'capture')
  const rolled = events.some(event => event.type === 'reaction' && event.face !== undefined)
  const outcome = events.find(event => event.type === 'outcome')

  if (capture?.type === 'capture') add(capture.friendly ? 'friendlyCapture' : capture.mercy ? 'mercy' : 'capture', .13 * speed)
  else if (events.some(event => event.type === 'move')) add('move', .16 * speed)
  if (rolled) add('dice', 0)

  const states = new Set<Affliction>()
  for (const event of events) {
    if (event.type === 'reaction' || event.type === 'affliction') states.add(event.affliction)
  }
  let transformation: CueKind | undefined
  if (events.some(event => event.type === 'convert')) transformation = 'convert'
  else if (events.some(event => event.type === 'promotion')) transformation = 'promotion'
  else if (events.some(event => event.type === 'cure')) transformation = 'heal'
  else if (states.has('bloodlust')) transformation = 'bloodlust'
  else if (states.has('berserk')) transformation = 'berserk'
  else if (states.has('devastated')) transformation = 'devastated'
  else if (states.has('guilt')) transformation = 'guilt'
  else if (events.some(event => event.type === 'remove')) transformation = 'remove'
  else if (states.has('neutral') && rolled) transformation = 'unaffected'
  else if (events.some(event => event.type === 'bonus')) transformation = 'bonus'
  // The committed reaction is already known, but its sound waits for the same settle as the visible die.
  const afterContact = rolled ? getDieMotionTiming(Boolean(options.reducedMotion)).motionMs / 1000 + .025 : .25 * speed
  if (transformation) add(transformation, afterContact)

  if (outcome?.type === 'outcome') {
    const winner = outcome.outcome.winner
    add(winner === null ? 'draw' : !options.humanSide ? 'finish' : winner === options.humanSide ? 'win' : 'loss',
      cues.length ? afterContact + .14 * speed : .02 * speed)
  } else if (events.some(event => event.type === 'turn' && event.check)) {
    add('check', cues.length ? afterContact + .09 * speed : .02 * speed)
  } else if (!cues.length && events.some(event => event.type === 'turn')) add('turn', .02 * speed)
  return cues
}

interface AudioGraph {
  readonly audio: AudioContext
  readonly input: GainNode
  readonly master: GainNode
  readonly noise: AudioBuffer
}

interface Voice {
  readonly source: AudioScheduledSourceNode
  readonly envelope: GainNode
  readonly clean: () => void
}

interface PendingCue {
  readonly cues: readonly SceneCue[]
  readonly options: SceneAudioOptions
  readonly generation: number
  readonly startedAt: number
}

const MAX_VOICES = 64
const MAX_CUE_AGE_MS = 1000
const MAX_SEEN_BATCHES = 128
let graph: AudioGraph | undefined
let enabled = false
let masterVolume = .7
let generation = 0
let resuming: Promise<void> | undefined
let pending: PendingCue | undefined
let visibilityListenerInstalled = false
const voices = new Set<Voice>()
const seenBatches = new Set<string>()

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const nowMs = () => typeof performance === 'undefined' ? Date.now() : performance.now()

function adjustMaster(target: number) {
  if (!graph || graph.audio.state === 'closed') return
  const now = graph.audio.currentTime
  graph.master.gain.cancelScheduledValues(now)
  graph.master.gain.setTargetAtTime(target, now, .012)
}

function desiredGain() {
  return enabled && visible() ? .75 * masterVolume ** 1.4 : 0
}

/** Preference-only: changing a slider never creates/resumes an audio device or overrides mute. */
export function setAudioVolume(value: number) {
  if (!Number.isFinite(value)) return
  masterVolume = Math.max(0, Math.min(1, value))
  adjustMaster(desiredGain())
}

/** Cancel scheduled/current effects on undo, navigation, restore or a different live session. */
export function stopSceneAudio() {
  generation += 1
  pending = undefined
  adjustMaster(0)
  const now = graph?.audio.currentTime ?? 0
  for (const voice of [...voices]) {
    try {
      voice.envelope.gain.cancelScheduledValues(now)
      voice.envelope.gain.setTargetAtTime(.0001, now, .004)
      voice.source.stop(now + .018)
    } catch { voice.clean() }
  }
}

export function muteAudio() {
  enabled = false
  stopSceneAudio()
}

function buildGraph(audio: AudioContext): AudioGraph {
  const input = audio.createGain()
  const master = audio.createGain()
  const compressor = audio.createDynamicsCompressor()
  compressor.threshold.value = -18
  compressor.knee.value = 18
  compressor.ratio.value = 4
  compressor.attack.value = .003
  compressor.release.value = .16
  master.gain.value = 0
  input.connect(compressor).connect(master).connect(audio.destination)

  // A short local room tail gives stone/glass contacts body without external files or music.
  const room = audio.createConvolver()
  const roomSend = audio.createGain()
  roomSend.gain.value = .13
  const impulse = audio.createBuffer(2, Math.ceil(audio.sampleRate * .38), audio.sampleRate)
  const noise = audio.createBuffer(1, Math.ceil(audio.sampleRate * .6), audio.sampleRate)
  // Sound texture has its own fixed generator. It never consumes gameplay/engine randomness.
  let seed = 0x72534f52
  const sample = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0x100000000 * 2 - 1
  }
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel)
    for (let i = 0; i < data.length; i += 1) data[i] = sample() * (1 - i / data.length) ** 3
  }
  const texture = noise.getChannelData(0)
  for (let i = 0; i < texture.length; i += 1) texture[i] = sample()
  room.buffer = impulse
  input.connect(roomSend).connect(room).connect(compressor)
  return { audio, input, master, noise }
}

/** Invoke directly in Start/Resume/Learn, a board gesture or the sound toggle, before awaiting storage. */
export async function unlockAudio(): Promise<boolean> {
  enabled = true
  try {
    if (!graph || graph.audio.state === 'closed') {
      const AudioConstructor = globalThis.AudioContext ??
        (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioConstructor) return false
      graph = buildGraph(new AudioConstructor({ latencyHint: 'interactive' }))
    }
    if (!visibilityListenerInstalled && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!visible()) stopSceneAudio() })
      visibilityListenerInstalled = true
    }
    const current = graph
    if (current.audio.state !== 'running') {
      // Calling resume here (rather than in an effect) preserves the caller's user activation.
      if (!resuming) {
        const attempt = current.audio.resume().finally(() => { if (resuming === attempt) resuming = undefined })
        resuming = attempt
      }
      await resuming
    }
    if (!enabled || !visible() || current !== graph || current.audio.state !== 'running') return false
    adjustMaster(desiredGain())
    const queued = pending
    pending = undefined
    const elapsedMs = queued ? Math.max(0, nowMs() - queued.startedAt) : 0
    if (queued && queued.generation === generation && elapsedMs <= MAX_CUE_AGE_MS) {
      scheduleCues(current, queued.cues, queued.options, elapsedMs)
    }
    return true
  } catch {
    pending = undefined
    // A blocked/unsupported audio device never changes a game decision or rejects an action.
    return false
  }
}

function track(source: AudioScheduledSourceNode, envelope: GainNode, nodes: readonly AudioNode[]) {
  if (voices.size >= MAX_VOICES) {
    const oldest = voices.values().next().value as Voice | undefined
    if (oldest) {
      try { oldest.source.stop() } catch { /* It may already have ended. */ }
      oldest.clean()
    }
  }
  const voice: Voice = {
    source, envelope,
    clean: () => {
      for (const node of nodes) node.disconnect()
      voices.delete(voice)
    },
  }
  voices.add(voice)
  source.onended = voice.clean
}

function envelopeAt(envelope: GainNode, when: number, length: number, strength: number) {
  envelope.gain.setValueAtTime(0, when)
  envelope.gain.linearRampToValueAtTime(strength, when + .003)
  envelope.gain.exponentialRampToValueAtTime(.0001, when + length)
}

function tone(g: AudioGraph, when: number, note: number, length: number, strength: number,
  shape: OscillatorType = 'sine', endNote = note) {
  if (when < g.audio.currentTime) return
  const source = g.audio.createOscillator()
  const envelope = g.audio.createGain()
  source.type = shape
  source.frequency.setValueAtTime(note, when)
  if (endNote !== note) source.frequency.exponentialRampToValueAtTime(endNote, when + length)
  envelopeAt(envelope, when, length, strength)
  source.connect(envelope).connect(g.input)
  track(source, envelope, [source, envelope])
  source.start(when)
  source.stop(when + length + .01)
}

function texture(g: AudioGraph, when: number, length: number, strength: number, frequency: number,
  type: BiquadFilterType = 'bandpass', endFrequency = frequency) {
  if (when < g.audio.currentTime) return
  const source = g.audio.createBufferSource()
  const filter = g.audio.createBiquadFilter()
  const envelope = g.audio.createGain()
  source.buffer = g.noise
  filter.type = type
  filter.frequency.setValueAtTime(frequency, when)
  if (endFrequency !== frequency) filter.frequency.exponentialRampToValueAtTime(endFrequency, when + length)
  filter.Q.value = .65
  envelopeAt(envelope, when, length, strength)
  source.connect(filter).connect(envelope).connect(g.input)
  track(source, envelope, [source, filter, envelope])
  source.start(when, .04, length)
  source.stop(when + length + .01)
}

function contact(g: AudioGraph, when: number, weight = 1, pitch = 1) {
  texture(g, when, .032, .32 * weight, 2100 * pitch, 'lowpass')
  tone(g, when, 205 * pitch, .10, .21 * weight, 'triangle', 183 * pitch)
  tone(g, when + .002, 625 * pitch, .043, .075 * weight)
}

function renderCue(g: AudioGraph, kind: CueKind, when: number, options: SceneAudioOptions) {
  const speed = options.reducedMotion ? .38 : 1
  const at = (offset: number) => when + offset * speed
  switch (kind) {
    case 'move':
      contact(g, when)
      break
    case 'capture':
    case 'friendlyCapture':
      contact(g, when, 1.35, kind === 'friendlyCapture' ? .72 : .86)
      texture(g, at(.022), .09, .19, 1500, 'highpass')
      tone(g, at(.014), 112, .18, .16, 'triangle', 74)
      tone(g, at(.034), 1180, .075, .045)
      break
    case 'mercy':
      contact(g, when, .85, .82)
      texture(g, at(.025), .17, .085, 1200, 'bandpass', 350)
      break
    case 'dice':
      for (const [index, impactMs] of getDieMotionTiming(Boolean(options.reducedMotion)).impactsMs.entries()) {
        contact(g, when + impactMs / 1000, options.reducedMotion ? .34 : .64 * .74 ** index, 1.8 - index * .12)
      }
      break
    case 'unaffected':
      tone(g, when, 659.25, .11, .09)
      tone(g, at(.025), 987.77, .075, .04)
      break
    case 'guilt':
      tone(g, when, 523.25, .26, .105)
      tone(g, at(.065), 466.16, .25, .08)
      tone(g, when, 1046.5, .10, .025)
      break
    case 'devastated':
      texture(g, when, .22, .10, 950, 'bandpass', 250)
      tone(g, when, 174.61, .34, .16, 'triangle', 130.81)
      tone(g, at(.07), 246.94, .26, .075, 'sine', 196)
      break
    case 'berserk':
      texture(g, when, .12, .12, 700, 'bandpass', 1900)
      tone(g, when, 146.83, .16, .16, 'triangle', 220)
      tone(g, at(.09), 440, .19, .10, 'triangle', 587.33)
      break
    case 'bloodlust':
      for (const delay of [0, .11]) {
        tone(g, at(delay), 98, .17, .19, 'triangle', 73.42)
        texture(g, at(delay), .06, .12, 1100, 'lowpass')
      }
      tone(g, at(.04), 415.3, .24, .065, 'sine', 311.13)
      break
    case 'heal':
      for (const [index, note] of [392, 493.88, 587.33].entries()) {
        tone(g, at(index * .055), note, .34, .10 - index * .018)
      }
      tone(g, at(.14), 1174.66, .18, .025)
      break
    case 'convert':
      texture(g, when, .25, .07, 600, 'bandpass', 2300)
      for (const [index, note] of [293.66, 440, 587.33, 880].entries()) {
        tone(g, at(index * .065), note, .34, .105 - index * .019)
      }
      break
    case 'remove':
      texture(g, when, .25, .16, 1800, 'bandpass', 250)
      tone(g, when, 196, .25, .09, 'sine', 98)
      break
    case 'promotion':
      for (const [index, note] of [392, 493.88, 587.33, 783.99].entries()) {
        tone(g, at(index * .055), note, .30, .10 - index * .012)
      }
      tone(g, at(.19), 1567.98, .13, .025)
      break
    case 'bonus':
      tone(g, when, 783.99, .11, .09)
      tone(g, at(.065), 987.77, .13, .065)
      break
    case 'check':
      tone(g, when, 698.46, .18, .14, 'triangle')
      tone(g, at(.11), 932.33, .24, .115)
      break
    case 'turn':
      tone(g, when, 440, .065, .075, 'triangle')
      break
    case 'win':
      for (const [index, note] of [523.25, 659.25, 783.99, 1046.5].entries()) {
        tone(g, at(index * .095), note, .42, .12 - index * .018)
      }
      break
    case 'loss':
      for (const [index, note] of [329.63, 293.66, 220].entries()) {
        tone(g, at(index * .13), note, .44, .12 - index * .018)
      }
      break
    case 'draw':
    case 'finish':
      for (const [index, note] of [293.66, 440, 587.33].entries()) {
        tone(g, at(index * .08), note, .38, .10 - index * .015)
      }
      break
  }
}

function scheduleCues(g: AudioGraph, cues: readonly SceneCue[], options: SceneAudioOptions, elapsedMs = 0) {
  if (!enabled || masterVolume === 0 || !visible() || g.audio.state !== 'running') return
  adjustMaster(desiredGain())
  // A delayed React effect or device wake-up cannot restart the throw. Drop past contacts.
  const base = g.audio.currentTime + .008 - elapsedMs / 1000
  for (const cue of cues) renderCue(g, cue.kind, base + cue.at, options)
}

/** Accept only newly committed live events. Never call this with restored/review/search history. */
export function playSceneCue(events: readonly GameEvent[], options: SceneAudioOptions = {}): boolean {
  if (!enabled || masterVolume === 0 || !graph || !visible()) return false
  const batchId = events.at(-1)?.id
  if (!batchId || seenBatches.has(batchId)) return false
  const now = nowMs()
  const startedAt = typeof options.startedAt === 'number' && Number.isFinite(options.startedAt) && options.startedAt >= 0
    ? Math.min(now, options.startedAt) : now
  const elapsedMs = now - startedAt
  if (elapsedMs > MAX_CUE_AGE_MS) return false
  const cues = planSceneCues(events, options)
  if (!cues.length) return false
  try {
    if (graph.audio.state === 'running') scheduleCues(graph, cues, options, elapsedMs)
    else if (resuming) pending = { cues, options, generation, startedAt }
    else return false // No backlog while blocked: a future gesture must not play old game history.
    seenBatches.add(batchId)
    if (seenBatches.size > MAX_SEEN_BATCHES) seenBatches.delete(seenBatches.values().next().value!)
    return true
  } catch {
    stopSceneAudio()
    return false
  }
}
