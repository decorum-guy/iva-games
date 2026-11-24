export const RULES_VERSION = 'remorse-digital-v1' as const
export const SIDES = ['white', 'black'] as const
export const PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const
export const PROMOTIONS = ['queen', 'rook', 'bishop', 'knight'] as const
export const AFFLICTIONS = ['neutral', 'guilt', 'devastated', 'berserk', 'bloodlust'] as const
export const REACTIONS = ['unassigned', 'devastated', 'guilt', 'unaffected', 'berserk'] as const

export type Side = typeof SIDES[number]
export type PieceType = typeof PIECE_TYPES[number]
export type Promotion = typeof PROMOTIONS[number]
export type Affliction = typeof AFFLICTIONS[number]
export type CaptureReaction = typeof REACTIONS[number]
export type Square = string
export type DieFace = 1 | 2 | 3 | 4 | 5 | 6

export interface Piece {
  readonly id: string
  readonly side: Side
  readonly type: PieceType
  readonly square: Square
  readonly affliction: Affliction
  readonly captureReaction: CaptureReaction
  readonly capturesSinceRebirth: number
  readonly pawnDoubleStepEligible: boolean
  readonly castleEligible: boolean
  readonly devastationDue: number | null
  readonly cureArmedAt: number | null
  readonly shameArmedAt: number | null
}

export type PieceInput = Pick<Piece, 'side' | 'type' | 'square'> &
  Partial<Omit<Piece, 'side' | 'type' | 'square'>>

export interface EnPassant {
  readonly pawnId: string
  readonly target: Square
  readonly availableTo: Side
}

export type GameOutcome =
  | { readonly reason: 'checkmate' | 'resignation'; readonly winner: Side }
  | { readonly reason: 'stalemate' | 'bareKings' | 'repetition' | 'agreement'; readonly winner: null }

export interface GameState {
  readonly rulesVersion: typeof RULES_VERSION
  readonly pieces: readonly Piece[]
  readonly side: Side
  readonly turnSerial: number
  readonly phase: 'primary' | 'bonus'
  readonly bonusPieceId: string | null
  readonly enPassant: EnPassant | null
  readonly repetition: Readonly<Record<string, number>>
  readonly outcome: GameOutcome | null
}

export interface PositionInput {
  readonly pieces: readonly PieceInput[]
  readonly side?: Side
  readonly turnSerial?: number
  readonly phase?: GameState['phase']
  readonly bonusPieceId?: string | null
  readonly enPassant?: EnPassant | null
  readonly repetition?: GameState['repetition']
}

export interface Move {
  readonly type: 'move'
  readonly from: Square
  readonly to: Square
  readonly promotion?: Promotion
}

export type Command =
  | Move
  | { readonly type: 'endTurn' }
  | { readonly type: 'claimRepetitionDraw' }
  | { readonly type: 'resign' }
  | { readonly type: 'agreeDraw' }

export interface Chance {
  readonly face?: DieFace
  readonly weight: number
}

export interface CaptureDetails {
  readonly capturer: Piece
  readonly victim: Piece
  readonly landing: Square
  readonly friendly: boolean
  readonly mercy: boolean
  readonly kind: 'ordinary' | 'mercy' | 'enPassant'
}

export type CoreEventData =
  | { readonly type: 'move'; readonly piece: Piece; readonly from: Square; readonly to: Square; readonly castle?: true }
  | ({ readonly type: 'capture' } & CaptureDetails)
  | { readonly type: 'reaction'; readonly piece: Piece; readonly affliction: Affliction; readonly face?: DieFace; readonly cause: 'roll' | 'memory' | 'bishop' }
  | { readonly type: 'affliction'; readonly piece: Piece; readonly affliction: Affliction; readonly cause: 'shame' | 'bloodlust' }
  | { readonly type: 'cure'; readonly piece: Piece; readonly cause: 'bishop' | 'rally' }
  | { readonly type: 'convert'; readonly piece: Piece; readonly side: Side }
  | { readonly type: 'remove'; readonly piece: Piece }
  | { readonly type: 'promotion'; readonly piece: Piece; readonly promotion: Promotion }
  | { readonly type: 'bonus'; readonly piece: Piece; readonly required: boolean }
  | { readonly type: 'turn'; readonly side: Side; readonly turnSerial: number; readonly check: boolean }
  | { readonly type: 'outcome'; readonly outcome: GameOutcome }

export type GameEvent = CoreEventData & { readonly id: string }
export type CaptureEvent = Extract<GameEvent, { type: 'capture' }>

export interface Transition {
  readonly state: GameState
  readonly events: readonly GameEvent[]
}

export type RejectionCode =
  | 'finished' | 'invalidCommand' | 'invalidState' | 'wrongSide' | 'wrongBonusPiece'
  | 'devastated' | 'guiltCapture' | 'bishopCapture' | 'bloodlustMove' | 'kingCapture'
  | 'promotionRequired' | 'illegalMovement' | 'kingSafety' | 'endTurnUnsafe'
  | 'notBonus' | 'noRepetition' | 'invalidRoll'

export class RuleError extends Error {
  constructor(readonly code: RejectionCode) {
    super(code)
    this.name = 'RuleError'
  }
}
