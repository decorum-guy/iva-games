import { ABILITIES, PROMOTIONS, LEGACY_RULES_VERSION, energyBankSize, RuleError } from './types'
import type { Action, Command, EnPassant, EventData, GameOutcome, GameState, Piece, Side, Square, Transition } from './types'
import { adjacent, DIAGONAL, file, homeRank, KING_STEPS, KNIGHT_STEPS, offset, opposite, ORTHOGONAL, pawnDirection, pawnStartRank, promotionRank, raidMiddles, rank, squareAt, validSquare } from './geometry'

const reject = (code: ConstructorParameters<typeof RuleError>[0]): never => { throw new RuleError(code) }
const at = (state: Pick<GameState, 'pieces'>, square: Square): Piece | undefined => state.pieces.find(p => p.square === square)
export const pieceAt = at
export const hasAbility = (state: GameState, piece: Piece): boolean => state.energy[piece.side] >= energyBankSize(state.rulesVersion) || state.forms[piece.side]?.pieceId === piece.id

/** Non-recursive geometric attack map. Pins do not suppress attacks. */
export function attackMap(state: GameState, side: Side): ReadonlySet<Square> {
  const attacked = new Set<Square>(), board = new Map(state.pieces.map(p => [p.square, p]))
  for (const piece of state.pieces) {
    if (piece.side !== side) continue
    if (piece.type === 'pawn') {
      for (const dx of [-1, 1]) { const to = offset(piece.square, dx, pawnDirection(side)); if (to) attacked.add(to) }
      continue
    }
    if (piece.type === 'knight') {
      for (const [dx, dy] of KNIGHT_STEPS) {
        const to = offset(piece.square, dx, dy)
        if (!to) continue
        attacked.add(to)
        if (hasAbility(state, piece) && !board.has(to)) for (const middle of raidMiddles(piece.square, to)) attacked.add(middle)
      }
      continue
    }
    if (piece.type === 'king') {
      for (const [dx, dy] of KING_STEPS) { const to = offset(piece.square, dx, dy); if (to) attacked.add(to) }
      continue
    }
    const directions = piece.type === 'rook' ? ORTHOGONAL : piece.type === 'bishop' ? DIAGONAL : KING_STEPS
    for (const [dx, dy] of directions) {
      let blockers = 0
      const limit = piece.type === 'bishop' && hasAbility(state, piece) ? 2 : 1
      for (let step = 1; step < 8; step++) {
        const to = offset(piece.square, dx * step, dy * step)
        if (!to) break
        attacked.add(to)
        if (board.has(to) && ++blockers >= limit) break
      }
    }
  }
  return attacked
}
export function isInCheck(state: GameState, side: Side = state.side): boolean {
  const king = state.pieces.find(p => p.side === side && p.type === 'king')
  return !king || attackMap(state, opposite(side)).has(king.square)
}

export function commandKey(command: Command): string {
  if (command.type === 'resign' || command.type === 'agreeDraw') return command.type
  if (command.type === 'claimDraw') return `${command.type}:${command.reason}`
  return [command.type, command.mode, command.pieceId, command.to ?? '', command.targetId ?? '', command.promotion ?? ''].join(':')
}
export function validateCommand(value: unknown): value is Command {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const c = value as Record<string, unknown>
  if (c.type === 'resign' || c.type === 'agreeDraw') return Object.keys(c).length === 1
  if (c.type === 'claimDraw') return Object.keys(c).length === 2 && (c.reason === 'repetition' || c.reason === 'fiftyMoves')
  if (c.type !== 'move' && c.type !== 'ability') return false
  if (!['normal', 'impulse', 'form', 'activate'].includes(String(c.mode)) || typeof c.pieceId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.pieceId)) return false
  if (Object.keys(c).some(k => !['type', 'mode', 'pieceId', 'to', 'targetId', 'promotion'].includes(k))) return false
  if ('to' in c && !validSquare(c.to)) return false
  if ('targetId' in c && (typeof c.targetId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.targetId))) return false
  if ('promotion' in c && !PROMOTIONS.includes(c.promotion as typeof PROMOTIONS[number])) return false
  return c.type === 'ability' || (validSquare(c.to) && !('targetId' in c))
}

function ray(from: Square, to: Square, diagonal: boolean, straight: boolean): readonly Square[] | null {
  const dx = file(to) - file(from), dy = rank(to) - rank(from)
  if (dx === 0 && dy === 0) return null
  if (!(diagonal && Math.abs(dx) === Math.abs(dy)) && !(straight && (dx === 0 || dy === 0))) return null
  const result: Square[] = []
  for (let step = 1; step < Math.max(Math.abs(dx), Math.abs(dy)); step++) result.push(offset(from, Math.sign(dx) * step, Math.sign(dy) * step)!)
  return result
}
export function checkLayoutKey(state: Pick<GameState, 'pieces'>, side: Side): string {
  const symbols = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' }
  const board = Array<string>(64).fill('--')
  for (const piece of state.pieces) board[rank(piece.square) * 8 + file(piece.square)] = `${piece.side[0]}${symbols[piece.type]}`
  return `${side[0]}:${board.join('')}`
}

/** Resolves exactly one atomic action. It never evaluates mate or repetition. */
export function resolveCandidate(state: GameState, command: Action): Transition {
  if (state.outcome) return reject('finished')
  if (!validateCommand(command) || (command.type !== 'move' && command.type !== 'ability')) return reject('invalidCommand')
  const original = state.pieces.find(p => p.id === command.pieceId)
  if (!original) return reject('invalidCommand')
  if (original.side !== state.side) return reject('wrongSide')
  const side = state.side, enemy = opposite(side), events: EventData[] = []
  const energy = { ...state.energy }, forms = { ...state.forms }
  const rewardedCheckLayouts = { ...state.rewardedCheckLayouts }
  let pieces = state.pieces.slice(), enPassant: EnPassant | null = null, captured = 0, captureValue = 0, movedPawn = false
  const bank = energyBankSize(state.rulesVersion), capacity = bank * 2
  const spent = command.mode === 'impulse' ? bank : command.mode === 'activate' ? capacity : 0
  if (command.type === 'move' && command.mode !== 'normal' && command.mode !== 'activate') return reject('invalidCommand')
  if (command.type === 'ability' && command.mode === 'normal') return reject('invalidCommand')
  if (energy[side] < spent) return reject('energy')
  if (command.mode === 'form' && forms[side]?.pieceId !== original.id) return reject('form')
  if (command.mode === 'impulse' && forms[side]?.pieceId === original.id) return reject('form')
  energy[side] -= spent
  if (command.mode === 'activate') {
    forms[side] = { pieceId: original.id, remainingTurns: 3 }
    events.push({ type: 'form', side, pieceId: original.id, remainingTurns: 3, cause: 'activate' })
  }
  const currentAt = (square: Square) => pieces.find(p => p.square === square)
  const movePiece = (piece: Piece, to: Square, forced: boolean) => {
    if (piece.square === to) return
    pieces = pieces.map(p => p.id === piece.id ? { ...p, square: to, pawnDoubleStepEligible: false, castleEligible: false } : p)
    movedPawn ||= piece.type === 'pawn'
    events.push({ type: 'move', pieceId: piece.id, side: piece.side, pieceType: piece.type, from: piece.square, to, forced })
  }
  const capturePiece = (victim: Piece) => {
    if (victim.type === 'king') return reject('kingCapture')
    if (victim.side === side) return reject('illegalMovement')
    pieces = pieces.filter(p => p.id !== victim.id)
    captured++
    captureValue += state.rulesVersion === LEGACY_RULES_VERSION ? 1 : ({ pawn: 1, knight: 2, bishop: 2, rook: 3, queen: 4, king: 0 } as const)[victim.type]
    events.push({ type: 'capture', victim, pieceId: original.id })
    if (forms[victim.side]?.pieceId === victim.id) {
      forms[victim.side] = null
      events.push({ type: 'form', side: victim.side, pieceId: victim.id, remainingTurns: 0, cause: 'capture' })
    }
  }
  if (command.type === 'move') {
    const to = command.to!
    const dx = file(to) - file(original.square), dy = rank(to) - rank(original.square)
    let victim = currentAt(to)
    if (victim?.side === side) return reject('illegalMovement')
    if (victim?.type === 'king') return reject('kingCapture')
    if (original.type === 'pawn') {
      const direction = pawnDirection(side)
      if (dx === 0 && dy === direction && !victim) { /* ordinary advance */ }
      else if (dx === 0 && dy === direction * 2 && rank(original.square) === pawnStartRank(side) && original.pawnDoubleStepEligible && !victim && !currentAt(offset(original.square, 0, direction)!)) {
        enPassant = { pawnId: original.id, target: offset(original.square, 0, direction)!, availableTo: enemy }
      } else if (Math.abs(dx) === 1 && dy === direction) {
        if (!victim) {
          const ep = state.enPassant
          if (!ep || ep.target !== to || ep.availableTo !== side) return reject('illegalMovement')
          victim = pieces.find(p => p.id === ep.pawnId && p.type === 'pawn' && p.side === enemy && p.square === offset(to, 0, -direction))
          if (!victim) return reject('illegalMovement')
        }
      } else return reject('illegalMovement')
    } else if (original.type === 'knight') {
      if (!((Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1))) return reject('illegalMovement')
    } else if (original.type === 'king') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) { /* ordinary king step */ }
      else if (dy === 0 && Math.abs(dx) === 2 && original.square === squareAt(4, homeRank(side)) && original.castleEligible) {
        const direction = Math.sign(dx), rook = currentAt(squareAt(direction > 0 ? 7 : 0, homeRank(side))!)
        if (!rook || rook.side !== side || rook.type !== 'rook' || !rook.castleEligible) return reject('illegalMovement')
        const path = ray(original.square, rook.square, false, true)!
        if (path.some(s => currentAt(s))) return reject('illegalMovement')
        if (isInCheck(state, side)) return reject('kingSafety')
        const transit = { ...state, pieces: pieces.map(p => p.id === original.id ? { ...p, square: offset(original.square, direction, 0)! } : p) }
        if (isInCheck(transit, side)) return reject('kingSafety')
        movePiece(rook, offset(original.square, direction, 0)!, true)
      } else return reject('illegalMovement')
    } else {
      const path = ray(original.square, to, original.type !== 'rook', original.type !== 'bishop')
      if (!path || path.some(s => currentAt(s))) return reject('illegalMovement')
    }
    if (victim) capturePiece(victim)
    movePiece(original, to, false)
  } else {
    const target = command.targetId ? pieces.find(p => p.id === command.targetId) : undefined
    if (target?.type === 'king') return reject('kingCapture')
    let landing = original.square
    if (original.type === 'pawn') {
      if (command.to || !target || target.side === side) return reject('illegalMovement')
      const dy = pawnDirection(side), front = offset(original.square, 0, dy)
      if (!front || currentAt(front) || ![-1, 1].some(dx => offset(original.square, dx, dy) === target.square)) return reject('illegalMovement')
      movePiece(target, front, true)
    } else if (original.type === 'knight') {
      if (!command.to || currentAt(command.to) || !target || target.side === side || !raidMiddles(original.square, command.to).includes(target.square)) return reject('illegalMovement')
      capturePiece(target)
      landing = command.to
      movePiece(original, landing, false)
    } else if (original.type === 'bishop') {
      if (command.to || !target || target.side === side) return reject('illegalMovement')
      const path = ray(original.square, target.square, true, false)
      if (!path || path.filter(s => currentAt(s)).length !== 1) return reject('illegalMovement')
      capturePiece(target)
      landing = target.square
      movePiece(original, landing, false)
    } else if (original.type === 'rook') {
      if (command.to || !target) return reject('illegalMovement')
      const path = ray(original.square, target.square, false, true)
      if (!path || path.some(s => currentAt(s))) return reject('illegalMovement')
      const beyond = offset(target.square, Math.sign(file(target.square) - file(original.square)), Math.sign(rank(target.square) - rank(original.square)))
      if (!beyond || currentAt(beyond)) return reject('illegalMovement')
      movePiece(target, beyond, true)
      landing = target.square
      movePiece(original, landing, false)
    } else if (original.type === 'queen') {
      if (command.to || !target || target.side !== side) return reject('illegalMovement')
      const path = ray(original.square, target.square, true, true)
      if (!path || path.some(s => currentAt(s))) return reject('illegalMovement')
      movePiece(target, original.square, true)
      landing = target.square
      movePiece(original, landing, false)
    } else {
      if (!command.to || currentAt(command.to) || !adjacent(original.square, command.to) || !target || target.side !== side || target.type === 'pawn' || !adjacent(original.square, target.square)) return reject('illegalMovement')
      movePiece(target, original.square, true)
      landing = command.to
      movePiece(original, landing, false)
    }
    events.push({ type: 'ability', ability: ABILITIES[original.type], pieceId: original.id, mode: command.mode, from: original.square, to: landing, ...(target ? { targetId: target.id } : {}) })
  }
  let ownPromotion = false
  for (const piece of pieces.slice()) {
    if (piece.type !== 'pawn') continue
    if (rank(piece.square) === homeRank(piece.side)) return reject('illegalMovement')
    if (rank(piece.square) !== promotionRank(piece.side)) continue
    const owned = piece.side === side
    if (owned && !command.promotion) return reject('promotionRequired')
    const promotion = owned ? command.promotion! : 'queen'
    pieces = pieces.map(p => p.id === piece.id ? { ...p, type: promotion, castleEligible: false, pawnDoubleStepEligible: false } : p)
    ownPromotion ||= owned
    events.push({ type: 'promotion', pieceId: piece.id, side: piece.side, promotion, square: piece.square, forced: piece.id !== original.id })
  }
  if (command.promotion && !ownPromotion) return reject('invalidPromotion')
  const form = forms[side]
  if (form) {
    const remainingTurns = form.remainingTurns - 1
    forms[side] = remainingTurns ? { ...form, remainingTurns } : null
    events.push({ type: 'form', side, pieceId: form.pieceId, remainingTurns, cause: remainingTurns ? 'tick' : 'expire' })
  }
  const captureEarned = Math.min(capacity - energy[side], captureValue)
  energy[side] += captureEarned
  let candidate: GameState = { ...state, pieces, energy, forms, rewardedCheckLayouts, enPassant }
  let checkEarned = 0
  if (isInCheck(candidate, enemy)) {
    const key = checkLayoutKey(candidate, side)
    if (!rewardedCheckLayouts[side].includes(key)) {
      rewardedCheckLayouts[side] = [...rewardedCheckLayouts[side], key].sort()
      checkEarned = Math.min(2, capacity - energy[side])
      energy[side] += checkEarned
    }
  }
  if (isInCheck(candidate, side)) return reject('kingSafety')
  candidate = { ...candidate, side: enemy, turnSerial: state.turnSerial + 1, quietPly: movedPawn || captured ? 0 : state.quietPly + 1 }
  if (spent || captured || checkEarned) events.push({ type: 'energy', side, before: state.energy[side], after: energy[side], spent, captureEarned, checkEarned })
  return { state: candidate, events: events.map((event, index) => ({ ...event, id: `overdrive:${candidate.turnSerial}:${index}` })) }
}

function* rawActions(state: GameState): Generator<Action> {
  const board = new Map(state.pieces.map(p => [p.square, p]))
  const own = state.pieces.filter(p => p.side === state.side)
  for (const piece of own) {
    const moves: Square[] = []
    if (piece.type === 'pawn') {
      const dy = pawnDirection(piece.side)
      for (const [dx, distance] of [[0, 1], [0, 2], [-1, 1], [1, 1]]) {
        const to = offset(piece.square, dx, dy * distance)
        if (to) moves.push(to)
      }
    } else if (piece.type === 'knight' || piece.type === 'king') {
      for (const [dx, dy] of piece.type === 'knight' ? KNIGHT_STEPS : KING_STEPS) {
        const to = offset(piece.square, dx, dy); if (to) moves.push(to)
      }
      if (piece.type === 'king' && piece.castleEligible) for (const dx of [-2, 2]) { const to = offset(piece.square, dx, 0); if (to) moves.push(to) }
    } else {
      for (const [dx, dy] of piece.type === 'rook' ? ORTHOGONAL : piece.type === 'bishop' ? DIAGONAL : KING_STEPS) {
        for (let distance = 1; distance < 8; distance++) {
          const to = offset(piece.square, dx * distance, dy * distance)
          if (!to) break
          moves.push(to)
          if (board.has(to)) break
        }
      }
    }
    for (const to of moves) {
      yield { type: 'move', mode: 'normal', pieceId: piece.id, to }
      if (state.energy[piece.side] >= energyBankSize(state.rulesVersion) * 2) yield { type: 'move', mode: 'activate', pieceId: piece.id, to }
    }
    const modes: Action['mode'][] = []
    if (state.forms[piece.side]?.pieceId === piece.id) modes.push('form')
    else if (state.energy[piece.side] >= energyBankSize(state.rulesVersion)) modes.push('impulse')
    if (state.energy[piece.side] >= energyBankSize(state.rulesVersion) * 2) modes.push('activate')
    if (!modes.length) continue
    const abilities: Omit<Action, 'mode'>[] = []
    const add = (target: Piece, to?: Square) => abilities.push({ type: 'ability', pieceId: piece.id, targetId: target.id, ...(to ? { to } : {}) })
    if (piece.type === 'pawn') {
      for (const dx of [-1, 1]) { const to = offset(piece.square, dx, pawnDirection(piece.side)), target = to ? board.get(to) : undefined; if (target) add(target) }
    } else if (piece.type === 'knight') {
      for (const [dx, dy] of KNIGHT_STEPS) {
        const to = offset(piece.square, dx, dy)
        if (!to || board.has(to)) continue
        for (const middle of raidMiddles(piece.square, to)) { const target = board.get(middle); if (target) add(target, to) }
      }
    } else if (piece.type === 'king') {
      const guards = own.filter(p => p.type !== 'pawn' && p.id !== piece.id && adjacent(piece.square, p.square))
      for (const [dx, dy] of KING_STEPS) { const to = offset(piece.square, dx, dy); if (to && !board.has(to)) for (const guard of guards) add(guard, to) }
    } else {
      const directions = piece.type === 'bishop' ? DIAGONAL : piece.type === 'rook' ? ORTHOGONAL : KING_STEPS
      for (const [dx, dy] of directions) {
        let blockers = 0
        for (let distance = 1; distance < 8; distance++) {
          const to = offset(piece.square, dx * distance, dy * distance)
          if (!to) break
          const target = board.get(to)
          if (!target) continue
          blockers++
          if (piece.type === 'bishop' ? blockers === 2 : blockers === 1) { add(target); break }
        }
      }
    }
    for (const ability of abilities) for (const mode of modes) yield { ...ability, mode }
  }
}

function* legalActionTransitions(state: GameState, probe?: () => void): Generator<{ action: Action; transition: Transition }> {
  if (state.outcome) return
  for (const command of rawActions(state)) {
    probe?.()
    try { yield { action: command, transition: resolveCandidate(state, command) } }
    catch (error) {
      if (!(error instanceof RuleError)) throw error
      if (error.code !== 'promotionRequired') continue
      for (const promotion of PROMOTIONS) {
        const promoted = { ...command, promotion }
        try { yield { action: promoted, transition: resolveCandidate(state, promoted) } }
        catch (promotionError) { if (!(promotionError instanceof RuleError)) throw promotionError }
      }
    }
  }
}
export function legalActions(state: GameState, probe?: () => void): readonly Action[] { return [...legalActionTransitions(state, probe)].map(x => x.action) }
export function hasLegalAction(state: GameState, probe?: () => void): boolean { return !legalActionTransitions(state, probe).next().done }
export function effectiveEnPassant(state: GameState): Square | null {
  if (!state.enPassant) return null
  for (const piece of state.pieces) {
    if (piece.side !== state.side || piece.type !== 'pawn') continue
    const to = state.enPassant.target
    if (Math.abs(file(piece.square) - file(to)) !== 1 || rank(to) - rank(piece.square) !== pawnDirection(piece.side)) continue
    try { resolveCandidate({ ...state, outcome: null }, { type: 'move', mode: 'normal', pieceId: piece.id, to }); return to }
    catch (error) { if (!(error instanceof RuleError)) throw error }
  }
  return null
}
export function positionKey(state: GameState): string {
  const pieces = state.pieces.slice().sort((a, b) => a.square.localeCompare(b.square)).map(piece => [piece.square, piece.side[0], piece.type, piece.pawnDoubleStepEligible ? 1 : 0, piece.castleEligible ? 1 : 0, state.forms[piece.side]?.pieceId === piece.id ? state.forms[piece.side]!.remainingTurns : 0])
  return JSON.stringify([state.side, pieces, state.energy.white, state.energy.black, effectiveEnPassant(state), state.rewardedCheckLayouts.white.slice().sort(), state.rewardedCheckLayouts.black.slice().sort()])
}
export function legalCommands(state: GameState, probe?: () => void): readonly Command[] {
  if (state.outcome) return []
  const result: Command[] = [...legalActions(state, probe)]
  if ((state.repetition[positionKey(state)] ?? 0) >= 3) result.push({ type: 'claimDraw', reason: 'repetition' })
  if (state.quietPly >= 100) result.push({ type: 'claimDraw', reason: 'fiftyMoves' })
  return result
}
export function evaluateOutcome(state: GameState, probe?: () => void): GameOutcome | null {
  if (state.outcome) return state.outcome
  if (!hasLegalAction(state, probe)) return isInCheck(state) ? { winner: opposite(state.side), reason: 'checkmate' } : { winner: null, reason: 'stalemate' }
  if (state.pieces.length === 2 && state.pieces.every(p => p.type === 'king')) return { winner: null, reason: 'bareKings' }
  if ((state.repetition[positionKey(state)] ?? 0) >= 5) return { winner: null, reason: 'repetition' }
  if (state.quietPly >= 150) return { winner: null, reason: 'seventyFiveMoves' }
  return null
}
function finish(state: GameState, outcome: GameOutcome): Transition {
  return { state: { ...state, outcome }, events: [{ type: 'outcome', outcome, id: `overdrive:${state.turnSerial}:outcome` }] }
}
export function resign(state: GameState, side: Side): Transition {
  if (state.outcome) return reject('finished')
  if (side !== 'white' && side !== 'black') return reject('invalidCommand')
  return finish(state, { reason: 'resignation', winner: opposite(side) })
}
export function agreeDraw(state: GameState): Transition {
  if (state.outcome) return reject('finished')
  return finish(state, { reason: 'agreement', winner: null })
}
export function transition(state: GameState, command: Command, probe?: () => void): Transition {
  if (state.outcome) return reject('finished')
  if (!validateCommand(command)) return reject('invalidCommand')
  if (command.type === 'resign') return resign(state, state.side)
  if (command.type === 'agreeDraw') return agreeDraw(state)
  if (command.type === 'claimDraw') {
    const available = command.reason === 'repetition' ? (state.repetition[positionKey(state)] ?? 0) >= 3 : state.quietPly >= 100
    if (!available) return reject('noDraw')
    return finish(state, { winner: null, reason: command.reason })
  }
  const candidate = resolveCandidate(state, command)
  const key = positionKey(candidate.state)
  let next: GameState = { ...candidate.state, repetition: { ...state.repetition, [key]: (state.repetition[key] ?? 0) + 1 } }
  const outcome = evaluateOutcome(next, probe)
  if (outcome) next = { ...next, outcome }
  const extra: EventData[] = [{ type: 'turn', side: next.side, turnSerial: next.turnSerial, check: isInCheck(next) }, ...(outcome ? [{ type: 'outcome' as const, outcome }] : [])]
  return { state: next, events: [...candidate.events, ...extra.map((event, index) => ({ ...event, id: `overdrive:${next.turnSerial}:${candidate.events.length + index}` }))] }
}
/** The caller may already know legality; state resolution still checks all rules. */
export const transitionKnownLegal = transition
