export type Language = "ru" | "en";
export interface PublicPlayer {
  playerId: string;
  handle: string;
  displayName: string;
}
export interface User extends PublicPlayer {
  email: string;
  emailVerified: boolean;
}
export interface Session {
  user: User | null;
  csrfToken: string;
}
export interface Game {
  gameId: string;
  title: string;
  minPlayers: number;
  maxPlayers: number;
  supportsBots: boolean;
  rulesVersion: string;
  contentVersion: string;
  status: "available" | "unavailable" | "planned";
}
export interface FriendRequest {
  requestId: string;
  player: PublicPlayer;
}
export interface Social {
  friends: PublicPlayer[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  blocked: PublicPlayer[];
}
export type BotDifficulty = "easy" | "normal" | "hard";
export interface Member {
  participantId: string;
  playerId: string | null;
  handle: string;
  displayName: string;
  seatIndex: number;
  ready: boolean;
  controller:
    | { kind: "human"; playerId: string }
    | {
        kind: "bot";
        botProfileId: string;
        botVersion: string;
        difficulty: BotDifficulty;
      };
}
export type RoomState =
  | "lobby"
  | "starting"
  | "playing"
  | "finished"
  | "cancelled";
export interface Room {
  roomId: string;
  gameId: string;
  title: string;
  hostPlayerId: string;
  state: RoomState;
  capacity: number;
  rulesVersion: string;
  contentVersion: string;
  revision: number;
  settings: Record<string, unknown>;
  members: Member[];
  reservedSeats: number;
  matchId: string | null;
  outcome: null | Record<string, unknown>;
  createdAt: number;
}
export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";
export interface Invitation {
  invitationId: string;
  roomId: string;
  roomTitle: string;
  gameId: string;
  inviter: PublicPlayer;
  invitee: PublicPlayer;
  status: InvitationStatus;
  displayStatus: InvitationStatus | "full";
  expiresAt: number;
  reservationExpiresAt: number | null;
  reason: string | null;
  url: string;
}
export interface TelegramAccount {
  displayNameMasked: string;
  usernameMasked: string | null;
  userIdSuffix: string;
}
export type TelegramStatus =
  | { available: false; linked: false; reason: string }
  | {
      available: true;
      linked: boolean;
      status: "unlinked" | "active" | "unreachable";
      notificationsEnabled: boolean;
      botUsername: string;
      account: TelegramAccount | null;
    };
export type TelegramAttemptState =
  | "issued"
  | "awaiting_web_confirmation"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "rejected";
export interface TelegramAttempt {
  attemptId: string;
  state: TelegramAttemptState;
  expiresAt: number;
  candidate: TelegramAccount | null;
  proofAttemptsRemaining: number;
}
export interface TelegramCreatedAttempt extends TelegramAttempt {
  deepLink: string;
}
