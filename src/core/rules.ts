import { boardOf, forward, isInCheck, movePlans, opposite, rankOf, squareAt, squareIndex, validSquare, type Board, type MovePlan } from './geometry'
import { isFrenzied, rebirth, refreshContacts, setAffliction, settlePassives } from './passives'
import {
  PROMOTIONS,
  RuleError,
  type CaptureDetails,
  type CaptureReaction,
  type Chance,
  type Command,
  type CoreEventData,
  type DieFace,
  type GameOutcome,
  type GameState,
  type Move,
  type Piece,
  type RejectionCode,
  type Side,
  type Transition,
} from './types'

const DIE_REACTIONS = ['devastated', 'guilt', 'guilt', 'unaffected', 'unaffected', 'berserk'] as const
const DIE_OUTCOMES: readonly Chance[] = [
  { face: 1, weight: 1 / 6 },
  { face: 2, weight: 2 / 6 },
  { face: 4, weight: 2 / 6 },
  { face: 6, weight: 1 / 6 },
]
const NO_ROLL: readonly Chance[] = [{ weight: 1 }]

export function reactionForFace(face: DieFace): Exclude<CaptureReaction, 'unassigned'> {
  return DIE_REACTIONS[face - 1]
}

function needsRoll(plan: MovePlan): boolean {
  const { piece, victim } = plan
  return !!victim && piece.type !== 'king' && !isFrenzied(piece) &&
    victim.type !== 'bishop' && victim.affliction !== 'devastated' &&
    !(piece.type === 'knight' && piece.capturesSinceRebirth === 0) &&
    piece.captureReaction === 'unassigned'
}

function mercyApplies(piece: Piece, victim: Piece): boolean {
  return piece.type !== 'king' && !isFrenzied(piece) && victim.type !== 'bishop' && victim.affliction === 'devastated'
}

function resolveCapture(plan: MovePlan, moved: Piece, armedAt: number, face?: DieFace, events?: CoreEventData[]) {
  const { piece, victim } = plan
  if (!victim) return moved
  const counted: Piece = { ...moved, capturesSinceRebirth: moved.capturesSinceRebirth + 1 }
  if (piece.type === 'king') return counted
  if (isFrenzied(piece)) {
    const bloodlust = counted.capturesSinceRebirth >= 3 ? setAffliction(counted, 'bloodlust', armedAt) : counted
    if (bloodlust !== counted) events?.push({ type: 'affliction', piece: bloodlust, affliction: 'bloodlust', cause: 'bloodlust' })
    return bloodlust
  }
  if (victim.type === 'bishop') {
    const devastated = setAffliction(counted, 'devastated', armedAt)
    events?.push({ type: 'reaction', piece: devastated, affliction: 'devastated', cause: 'bishop' })
    return devastated
  }
  if (mercyApplies(piece, victim) ||
    (piece.type === 'knight' && piece.capturesSinceRebirth === 0 && piece.captureReaction === 'unassigned')) return counted
  const reaction = face === undefined ? counted.captureReaction : reactionForFace(face)
  if (reaction === 'unassigned') throw new RuleError('invalidRoll')
  const result = reaction === 'unaffected' ? counted : setAffliction(counted, reaction, armedAt)
  const remembered: Piece = { ...result, captureReaction: reaction }
  events?.push({ type: 'reaction', piece: remembered, affliction: remembered.affliction, face, cause: face === undefined ? 'memory' : 'roll' })
  if (reaction === 'berserk' && remembered.capturesSinceRebirth >= 3) {
    const bloodlust = setAffliction(remembered, 'bloodlust', armedAt)
    events?.push({ type: 'affliction', piece: bloodlust, affliction: 'bloodlust', cause: 'bloodlust' })
    return bloodlust
  }
  return remembered
}

function movePiece(piece: Piece, to: Piece['square']): Piece {
  return { ...piece, square: to, castleEligible: false, pawnDoubleStepEligible: false }
}

interface ResolvedMove {
  readonly state: GameState
  readonly moved: Piece
}

function resolveMove(state: GameState, plan: MovePlan, face?: DieFace, events?: CoreEventData[]): ResolvedMove {
  const { piece, command: { from, to, promotion }, victim, rook } = plan
  const armedAt = state.turnSerial + 1
  let moved = movePiece(piece, to)
  events?.push({ type: 'move', piece, from, to, castle: rook ? true : undefined })
  if (victim) {
    const kind: CaptureDetails['kind'] = plan.enPassant ? 'enPassant' : mercyApplies(piece, victim) ? 'mercy' : 'ordinary'
    events?.push({
      type: 'capture',
      capturer: piece,
      victim,
      landing: to,
      friendly: victim.side === piece.side,
      kind,
      mercy: mercyApplies(piece, victim),
    })
    moved = resolveCapture(plan, moved, armedAt, face, events)
  }
  if (promotion) {
    events?.push({ type: 'promotion', piece: moved, promotion })
    moved = { ...(promotion === 'bishop' ? rebirth(moved) : moved), type: promotion }
  }

  if (rook) events?.push({ type: 'move', piece: rook.piece, from: rook.piece.square, to: rook.to, castle: true })
  const pieces: Piece[] = []
  for (const current of state.pieces) {
    if (current.id === victim?.id) continue
    if (current.id === piece.id) pieces.push(moved)
    else if (rook && current.id === rook.piece.id) pieces.push(movePiece(current, rook.to))
    else pieces.push(current)
  }
  const settled = refreshContacts(pieces, armedAt, events)
  let enPassant = state.enPassant
  if (enPassant && (enPassant.pawnId === victim?.id || enPassant.pawnId === piece.id || enPassant.target === to)) {
    enPassant = null
  }
  if (piece.type === 'pawn' && Math.abs(rankOf(to) - rankOf(from)) === 2) {
    const target = squareAt(squareIndex(from) & 7, rankOf(from) + forward(piece.side))!
    enPassant = { pawnId: piece.id, target, availableTo: opposite(piece.side) }
  }
  const resultingPiece = settled.find(current => current.id === moved.id)!
  return { state: { ...state, pieces: settled, enPassant }, moved: resultingPiece }
}

export function positionKey(state: GameState): string {
  const { phase, side, bonusPieceId, enPassant } = state
  const parts: string[] = []
  const board = boardOf(state)
  const castleRights = {
    white: hasHistoricalCastlePair(state, 'white'),
    black: hasHistoricalCastlePair(state, 'black'),
  }
  for (let index = 0; index < 64; index++) {
    const piece = board[index]
    if (!piece) continue
    const type = PIECE_CODE[piece.type]
    const army = piece.side === 'white' ? type.toUpperCase() : type
    const remaining = (timer: number | null) => timer === null ? '' : timer - state.turnSerial
    const right = piece.castleEligible && castleRights[piece.side] ? 'c' : piece.pawnDoubleStepEligible ? 'p' : ''
    parts.push([
      index.toString(36) + army + AFFLICTION_CODE[piece.affliction] + REACTION_CODE[piece.captureReaction] + right,
      relevantCaptures(piece),
      remaining(piece.devastationDue),
      remaining(piece.cureArmedAt),
      remaining(piece.shameArmedAt),
    ].join('.'))
  }
  return [
    phase === 'primary' ? 'p' : 'b',
    side === 'white' ? 'w' : 'b',
    bonusPieceId ? encodeURIComponent(bonusPieceId) : '',
    enPassant ? enPassant.target + encodeURIComponent(enPassant.pawnId) : '',
    parts.join(','),
  ].join('|')
}

// A rook's movement history remains recorded even when its original king
// can no longer castle. Only a surviving king/rook right affects repetition.
function hasHistoricalCastlePair(state: GameState, side: Side): boolean {
  return state.pieces.some(piece => piece.side === side && piece.castleEligible && piece.type === 'king') &&
    state.pieces.some(piece => piece.side === side && piece.castleEligible && piece.type === 'rook')
}

function relevantCaptures(piece: Piece): number {
  const canChangeFrenzy = piece.captureReaction === 'unassigned' || piece.captureReaction === 'berserk'
  return piece.type !== 'king' && piece.type !== 'bishop' && canChangeFrenzy
    ? Math.min(3, piece.capturesSinceRebirth)
    : 0
}

const PIECE_CODE = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' }
const AFFLICTION_CODE = { neutral: '0', guilt: '1', devastated: '2', berserk: '3', bloodlust: '4' }
const REACTION_CODE = { unassigned: '0', guilt: '1', devastated: '2', unaffected: '3', berserk: '4' }

export function canClaimRepetition(state: GameState): boolean {
  return !state.outcome && state.phase === 'primary' && (state.repetition[positionKey(state)] ?? 0) >= 3
}

function safeBoundary(state: GameState, immediateSafetyKnown: boolean): boolean {
  const pieces = settlePassives(state.pieces, state.turnSerial + 1)
  if (immediateSafetyKnown && pieces === state.pieces) return true
  return !isInCheck({ ...state, pieces })
}

function safeBonusPlan(state: GameState, plan: MovePlan): boolean {
  const moved = resolveMove(state, plan).state
  return !isInCheck(moved) && safeBoundary(moved, true)
}

function hasSafeBonus(state: GameState, piece: Piece, probe?: () => void): boolean {
  const plans = movePlans(state, piece, boardOf(state))
  return plans.some(plan => {
    probe?.()
    return safeBonusPlan(state, plan)
  })
}

function safePrimaryPlan(state: GameState, plan: MovePlan, probe?: () => void): boolean {
  const chances = needsRoll(plan) ? DIE_OUTCOMES : NO_ROLL
  for (const { face } of chances) {
    probe?.()
    const result = resolveMove(state, plan, face)
    if (isInCheck(result.state)) return false
    if (safeBoundary(result.state, true)) continue
    if (!plan.victim || !isFrenzied(result.moved) || !hasSafeBonus(result.state, result.moved, probe)) return false
  }
  return true
}

function allPlans(state: GameState): MovePlan[] {
  const board = boardOf(state)
  return state.pieces.flatMap(piece => {
    if (piece.side !== state.side || (state.phase === 'bonus' && piece.id !== state.bonusPieceId)) return []
    return movePlans(state, piece, board)
  })
}

function legalPlan(state: GameState, plan: MovePlan, probe?: () => void) {
  return state.phase === 'bonus' ? safeBonusPlan(state, plan) : safePrimaryPlan(state, plan, probe)
}

export function legalCommands(state: GameState, probe?: () => void): Command[] {
  if (state.outcome) return []
  const commands: Command[] = []
  for (const plan of allPlans(state)) {
    probe?.()
    if (legalPlan(state, plan, probe)) commands.push(plan.command)
  }
  if (state.phase === 'bonus' && safeBoundary(state, true)) commands.push({ type: 'endTurn' })
  if (canClaimRepetition(state)) commands.push({ type: 'claimRepetitionDraw' })
  return commands
}

function matchPlan(state: GameState, command: Move, board = boardOf(state)): MovePlan | undefined {
  const piece = board[squareIndex(command.from)]
  if (!piece) return undefined
  return movePlans(state, piece, board).find(({ command: candidate }) =>
    candidate.to === command.to && candidate.promotion === command.promotion)
}

export function enumerateOutcomes(state: GameState, command: Command): readonly Chance[] {
  if (command.type !== 'move') return NO_ROLL
  const plan = matchPlan(state, command)
  return plan && needsRoll(plan) ? DIE_OUTCOMES : NO_ROLL
}

function moveRejection(state: GameState, command: Move, board: Board): RejectionCode {
  const piece = board[squareIndex(command.from)]
  if (!piece) return 'illegalMovement'
  if (piece.side !== state.side) return 'wrongSide'
  if (state.phase === 'bonus' && piece.id !== state.bonusPieceId) return 'wrongBonusPiece'
  if (piece.affliction === 'devastated') return 'devastated'
  const victim = board[squareIndex(command.to)]
  const ep = piece.type === 'pawn' && state.enPassant?.availableTo === piece.side && state.enPassant.target === command.to
  if (victim?.type === 'king') return 'kingCapture'
  if (victim || ep) {
    if (piece.type === 'bishop') return 'bishopCapture'
    if (piece.affliction === 'guilt') return 'guiltCapture'
  } else if (piece.affliction === 'bloodlust') return 'bloodlustMove'
  const choices = movePlans(state, piece, board).filter(plan => plan.command.to === command.to)
  if (choices.some(plan => plan.command.promotion) && command.promotion === undefined) return 'promotionRequired'
  return 'illegalMovement'
}

type Readiness = { readonly error: RejectionCode } | { readonly plan?: MovePlan }

function readiness(state: GameState, command: Command, actor: Side): Readiness {
  if (state.outcome) return { error: 'finished' }
  if (!command || typeof command !== 'object' || (actor !== 'white' && actor !== 'black')) {
    return { error: 'invalidCommand' }
  }
  if (command.type === 'resign' || command.type === 'agreeDraw') return {}
  if (actor !== state.side) return { error: 'wrongSide' }
  switch (command.type) {
    case 'claimRepetitionDraw':
      return canClaimRepetition(state) ? {} : { error: 'noRepetition' }
    case 'endTurn':
      if (state.phase !== 'bonus') return { error: 'notBonus' }
      return safeBoundary(state, true) ? {} : { error: 'endTurnUnsafe' }
    case 'move': {
      if (!validSquare(command.from) || !validSquare(command.to) ||
        (command.promotion !== undefined && !PROMOTIONS.includes(command.promotion))) {
        return { error: 'invalidCommand' }
      }
      const board = boardOf(state)
      const piece = board[squareIndex(command.from)]
      if (!piece || piece.side !== state.side || (state.phase === 'bonus' && piece.id !== state.bonusPieceId)) {
        return { error: moveRejection(state, command, board) }
      }
      const plan = matchPlan(state, command, board)
      if (!plan) return { error: moveRejection(state, command, board) }
      return legalPlan(state, plan) ? { plan } : { error: 'kingSafety' }
    }
    default:
      return { error: 'invalidCommand' }
  }
}

export function commandRejection(state: GameState, command: Command, actor: Side = state.side): RejectionCode | null {
  const ready = readiness(state, command, actor)
  return 'error' in ready ? ready.error : null
}

export function naturalOutcome(state: GameState, probe?: () => void, check = isInCheck(state)): GameOutcome | null {
  if (state.phase === 'bonus') return null
  if (state.pieces.length === 2) return { reason: 'bareKings', winner: null }
  const board = boardOf(state)
  for (const piece of state.pieces) {
    if (piece.side !== state.side) continue
    for (const plan of movePlans(state, piece, board)) {
      probe?.()
      if (safePrimaryPlan(state, plan, probe)) return null
    }
  }
  return check ? { reason: 'checkmate', winner: opposite(state.side) } : { reason: 'stalemate', winner: null }
}

export function bonusIsGenuine(state: GameState): boolean {
  const boosted = state.pieces.find(piece => piece.id === state.bonusPieceId)
  return !!boosted && boosted.side === state.side && isFrenzied(boosted) && hasSafeBonus(state, boosted)
}

function finishTurn(state: GameState, events: CoreEventData[], probe?: () => void): GameState {
  const side = opposite(state.side)
  const turnSerial = state.turnSerial + 1
  const pieces = settlePassives(state.pieces, turnSerial, events)
  const enPassant = state.enPassant?.availableTo === side && pieces.some(piece =>
    piece.id === state.enPassant?.pawnId && piece.side !== side && piece.type === 'pawn')
    ? state.enPassant : null
  const completed: GameState = { ...state, side, turnSerial, pieces, enPassant, phase: 'primary', bonusPieceId: null }
  const key = positionKey(completed)
  const repetition = { ...state.repetition, [key]: (state.repetition[key] ?? 0) + 1 }
  const check = isInCheck(completed)
  events.push({ type: 'turn', side, turnSerial, check })
  const outcome = naturalOutcome(completed, probe, check)
  if (outcome) events.push({ type: 'outcome', outcome })
  return { ...completed, repetition, outcome }
}

function apply(
  state: GameState,
  command: Command,
  plan: MovePlan | undefined,
  face: DieFace | undefined,
  actor: Side,
  probe?: () => void,
): Transition {
  const wantsFace = !!plan && needsRoll(plan)
  if ((wantsFace && (face === undefined || !Number.isInteger(face) || face < 1 || face > 6)) ||
    (!wantsFace && face !== undefined)) throw new RuleError('invalidRoll')

  const events: CoreEventData[] = []
  let next: GameState
  if (command.type === 'resign' || command.type === 'agreeDraw' || command.type === 'claimRepetitionDraw') {
    const outcome: GameOutcome = command.type === 'resign'
      ? { reason: 'resignation', winner: opposite(actor) }
      : { reason: command.type === 'agreeDraw' ? 'agreement' : 'repetition', winner: null }
    next = { ...state, outcome }
    events.push({ type: 'outcome', outcome })
  } else if (command.type === 'endTurn') {
    next = finishTurn(state, events, probe)
  } else {
    if (!plan) throw new RuleError('illegalMovement')
    const result = resolveMove(state, plan, face, events)
    const canUseBonus = state.phase === 'primary' && !!plan.victim && isFrenzied(result.moved) &&
      hasSafeBonus(result.state, result.moved, probe)
    if (canUseBonus) {
      next = { ...result.state, phase: 'bonus', bonusPieceId: result.moved.id }
      events.push({ type: 'bonus', piece: result.moved, required: !safeBoundary(result.state, true) })
    } else {
      next = finishTurn(result.state, events, probe)
    }
  }
  const prefix = 't' + state.turnSerial + '/' + state.phase + '/'
  return { state: next, events: events.map((event, index) => ({ ...event, id: prefix + index })) }
}

export function transitionKnownLegal(
  state: GameState,
  command: Command,
  face?: DieFace,
  probe?: () => void,
  actor: Side = state.side,
): Transition {
  const plan = command.type === 'move' ? matchPlan(state, command) : undefined
  return apply(state, command, plan, face, actor, probe)
}

export function applyResolvedCommand(
  state: GameState,
  command: Command,
  face?: DieFace,
  actor: Side = state.side,
): Transition {
  const ready = readiness(state, command, actor)
  if ('error' in ready) throw new RuleError(ready.error)
  return apply(state, command, ready.plan, face, actor)
}
