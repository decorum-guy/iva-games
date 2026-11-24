import { rebirth } from '../core/passives'
import type { GameEvent, Piece } from '../core/types'
import { getDieMotionTiming, getDieThrowDuration } from './diceMotion'
import { promotionTiming } from './promotionMotion'
import { royalLeadIn } from './royalMotion'

type PromotionEvent = Extract<GameEvent, { type: 'promotion' }>

export type PromotionStage = 'contact' | 'roll' | 'reaction' | 'surge' | 'formation' | 'aftermath'

export interface PromotionPlan {
  readonly event: PromotionEvent
  readonly contactPawn: Piece
  readonly reactingPawn: Piece
  readonly formed: Piece
  readonly contactEvents: readonly GameEvent[]
  readonly reactionEvents: readonly GameEvent[]
  readonly surgeEvents: readonly GameEvent[]
  readonly aftermathEvents: readonly GameEvent[]
  readonly reactionAt: number | null
  readonly surgeAt: number | null
  readonly formationAt: number
  readonly aftermathAt: number
}

export interface ActionPlan {
  readonly reduced: boolean
  readonly roll: { readonly start: number; readonly settle: number } | null
  readonly end: number
  readonly escalationAt: number | null
  readonly promotion: PromotionPlan | null
}

export function isCaptureReaction(event: GameEvent) {
  return event.type === 'reaction' || (event.type === 'affliction' && event.cause === 'bloodlust')
}

export function actionPlan(events: readonly GameEvent[], rolled: boolean, reduced: boolean, royal: boolean): ActionPlan {
  const promotionIndex = events.findIndex(event => event.type === 'promotion')
  const event = events[promotionIndex]
  const forming = event?.type === 'promotion'
  const motion = rolled ? getDieMotionTiming(reduced).motionMs : null
  const rollStart = forming ? reduced ? 105 : 420 : 0
  const roll = motion === null ? null : { start: rollStart, settle: rollStart + motion }
  if (!forming) {
    const reactions = events.filter(isCaptureReaction)
    const aftermath = reactions.length > 0 && events.some(item => item.type === 'cure' || item.type === 'convert' ||
      item.type === 'remove' || (item.type === 'affliction' && item.cause === 'shame'))
    const base = rolled ? getDieThrowDuration(reduced) : reduced ? 75 : 330
    const hold = aftermath ? (roll?.settle ?? 0) + (reduced ? 304 : roll ? 487 : 560) : 0
    const escalationAt = roll && reactions.length > 1 ? roll.settle + (reduced ? 100 : 200) : null
    return { reduced, roll, escalationAt,
      end: Math.max(hold, royal ? royalLeadIn(events, base, motion, reduced) : base), promotion: null }
  }

  const initial = events.slice(0, promotionIndex)
  const reactions = initial.filter(isCaptureReaction)
  const move = initial.find(item => item.type === 'move' && item.piece.id === event.piece.id)
  const captured = initial.some(item => item.type === 'capture')
  const contactPawn = {
    ...(move?.type === 'move' ? move.piece : event.piece),
    square: event.piece.square, castleEligible: false, pawnDoubleStepEligible: false,
  }
  const reaction = reactions[0]
  const reactingPawn = reaction && (reaction.type === 'reaction' || reaction.type === 'affliction') ? reaction.piece : event.piece
  const reactionAt = reactions.length ? roll?.settle ?? (reduced ? 100 : 420) : null
  const surgeAt = reactions.length > 1 && reactionAt !== null ? reactionAt + (reduced ? 100 : 200) : null
  const meaningful = reactingPawn.affliction !== 'neutral' || surgeAt !== null
  const read = reactionAt === null ? 0 : (surgeAt ?? reactionAt) + (reduced ? 165 : meaningful ? 380 : 285)
  const formationAt = Math.max(read, roll ? roll.start + getDieThrowDuration(reduced) : 0,
    reduced ? 95 : captured ? 430 : 320)
  const aftermathAt = formationAt + promotionTiming(event.promotion, reduced).duration
  const aftermathEvents = events.slice(promotionIndex + 1)
  const hasAftermath = aftermathEvents.some(item => item.type === 'cure' || item.type === 'convert' ||
    item.type === 'remove' || item.type === 'affliction')
  return {
    reduced, roll, escalationAt: null, end: aftermathAt + (hasAftermath ? reduced ? 145 : 565 : 0),
    promotion: {
      event, contactPawn, reactingPawn,
      formed: { ...(event.promotion === 'bishop' ? rebirth(event.piece) : event.piece), type: event.promotion },
      contactEvents: initial.filter(item => item.type === 'move' || item.type === 'capture'),
      reactionEvents: reactions.slice(0, 1), surgeEvents: reactions.slice(1),
      aftermathEvents, reactionAt, surgeAt, formationAt, aftermathAt,
    },
  }
}
