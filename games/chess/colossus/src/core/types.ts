export const RULES_VERSION = 'colossus-v1' as const;
export type Language = 'ru' | 'en';
export type Localized = Record<Language, string>;
export type UnitType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
export type PromotionType = 'Q' | 'R' | 'B' | 'N';
export type BossId = 'regent' | 'spire' | 'archivist';
export type Difficulty = 'initiate' | 'knight' | 'veteran' | 'abyss';
export type Mode = 'hunt' | 'campaign' | 'practice';
export type Seat = 'A' | 'B';
export type Actor = Seat | 'solo';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CardId = 'bandage' | 'stone-skin' | 'sharp-edge' | 'armor-tip' | 'focus' | 'reposition'
  | 'swap' | 'minor-vow' | 'hospital' | 'hunt-mark' | 'wedge' | 'formation' | 'disrupt'
  | 'counterorder' | 'marble-vow' | 'shell-break';
export type BossCardId = string;

/** Squares are integers 0=a1, 7=h1, 56=a8, 63=h8. Dead units remain by stable ID. */
export interface Unit {
  id: string;
  type: UnitType;
  square: number | null;
  startSquare: number;
  owner: Seat;
  hp: number;
  maxHp: number;
  activated: boolean;
  firstMove: boolean;
  shield: number;
  invulnerable: number;
  attackBonus: number;
  armorTip: boolean;
}

export interface Boss {
  id: BossId;
  anchor: number;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  nextPattern: number;
  lastPattern: number | null;
  combatCount: number;
}

export type MoveMode = 'step' | 'ram' | 'dash' | 'contact' | 'jump';
export interface IntentStep {
  kind: 'move' | 'rays' | 'area' | 'fire';
  label: Localized;
  /** Area/fire cells, or all geometric cells of rays/contact for visual highlighting. */
  cells: number[];
  damage: number;
  /** Each ray stops at its first living unit; all rays in a step are simultaneous. */
  rays?: number[][];
  /** A frozen ordered list of future boss anchors. */
  path?: number[];
  from?: number;
  moveMode?: MoveMode;
  /** Index of a movement step which must fully succeed for this step to execute. */
  requires?: number;
}

export interface Intent {
  name: Localized;
  pattern: number;
  rest: boolean;
  steps: IntentStep[];
  cancelledStep: number | null;
  bossCard: BossCardId | null;
}

export interface CardDefinition {
  id: CardId;
  name: Localized;
  description: Localized;
  rarity: Rarity;
  cost: number;
  icon: string;
  target: 'unit' | 'units' | 'move' | 'swap' | 'boss' | 'intent' | 'none';
  maxTargets: number;
}

export interface BossCardDefinition {
  id: BossCardId;
  boss: BossId;
  name: Localized;
  description: Localized;
  rarity: 'rare' | 'epic' | 'legendary';
  icon: string;
}

export interface BossDefinition {
  id: BossId;
  name: Localized;
  description: Localized;
  width: number;
  height: number;
  anchor: number;
  armor: number;
  hp: number;
}

export interface CreateOptions {
  boss?: BossId;
  difficulty?: Difficulty;
  mode?: Mode;
  coop?: boolean;
  seed?: number | string;
  deck?: CardId[];
  bossCards?: boolean;
  roundLimit?: number | null;
}

export interface GameEvent {
  type: 'move' | 'attack' | 'damage' | 'death' | 'shield' | 'heal' | 'card' | 'boss-card'
    | 'blocked' | 'fire' | 'promote' | 'round' | 'victory' | 'defeat' | 'camp' | 'transfer' | 'consent';
  unitId?: string;
  from?: number;
  to?: number;
  amount?: number;
  absorbed?: number;
  armor?: number;
  hp?: number;
  cardId?: string;
  cells?: number[];
  step?: number;
  /** Semantic key, translated by the client; never raw backend exceptions. */
  key?: string;
}

export interface Outcome {
  winner: 'army' | 'boss';
  reason: 'boss-defeated' | 'king-dead' | 'limit' | 'surrender';
  round: number;
}

export interface SecretState {
  runSeed: number;
  playerDeck: CardId[];
  bossDeck: BossCardId[];
}

export interface GameState {
  version: typeof RULES_VERSION;
  revision: number;
  mode: Mode;
  coop: boolean;
  difficulty: Difficulty;
  phase: 'army' | 'promotion' | 'camp' | 'finished';
  round: number;
  roundLimit: number | null;
  campaignIndex: number;
  units: Unit[];
  boss: Boss;
  intent: Intent;
  /** Last-cast lines tick once before the next boss intent, then expire. */
  fire: number[];
  commands: number;
  commandIndex: number;
  slotTransferred: boolean;
  focus: number;
  hand: CardId[];
  discard: CardId[];
  selectedDeck: CardId[];
  deckRemaining: number;
  cardPlayed: boolean;
  huntMark: number;
  mustDiscard: boolean;
  pendingPromotions: string[];
  bossCardsEnabled: boolean;
  bossHand: BossCardId[];
  bossDiscard: BossCardId[];
  bossDeckRemaining: number;
  /** Null in all network views; never infer the future draw from a transmitted seed. */
  secret: SecretState | null;
  /** A server-authorized takeover controls both seats until explicitly restored. */
  control: 'shared' | Seat;
  assisted: boolean;
  consents: { end: Seat[]; surrender: Seat[] };
  outcome: Outcome | null;
  events: GameEvent[];
}

export type Action =
  | { type: 'move'; unitId: string; to: number; promotion?: PromotionType }
  | { type: 'attack'; unitId: string; target: number; retreat?: number; lunge?: boolean }
  | { type: 'guard'; unitId: string }
  | { type: 'card'; cardId: CardId; targets?: string[]; to?: number; step?: number; promotions?: Record<string, PromotionType> }
  | { type: 'discard'; cardId: CardId }
  | { type: 'promote'; unitId: string; promotion: PromotionType }
  | { type: 'camp'; reviveId?: string; healId?: string }
  | { type: 'transfer' }
  | { type: 'end' }
  | { type: 'surrender' };

export interface ResponsePreview {
  state: GameState;
  events: GameEvent[];
  damage: Record<string, number>;
  deaths: string[];
  kingDies: boolean;
  threatenedCells: number[];
  blockedSteps: number[];
}

export interface PracticePatch {
  units?: Array<{ id: string; square?: number | null; hp?: number; type?: UnitType }>;
  boss?: { anchor?: number; hp?: number; armor?: number };
  hand?: CardId[];
  focus?: number;
  roundLimit?: number | null;
}

export class RuleError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'RuleError';
  }
}
