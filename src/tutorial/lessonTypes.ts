import type { Command, DieFace, GameEvent, GameState, Move, Promotion, RejectionCode } from '../core/types';

export type Copy = Readonly<{ ru: string; en: string }>;

export interface FixedRoll {
  readonly face: DieFace;
  readonly capturer: string;
  readonly victim: string;
}

type Objective = (events: readonly GameEvent[], state: GameState) => boolean;

/** A required, acknowledged explanation of one already committed action. */
export interface TeachingBeat {
  readonly id: string;
  readonly title: Copy;
  readonly text: Copy;
  readonly rule?: Copy;
  readonly action?: Copy;
  readonly focus?: { readonly square: string; readonly subject: 'piece' | 'countdown' };
  readonly diceLegend?: boolean;
  readonly hud?: 'captures' | 'material';
}

type Guidance =
  | { readonly kind: 'move'; readonly moves: readonly Command[] | 'open'; readonly roll?: FixedRoll; readonly expect?: Objective }
  | { readonly kind: 'script'; readonly move: Command | 'reply'; readonly roll?: FixedRoll; readonly expect?: Objective }
  | { readonly kind: 'inspect'; readonly square: string }
  | { readonly kind: 'illegal'; readonly move: Move; readonly reason: RejectionCode }
  | { readonly kind: 'read' };

export type Step = Guidance & {
  readonly id: string;
  /** The one short action or observation shown in the main coachmark. */
  readonly text: Copy;
  /** Optional rule detail: never required reading before the learner can act. */
  readonly detail?: Copy;
  /** Deliberate inspection target; never inferred from the previous move. */
  readonly focus?: { readonly square: string; readonly subject: 'piece' | 'countdown' };
  /** These observations pause before the next move, script or fixture reset. */
  readonly after?: readonly TeachingBeat[];
  readonly hud?: 'captures' | 'material';
};

export interface Position {
  readonly setup: () => GameState;
  readonly steps: readonly Step[];
}

export interface Lesson {
  readonly id: string;
  readonly title: Copy;
  readonly positions: readonly Position[];
}

export function move(from: string, to: string, promotion?: Promotion): Move {
  return { type: 'move', from, to, ...(promotion ? { promotion } : {}) };
}

export function fixed(face: DieFace, capturer: string, victim: string): FixedRoll {
  return { face, capturer, victim };
}
