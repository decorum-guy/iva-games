import type { Affliction, GameEvent, Side } from '../core/types'
import { sampleWindow, sceneAudioPath } from './audioSamples'
import type { SampleName } from './audioSamples'
import { getDieMotionTiming } from './diceMotion'
import { actionPlan, isCaptureReaction } from './actionPresentation'
import type { ActionPlan, PromotionPlayback } from './actionPresentation'
import { promotionFamily, promotionTiming } from './promotionMotion'
import { royalTiming } from './royalMotion'
import type { RoyalCue } from './royalMotion'

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

type CueKind = 'move' | 'capture' | 'mercy' | 'friendlyCapture' | 'dice' | 'unaffected'
  | 'guilt' | 'devastated' | 'berserk' | 'bloodlust' | 'heal' | 'convert' | 'remove'
  | 'promotionFormation' | 'promotionRookApproach' | 'promotionRookImpact'
  | 'promotionQueenApproach' | 'promotionQueenImpact' | 'promotionQueenFracture' | 'promotionQueenArc'
  | 'bonus' | 'check' | 'turn' | 'win' | 'loss' | 'draw' | 'finish' | RoyalSound
type RoyalSound = 'royalCheck' | 'royalCharge' | 'royalBreak' | 'royalWin' | 'royalLoss' | 'royalEnd'

interface SceneCue {
  readonly kind: CueKind
  readonly at: number
}

export const DIE_SETTLE_SOUND_GAP = .09

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
  if (capture) cues.push({
    kind: capture.friendly ? 'friendlyCapture' : capture.mercy ? 'mercy' : 'capture',
    at: reduced ? .018 : promotion ? .205 : .13,
  })
  else if (events.some(event => event.type === 'move')) cues.push({ kind: 'move', at: reduced ? .022 : .16 })
  if (roll) cues.push({ kind: 'dice', at: roll.start / 1000 })

  const ending = outcomeCue(events, options)
  if (promotion) {
    const { event, reactionEvents, reactionAt, surgeAt, formationAt, aftermathAt, aftermathEvents } = promotion
    const state = importantEffect(reactionEvents, rolled)
    if (state && reactionAt !== null) cues.push({ kind: state, at: reactionAt / 1000 + (reduced ? .036 : .074) })
    if (surgeAt !== null) cues.push({ kind: 'bloodlust', at: surgeAt / 1000 + (reduced ? .035 : .064) })
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
    if (consequence) cues.push({ kind: consequence, at: aftermathAt / 1000 + (reduced ? .035 : .09) })
    if (ending) cues.push({ kind: ending, at: plan.end / 1000 + .015 })
    if (options.playback) {
      const boundary = formationAt / 1000
      return options.playback === 'reaction' ? cues.filter(cue => cue.at < boundary)
        : cues.filter(cue => cue.at >= boundary).map(cue => ({ ...cue, at: cue.at - boundary }))
    }
    return cues
  }

  const at = roll ? roll.settle / 1000 + DIE_SETTLE_SOUND_GAP : cues.length ? (reduced ? .084 : .258) : .018
  const reactions = ending ? [] : events.filter(isCaptureReaction)
  const accent = ending ?? importantEffect(reactions.length ? reactions.slice(0, 1) : events, rolled)
  if (accent) cues.push({ kind: accent, at })
  if (plan.escalationAt !== null && !ending) {
    cues.push({ kind: 'bloodlust', at: plan.escalationAt / 1000 + (reduced ? .035 : .064) })
  }
  if (reactions.length) {
    const consequence = importantEffect(events.filter(event => !isCaptureReaction(event) && event.type !== 'bonus'), false)
    if (consequence) cues.push({ kind: consequence, at: (cues.at(-1)?.at ?? at) + (reduced ? .09 : .18) })
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

const regular: Record<Exclude<CueKind, 'dice' | RoyalSound>, SampleVoice> = {
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
  check: { sample: 'diceEdge', rate: 1.02, gain: .64 },
  turn: { sample: 'stone', rate: 1.28, gain: .25 },
  win: { sample: 'resonance', rate: 1.15, gain: .67 },
  loss: { sample: 'fracture', rate: .79, gain: .51 },
  draw: { sample: 'resonance', rate: .93, gain: .48 },
  finish: { sample: 'capture', rate: .84, gain: .61 },
}

// The castle scenes remix the same recorded stone, metal and resonance bank.
// The layers share a compressed output and one contact time for the whole hit.
const royalLayers = {
  royalCheck: [
    [0, { sample: 'capture', rate: 1.17, gain: .68 }],
    [.012, { sample: 'diceEdge', rate: .81, gain: .35 }],
    [.038, { sample: 'resonance', rate: .84, gain: .31 }],
  ],
  royalBreak: [
    [0, { sample: 'capture', rate: .68, gain: .92 }],
    [.009, { sample: 'fracture', rate: .80, gain: .61 }],
    [.024, { sample: 'diceEdge', rate: .84, gain: .41 }],
    [.072, { sample: 'resonance', rate: .61, gain: .42 }],
    [.190, { sample: 'stone', rate: .63, gain: .18 }],
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
const MAX_CUE_AGE_MS = 1000
const MAX_SEEN_BATCHES = 128
const BUS_RELEASE = .018
let graph: AudioGraph | undefined
let sampleRequest: Promise<ArrayBuffer | undefined> | undefined
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

function buildGraph(audio: AudioContext): AudioGraph {
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
  if (typeof audio.decodeAudioData === 'function') {
    void prepareSceneAudio().then(async bytes => {
      if (!bytes || audio.state === 'closed') return
      const samples = await audio.decodeAudioData(bytes.slice(0))
      result.samples = samples
      const resonance = sampleWindow('resonance')
      const begin = Math.round(resonance.offset * samples.sampleRate)
      const length = Math.round(resonance.duration * samples.sampleRate)
      const charge = audio.createBuffer(1, length, samples.sampleRate)
      const target = charge.getChannelData(0)
      const recorded = samples.getChannelData(0)
      for (let i = 0; i < length; i++) target[i] = recorded[begin + length - 1 - i] * (i / length)
      result.charge = charge
    }).catch(() => undefined)
  }
  return result
}

/** Invoke in a real gesture before awaiting storage. */
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

function renderCue(g: AudioGraph, kind: CueKind, when: number, reduced: boolean) {
  if (kind === 'dice') {
    const timing = getDieMotionTiming(reduced)
    for (const [index, impact] of timing.impactsMs.entries()) {
      playContact(g, when + impact / 1000, reduced ? quietImpact : diceImpacts[index])
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
  if (kind === 'royalCheck' || kind === 'royalBreak' || kind === 'royalWin' || kind === 'royalLoss' || kind === 'royalEnd') {
    for (const [delay, layer] of royalLayers[kind]) {
      playContact(g, when + delay, reduced ? { ...layer, gain: layer.gain * .73 } : layer)
    }
    return
  }
  const sound = regular[kind]
  const rate = reduced && (kind === 'move' || kind === 'capture' || kind === 'mercy' || kind === 'friendlyCapture')
    ? sound.rate * 1.42 : sound.rate
  playContact(g, when, rate === sound.rate ? sound : { ...sound, rate })
}

function scheduleCues(g: AudioGraph, cues: readonly SceneCue[], options: SceneAudioOptions, elapsedMs = 0) {
  if (!enabled || masterVolume === 0 || !visible() || g.audio.state !== 'running') return
  const reduced = Boolean(options.reducedMotion)
  const future = cues.filter(cue => cue.at + (cue.kind === 'dice' ? getDieMotionTiming(reduced).motionMs / 1000 : 0) >= elapsedMs / 1000)
  if (!future.length) return
  // Only the latest committed action owns the effects bus. Clear previous tails
  // and delayed accents before a quick reply or an interrupted presentation.
  releaseVoices()
  adjustMaster(desiredGain())
  const base = g.audio.currentTime + .008 - elapsedMs / 1000
  for (const cue of future) renderCue(g, cue.kind, base + cue.at, reduced)
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
  return playBatch(options.batchId ?? events.at(-1)?.id, planSceneCues(events, options), options)
}

export function playRoyalCue(cue: RoyalCue) {
  const { impact, resolution } = royalTiming(cue)
  const cues: SceneCue[] = cue.kind === 'check'
    ? [{ kind: 'royalCheck', at: impact / 1000 }]
    : [
      ...(cue.fromPromotion && !cue.reduced ? [] : [{ kind: 'royalCharge' as const, at: (impact - 760) / 1000 }]),
      { kind: 'royalBreak', at: impact / 1000 },
      { kind: cue.tone === 'win' ? 'royalWin' : cue.tone === 'loss' ? 'royalLoss' : 'royalEnd', at: resolution / 1000 },
    ]
  return playBatch(`royal/${cue.id}`, cues, { reducedMotion: cue.reduced, startedAt: cue.startedAt })
}
