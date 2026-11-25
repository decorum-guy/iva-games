import { boardOf, fileOf, isSquareAttacked, mobility, opposite, rankOf, squareIndex } from '../core'
import type { Command, GameState, Piece, PieceType, Side, Square } from '../core/types'

const VALUES: Record<PieceType, number> = {
  pawn: 1, knight: 3.15, bishop: 2.65, rook: 5.05, queen: 9.1, king: 0,
}

function material(piece: Piece, state: GameState): number {
  const base = VALUES[piece.type]
  switch (piece.affliction) {
    case 'guilt':
      if (piece.cureArmedAt !== null) return base * 0.87
      return base * (piece.type === 'bishop' ? 0.95 : piece.shameArmedAt === null ? 0.55 : 0.47)
    case 'devastated': {
      if (piece.cureArmedAt !== null) return base * 0.72
      if (piece.shameArmedAt !== null) return base * -0.32
      const remaining = Math.max(0, (piece.devastationDue ?? state.turnSerial) - state.turnSerial)
      return base * (piece.type === 'bishop' ? 0.4 + remaining * 0.055 : 0.1 + remaining * 0.045)
    }
    case 'berserk':
      return base * 1.34
    case 'bloodlust':
      return base * 0.74
    case 'neutral':
      return base * (piece.shameArmedAt === null ? 1 : 0.86)
  }
}

function center(square: Square): number {
  return 7 - Math.abs(fileOf(square) - 3.5) - Math.abs(rankOf(square) - 3.5)
}

export function evaluate(state: GameState, perspective: Side): number {
  const board = boardOf(state)
  const checkPenalty = 0.34
  let whiteScore = 0
  for (const piece of state.pieces) {
    const relativeRank = piece.side === 'white' ? rankOf(piece.square) : 7 - rankOf(piece.square)
    let score = material(piece, state)
    if (piece.type === 'king') {
      if (piece.side === state.side && isSquareAttacked(board, piece.square, opposite(piece.side))) score -= checkPenalty
      if (relativeRank === 0 && ['c', 'g'].includes(piece.square[0])) score += 0.19
    } else {
      const moves = mobility(state, piece, board)
      const active = piece.affliction !== 'devastated'
      if (active) {
        score += center(piece.square) * (piece.type === 'pawn' || piece.type === 'knight' ? 0.055 : 0.027)
        score += moves * (piece.affliction === 'bloodlust' ? 0.082 : 0.022)
        if (piece.type === 'pawn') score += relativeRank * (relativeRank > 4 ? 0.12 : 0.033)
      }
      if (piece.affliction === 'bloodlust' && moves > 0) score += Math.min(0.42, moves * 0.083)
      if (piece.affliction === 'neutral' && piece.captureReaction === 'unaffected') score += VALUES[piece.type] * 0.028
    }
    whiteScore += piece.side === 'white' ? score : -score
  }
  return perspective === 'white' ? whiteScore : -whiteScore
}

export function orderCommands(state: GameState, commands: readonly Command[]) {
  const board = boardOf(state)
  const ordered = commands.map(command => {
    if (command.type === 'claimRepetitionDraw') return { command, priority: -evaluate(state, state.side) }
    if (command.type !== 'move') return { command, priority: 0 }
    const mover = board[squareIndex(command.from)]
    const victim = board[squareIndex(command.to)] ??
      (mover?.type === 'pawn' && state.enPassant?.target === command.to &&
        fileOf(command.from) !== fileOf(command.to)
        ? state.pieces.find(piece => piece.id === state.enPassant?.pawnId)
        : undefined)
    let priority = (center(command.to) - center(command.from)) * 0.056
    if (mover?.type === 'pawn' && !victim) priority += Math.abs(rankOf(command.to) - rankOf(command.from)) * 0.032
    if (victim) {
      priority += material(victim, state) * (victim.side === state.side ? -1 : 1)
      if (victim.type === 'bishop' && mover && mover.type !== 'king' &&
        mover.affliction !== 'berserk' && mover.affliction !== 'bloodlust') {
        priority -= VALUES[mover.type] * 0.6
      }
    }
    if (command.promotion) priority += VALUES[command.promotion] - VALUES.pawn
    return { command, priority }
  })
  return ordered.sort((a, b) => b.priority - a.priority || compareCommands(a.command, b.command))
}

function commandKey(command: Command): string {
  return command.type === 'move' ? `${command.from}${command.to}${command.promotion ?? ''}` : command.type
}

export function compareCommands(left: Command, right: Command): number {
  const a = commandKey(left)
  const b = commandKey(right)
  return a === b ? 0 : a < b ? -1 : 1
}
