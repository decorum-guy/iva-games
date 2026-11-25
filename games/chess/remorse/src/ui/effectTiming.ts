import { CYCLE } from '../core';
import type { GameState, Piece } from '../core';

/** Exact remaining completed player turns, not rounded cycle labels. */
export function effectTiming(piece: Piece, state: Pick<GameState, 'turnSerial'>) {
  const remaining = (deadline: number | null) => deadline === null ? null : Math.max(0, deadline - state.turnSerial);
  return {
    removal: remaining(piece.devastationDue),
    cure: remaining(piece.cureArmedAt === null ? null : piece.cureArmedAt + CYCLE),
    shame: remaining(piece.shameArmedAt === null ? null : piece.shameArmedAt + CYCLE),
  };
}
