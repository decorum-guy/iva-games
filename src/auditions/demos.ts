import { applyResolvedCommand, createPosition, pieceAt } from '../core';
import type { DieFace, GameEvent, GameState, Piece, PieceInput, Promotion } from '../core';
import { actionPlan } from '../scene/actionPresentation';
import type { ActionPlan, PromotionStage } from '../scene/actionPresentation';
import type { PromotionCue } from '../scene/promotionMotion';
import { projectPromotion, promotionEvents } from '../ui/promotionProjection';
import { maskRollResult, rollSceneEvents } from '../ui/rollPresentation';

export const groups = [
  'reaction.guilt', 'reaction.devastated', 'reaction.berserk', 'reaction.bloodlust',
  'promotion.formation', 'promotion.rook', 'promotion.queen',
] as const;
export type Group = typeof groups[number];

const faceByReaction: Partial<Record<Group, DieFace>> = { 'reaction.guilt': 2, 'reaction.devastated': 1, 'reaction.berserk': 6 };
const reactionPieces: readonly PieceInput[] = [
  { side: 'white', type: 'king', square: 'b1' }, { side: 'black', type: 'king', square: 'g8' },
  { side: 'black', type: 'pawn', square: 'd5' }, { side: 'black', type: 'knight', square: 'f6' },
  { side: 'black', type: 'pawn', square: 'c6' }, { side: 'white', type: 'knight', square: 'f3' },
  { side: 'white', type: 'pawn', square: 'b2' },
];
const promotionPieces: readonly PieceInput[] = [
  { side: 'white', type: 'king', square: 'a1' }, { side: 'black', type: 'king', square: 'h7' },
  { side: 'white', type: 'pawn', square: 'e7' }, { side: 'black', type: 'rook', square: 'd8' },
  { side: 'white', type: 'knight', square: 'c3' }, { side: 'black', type: 'knight', square: 'b8' },
  { side: 'white', type: 'pawn', square: 'g2' }, { side: 'black', type: 'pawn', square: 'b6' },
];

export interface Demo {
  readonly group: Group;
  readonly key: string;
  readonly before: GameState;
  readonly after: GameState;
  readonly events: readonly GameEvent[];
  readonly plan: ActionPlan;
  readonly face?: DieFace;
  readonly result: Piece;
  readonly notation: string;
}

export function createDemo(group: Group, minor: 'bishop' | 'knight', reduced: boolean): Demo {
  const promotion: Promotion | undefined = group === 'promotion.formation' ? minor
    : group === 'promotion.rook' ? 'rook' : group === 'promotion.queen' ? 'queen' : undefined;
  const bloodlust = group === 'reaction.bloodlust';
  const before = createPosition({ pieces: promotion ? promotionPieces : [
    ...reactionPieces, { side: 'white', type: 'rook', square: 'd4',
      ...(bloodlust ? { affliction: 'berserk' as const, capturesSinceRebirth: 2 } : {}) },
  ] });
  const face = faceByReaction[group];
  const to = promotion ? 'e8' : 'd5';
  const { state: after, events } = applyResolvedCommand(before, {
    type: 'move', from: promotion ? 'e7' : 'd4', to, promotion,
  }, face);
  const plan = actionPlan(events, face !== undefined, reduced, false);
  const suffix = promotion === 'knight' ? 'N' : promotion?.[0].toUpperCase();
  return { group, key: `audition/${group}/${promotion ?? 'rook'}`, before, after, events, plan, face,
    result: pieceAt(after, to)!, notation: suffix ? `e7–e8=${suffix}` : 'd4×d5' };
}

export function stageOffsets(demo: Demo) {
  const { plan } = demo;
  return [0, ...new Set([plan.roll?.settle, plan.promotion?.formationAt, plan.promotion?.aftermathAt, plan.end])]
    .filter((offset): offset is number => offset !== undefined).sort((a, b) => a - b);
}

const noEvents: readonly GameEvent[] = [];

export function demoFrame(demo: Demo, elapsed: number, startedAt: number) {
  const { before, after, events, plan } = demo;
  const forming = plan.promotion;
  const rolling = plan.roll !== null && elapsed >= 0 && elapsed < plan.roll.settle;
  let state = elapsed < 0 ? before : rolling ? maskRollResult(after, before) : after;
  let visible = elapsed < 0 ? noEvents : plan.roll ? rollSceneEvents(events, rolling ? 'throwing' : 'revealed') : events;
  let stage: PromotionStage | undefined;
  let promotion: PromotionCue | undefined;
  if (forming && elapsed >= 0) {
    stage = elapsed < forming.formationAt ? 'contact' : elapsed < forming.aftermathAt ? 'formation' : 'aftermath';
    state = projectPromotion(after, before, forming, stage);
    visible = promotionEvents(forming, stage);
    if (stage === 'formation') {
      const { event } = forming;
      promotion = { id: `${demo.key}/${event.id}`, pieceId: event.piece.id, square: event.piece.square,
        kind: event.promotion, side: event.piece.side, startedAt: startedAt + forming.formationAt,
        reduced: plan.reduced, intoRoyal: false };
    }
  }
  return { state, events: visible, stage, promotion, rolling,
    revealed: elapsed >= (plan.roll?.settle ?? plan.promotion?.formationAt ?? plan.end) };
}
