import { PIECE_TYPES, RULES_VERSION, LEGACY_RULES_VERSION, energyBankSize, SIDES, RuleError } from './types'
import type { GameState, Piece, PieceType, PositionInput, Side } from './types'
import { adjacent, homeRank, opposite, pawnStartRank, rank, squareAt, validSquare } from './geometry'
import { positionKey } from './rules'

export function createPosition(input: PositionInput): GameState {
  const pieces: Piece[] = input.pieces.map((piece, index) => ({
    id: piece.id ?? `${piece.side}-${piece.type}-${index}`,
    side: piece.side, type: piece.type, square: piece.square,
    pawnDoubleStepEligible: piece.pawnDoubleStepEligible ?? false,
    castleEligible: piece.castleEligible ?? false,
  }))
  const state: GameState = {
    rulesVersion: input.rulesVersion ?? RULES_VERSION, pieces,
    side: input.side ?? 'white', turnSerial: input.turnSerial ?? 0,
    energy: { white: input.energy?.white ?? 0, black: input.energy?.black ?? 0 },
    forms: { white: input.forms?.white ? { ...input.forms.white } : null, black: input.forms?.black ? { ...input.forms.black } : null },
    rewardedCheckLayouts: { white: [...(input.rewardedCheckLayouts?.white ?? [])].sort(), black: [...(input.rewardedCheckLayouts?.black ?? [])].sort() },
    enPassant: input.enPassant ? { ...input.enPassant } : null,
    quietPly: input.quietPly ?? 0, repetition: { ...(input.repetition ?? {}) }, outcome: input.outcome ?? null,
  }
  if (!validateState(state)) throw new RuleError('invalidState')
  return input.repetition ? state : { ...state, repetition: { [positionKey(state)]: 1 } }
}
export function createInitialState(): GameState {
  const pieces: Piece[] = []
  const order: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook']
  for (const side of SIDES) for (let x = 0; x < 8; x++) {
    const type = order[x]
    pieces.push({ id: `${side}-${type}-${x}`, side, type, square: squareAt(x, homeRank(side))!, pawnDoubleStepEligible: false, castleEligible: type === 'king' || type === 'rook' })
    pieces.push({ id: `${side}-pawn-${x}`, side, type: 'pawn', square: squareAt(x, pawnStartRank(side))!, pawnDoubleStepEligible: true, castleEligible: false })
  }
  return createPosition({ pieces })
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max
const side = (value: unknown): value is Side => value === 'white' || value === 'black'
const ownKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key))

/** Structural/invariant validation for persisted JSON. Does not claim reachability from the opening. */
export function validateState(value: unknown): value is GameState {
  if (!record(value) || !ownKeys(value, ['rulesVersion', 'pieces', 'side', 'turnSerial', 'energy', 'forms', 'rewardedCheckLayouts', 'enPassant', 'quietPly', 'repetition', 'outcome'])) return false
  if ((value.rulesVersion !== RULES_VERSION && value.rulesVersion !== LEGACY_RULES_VERSION) || !side(value.side) || !integer(value.turnSerial) || !integer(value.quietPly)) return false
  if (!Array.isArray(value.pieces) || value.pieces.length < 2 || value.pieces.length > 32) return false
  const ids = new Set<string>(), squares = new Set<string>(), kings = { white: 0, black: 0 }
  for (const p of value.pieces) {
    if (!record(p) || !ownKeys(p, ['id', 'side', 'type', 'square', 'pawnDoubleStepEligible', 'castleEligible'])) return false
    if (typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id) || !side(p.side) || !PIECE_TYPES.includes(p.type as PieceType) || !validSquare(p.square) || squares.has(p.square)) return false
    if (typeof p.pawnDoubleStepEligible !== 'boolean' || typeof p.castleEligible !== 'boolean') return false
    if (p.type === 'pawn' && (rank(p.square) === 0 || rank(p.square) === 7)) return false
    if (p.pawnDoubleStepEligible && (p.type !== 'pawn' || rank(p.square) !== pawnStartRank(p.side))) return false
    if (p.castleEligible && !((p.type === 'king' && p.square === squareAt(4, homeRank(p.side))) || (p.type === 'rook' && [squareAt(0, homeRank(p.side)), squareAt(7, homeRank(p.side))].includes(p.square)))) return false
    if (p.type === 'king') kings[p.side]++
    ids.add(p.id); squares.add(p.square)
  }
  if (kings.white !== 1 || kings.black !== 1) return false
  const kingPieces = value.pieces.filter(p => p.type === 'king')
  if (adjacent(kingPieces[0].square, kingPieces[1].square)) return false
  for (const field of ['energy', 'forms', 'rewardedCheckLayouts'] as const) if (!record(value[field]) || !ownKeys(value[field], SIDES)) return false
  const energy = value.energy as Record<string, unknown>, forms = value.forms as Record<string, unknown>, rewards = value.rewardedCheckLayouts as Record<string, unknown>
  for (const s of SIDES) {
    if (!integer(energy[s], energyBankSize(value.rulesVersion) * 2)) return false
    const form = forms[s]
    if (form !== null && (!record(form) || !ownKeys(form, ['pieceId', 'remainingTurns']) || typeof form.pieceId !== 'string' || !integer(form.remainingTurns, 3) || form.remainingTurns === 0 || !value.pieces.some(p => p.id === form.pieceId && p.side === s))) return false
    const keys = rewards[s]
    if (!Array.isArray(keys) || keys.length > 4096 || keys.some(k => typeof k !== 'string' || !k.startsWith(`${s[0]}:`) || !/^[wb]:(?:--|[wb][pnbrqk]){64}$/.test(k)) || new Set(keys).size !== keys.length) return false
  }
  const ep = value.enPassant
  if (ep !== null) {
    if (!record(ep) || !ownKeys(ep, ['pawnId', 'target', 'availableTo']) || typeof ep.pawnId !== 'string' || !validSquare(ep.target) || ep.availableTo !== value.side || !side(ep.availableTo) || squares.has(ep.target)) return false
    const victim = value.pieces.find(p => p.id === ep.pawnId)
    if (!victim || victim.type !== 'pawn' || victim.side !== opposite(ep.availableTo) || rank(ep.target) !== (ep.availableTo === 'white' ? 5 : 2) || victim.square !== `${ep.target[0]}${ep.availableTo === 'white' ? 5 : 4}`) return false
  }
  if (!record(value.repetition) || Object.keys(value.repetition).length > 10000 || Object.entries(value.repetition).some(([key, n]) => !key.startsWith('[') || key.length > 2_000_000 || !integer(n, 10000) || n === 0)) return false
  const result = value.outcome
  if (result !== null) {
    if (!record(result) || !ownKeys(result, ['reason', 'winner']) || !['checkmate', 'resignation', 'stalemate', 'bareKings', 'repetition', 'fiftyMoves', 'seventyFiveMoves', 'agreement'].includes(String(result.reason))) return false
    if (result.reason === 'checkmate' || result.reason === 'resignation') { if (!side(result.winner)) return false }
    else if (result.winner !== null) return false
  }
  return true
}
