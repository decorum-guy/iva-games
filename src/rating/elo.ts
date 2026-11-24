import type { GameOutcome, Side } from '../core/types';

export const RATING_VERSION = 'remorse-elo-v1';
export const K_FACTOR = 32;

export interface Profile {
  readonly id: 'local';
  readonly rating: number;
  readonly best: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly revision: number;
  readonly ratedId: string | null;
}

export const initialProfile: Profile = {
  id: 'local', rating: 1000, best: 1000, wins: 0, draws: 0, losses: 0, revision: 0, ratedId: null,
};

export interface RatedContract {
  readonly ratingBefore: number;
  readonly profileRevision: number;
  readonly anchor: number;
  readonly scaleVersion: typeof RATING_VERSION;
  readonly engineVersion: string;
  readonly presetVersion: string;
}

export function calculateElo(before: number, anchor: number, score: 0 | 0.5 | 1) {
  const expected = 1 / (1 + 10 ** ((anchor - before) / 400));
  const after = Math.max(100, before + K_FACTOR * (score - expected));
  return { before, anchor, score, expected, after, exactDelta: after - before, k: K_FACTOR };
}

export function displayDelta(before: number, after: number): number {
  return Math.round(after) - Math.round(before);
}

export function scoreOf(outcome: GameOutcome, human: Side): 0 | 0.5 | 1 {
  return outcome.winner === null ? 0.5 : Number(outcome.winner === human) as 0 | 1;
}

export interface RatingEntry extends ReturnType<typeof calculateElo> {
  readonly matchId: string;
  readonly timestamp: number;
  readonly outcome: GameOutcome;
  readonly human: Side;
  readonly level: number;
  readonly contract: RatedContract;
}
