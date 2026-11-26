import type { CaptureEvent, Command, DieFace, GameEvent, GameState, Side } from '../core';
import type { MatchStatus, SessionConfig } from './match';

/** The board only needs a readable game, never a local seed or write authority. */
export interface ViewConfig extends Omit<SessionConfig, 'mode' | 'provenance'> {
  readonly mode: SessionConfig['mode'] | 'online';
  readonly provenance: SessionConfig['provenance'] | 'online';
}

export interface ViewAction {
  readonly id: string;
  readonly actor: Side;
  readonly command: Command;
  readonly roll?: { readonly face: DieFace; readonly fixed?: boolean };
}

export interface ViewCheckpoint {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export interface GameView {
  readonly record: {
    readonly id: string;
    readonly config: ViewConfig;
    readonly revision: number;
    readonly status: MatchStatus;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly root: GameState;
    readonly rootLedger: readonly CaptureEvent[];
    readonly actions: readonly ViewAction[];
    readonly cursor: number;
  };
  readonly state: GameState;
  readonly current: ViewCheckpoint;
  readonly events: readonly GameEvent[];
  eventsAt(cursor: number): readonly GameEvent[];
  legal(): readonly Command[];
  review(cursor: number): ViewCheckpoint;
}
