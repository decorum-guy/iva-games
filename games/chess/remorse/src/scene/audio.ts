import type { Affliction, GameEvent, PieceType, Side } from '../core/types'
import { sampleWindow, sceneAudioPath } from './audioSamples'
import type { SampleName } from './audioSamples'
import { getDieMotionTiming } from './diceMotion'
import { fireEvent } from './fireMotion'
import { actionPlan, isCaptureReaction } from './actionPresentation'
import type { ActionPlan, PromotionPlayback } from './actionPresentation'
import { promotionFamily, promotionTiming } from './promotionMotion'
import { mateGroundContact, royalTiming } from './royalMotion'
import type { RoyalAction, RoyalCue } from './royalMotion'
import { reactionSoundLevel, replaceShowcaseCues, showcaseDice, showcaseSoundForCue, showcaseSources } from './showcaseSfx'
import type { ShowcaseSound } from './showcaseSfx'

export interface SceneAudioOptions {
  readonly reducedMotion?: boolean
  readonly humanSide?: Side | null
  /** performance.now() at the live presentation commit, shared with its animation. */
  readonly startedAt?: number
  readonly royal?: boolean
  readonly plan?: ActionPlan
  readonly batchId?: string
  readonly playback?: PromotionPlayback
}

export type CueKind = 'move' | 'capture' | 'mercy' | 'friendlyCapture' | 'dice' | 'unaffected'
  | 'guilt' | 'devastated' | 'berserk' | 'berserkIgnite' | 'bloodlust' | 'heal' | 'convert' | 'remove'
  | 'promotionFormation' | 'promotionRookApproach' | 'promotionRookImpact'
  | 'promotionQueenApproach' | 'promotionQueenImpact' | 'promotionQueenFracture' | 'promotionQueenArc'
  | 'bonus' | 'check' | 'turn' | 'win' | 'loss' | 'draw' | 'finish' | RoyalSound
type RoyalSound = 'royalCheck' | 'royalCharge' | 'royalBreak' | 'royalGround' | 'royalWin' | 'royalLoss' | 'royalEnd'

export interface SceneCue {
  readonly kind: CueKind
  readonly at: number
  readonly figure?: PieceType
}

function stateCue(kind: CueKind, at: number, events: readonly GameEvent[]): SceneCue {
  const state = events.find(event => (event.type === 'reaction' || event.type === 'affliction') && event.affliction === kind)
  return state?.type === 'reaction' || state?.type === 'affliction' ? { kind, at, figure: state.piece.type } : { kind, at }
}

function importantEffect(events: readonly GameEvent[], rolled: boolean): CueKind | undefined {
  const states = new Set<Affliction>()
  for (const event of events) {
    if (event.type === 'reaction' || event.type === 'affliction') states.add(event.affliction)
  }
  if (events.some(event => event.type === 'convert')) return 'convert'
  if (events.some(event => event.type === 'cure')) return 'heal'
  for (const state of ['bloodlust', 'berserk', 'devastated', 'guilt'] as const) {
    if (states.has(state)) return state
  }
  if (events.some(event => event.type === 'remove')) return 'remove'
  if (states.has('neutral') && rolled) return 'unaffected'
  if (events.some(event => event.type === 'bonus')) return 'bonus'
}

function outcomeCue(events: readonly GameEvent[], options: SceneAudioOptions): CueKind | undefined {
  if (options.royal) return undefined
  const outcome = events.find(event => event.type === 'outcome')
  if (outcome?.type === 'outcome') {
    const winner = outcome.outcome.winner
    return winner === null ? 'draw' : !options.humanSide ? 'finish' : winner === options.humanSide ? 'win' : 'loss'
  }
  if (events.some(event => event.type === 'turn' && event.check)) return 'check'
}

/** Schedule the whole committed action at its live start, including its later semantic stages. */
export function planSceneCues(events: readonly GameEvent[], options: SceneAudioOptions = {}): readonly SceneCue[] {
  const cues: SceneCue[] = []
  const rolled = events.some(event => event.type === 'reaction' && event.face !== undefined)
  const plan = options.plan ?? actionPlan(events, rolled, Boolean(options.reducedMotion), Boolean(options.royal))
  const { reduced, roll, promotion } = plan
  const capture = events.find(event => event.type === 'capture')
  function stateAccent(kind: CueKind, at: number, related: readonly GameEvent[]) {
    cues.push(stateCue(kind, at, related))
    if (kind === 'berserk' && capture && fireEvent(related, capture.capturer.affliction, 'berserk')?.kind === 'ignite') {
      cues.push({ kind: 'berserkIgnite', at })
    }
  }
  if (capture) cues.push({
    kind: capture.friendly ? 'friendlyCapture' : capture.mercy ? 'mercy' : 'capture',
    at: reduced ? .018 : promotion ? .205 : .13,
  })
  else if (events.some(event => event.type === 'move')) cues.push({ kind: 'move', at: reduced ? .022 : .16 })
  if (roll) cues.push({ kind: 'dice', at: roll.start / 1000 })

  const ending = outcomeCue(events, options)
  if (promotion) {
    const { event, reactionEvents, surgeEvents, reactionAt, surgeAt, formationAt, aftermathAt, aftermathEvents } = promotion
    const state = importantEffect(reactionEvents, rolled)
    if (state && reactionAt !== null) stateAccent(state, reactionAt / 1000 + (roll ? 0 : reduced ? .036 : .074), reactionEvents)
    if (surgeAt !== null) cues.push(stateCue('bloodlust', surgeAt / 1000 + (reduced ? .035 : .064), surgeEvents))
    const family = promotionFamily(event.promotion)
    const impact = (formationAt + promotionTiming(event.promotion, reduced).impact) / 1000
    if (family === 'formation') {
      cues.push({ kind: 'promotionFormation', at: formationAt / 1000 + (reduced ? .055 : .15) })
    } else if (family === 'rook') {
      if (!reduced) cues.push({ kind: 'promotionRookApproach', at: impact - .31 })
      cues.push({ kind: 'promotionRookImpact', at: impact })
    } else {
      if (!reduced) cues.push({ kind: 'promotionQueenApproach', at: impact - .42 })
      cues.push({ kind: 'promotionQueenImpact', at: impact }, { kind: 'promotionQueenFracture', at: impact + .075 })
      if (!reduced) cues.push({ kind: 'promotionQueenArc', at: impact + .14 })
    }
    const consequence = importantEffect(aftermathEvents.filter(event => event.type !== 'bonus'), false)
    if (consequence) cues.push(stateCue(consequence, aftermathAt / 1000 + (reduced ? .035 : .09), aftermathEvents))
    if (ending) cues.push({ kind: ending, at: plan.end / 1000 + .015 })
    if (options.playback) {
      const boundary = formationAt / 1000
      return options.playback === 'reaction' ? cues.filter(cue => cue.at < boundary)
        : cues.filter(cue => cue.at >= boundary).map(cue => ({ ...cue, at: cue.at - boundary }))
    }
    return cues
  }

  const at = roll ? roll.reveal / 1000 : cues.length ? (reduced ? .084 : .258) : .018
  const reactions = ending ? [] : events.filter(isCaptureReaction)
  const accent = ending ?? importantEffect(reactions.length ? reactions.slice(0, 1) : events, rolled)
  if (accent && (accent !== 'bloodlust' || plan.escalationAt === null)) {
    stateAccent(accent, at, reactions.length ? reactions : events)
  }
  if (plan.escalationAt !== null && !ending) {
    cues.push(stateCue('bloodlust', plan.escalationAt / 1000 + (reduced ? .035 : .064), reactions))
  }
  if (reactions.length) {
    const consequence = importantEffect(events.filter(event => !isCaptureReaction(event) && event.type !== 'bonus'), false)
    if (consequence) cues.push(stateCue(consequence, (cues.at(-1)?.at ?? at) + (reduced ? .09 : .18),
      events.filter(event => !isCaptureReaction(event))))
  } else if (!options.royal && !cues.length && events.some(event => event.type === 'turn')) {
    cues.push({ kind: 'turn', at: .018 })
  }
  return cues
}

interface AudioGraph {
  readonly audio: AudioContext
  readonly input: GainNode
  readonly master: GainNode
  samples?: AudioBuffer
  charge?: AudioBuffer
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

interface SampleVoice {
  readonly sample: SampleName
  readonly rate: number
  readonly gain: number
}

const regular: Record<Exclude<CueKind, 'dice' | 'berserkIgnite' | RoyalSound>, SampleVoice> = {
  move: { sample: 'stone', rate: 1, gain: .47 },
  capture: { sample: 'capture', rate: 1, gain: .68 },
  mercy: { sample: 'stone', rate: .87, gain: .40 },
  friendlyCapture: { sample: 'capture', rate: .81, gain: .64 },
  unaffected: { sample: 'resonance', rate: 1.26, gain: .22 },
  guilt: { sample: 'fracture', rate: 1.02, gain: .43 },
  devastated: { sample: 'fracture', rate: .70, gain: .51 },
  berserk: { sample: 'fracture', rate: 1.49, gain: .53 },
  bloodlust: { sample: 'capture', rate: .68, gain: .51 },
  heal: { sample: 'resonance', rate: 1.14, gain: .53 },
  convert: { sample: 'resonance', rate: .84, gain: .59 },
  remove: { sample: 'fracture', rate: .56, gain: .37 },
  // Local audition replacements attach to these named stages. The shipped
  // bank supplies their temporary mix until the owner selects new recordings.
  promotionFormation: { sample: 'resonance', rate: 1.19, gain: .46 },
  promotionRookApproach: { sample: 'resonance', rate: .75, gain: .22 },
  promotionRookImpact: { sample: 'capture', rate: .83, gain: .69 },
  promotionQueenApproach: { sample: 'resonance', rate: .57, gain: .26 },
  promotionQueenImpact: { sample: 'capture', rate: .66, gain: .75 },
  promotionQueenFracture: { sample: 'fracture', rate: .80, gain: .43 },
  promotionQueenArc: { sample: 'diceEdge', rate: 1.36, gain: .25 },
  bonus: { sample: 'resonance', rate: 1.65, gain: .31 },
  check: { sample: 'capture', rate: .83, gain: .64 },
  turn: { sample: 'stone', rate: 1.28, gain: .25 },
  win: { sample: 'resonance', rate: 1.15, gain: .67 },
  loss: { sample: 'fracture', rate: .79, gain: .51 },
  draw: { sample: 'resonance', rate: .93, gain: .48 },
  finish: { sample: 'capture', rate: .84, gain: .61 },
}

// Charge and resolution use the stone bank, which also supplies fallbacks
// when a recorded contact cannot be decoded.
const royalLayers = {
  royalCheck: [
    [0, { sample: 'capture', rate: .83, gain: .76 }],
    [.019, { sample: 'fracture', rate: .93, gain: .23 }],
  ],
  royalBreak: [
    [0, { sample: 'capture', rate: .68, gain: .92 }],
    [.009, { sample: 'fracture', rate: .80, gain: .61 }],
    [.024, { sample: 'diceEdge', rate: .84, gain: .41 }],
    [.072, { sample: 'resonance', rate: .61, gain: .42 }],
    [.190, { sample: 'stone', rate: .63, gain: .18 }],
  ],
  royalGround: [
    [0, { sample: 'capture', rate: .49, gain: .85 }],
  ],
  royalWin: [
    [0, { sample: 'resonance', rate: .98, gain: .39 }],
    [.085, { sample: 'resonance', rate: 1.46, gain: .27 }],
  ],
  royalLoss: [
    [0, { sample: 'resonance', rate: .61, gain: .36 }],
    [.067, { sample: 'stone', rate: .65, gain: .21 }],
  ],
  royalEnd: [
    [0, { sample: 'stone', rate: .74, gain: .26 }],
    [.039, { sample: 'resonance', rate: .79, gain: .31 }],
  ],
} as const satisfies Record<Exclude<RoyalSound, 'royalCharge'>, readonly (readonly [number, SampleVoice])[]>
const diceImpacts: readonly SampleVoice[] = [
  { sample: 'diceBody', rate: .93, gain: 1.05 },
  { sample: 'diceBounce', rate: 1.03, gain: .80 },
  { sample: 'diceEdge', rate: 1.02, gain: .66 },
  { sample: 'diceBounce', rate: 1.18, gain: .47 },
  { sample: 'diceSettle', rate: .95, gain: .40 },
]
const quietImpact: SampleVoice = { sample: 'diceBody', rate: 1.06, gain: .73 }
const previousDieLevel = .65
const MAX_CUE_AGE_MS = 1000
const MAX_SEEN_BATCHES = 128
const BUS_RELEASE = .018
let graph: AudioGraph | undefined
let sampleRequest: Promise<ArrayBuffer | undefined> | undefined
let showcaseRequests: ReadonlyMap<ShowcaseSound, Promise<void>> | undefined
const showcaseBuffers = new Map<ShowcaseSound, AudioBuffer>()
let enabled = false
let masterVolume = .65
let generation = 0
let resuming: Promise<void> | undefined
let pending: PendingCue | undefined
let visibilityListenerInstalled = false
const voices = new Set<Voice>()
const seenBatches = new Set<string>()

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const nowMs = () => typeof performance === 'undefined' ? Date.now() : performance.now()

/** Fetch local samples early. Decode with the actual context once a gesture unlocks it. */
export function prepareSceneAudio() {
  sampleRequest ??= fetch(`${import.meta.env.BASE_URL}${sceneAudioPath}`).then(response => response.ok ? response.arrayBuffer() : undefined, () => undefined)
    .catch(() => undefined)
  return sampleRequest
}

function prepareShowcaseAudio(fallback?: AudioContext) {
  if (showcaseRequests) return showcaseRequests
  let decoder: BaseAudioContext | undefined = fallback
  try {
    if (typeof OfflineAudioContext === 'function') decoder = new OfflineAudioContext(2, 1, 48_000)
  } catch { /* Use the live decoder after the first gesture if necessary. */ }
  if (!decoder) return
  const decode = decoder
  const requests = new Map<ShowcaseSound, Promise<void>>()
  for (const [key, asset] of Object.entries(showcaseSources) as [ShowcaseSound, string][]) {
    const request = fetch(`${import.meta.env.BASE_URL}assets/audio/${asset}`).then(async response => {
      if (response.ok) showcaseBuffers.set(key, await decode.decodeAudioData(await response.arrayBuffer()))
    }).catch(() => undefined).finally(() => { requests.delete(key) })
    requests.set(key, request)
  }
  showcaseRequests = requests
  return showcaseRequests
}

export function prepareGameAudio() {
  void prepareSceneAudio()
  prepareShowcaseAudio()
}

function adjustMaster(target: number) {
  if (!graph || graph.audio.state === 'closed') return
  const now = graph.audio.currentTime
  graph.master.gain.cancelScheduledValues(now)
  graph.master.gain.setTargetAtTime(target, now, .010)
}

function desiredGain() {
  return enabled && visible() ? .73 * masterVolume ** 1.35 : 0
}

/** Preference-only: changing a slider never creates/resumes an audio device or overrides mute. */
export function setAudioVolume(value: number) {
  if (!Number.isFinite(value)) return
  masterVolume = Math.max(0, Math.min(1, value))
  adjustMaster(desiredGain())
}

function releaseVoices() {
  const now = graph?.audio.currentTime ?? 0
  for (const voice of voices) {
    try {
      const gain = voice.envelope.gain
      if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now)
      else gain.cancelScheduledValues(now)
      gain.setTargetAtTime(0, now, .004)
      voice.source.stop(now + BUS_RELEASE)
    } catch { voice.clean() }
  }
}

/** Cancel scheduled/current effects on undo, navigation, restore or a different live session. */
export function stopSceneAudio() {
  generation += 1
  pending = undefined
  adjustMaster(0)
  releaseVoices()
}

export function muteAudio() {
  enabled = false
  stopSceneAudio()
}

function buildGraph(audio: AudioContext, decodedBank?: AudioBuffer): AudioGraph {
  const input = audio.createGain()
  const master = audio.createGain()
  const compressor = audio.createDynamicsCompressor()
  compressor.threshold.value = -15
  compressor.knee.value = 12
  compressor.ratio.value = 3
  compressor.attack.value = .003
  compressor.release.value = .075
  master.gain.value = 0
  input.connect(compressor).connect(master).connect(audio.destination)

  const result: AudioGraph = { audio, input, master }
  function installSamples(samples: AudioBuffer) {
    result.samples = samples
    const resonance = sampleWindow('resonance')
    const begin = Math.round(resonance.offset * samples.sampleRate)
    const length = Math.round(resonance.duration * samples.sampleRate)
    const charge = audio.createBuffer(1, length, samples.sampleRate)
    const target = charge.getChannelData(0)
    const recorded = samples.getChannelData(0)
    for (let i = 0; i < length; i++) target[i] = recorded[begin + length - 1 - i] * (i / length)
    result.charge = charge
  }
  if (decodedBank) installSamples(decodedBank)
  else if (typeof audio.decodeAudioData === 'function') {
    void prepareSceneAudio().then(async bytes => {
      if (bytes && audio.state !== 'closed') installSamples(await audio.decodeAudioData(bytes.slice(0)))
    }).catch(() => undefined)
    prepareShowcaseAudio(audio)
  }
  return result
}

/** Invoke in a real gesture before awaiting storage. */
export async function unlockAudio(decodedBank?: AudioBuffer): Promise<boolean> {
  enabled = true
  try {
    if (!graph || graph.audio.state === 'closed') {
      const AudioConstructor = globalThis.AudioContext ??
        (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioConstructor) return false
      graph = buildGraph(new AudioConstructor({ latencyHint: 'interactive' }), decodedBank)
    }
    if (!visibilityListenerInstalled && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!visible()) stopSceneAudio() })
      visibilityListenerInstalled = true
    }
    const current = graph
    if (current.audio.state !== 'running') {
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
    return false
  }
}

function connectVoice(g: AudioGraph, source: AudioScheduledSourceNode, gain: number): GainNode {
  const envelope = g.audio.createGain()
  envelope.gain.value = gain
  source.connect(envelope).connect(g.input)
  const voice: Voice = {
    source, envelope,
    clean: () => {
      source.disconnect()
      envelope.disconnect()
      voices.delete(voice)
    },
  }
  voices.add(voice)
  source.onended = voice.clean
  return envelope
}

function playContact(g: AudioGraph, when: number, voice: SampleVoice) {
  if (when < g.audio.currentTime) return
  const { sample, rate, gain } = voice
  if (g.samples) {
    const source = g.audio.createBufferSource()
    const { offset, duration } = sampleWindow(sample)
    source.buffer = g.samples
    source.playbackRate.setValueAtTime(rate, when)
    connectVoice(g, source, gain)
    source.start(when, offset, duration)
    return
  }

  // A short dry contact keeps feedback usable until the local audio bank decodes.
  const source = g.audio.createOscillator()
  const low = sample === 'capture' || sample === 'fracture' || sample === 'diceBody'
  const frequency = (low ? 170 : 300) * rate
  const decay = low ? .059 : .037
  source.type = 'triangle'
  source.frequency.setValueAtTime(frequency, when)
  source.frequency.exponentialRampToValueAtTime(frequency * .72, when + decay)
  const envelope = connectVoice(g, source, 0)
  envelope.gain.setValueAtTime(.001, when)
  envelope.gain.linearRampToValueAtTime(gain * .15, when + .002)
  envelope.gain.exponentialRampToValueAtTime(.0001, when + decay)
  source.start(when)
  source.stop(when + decay)
}

function renderCue(g: AudioGraph, kind: CueKind, when: number, reduced: boolean, figure?: PieceType, dieLevel = previousDieLevel) {
  if (kind === 'berserkIgnite') return
  if (kind === 'dice') {
    const timing = getDieMotionTiming(reduced)
    for (const [index, impact] of timing.impactsMs.entries()) {
      const voice = reduced ? quietImpact : diceImpacts[index]
      playContact(g, when + impact / 1000, { ...voice, gain: voice.gain * dieLevel })
    }
    return
  }
  if (kind === 'royalCharge') {
    if (!g.charge || when < g.audio.currentTime) return
    const source = g.audio.createBufferSource()
    source.buffer = g.charge
    source.playbackRate.setValueAtTime(.247, when)
    connectVoice(g, source, reduced ? .24 : .35)
    source.start(when)
    return
  }
  if (kind === 'royalCheck' || kind === 'royalBreak' || kind === 'royalGround' || kind === 'royalWin' || kind === 'royalLoss' || kind === 'royalEnd') {
    for (const [delay, layer] of royalLayers[kind]) {
      playContact(g, when + delay, reduced ? { ...layer, gain: layer.gain * .73 } : layer)
    }
    return
  }
  const sound = regular[kind]
  const rate = reduced && (kind === 'move' || kind === 'capture' || kind === 'mercy' || kind === 'friendlyCapture')
    ? sound.rate * 1.42 : sound.rate
  playContact(g, when, { ...sound, rate, gain: sound.gain * reactionSoundLevel(kind, figure) })
}

export interface RecordedClip {
  readonly buffer: AudioBuffer
  readonly at: number
  readonly offset: number
  readonly duration: number
  readonly gain: number
  readonly fadeIn: number
  readonly fadeOut: number
}

function playRecorded(g: AudioGraph, clip: RecordedClip, when: number) {
  const now = g.audio.currentTime
  const elapsed = Math.max(0, now - when)
  const duration = clip.duration - elapsed
  if (duration <= .018) return
  const source = g.audio.createBufferSource()
  source.buffer = clip.buffer
  const start = Math.max(now, when)
  const release = Math.min(clip.fadeOut, duration * .8)
  const attack = Math.min(clip.fadeIn, duration - release)
  const gain = connectVoice(g, source, 0).gain
  const level = release > 0 ? clip.gain * Math.min(1, duration / clip.fadeOut) : clip.gain
  gain.setValueAtTime(0, start)
  gain.linearRampToValueAtTime(level, start + attack)
  if (release > 0) {
    gain.setValueAtTime(level, start + duration - release)
    gain.linearRampToValueAtTime(0, start + duration)
  }
  source.start(start, clip.offset + elapsed, duration)
}

/** The isolated audition uses the live bank and bus with a shared future visual epoch. */
export function playAuditionAudio(cues: readonly SceneCue[], clips: readonly RecordedClip[], startedAt: number, reduced: boolean, dieLevel?: number) {
  const g = graph
  if (!g?.samples || !enabled || !visible() || g.audio.state !== 'running') return false
  const time = g.audio.currentTime + (startedAt - nowMs()) / 1000
  if (time < g.audio.currentTime) return false
  try {
    releaseVoices()
    adjustMaster(desiredGain())
    for (const cue of cues) renderCue(g, cue.kind, time + cue.at, reduced, cue.figure, dieLevel)
    for (const clip of clips) playRecorded(g, clip, time + clip.at)
    return true
  } catch {
    stopSceneAudio()
    return false
  }
}

function scheduleCues(g: AudioGraph, cues: readonly SceneCue[], options: SceneAudioOptions, elapsedMs = 0) {
  if (!enabled || masterVolume === 0 || !visible() || g.audio.state !== 'running') return
  const reduced = Boolean(options.reducedMotion)
  const future = cues.filter(cue => cue.at + (cue.kind === 'dice' ? getDieMotionTiming(reduced).motionMs / 1000 : 0) >= elapsedMs / 1000)
  if (!future.length) return
  // Only the latest committed action owns the effects bus. Clear previous tails
  // and delayed accents before a quick reply or an interrupted presentation.
  const batch = ++generation
  releaseVoices()
  adjustMaster(desiredGain())
  const base = g.audio.currentTime + .008 - elapsedMs / 1000
  const selected: SceneCue[] = []
  const loading = new Set<Promise<void>>()
  for (const cue of future) {
    const sound = showcaseSoundForCue(cue.kind, options.plan)
    if (!sound) {
      renderCue(g, cue.kind, base + cue.at, reduced, cue.figure)
      continue
    }
    selected.push(cue)
    const request = !showcaseBuffers.has(sound) && showcaseRequests?.get(sound)
    if (request) loading.add(request)
  }
  if (!selected.length) return
  function playSelected() {
    const { stock, clips } = replaceShowcaseCues(selected, showcaseBuffers, options.plan, options.playback, Boolean(options.royal), reduced)
    for (const cue of stock) renderCue(g, cue.kind, base + cue.at, reduced, cue.figure, showcaseDice.level)
    for (const clip of clips) playRecorded(g, clip, base + clip.at)
  }
  // WebKit may still be decoding the first recording when the player moves.
  // Start the ordinary cues unchanged and reserve the recorded ones until
  // ready or just before their first accent. Both use the original epoch.
  const spareMs = (base + Math.min(...selected.map(cue => cue.at)) - g.audio.currentTime) * 1000 - 30
  if (!loading.size || spareMs <= 0) { playSelected(); return }
  let played = false
  function finish() {
    if (played) return
    played = true
    clearTimeout(deadline)
    if (batch !== generation || !enabled || masterVolume === 0 || !visible() || g.audio.state !== 'running') return
    try { playSelected() } catch { stopSceneAudio() }
  }
  const deadline = setTimeout(finish, spareMs)
  void Promise.all(loading).then(finish)
}

function playBatch(batchId: string | undefined, cues: readonly SceneCue[], options: SceneAudioOptions): boolean {
  if (!enabled || masterVolume === 0 || !graph || !visible()) return false
  if (!batchId || seenBatches.has(batchId)) return false
  const now = nowMs()
  const startedAt = typeof options.startedAt === 'number' && Number.isFinite(options.startedAt) && options.startedAt >= 0
    ? Math.min(now, options.startedAt) : now
  const elapsedMs = now - startedAt
  if (elapsedMs > MAX_CUE_AGE_MS) return false
  if (!cues.length) return false
  try {
    if (graph.audio.state === 'running') scheduleCues(graph, cues, options, elapsedMs)
    else if (resuming) pending = { cues, options, generation, startedAt }
    else return false
    seenBatches.add(batchId)
    if (seenBatches.size > MAX_SEEN_BATCHES) seenBatches.delete(seenBatches.values().next().value!)
    return true
  } catch {
    stopSceneAudio()
    return false
  }
}

/** Accept only newly committed live events. Never call this with restored/review/search history. */
export function playSceneCue(events: readonly GameEvent[], options: SceneAudioOptions = {}): boolean {
  const plan = options.plan ?? actionPlan(events, events.some(event => event.type === 'reaction' && event.face !== undefined),
    Boolean(options.reducedMotion), Boolean(options.royal))
  const live = { ...options, plan }
  return playBatch(options.batchId ?? events.at(-1)?.id, planSceneCues(events, live), live)
}

export function planRoyalCues(cue: RoyalAction): SceneCue[] {
  const { impact, resolution } = royalTiming(cue)
  if (cue.kind === 'check') return [{ kind: 'royalCheck', at: impact / 1000 }]
  const contact = mateGroundContact(cue) / 1000
  return [
    ...(cue.fromPromotion && !cue.reduced ? [] : [{ kind: 'royalCharge' as const, at: (impact - 760) / 1000 }]),
    { kind: 'royalGround', at: contact },
    // The two unchanged recordings form one contact without stacking their sharp transients.
    { kind: 'royalBreak', at: contact + .018 },
    { kind: cue.tone === 'win' ? 'royalWin' : cue.tone === 'loss' ? 'royalLoss' : 'royalEnd', at: resolution / 1000 },
  ]
}

export function playRoyalCue(cue: RoyalCue) {
  const cues = planRoyalCues(cue)
  return playBatch(`royal/${cue.id}`, cues, { reducedMotion: cue.reduced, startedAt: cue.startedAt })
}
