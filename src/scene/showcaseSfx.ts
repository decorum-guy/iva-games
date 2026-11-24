import { promotionFamily } from './promotionMotion'
import { getDieMotionTiming } from './diceMotion'
import { promotionGain, promotionMontage, reactionMontage } from './sfxMontage'
import type { ActionPlan, PromotionPlayback } from './actionPresentation'
import type { CueKind, RecordedClip, SceneCue } from './audio'
import type { PieceType } from '../core/types'

const reactions = {
  guilt: 'r1-guilt', devastated: 'r2-devastated', berserk: 'r1-berserk', bloodlust: 'r2-bloodlust',
} as const

type ReactionSound = keyof typeof reactions
type PromotionSound = ReturnType<typeof promotionFamily>
type RoyalContactSound = 'royalCheck' | 'royalBreak' | 'royalGround'
export type ShowcaseSound = ReactionSound | PromotionSound | RoyalContactSound | 'dice' | 'berserkIgnite'

export const showcaseDice = { id: 'D2', level: .40 } as const

export const showcaseSources = {
  guilt: 'auditions/reaction-r1-guilt.mp3', devastated: 'auditions/reaction-r2-devastated.mp3',
  berserk: 'auditions/reaction-r1-berserk.mp3', bloodlust: 'auditions/reaction-r2-bloodlust.mp3',
  formation: 'auditions/promotion-p2-formation.mp3', rook: 'showcase/promotion-rook-p1-p2-room.mp3',
  queen: 'auditions/promotion-p2-queen.mp3',
  dice: `dice-auditions/${showcaseDice.id.toLowerCase()}.mp3`,
  berserkIgnite: 'showcase/berserk-ignition-f1-f2.mp3',
  royalCheck: 'showcase/royal-check.mp3',
  royalBreak: 'showcase/royal-mate-fragments.mp3', royalGround: 'showcase/royal-mate-ground.mp3',
} as const satisfies Readonly<Record<ShowcaseSound, string>>

export const QUEEN_SOUND_LEVEL = .90

const royalContactWindows = {
  royalCheck: [.70, .57], royalBreak: [.62, .38], royalGround: [.92, .92],
} as const satisfies Readonly<Record<RoyalContactSound, readonly [number, number]>>

export function reactionSoundLevel(kind: CueKind, figure?: PieceType) {
  if (kind === 'devastated' || kind === 'guilt' && figure === 'rook') return .80
  if (kind === 'berserk') return .95
  return 1
}
const promotionSounds: ReadonlySet<CueKind> = new Set([
  'promotionFormation', 'promotionRookApproach', 'promotionRookImpact',
  'promotionQueenApproach', 'promotionQueenImpact', 'promotionQueenFracture', 'promotionQueenArc',
])

function isReactionSound(kind: CueKind): kind is ReactionSound {
  return Object.hasOwn(reactions, kind)
}

export function showcaseSoundForCue(kind: CueKind, plan: ActionPlan | undefined): ShowcaseSound | undefined {
  if (kind === 'dice') return 'dice'
  if (kind === 'berserkIgnite') return 'berserkIgnite'
  if (kind === 'check' || kind === 'royalCheck') return 'royalCheck'
  if (kind === 'royalBreak' || kind === 'royalGround') return kind
  if (isReactionSound(kind)) return kind
  if (plan?.promotion && promotionSounds.has(kind)) return promotionFamily(plan.promotion.event.promotion)
}

export function dieRecordingCues(buffer: AudioBuffer, reduced: boolean, at: number, gain: number): RecordedClip[] {
  return getDieMotionTiming(reduced).impactsMs.map((impact, index) => ({
    buffer, at: at + (impact - 9) / 1000, offset: index * .128, duration: .108,
    gain, fadeIn: .003, fadeOut: .012,
  }))
}

export function replaceShowcaseCues(cues: readonly SceneCue[], buffers: ReadonlyMap<ShowcaseSound, AudioBuffer>,
  plan: ActionPlan | undefined, playback: PromotionPlayback | undefined, royal: boolean, reduced = Boolean(plan?.reduced),
) {
  const stock: SceneCue[] = []
  const clips: RecordedClip[] = []
  const promotion = plan?.promotion
  if (plan && promotion && cues.some(cue => promotionSounds.has(cue.kind))) {
    const family = promotionFamily(promotion.event.promotion)
    const buffer = buffers.get(family)
    if (buffer) {
      const edit = promotionMontage(promotion.event.promotion, plan.reduced,
        playback === 'formation' ? 0 : promotion.formationAt, {
          seconds: buffer.duration, marker: family === 'formation' ? .120 : .420,
          decibels: family === 'rook' ? 0 : promotionGain[family === 'queen' ? 'p2-queen' : 'p2-formation'],
          formation: family === 'formation',
        })
      clips.push({ ...edit, buffer, gain: 10 ** (edit.decibels / 20) * (family === 'queen' ? QUEEN_SOUND_LEVEL : 1) })
    }
  }
  const replacedPromotion = clips.length > 0
  function untilNextAccent(cue: SceneCue, index: number) {
    const nextState = cues.slice(index + 1).find(later => isReactionSound(later.kind))
    const nextStage = promotion && playback === undefined && cue.at < promotion.formationAt / 1000
      ? promotion.formationAt / 1000 : royal && plan ? plan.end / 1000 : Infinity
    return Math.min(nextState?.at ?? Infinity, nextStage) - cue.at
  }
  for (const [index, cue] of cues.entries()) {
    if (replacedPromotion && promotionSounds.has(cue.kind)) continue
    const sound = showcaseSoundForCue(cue.kind, plan)
    const buffer = sound ? buffers.get(sound) : undefined
    if (sound === 'dice' && buffer) {
      clips.push(...dieRecordingCues(buffer, reduced, cue.at, showcaseDice.level))
      continue
    }
    if (sound === 'berserkIgnite' && buffer) {
      const duration = Math.min(buffer.duration, reduced ? .36 : .88, untilNextAccent(cue, index))
      if (duration > .025) clips.push({ buffer, at: cue.at, duration, offset: 0, gain: reduced ? .72 : 1,
        fadeIn: .009, fadeOut: Math.min(.12, duration * .40) })
      continue
    }
    if ((sound === 'royalCheck' || sound === 'royalBreak' || sound === 'royalGround') && buffer) {
      const [ordinary, compact] = royalContactWindows[sound]
      const length = reduced ? compact : ordinary
      clips.push({ buffer, at: cue.at, offset: 0, duration: Math.min(buffer.duration, length),
        gain: reduced ? .73 : 1, fadeIn: .003, fadeOut: .045 })
      continue
    }
    const edit = isReactionSound(cue.kind) ? reactionMontage(reactions[cue.kind], cue.at) : undefined
    if (!buffer || !edit) { stock.push(cue); continue }
    // A committed new state or a cinematic handoff owns its own accent.
    const duration = Math.min(edit.duration, buffer.duration - edit.offset, untilNextAccent(cue, index))
    if (duration > .025) clips.push({ ...edit, buffer, duration,
      gain: 10 ** (edit.decibels / 20) * reactionSoundLevel(cue.kind, cue.figure),
      fadeOut: duration < edit.duration - .001 ? Math.min(edit.fadeOut, duration * .52) : edit.fadeOut })
  }
  return { stock, clips }
}
