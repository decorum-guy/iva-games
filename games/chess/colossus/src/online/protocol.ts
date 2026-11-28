import type { Action, HuntBossId, CardId, Difficulty, GameState, Seat } from '../core/types';

export const ONLINE_PROTOCOL = 'colossus-online-v1' as const;
export const ONLINE_SAVE_VERSION = 1 as const;
export const PRESENCE_TIMEOUT_MS = 15_000;
export const TAKEOVER_AFTER_MS = 60_000;
export interface RoomOptions {
  boss?: HuntBossId;
  difficulty?: Difficulty;
  mode?: 'hunt' | 'campaign';
  deck?: CardId[];
  bossCards?: boolean;
}
export interface CreateRoomRequest {
  protocol: typeof ONLINE_PROTOCOL;
  requestId: string;
  name: string;
  options: RoomOptions;
}
export interface JoinRoomRequest { protocol: typeof ONLINE_PROTOCOL; name: string; invite: string }
export interface RoomPlayer { name: string; connected: boolean }
export interface RoomSnapshot {
  protocol: typeof ONLINE_PROTOCOL;
  id: string;
  revision: number;
  status: 'waiting' | 'playing' | 'finished' | 'expired';
  you: Seat;
  players: Record<Seat, RoomPlayer | null>;
  /** Public state only: secret is null, with no future cards or seed in any other field. */
  state: GameState;
  paused: boolean;
  pauseReason: 'waiting' | 'partner-offline' | 'controller-offline' | null;
  takeoverAt: number | null;
  canTakeover: boolean;
  returnRequested: Seat | null;
  restoreScheduled: boolean;
  serverTime: number;
  expiresAt: number;
}
export type OnlineCommand =
  | { type: 'action'; action: Action }
  | { type: 'takeover' }
  | { type: 'request-return' }
  | { type: 'restore-control'; accept: boolean };
export interface CommandEnvelope {
  protocol: typeof ONLINE_PROTOCOL;
  commandId: string;
  /** Room revision, not state.revision; presence transitions can also invalidate a proposal. */
  expectedRevision: number;
  command: OnlineCommand;
}
export interface CommandAck { commandId: string; revision: number; gameRevision: number }
export interface CommandResponse { ack: CommandAck; snapshot: RoomSnapshot }
export interface RoomResponse { snapshot: RoomSnapshot }
export interface CreateRoomResponse extends RoomResponse { invite: string }
export interface OnlineFailure { error: string }
