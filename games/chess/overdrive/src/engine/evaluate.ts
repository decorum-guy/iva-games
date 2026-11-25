import type { Action, Command, GameState, Piece, PieceType, Side } from '../core'
import { attackMap, commandKey, file, hasAbility, isInCheck, KING_STEPS, offset, opposite, pawnDirection, pieceAt, positionKey, rank } from '../core'
export const MATERIAL: Readonly<Record<PieceType, number>> = { pawn: 1, knight: 3.2, bishop: 3.3, rook: 5.1, queen: 9.3, king: 0 }

export function evaluate(state: GameState, perspective: Side): number {
  const attacks = { white: attackMap(state, 'white'), black: attackMap(state, 'black') }
  const score = (side: Side) => {
    const enemy = opposite(side)
    let value = state.energy[side] * .075 + (state.energy[side] >= 5 ? .2 : 0) + (state.energy[side] === 10 ? .12 : 0)
    for (const piece of state.pieces) {
      if (piece.side !== side) continue
      value += MATERIAL[piece.type]
      const centrality = 3.5 - (Math.abs(file(piece.square) - 3.5) + Math.abs(rank(piece.square) - 3.5)) / 2
      if (piece.type !== 'king') value += centrality * (piece.type === 'knight' ? .075 : .026)
      if (piece.type === 'pawn') {
        const advance = side === 'white' ? rank(piece.square) - 1 : 6 - rank(piece.square)
        value += Math.max(0, advance) * .035 + Math.max(0, advance - 3) * .12
      }
      if (hasAbility(state, piece)) {
        // Extra geometry only has strategic value when it opens squares beyond the ordinary map.
        if (piece.type === 'knight' || piece.type === 'bishop') value += .13
        if (state.forms[side]?.pieceId === piece.id) value += .14 * state.forms[side]!.remainingTurns
      }
      if (piece.type !== 'king' && attacks[enemy].has(piece.square)) value -= MATERIAL[piece.type] * (attacks[side].has(piece.square) ? .012 : .045)
    }
    value += attacks[side].size * .006
    const enemyArmy = state.pieces.filter(piece => piece.side === enemy)
    const ownKing = state.pieces.find(piece => piece.side === side && piece.type === 'king')
    const enemyKing = enemyArmy.find(piece => piece.type === 'king')
    // Narrow, rule-independent mating technique. Material alone is flat in KQ/K
    // or KR/K: reward boxing the lone king in and bringing our king closer.
    // Actual legal moves and stalemate/mate still come exclusively from the core.
    if (enemyArmy.length === 1 && ownKing && enemyKing && state.pieces.some(piece => piece.side === side && (piece.type === 'queen' || piece.type === 'rook'))) {
      const edge = Math.max(Math.abs(file(enemyKing.square) - 3.5), Math.abs(rank(enemyKing.square) - 3.5))
      const kingDistance = Math.max(Math.abs(file(ownKing.square) - file(enemyKing.square)), Math.abs(rank(ownKing.square) - rank(enemyKing.square)))
      const boxed = KING_STEPS.filter(([dx, dy]) => {
        const square = offset(enemyKing.square, dx, dy)
        return !square || attacks[side].has(square)
      }).length
      value += edge * .32 + (7 - kingDistance) * .18 + boxed * .09
    }
    if (isInCheck(state, side)) value -= .27
    return value
  }
  const value = score(perspective) - score(opposite(perspective))
  const canClaim = state.quietPly >= 100 || (state.repetition[positionKey(state)] ?? 0) >= 3
  // At the horizon the player to move can still elect an already available draw.
  return canClaim ? state.side === perspective ? Math.max(0, value) : Math.min(0, value) : value
}
function victimFor(state: GameState, command: Action): Piece | undefined {
  if (command.type === 'ability') {
    const attacker = state.pieces.find(p => p.id === command.pieceId)
    return attacker && (attacker.type === 'bishop' || attacker.type === 'knight') ? state.pieces.find(p => p.id === command.targetId) : undefined
  }
  const victim = command.to ? pieceAt(state, command.to) : undefined
  if (victim) return victim
  const piece = state.pieces.find(p => p.id === command.pieceId)
  if (piece?.type === 'pawn' && command.to && command.to === state.enPassant?.target && file(piece.square) !== file(command.to)) return state.pieces.find(p => p.id === state.enPassant?.pawnId)
  return undefined
}
export function orderActions(state: GameState, actions: readonly Command[]) {
  return actions.map(action => {
    if (action.type === 'claimDraw') return { action, priority: -.05 }
    if (action.type !== 'move' && action.type !== 'ability') return { action, priority: -100 }
    const piece = state.pieces.find(p => p.id === action.pieceId)!, victim = victimFor(state, action)
    let priority = victim ? MATERIAL[victim.type] + .08 : 0
    if (action.promotion) priority += MATERIAL[action.promotion] - 1
    if (action.to) {
      priority += (Math.abs(file(piece.square) - 3.5) - Math.abs(file(action.to) - 3.5)) * .02
      if (piece.type === 'pawn') priority += (rank(action.to) - rank(piece.square)) * pawnDirection(piece.side) * .035
    }
    // Resource costs discourage ornamental activation in fallback; searched tactical gains may outweigh it.
    if (action.mode === 'impulse') priority -= .25
    if (action.mode === 'activate') priority -= .42
    if (action.mode === 'form') priority += .03
    return { action, priority }
  }).sort((a, b) => b.priority - a.priority || commandKey(a.action).localeCompare(commandKey(b.action)))
}
