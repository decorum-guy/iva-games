import { adjacent, boardOf, fileOf, forward, homeRank, isInCheck, opposite, pawnRank, rankOf, squareAt, squareIndex, validSquare } from './geometry'
import { CYCLE, DEVASTATION_DURATION, contactsAreValid, refreshContacts } from './passives'
import { bonusIsGenuine, naturalOutcome, positionKey } from './rules'
import {
  AFFLICTIONS,
  PIECE_TYPES,
  REACTIONS,
  RULES_VERSION,
  RuleError,
  SIDES,
  type EnPassant,
  type GameOutcome,
  type GameState,
  type Piece,
  type PieceInput,
  type PieceType,
  type PositionInput,
} from './types'

function invalid(detail: string): never {
  const error = new RuleError('invalidState')
  // This detail is for tests/diagnostics. Player-facing text uses the stable code.
  error.message += ': ' + detail
  throw error
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('object required')
  return value as Record<string, unknown>
}

function oneOf<T>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.includes(value as T)
}

function isNaturalInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value)
}

function timer(value: unknown, min: number, max: number): value is number | null {
  return value === null || (isNaturalInteger(value) && value >= min && value <= max)
}

function parsePiece(input: unknown, serial: number, phase: GameState['phase']): Piece {
  const raw = record(input)
  const {
    id, side, square, type, affliction, captureReaction, capturesSinceRebirth,
    pawnDoubleStepEligible, castleEligible, devastationDue, cureArmedAt, shameArmedAt,
  } = raw
  if (!validId(id) || !oneOf(side, SIDES) || !validSquare(square) || !oneOf(type, PIECE_TYPES) ||
    !oneOf(affliction, AFFLICTIONS) || !oneOf(captureReaction, REACTIONS) || !isNaturalInteger(capturesSinceRebirth) ||
    typeof pawnDoubleStepEligible !== 'boolean' || typeof castleEligible !== 'boolean') invalid('piece fields')
  const armedLimit = serial + (phase === 'bonus' ? 1 : 0)
  if (!timer(devastationDue, serial + 1, armedLimit + DEVASTATION_DURATION) ||
    !timer(cureArmedAt, serial - CYCLE + 1, armedLimit) ||
    !timer(shameArmedAt, serial - CYCLE + 1, armedLimit)) invalid('piece deadline')
  if ((affliction === 'devastated') !== (devastationDue !== null) ||
    (cureArmedAt !== null && shameArmedAt !== null)) invalid('affliction deadlines')
  if (type === 'pawn' && (rankOf(square) === 0 || rankOf(square) === 7)) invalid('unpromoted pawn on back rank')
  if (pawnDoubleStepEligible && (type !== 'pawn' || rankOf(square) !== pawnRank(side))) invalid('pawn double-step right')
  if (castleEligible && (rankOf(square) !== homeRank(side) ||
    !((type === 'king' && fileOf(square) === 4) || (type === 'rook' && [0, 7].includes(fileOf(square)))))) {
    invalid('castling right')
  }
  if ((type === 'king' || type === 'bishop') && captureReaction !== 'unassigned') invalid('immune capture disposition')
  if (type === 'king' && affliction !== 'neutral') invalid('afflicted king')
  if (type === 'bishop' && capturesSinceRebirth !== 0) invalid('capturing bishop')
  if ((affliction === 'berserk' || affliction === 'bloodlust') !== (captureReaction === 'berserk')) invalid('berserk disposition')
  if (captureReaction !== 'unassigned' && capturesSinceRebirth < 1) invalid('reaction without a capture')
  if ((affliction === 'berserk' && capturesSinceRebirth >= 3) ||
    (affliction === 'bloodlust' && capturesSinceRebirth < 3)) invalid('bloodlust capture count')
  return {
    id, side, square, type, affliction, captureReaction, capturesSinceRebirth,
    pawnDoubleStepEligible, castleEligible, devastationDue, cureArmedAt, shameArmedAt,
  }
}

function parseEnPassant(input: unknown, state: GameState): EnPassant | null {
  if (input === null) return null
  const { availableTo, target, pawnId } = record(input)
  if (!validSquare(target) || !validId(pawnId) || !oneOf(availableTo, SIDES) || availableTo !== state.side) invalid('en passant fields')
  const pawn = state.pieces.find(piece => piece.id === pawnId)
  if (!pawn || pawn.type !== 'pawn' || pawn.side !== opposite(availableTo) || pawn.pawnDoubleStepEligible ||
    pawn.square !== squareAt(fileOf(target), pawnRank(pawn.side) + 2 * forward(pawn.side)) ||
    rankOf(target) !== pawnRank(pawn.side) + forward(pawn.side) ||
    state.pieces.some(piece => piece.square === target)) invalid('en passant right')
  return { availableTo, target, pawnId }
}

function parseRepetition(input: unknown, state: GameState): GameState['repetition'] {
  const entries = Object.entries(record(input))
  let total = 0
  for (const [key, count] of entries) {
    if (!/^p\|[wb]\|\|[^|]*\|[^|]+$/.test(key) || key.length > 4096 ||
      !isNaturalInteger(count) || count === 0) invalid('repetition entry')
    total += count
    if (total > state.turnSerial + 1) invalid('future repetition history')
  }
  if (total === 0) invalid('missing repetition root')
  const repetition = Object.fromEntries(entries) as Record<string, number>
  if (state.phase === 'primary' && !repetition[positionKey(state)]) invalid('uncounted current boundary')
  return repetition
}

function parseOutcome(input: unknown, state: GameState): GameOutcome | null {
  const natural = naturalOutcome(state)
  if (input === null) {
    if (natural) invalid('missing terminal outcome')
    return null
  }
  const { reason, winner } = record(input)
  if (natural) {
    if (natural.reason !== reason || natural.winner !== winner) invalid('natural outcome mismatch')
    return natural
  }
  if (reason === 'resignation' && oneOf(winner, SIDES)) return { reason, winner }
  if (reason === 'agreement' && winner === null) return { reason, winner }
  if (reason === 'repetition' && winner === null && state.phase === 'primary' &&
    (state.repetition[positionKey(state)] ?? 0) >= 3) return { reason, winner }
  return invalid('invalid game outcome')
}

function parseBoardState(input: unknown): GameState {
  const raw = record(input)
  const { rulesVersion, phase, side, turnSerial, bonusPieceId } = raw
  if (rulesVersion !== RULES_VERSION || !oneOf(side, SIDES) ||
    (phase !== 'primary' && phase !== 'bonus') || !isNaturalInteger(turnSerial) ||
    turnSerial >= Number.MAX_SAFE_INTEGER - DEVASTATION_DURATION - 1) invalid('rules version, phase or turn')
  if (phase === 'primary' ? bonusPieceId !== null : !validId(bonusPieceId)) invalid('bonus phase')
  if (!Array.isArray(raw.pieces) || raw.pieces.length < 2 || raw.pieces.length > 32) invalid('piece count')
  const pieces = raw.pieces.map(piece => parsePiece(piece, turnSerial, phase))
  if (new Set(pieces.map(piece => piece.square)).size !== pieces.length ||
    new Set(pieces.map(piece => piece.id)).size !== pieces.length) invalid('duplicate piece or square')
  const kings = pieces.filter(piece => piece.type === 'king')
  if (kings.length !== 2 || kings[0].side === kings[1].side || adjacent(kings[0].square, kings[1].square)) invalid('king invariant')
  const base: GameState = {
    rulesVersion, phase, side, turnSerial, bonusPieceId: bonusPieceId as string | null,
    pieces, enPassant: null, repetition: {}, outcome: null,
  }
  const enPassant = parseEnPassant(raw.enPassant, base)
  const state = { ...base, enPassant }
  if (!contactsAreValid(state)) invalid('inconsistent aura coverage')
  if (isInCheck(state, phase === 'bonus' ? side : opposite(side))) invalid('unsafe previous mover')
  if (phase === 'bonus' && !bonusIsGenuine(state)) invalid('no safe bonus action')
  return state
}

export function validateState(input: unknown): GameState {
  const boardState = parseBoardState(input)
  const raw = record(input)
  const repetition = parseRepetition(raw.repetition, boardState)
  const state = { ...boardState, repetition }
  return { ...state, outcome: parseOutcome(raw.outcome, state) }
}

export function createPosition(input: PositionInput): GameState {
  const turnSerial = input.turnSerial ?? 0
  const side = input.side ?? 'white'
  const phase = input.phase ?? 'primary'
  const armedAt = turnSerial + (phase === 'bonus' ? 1 : 0)
  const pieces = input.pieces.map((partial: PieceInput) => {
    const affliction = partial.affliction ?? 'neutral'
    const frenzied = affliction === 'berserk' || affliction === 'bloodlust'
    return parsePiece({
      id: (partial.side === 'white' ? 'w-' : 'b-') + partial.square,
      captureReaction: frenzied ? 'berserk' : 'unassigned',
      capturesSinceRebirth: affliction === 'bloodlust' ? 3 : frenzied || (partial.captureReaction && partial.captureReaction !== 'unassigned') ? 1 : 0,
      pawnDoubleStepEligible: false, castleEligible: false,
      devastationDue: affliction === 'devastated' ? armedAt + DEVASTATION_DURATION : null,
      cureArmedAt: null, shameArmedAt: null,
      ...partial,
      affliction,
    }, turnSerial, phase)
  })
  const state = parseBoardState({
    rulesVersion: RULES_VERSION,
    pieces: refreshContacts(pieces, armedAt),
    phase, side, turnSerial,
    bonusPieceId: input.bonusPieceId ?? null,
    enPassant: input.enPassant ?? null,
  })
  const repetition = parseRepetition(input.repetition ?? { [positionKey(state)]: 1 }, state)
  return { ...state, repetition, outcome: naturalOutcome(state) }
}

const BACK_RANK: readonly PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook']

export function createInitialState(): GameState {
  const pieces: PieceInput[] = []
  for (const side of SIDES) {
    for (const [file, type] of BACK_RANK.entries()) {
      pieces.push({ side, type, square: squareAt(file, homeRank(side))!, castleEligible: type === 'king' || type === 'rook' })
      pieces.push({ side, type: 'pawn', square: squareAt(file, pawnRank(side))!, pawnDoubleStepEligible: true })
    }
  }
  return createPosition({ pieces })
}

export function pieceAt(state: GameState, square: Piece['square']): Piece | undefined {
  return boardOf(state)[squareIndex(square)]
}
