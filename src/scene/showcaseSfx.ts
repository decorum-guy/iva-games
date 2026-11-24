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
export type ShowcaseSound = ReactionSound | PromotionSound | 'dice' | 'royalCheck' | 'royalGround'

export const showcaseDice = { id: 'D2', level: .40 } as const

export const showcaseSources = {
  guilt: 'auditions/reaction-r1-guilt.mp3', devastated: 'auditions/reaction-r2-devastated.mp3',
  berserk: 'auditions/reaction-r1-berserk.mp3', bloodlust: 'auditions/reaction-r2-bloodlust.mp3',
  formation: 'auditions/promotion-p2-formation.mp3', rook: 'showcase/promotion-rook-p1-p2-room.mp3',
  queen: 'auditions/promotion-p2-queen.mp3',
  dice: `dice-auditions/${showcaseDice.id.toLowerCase()}.mp3`,
  royalCheck: 'showcase/royal-check.mp3', royalGround: 'showcase/royal-mate-ground.mp3',
} as const satisfies Readonly<Record<ShowcaseSound, string>>

export const QUEEN_SOUND_LEVEL = .90

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
  if (kind === 'check' || kind === 'royalCheck') return 'royalCheck'
  if (kind === 'royalGround') return 'royalGround'
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
  for (const [index, cue] of cues.entries()) {
    if (replacedPromotion && promotionSounds.has(cue.kind)) continue
    const sound = showcaseSoundForCue(cue.kind, plan)
    const buffer = sound ? buffers.get(sound) : undefined
    if (sound === 'dice' && buffer) {
      clips.push(...dieRecordingCues(buffer, reduced, cue.at, showcaseDice.level))
      continue
    }
    if ((sound === 'royalCheck' || sound === 'royalGround') && buffer) {
      clips.push({ buffer, at: cue.at, offset: 0, duration: Math.min(buffer.duration, sound === 'royalCheck' ? .42 : .92),
        gain: reduced ? .73 : 1, fadeIn: .003, fadeOut: .045 })
      continue
    }
    const edit = isReactionSound(cue.kind) ? reactionMontage(reactions[cue.kind], cue.at) : undefined
    if (!buffer || !edit) { stock.push(cue); continue }
    const nextState = cues.slice(index + 1).find(later => isReactionSound(later.kind))
    // A committed new state or a cinematic handoff owns its own accent.
    const nextStage = promotion && playback === undefined && cue.at < promotion.formationAt / 1000
      ? promotion.formationAt / 1000 : royal && plan ? plan.end / 1000 : Infinity
    const duration = Math.min(edit.duration, buffer.duration - edit.offset, Math.min(nextState?.at ?? Infinity, nextStage) - edit.at)
    if (duration > .025) clips.push({ ...edit, buffer, duration,
      gain: 10 ** (edit.decibels / 20) * reactionSoundLevel(cue.kind, cue.figure),
      fadeOut: duration < edit.duration - .001 ? Math.min(edit.fadeOut, duration * .52) : edit.fadeOut })
  }
  return { stock, clips }
}
