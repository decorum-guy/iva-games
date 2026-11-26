import type { PromotionPlan, PromotionStage } from '../scene/actionPresentation'
import type { GameState } from '../core/types'

export function promotionEvents(plan: PromotionPlan, stage: PromotionStage | null) {
  switch (stage) {
    case 'contact':
    case 'roll': return plan.contactEvents
    case 'reaction': return plan.reactionEvents
    case 'surge': return plan.surgeEvents
    case 'formation': return noEvents
    default: return plan.aftermathEvents
  }
}

const noEvents: readonly never[] = []

/** Only view code can see a pawn on the far rank. The committed state already has the new piece. */
export function projectPromotion(committed: GameState, previous: GameState, plan: PromotionPlan, stage: PromotionStage): GameState {
  if (stage === 'aftermath') return committed
  const pawn = stage === 'formation' ? plan.formed : stage === 'surge' ? plan.event.piece
    : stage === 'reaction' ? plan.reactingPawn : plan.contactPawn
  const capture = plan.contactEvents.find(event => event.type === 'capture')
  return {
    ...previous, outcome: null,
    pieces: previous.pieces.filter(piece => capture?.type !== 'capture' || piece.id !== capture.victim.id)
      .map(piece => piece.id === pawn.id ? pawn : piece),
  }
}
