import { rebirth } from '../core/passives'
import { fileOf, rankOf } from '../core/geometry'
import type { GameEvent, Piece } from '../core/types'
import { getDieMotionTiming, getDieThrowDuration } from './diceMotion'
import { promotionTiming } from './promotionMotion'
import { royalLeadIn } from './royalMotion'

type PromotionEvent = Extract<GameEvent, { type: 'promotion' }>

export type PromotionStage = 'contact' | 'roll' | 'reaction' | 'surge' | 'formation' | 'aftermath'
export type PromotionPlayback = 'reaction' | 'formation'

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
  readonly roll: { readonly start: number; readonly settle: number; readonly reveal: number } | null
  readonly end: number
  readonly escalationAt: number | null
  readonly promotion: PromotionPlan | null
}

export function pieceTravelMs(distance: number) {
  return Math.min(380, 232 + 26 * distance)
}

export function isCaptureReaction(event: GameEvent) {
  return event.type === 'reaction' || (event.type === 'affliction' && event.cause === 'bloodlust')
}

export function actionPlan(events: readonly GameEvent[], rolled: boolean, reduced: boolean, royal: boolean): ActionPlan {
  const promotionIndex = events.findIndex(event => event.type === 'promotion')
  const event = events[promotionIndex]
  const forming = event?.type === 'promotion'
  const move = events.find(item => item.type === 'move')
  const travel = move ? pieceTravelMs(Math.hypot(fileOf(move.to) - fileOf(move.from), rankOf(move.to) - rankOf(move.from))) : 0
  const start = reduced ? 105 : Math.max(forming ? 420 : 0, Math.ceil(travel + 130))
  const settle = start + getDieMotionTiming(reduced).motionMs
  const roll = rolled ? { start, settle, reveal: settle + (reduced ? 140 : 240) } : null
  if (!forming) {
    const reactions = events.filter(isCaptureReaction)
    const aftermath = reactions.length > 0 && events.some(item => item.type === 'cure' || item.type === 'convert' ||
      item.type === 'remove' || (item.type === 'affliction' && item.cause === 'shame'))
    const base = roll ? Math.max(roll.start + getDieThrowDuration(reduced), roll.reveal + (reduced ? 165 : 240)) : reduced ? 75 : 330
    const hold = aftermath ? (roll?.reveal ?? 0) + (reduced ? 304 : roll ? 487 : 560) : 0
    const escalationAt = roll && reactions.length > 1 ? roll.reveal + (reduced ? 100 : 200) : null
    return { reduced, roll, escalationAt,
      end: Math.max(hold, escalationAt === null ? 0 : escalationAt + (reduced ? 130 : 215),
        royal ? royalLeadIn(events, base, roll?.settle ?? null, reduced) : base), promotion: null }
  }

  const initial = events.slice(0, promotionIndex)
  const reactions = initial.filter(isCaptureReaction)
  const pawnMove = initial.find(item => item.type === 'move' && item.piece.id === event.piece.id)
  const captured = initial.some(item => item.type === 'capture')
  const contactPawn = {
    ...(pawnMove?.type === 'move' ? pawnMove.piece : event.piece),
    square: event.piece.square, castleEligible: false, pawnDoubleStepEligible: false,
  }
  const reaction = reactions[0]
  const reactingPawn = reaction && (reaction.type === 'reaction' || reaction.type === 'affliction') ? reaction.piece : event.piece
  const reactionAt = reactions.length ? roll?.reveal ?? (reduced ? 100 : 420) : null
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
