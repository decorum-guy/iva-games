/** Complete, public state for the deterministic OVERDRIVE ruleset. */
export const RULES_VERSION = 'overdrive-v2' as const
export const LEGACY_RULES_VERSION = 'overdrive-v1' as const
export type RulesVersion = typeof RULES_VERSION | typeof LEGACY_RULES_VERSION
export const energyBankSize = (version: RulesVersion): number => version === LEGACY_RULES_VERSION ? 5 : 3
export const SIDES = ['white', 'black'] as const
export const PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const
export const PROMOTIONS = ['queen', 'rook', 'bishop', 'knight'] as const
export type Side = typeof SIDES[number]
export type PieceType = typeof PIECE_TYPES[number]
export type Promotion = typeof PROMOTIONS[number]
export type Square = string
export type Ability = 'sweep' | 'raid' | 'battery' | 'ram' | 'rotation' | 'cover'
export type ActionMode = 'normal' | 'impulse' | 'form' | 'activate'
export interface Piece {
  readonly id: string
  readonly side: Side
  readonly type: PieceType
  readonly square: Square
  readonly pawnDoubleStepEligible: boolean
  readonly castleEligible: boolean
}
export type PieceInput = Pick<Piece, 'side' | 'type' | 'square'> & Partial<Omit<Piece, 'side' | 'type' | 'square'>>
export interface Form { readonly pieceId: string; readonly remainingTurns: number }
export interface EnPassant { readonly pawnId: string; readonly target: Square; readonly availableTo: Side }
export interface GameOutcome {
  readonly winner: Side | null
  readonly reason: 'checkmate' | 'resignation' | 'stalemate' | 'bareKings' | 'repetition' | 'fiftyMoves' | 'seventyFiveMoves' | 'agreement'
}
export interface GameState {
  readonly rulesVersion: RulesVersion
  readonly pieces: readonly Piece[]
  readonly side: Side
  readonly turnSerial: number
  readonly energy: Readonly<Record<Side, number>>
  readonly forms: Readonly<Record<Side, Form | null>>
  readonly rewardedCheckLayouts: Readonly<Record<Side, readonly string[]>>
  readonly enPassant: EnPassant | null
  readonly quietPly: number
  readonly repetition: Readonly<Record<string, number>>
  readonly outcome: GameOutcome | null
}
export interface PositionInput {
  readonly rulesVersion?: RulesVersion
  readonly pieces: readonly PieceInput[]
  readonly side?: Side
  readonly turnSerial?: number
  readonly energy?: Partial<Record<Side, number>>
  readonly forms?: Partial<Record<Side, Form | null>>
  readonly rewardedCheckLayouts?: Partial<Record<Side, readonly string[]>>
  readonly enPassant?: EnPassant | null
  readonly quietPly?: number
  readonly repetition?: Readonly<Record<string, number>>
  readonly outcome?: GameOutcome | null
}
export interface Action {
  readonly type: 'move' | 'ability'
  readonly mode: ActionMode
  readonly pieceId: string
  readonly to?: Square
  readonly targetId?: string
  readonly promotion?: Promotion
}
export type Command = Action
  | { readonly type: 'claimDraw'; readonly reason: 'repetition' | 'fiftyMoves' }
  | { readonly type: 'resign' }
  | { readonly type: 'agreeDraw' }
export type EventData =
  | { readonly type: 'move'; readonly pieceId: string; readonly side: Side; readonly pieceType: PieceType; readonly from: Square; readonly to: Square; readonly forced: boolean }
  | { readonly type: 'capture'; readonly victim: Piece; readonly pieceId: string }
  | { readonly type: 'ability'; readonly ability: Ability; readonly pieceId: string; readonly mode: ActionMode; readonly from: Square; readonly to: Square; readonly targetId?: string }
  | { readonly type: 'energy'; readonly side: Side; readonly before: number; readonly after: number; readonly spent: number; readonly captureEarned: number; readonly checkEarned: number }
  | { readonly type: 'form'; readonly side: Side; readonly pieceId: string; readonly remainingTurns: number; readonly cause: 'activate' | 'tick' | 'expire' | 'capture' }
  | { readonly type: 'promotion'; readonly pieceId: string; readonly side: Side; readonly promotion: Promotion; readonly square: Square; readonly forced: boolean }
  | { readonly type: 'turn'; readonly side: Side; readonly turnSerial: number; readonly check: boolean }
  | { readonly type: 'outcome'; readonly outcome: GameOutcome }
export type GameEvent = EventData & { readonly id: string }
export interface Transition { readonly state: GameState; readonly events: readonly GameEvent[] }
export type RejectionCode = 'finished' | 'invalidCommand' | 'invalidState' | 'wrongSide' | 'energy' | 'form' | 'illegalMovement' | 'kingSafety' | 'kingCapture' | 'promotionRequired' | 'invalidPromotion' | 'noDraw'
export class RuleError extends Error {
  constructor(readonly code: RejectionCode) { super(code); this.name = 'OverdriveRuleError' }
}
export const ABILITIES: Readonly<Record<PieceType, Ability>> = { pawn: 'sweep', knight: 'raid', bishop: 'battery', rook: 'ram', queen: 'rotation', king: 'cover' }
