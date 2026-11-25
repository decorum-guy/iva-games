import type { Command, GameEvent, GameState, RejectionCode, Side } from '../core'

export const ONLINE_PROTOCOL = 'overdrive-online-v1' as const
export const ONLINE_SAVE_VERSION = 1 as const
export const ONLINE_NAME_LIMIT = 24

/** Committed, deterministic Overdrive actions. Clients never provide energy or state. */
export interface OnlineAction {
  readonly id: string
  readonly actor: Side
  readonly command: Command
  readonly events: readonly GameEvent[]
}

export interface OnlineGameSnapshot {
  readonly id: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly root: GameState
  readonly state: GameState
  readonly actions: readonly OnlineAction[]
}

export type RoomStatus = 'waiting' | 'playing' | 'finished' | 'expired'
export interface OnlinePlayer {
  readonly name: string
  readonly ready: boolean
  readonly connected: boolean
}

export interface RoomSnapshot {
  readonly protocol: typeof ONLINE_PROTOCOL
  readonly id: string
  /** Room metadata revision; game commands use game.revision instead. */
  readonly revision: number
  readonly status: RoomStatus
  readonly you: Side
  readonly players: Readonly<Record<Side, OnlinePlayer | null>>
  readonly game: OnlineGameSnapshot
  readonly drawOffer: { readonly id: string; readonly from: Side } | null
  readonly rematchVotes: readonly Side[]
  readonly expiresAt: number
  readonly serverTime: number
}

export type OnlineCommand = Exclude<Command, { readonly type: 'agreeDraw' }>
  | { readonly type: 'ready'; readonly ready: boolean }
  | { readonly type: 'offerDraw' }
  | { readonly type: 'answerDraw'; readonly offerId: string; readonly accept: boolean }
  | { readonly type: 'rematch'; readonly accept: boolean }

export interface OnlineCommandEnvelope {
  readonly type: 'command'
  readonly commandId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly command: OnlineCommand
}

export type OnlineClientMessage =
  | { readonly type: 'hello'; readonly protocol: typeof ONLINE_PROTOCOL; readonly roomId: string }
  | { readonly type: 'sync' }
  | OnlineCommandEnvelope

export type OnlineErrorCode = RejectionCode | 'invalidMessage' | 'invalidName' | 'protocolMismatch'
  | 'guestRequired' | 'roomMissing' | 'roomFull' | 'sameGuest' | 'inviteInvalid' | 'notYourSeat'
  | 'replaced' | 'notReady' | 'opponentOffline' | 'staleRevision' | 'commandConflict'
  | 'drawOfferMissing' | 'roomExpired' | 'rateLimited' | 'serverError'

export interface OnlineAck {
  readonly type: 'ack'
  readonly commandId: string
  readonly gameId: string
  readonly revision: number
}

export type OnlineServerMessage =
  | { readonly type: 'welcome'; readonly snapshot: RoomSnapshot }
  | { readonly type: 'update'; readonly snapshot: RoomSnapshot; readonly action?: OnlineAction }
  | OnlineAck
  | { readonly type: 'error'; readonly code: OnlineErrorCode; readonly commandId?: string }
  | { readonly type: 'replaced' }

export interface CreateRoomRequest {
  readonly name: string
  readonly side: Side | 'random'
  readonly requestId: string
}
export interface JoinRoomRequest { readonly invite: string; readonly name: string }
export interface CreateRoomResponse { readonly snapshot: RoomSnapshot; readonly invite: string }
export interface RoomResponse { readonly snapshot: RoomSnapshot }
export interface InviteResponse { readonly invite: string }
