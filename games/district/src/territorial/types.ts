import type { Participant } from '@iva-games/session-kit';
import type { Resource, TerritoryMap } from './maps';
import type { NewsEffect, NewsPreset, NewsProfile, NewsTemplate, NewsStage } from './news-catalog';

export const TERRITORY_RULES = 'district@0.4';
export const TERRITORY_CONTENT = 'district-territorial@1';
export const TERRITORY_BOT = 'district-bot@4';
export const TERRITORY_SAVE = 1;
export const RESOURCES = ['wood', 'brick', 'grain', 'wool', 'ore'] as const;
export const CARD_KINDS = ['patrol', 'survey', 'supply', 'charter'] as const;
export type CardKind = typeof CARD_KINDS[number];
export type Stock = Record<Resource, number>;
export const emptyStock = (): Stock => ({ wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 });
export const COSTS = {
  land: { wood: 1, brick: 1 },
  sea: { wood: 1, wool: 1 },
  build: { wood: 1, brick: 1, wool: 1, grain: 1 },
  upgrade: { grain: 2, ore: 3 },
  card: { wool: 1, grain: 1, ore: 1 },
  protect: { brick: 1, ore: 1 },
} satisfies Record<string, Partial<Stock>>;
export const LIMITS = { level1: 5, level2: 4, land: 15, sea: 12, target: 10, turnMs: 150_000, handLimit: 7 };

export type Zone = string | null; // null = the whole map, omitted zone = unrevealed
export type AppliedChange =
  | { kind: 'level'; ownerId: string; nodeId: string; before: number; after: number }
  | { kind: 'protected'; ownerId: string; nodeId: string }
  | { kind: 'resources'; ownerId: string; resources: Partial<Stock> }
  | { kind: 'coupon'; ownerId: string; coupon: CouponKind }
  | { kind: 'modifier'; ownerId: string; nodeId: string }
  | { kind: 'production'; ownerId: string; resources: Partial<Stock> };
type NewsMessageBase = {
  messageId: string; templateId: string; eventInstanceId: string; chainId?: string;
  headline: { ru: string; en: string }; round: number;
};
export type PublicNews =
  | (NewsMessageBase & { stage: 'forecast' | 'update' | 'confirmed'; zone?: Zone; dueRound: number })
  | (NewsMessageBase & { stage: 'applied' | 'success' | 'cancelled'; zone?: Zone;
      description?: { ru: string; en: string }; changes: AppliedChange[]; endsAfterRound?: number });
export type CouponKind = Extract<NewsEffect, { op: 'coupon' }>['kind'];
export interface NewsChain {
  chainId: string; eventInstanceId: string; templateId: string; zone: Zone;
  warnings: number; started: number; at: number; confirmAt: number; outcome: boolean;
  stage: NewsStage; protected: string[];
}
export interface Modifier {
  eventInstanceId: string; zone: Zone; effect: Extract<NewsEffect, { op: 'production' | 'port' | 'surcharge' }>;
  startsAfterRound: number; endsAfterRound: number; spent: string[];
}
export interface Coupon {
  id: string; eventInstanceId: string; ownerId: string; zone: Zone; kind: CouponKind; endsAfterRound: number;
}
export interface TerritoryNews {
  version: string; preset: NewsPreset; profile: NewsProfile; catalog: NewsTemplate[];
  nextRound: number; processedRound: number; counter: number; launches: number;
  lastTemplates: string[]; lastBadZone?: Zone; lastHazard: number; lastRenovation: number; cityMeteor: boolean;
  chains: NewsChain[]; modifiers: Modifier[]; coupons: Coupon[]; messages: PublicNews[];
  bonusNodes: Record<string, number>; bonusOwners: Record<string, number>;
  bonusByEvent: Record<string, number>; damage: Record<string, { round: number; level: number }>;
}
export interface TerritoryBuilding { ownerId: string; level: 1 | 2 }
export interface TerritoryPlayer {
  hand: Stock; cards: { id: string; kind: CardKind; bought: number }[];
  patrols: number;
}
export interface TerritoryOffer {
  id: string; authorId: string; targetId: string; give: Stock; receive: Stock; parentId?: string; offeredAt?: number;
  groupId?: string; agreedAt?: number;
  canAccept?: boolean; unavailableReason?: 'author-resources' | 'target-resources' | 'inactive-pair';
}
export type TerritoryOfferStatus = 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'replaced' | 'player-left' | 'match-finished';
export interface TerritoryClosedOffer extends TerritoryOffer {
  status: TerritoryOfferStatus; closedRevision: number; closedTurn: number; closedRound: number;
}
export type TerritoryAction =
  | { type: 'place' | 'settle' | 'upgrade' | 'protect'; nodeId: string }
  | { type: 'route'; edgeId: string }
  | { type: 'roll' | 'end' | 'buy-card' | 'leave' }
  | { type: 'discard'; resources: Stock }
  | { type: 'block'; tileId: string; targetId?: string }
  | { type: 'bank'; give: Resource; receive: Resource }
  | { type: 'offer'; targetId: string; targetIds?: string[]; give: Stock; receive: Stock; parentId?: string }
  | { type: 'accept' | 'decline' | 'cancel'; offerId: string }
  | { type: 'play-card'; cardId: string; resources?: Resource[] };
export type Activity = { revision: number; kind: 'roll' | 'build' | 'deal' | 'tactic' | 'win' };
export interface TerritoryProduction { ownerId: string; resources: Stock }
export interface TerritoryBlockedProduction {
  tileId: string; nodeId?: string; reason: 'blockade' | 'news'; eventInstanceId?: string;
  blockade?: TerritoryBlockade;
}
export interface TerritoryProductionSource { ownerId: string; tileId: string; resource: Resource; amount: number }
export interface TerritoryRoll {
  eventId: string; revision: number; actorId: string; round: number; turn: number;
  source?: 'player' | 'bot' | 'timeout';
  dice: [number, number]; sum: number; triggeredTileIds: string[];
  production: TerritoryProduction[]; blocked: TerritoryBlockedProduction[]; sources?: TerritoryProductionSource[];
}
export interface TerritoryBlockade {
  actorId?: string; reason: 'seven' | 'patrol' | 'unknown'; tileId: string;
  round?: number; turn?: number; revision?: number;
}
/** Public table history. Private resources/cards are added only for an authorised viewer. */
export interface TerritoryHistoryEntry {
  id: string; revision: number; actorId: string; round: number; turn: number;
  source?: 'player' | 'bot' | 'timeout';
  kind: TerritoryAction['type'] | 'distribution' | 'offer-closed' | 'win';
  phase?: TerritoryState['phase']; nodeId?: string; edgeId?: string; tileId?: string;
  dice?: [number, number]; sum?: number; triggeredTileIds?: string[];
  production?: TerritoryProduction[]; blocked?: TerritoryBlockedProduction[]; sources?: TerritoryProductionSource[];
  paid?: Stock; received?: Stock; resources?: Stock; count?: number;
  cardKind?: CardKind; offerId?: string; offerStatus?: TerritoryOfferStatus;
  targetId?: string; reason?: string; winnerParticipantIds?: string[];
  beforeLevel?: number; afterLevel?: number;
}
export interface StoredTerritoryHistoryEntry extends TerritoryHistoryEntry {
  audienceIds?: string[];
  privateByParticipantId?: Record<string, Partial<Pick<TerritoryHistoryEntry, 'resources' | 'cardKind' | 'paid' | 'received'>>>;
}
export interface TerritoryPricing {
  base: Stock; discount: Stock; surcharge: Stock; total: Stock;
  couponId?: string; freeRoutes: boolean; reason: 'setup' | 'normal' | 'coupon' | 'tactic';
  couponDecisions: { couponId: string; applies: boolean;
    reason: 'eligible' | 'sector' | 'sea' | 'purchase' | 'expired' | 'tactic-first' | 'other-coupon' }[];
}
export interface TerritoryOutcome { winnerParticipantIds: string[]; reason: 'points' | 'abandoned' }
export interface TerritoryRules {
  costs: typeof COSTS;
  limits: typeof LIMITS;
  stockPerResource: number;
  deck: Record<CardKind, number>;
  bankRate: number;
  portRate: number;
  specialisedPortRate: number;
  routeAward: number;
  patrolAward: number;
}
export interface TerritoryState {
  schemaVersion: typeof TERRITORY_SAVE;
  rulesVersion: typeof TERRITORY_RULES;
  contentVersion: typeof TERRITORY_CONTENT;
  botVersion: typeof TERRITORY_BOT;
  matchId: string; roomId: string; map: TerritoryMap; participants: Participant[];
  rules: TerritoryRules; revision: number; deadlineAt: number | null;
  round: number; turn: number; activeIndex: number;
  phase: 'setup-home' | 'setup-route' | 'roll' | 'discard' | 'block' | 'play' | 'finished';
  setupIndex: number; setupNode: string | null;
  players: Record<string, TerritoryPlayer>; buildings: Record<string, TerritoryBuilding>; routes: Record<string, string>;
  bank: Stock; deck: CardKind[]; seed: string;
  blockedTileId: string | null; discard: Record<string, number>;
  lastRoll: [number, number] | null; playedCard: boolean; protectedThisTurn: boolean; freeRoutes: number;
  routeHolder: string | null; patrolHolder: string | null; offerNumber: number;
  offers: TerritoryOffer[]; volunteered?: string[]; left: string[]; outcome: TerritoryOutcome | null;
  activity?: Activity;
  history?: StoredTerritoryHistoryEntry[]; latestRoll?: TerritoryRoll | null;
  blockade?: TerritoryBlockade | null; pendingBlockade?: { actorId: string; reason: 'seven' | 'patrol' } | null;
  offerHistory?: TerritoryClosedOffer[];
  botSchedule?: { revision: number; participantId: string; at: number };
  news: TerritoryNews;
}

export interface TerritoryOption {
  kind: 'place' | 'settle' | 'upgrade' | 'route'; id: string; cost: Stock;
  pricing?: TerritoryPricing;
}
export interface TerritoryView {
  gameId: 'district'; rulesVersion: typeof TERRITORY_RULES; contentVersion: typeof TERRITORY_CONTENT;
  matchId: string; revision: number; serverNow: number; phaseId: string; phase: TerritoryState['phase'];
  activeParticipantId: string; round: number; turn: number; deadlineAt: number | null;
  rules?: TerritoryRules;
  map: TerritoryMap; buildings: TerritoryState['buildings']; routes: TerritoryState['routes'];
  players: { participantId: string; displayName: string; seatIndex: number; isBot: boolean; left: boolean;
    handCount: number; cardCount: number; points: number; longestRoute: number; patrols: number }[];
  you: { participantId: string; hand: Stock; cards: (TerritoryPlayer['cards'][number] & { playable: boolean })[];
    discard: number; points: number; coupons: Coupon[]; protected: string[]; volunteered: boolean };
  bank: Stock; cardsAvailable: number; lastRoll: [number, number] | null; blockedTileId: string | null;
  routeHolder: string | null; patrolHolder: string | null; goal: number; offers: TerritoryOffer[];
  activity?: Activity;
  history?: TerritoryHistoryEntry[]; historyComplete?: boolean; latestRoll?: TerritoryRoll | null;
  blockade?: TerritoryBlockade | null; pendingBlockade?: { actorId: string; reason: 'seven' | 'patrol' } | null;
  offerHistory?: TerritoryClosedOffer[]; botActionAt?: number; botParticipantId?: string;
  news: PublicNews[]; threats: PublicNews[]; activeEffects?: { eventInstanceId: string; templateId: string; zone: Zone; endsAfterRound: number }[]; preset: NewsPreset; outcome: TerritoryOutcome | null;
  legal: { roll: boolean; end: boolean; options: TerritoryOption[]; block: { tileId: string; targets: string[] }[];
    bank: Record<Resource, number>; buyCard: Stock | null; buyCardPricing?: TerritoryPricing | null;
    couponRoutes?: Record<string, string[]>; protect: boolean; protectionCost: Partial<Stock>; trade: boolean };
}
