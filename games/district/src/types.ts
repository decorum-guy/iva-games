import type { BotDifficulty, Participant } from '@iva-games/session-kit';
import type { DistrictMap } from './maps';
import { DISTRICT_CONTENT_VERSION, DISTRICT_ISLAND_CONTENT_VERSION } from './map-schema';

export const DISTRICT_RULES_VERSION = 'district@0.2' as const;
export const DISTRICT_BOT_VERSION = '1' as const;
export const DISTRICT_ISLAND_RULES_VERSION = 'district@0.3' as const;
export const DISTRICT_ISLAND_BOT_VERSION = '2' as const;
const legacyProfile = { schemaVersion: 1, rulesVersion: DISTRICT_RULES_VERSION, contentVersion: DISTRICT_CONTENT_VERSION, botVersion: DISTRICT_BOT_VERSION } as const;
const islandProfile = { schemaVersion: 2, rulesVersion: DISTRICT_ISLAND_RULES_VERSION, contentVersion: DISTRICT_ISLAND_CONTENT_VERSION, botVersion: DISTRICT_ISLAND_BOT_VERSION } as const;
export const districtProfileForMap = (schemaVersion: 1 | 2) => schemaVersion === 1 ? legacyProfile : islandProfile;
export function districtProfileForVersion(rulesVersion: string, contentVersion: string) {
  return [legacyProfile, islandProfile].find(profile => profile.rulesVersion === rulesVersion && profile.contentVersion === contentVersion);
}
export const DISTRICT_TIMERS = { goals: 45_000, negotiation: 120_000, auction: 60_000, development: 45_000 } as const;
export const GOALS = ['variety', 'network', 'green', 'industry', 'sponsor', 'quality'] as const;
export type GoalId = typeof GOALS[number];
export type BuildingKind = 'house' | 'cafe' | 'workshop';
export type ResourceKind = 'coins' | 'materials' | 'crews';
export interface Resources { coins: number; materials: number; crews: number }
export interface Bundle extends Resources { lots: string[] }
export interface Building { kind: BuildingKind; level: 1 | 2 }
export interface DistrictCell {
  id: string; x: number; y: number; kind: 'lot' | 'neutral-house' | 'park' | 'square';
  neighborIds?: string[]; zoneId?: string;
  ownerId: string | null; building: Building | null; completed: boolean;
  sponsors: Array<{ participantId: string; resources: Resources }>;
}
export type EventId = 'ordinary' | 'filming' | 'fair' | 'boom' | 'traffic' | 'roadworks';
export interface CityEvent { kind: EventId; row: number | null; zoneId?: string }
export type DistrictPhase = 'goals' | 'negotiation' | 'auction' | 'development' | 'finished';
export interface Bid { lotId: string; amount: number }
export interface OfferBase { id: string; version: number; authorId: string; round: number; status: 'open' | 'completed' | 'declined' | 'cancelled' | 'replaced' | 'expired'; }
export interface TradeOffer extends OfferBase { kind: 'trade'; targetId: string; give: Bundle; receive: Bundle }
export interface ParkOffer extends OfferBase {
  kind: 'park'; parkId: string;
  contributions: Array<{ participantId: string; resources: Resources }>;
  signedBy: string[];
}
export type DistrictOffer = TradeOffer | ParkOffer;
export interface BotNegotiationMemory {
  round: number; created: number; lastInitiativeAt: number | null;
  counteredOfferIds: string[]; rejectedSignatures: string[]; bankActions: number;
}
export interface DistrictPlayer {
  participant: Participant; resources: Resources; left: boolean; ready: boolean;
  goalOptions: [GoalId, GoalId]; goal: GoalId | null;
  bid: Bid | null; bidConfirmed: boolean; lastIncome: number;
  botMemory: BotNegotiationMemory;
}
export interface IncomeLine {
  lotId: string; ownerId: string; building: Building;
  coins: number; materials: number; crews: number;
  neighbors: { houses: number; parks: number; workshops: number }; eventCoins: number;
}
/** Only completed public actions enter this journal. Private proposals never do. */
export interface DistrictHistoryEntry {
  id: number; round: number; type: 'event' | 'bank' | 'trade' | 'park' | 'auction' | 'build' | 'upgrade' | 'work' | 'income' | 'leave' | 'return' | 'finished' | 'abandoned';
  actorId?: string; data: Record<string, unknown>;
}
export interface DistrictResult {
  participantId: string; rank: number; capital: number; coins: number; materials: number; crews: number;
  buildings: number; goal: GoalId; goalCompleted: boolean; goalBonus: number; lastIncome: number;
}
export interface DistrictOutcome {
  reason: 'completed' | 'abandoned'; winnerParticipantIds: string[]; results: DistrictResult[];
}
export interface DistrictState {
  schemaVersion: 1 | 2; gameId: 'district'; rulesVersion: typeof DISTRICT_RULES_VERSION | typeof DISTRICT_ISLAND_RULES_VERSION; contentVersion: typeof DISTRICT_CONTENT_VERSION | typeof DISTRICT_ISLAND_CONTENT_VERSION;
  matchId: string; roomId: string; revision: number; round: number; totalRounds: number;
  phase: DistrictPhase; phaseId: string; deadlineAt: number | null; updatedAt: number; developmentIndex: number;
  map: DistrictMap; cells: DistrictCell[]; participants: Participant[]; players: DistrictPlayer[];
  initialOrder: string[]; seed: string; eventDeck: EventId[]; event: CityEvent | null;
  offers: DistrictOffer[]; nextOfferId: number; history: DistrictHistoryEntry[]; outcome: DistrictOutcome | null;
}
export interface DistrictView {
  gameId: 'district'; matchId: string; roomId: string; revision: number;
  rulesVersion: string; contentVersion: string; map: DistrictMap; cells: DistrictCell[];
  phase: DistrictPhase; phaseId: string; round: number; totalRounds: number; deadlineAt: number | null; serverNow: number;
  priority: string[]; activeParticipantId: string | null; event: CityEvent | null;
  remainingEvents: Record<EventId, number>;
  players: Array<{ participantId: string; displayName: string; seatIndex: number; isBot: boolean; difficulty: BotDifficulty | null;
    resources: Resources; ready: boolean; left: boolean; submitted: boolean; lastIncome: number }>;
  you: {
    participantId: string; resources: Resources; available: Resources; reserved: Resources; reservedLots: string[];
    goalOptions: GoalId[]; goal: GoalId | null; goalCompleted: boolean; bid: Bid | null; bidConfirmed: boolean;
    offers: DistrictOffer[]; left: boolean; botMemory: BotNegotiationMemory;
  };
  legal: { chooseGoal: boolean; negotiate: boolean; bid: boolean; confirmBid: boolean; develop: boolean; leave: boolean; return: boolean };
  incomePreview: IncomeLine[]; history: DistrictHistoryEntry[]; outcome: DistrictOutcome | null;
}
export type DistrictAction =
  | { type: 'choose-goal'; goal: GoalId }
  | { type: 'ready'; ready: boolean }
  | { type: 'bank'; resource: 'materials' | 'crews'; direction: 'buy' | 'sell'; quantity: number }
  | { type: 'offer-trade'; targetId: string; give: Bundle; receive: Bundle }
  | { type: 'replace-trade'; offerId: string; version: number; targetId: string; give: Bundle; receive: Bundle }
  | { type: 'counter-trade'; offerId: string; version: number; give: Bundle; receive: Bundle }
  | { type: 'accept-trade'; offerId: string; version: number }
  | { type: 'decline-offer'; offerId: string; version: number }
  | { type: 'cancel-offer'; offerId: string; version: number }
  | { type: 'offer-park'; parkId: string; contributions: Array<{ participantId: string; resources: Resources }> }
  | { type: 'replace-park'; offerId: string; version: number; parkId: string; contributions: Array<{ participantId: string; resources: Resources }> }
  | { type: 'sign-park'; offerId: string; version: number }
  | { type: 'bid'; bid: Bid | null }
  | { type: 'confirm-bid' }
  | { type: 'build'; lotId: string; building: BuildingKind }
  | { type: 'upgrade'; lotId: string }
  | { type: 'work' }
  | { type: 'leave' }
  | { type: 'return' };

export class DistrictError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message); this.name = 'DistrictError';
  }
}
