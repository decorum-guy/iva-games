import { PROMOTIONS, type GameState, type Move, type Piece, type Side, type Square } from './types'

export const SQUARES = Array.from({ length: 64 }, (_, index) =>
  String.fromCharCode(97 + index % 8) + (1 + (index >> 3)),
)

export const fileOf = (square: Square) => square.charCodeAt(0) - 97
export const rankOf = (square: Square) => square.charCodeAt(1) - 49
export const squareIndex = (square: Square) => (rankOf(square) << 3) + fileOf(square)
export const validSquare = (square: unknown): square is Square =>
  typeof square === 'string' && /^[a-h][1-8]$/.test(square)
export const squareAt = (file: number, rank: number): Square | undefined =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8 ? SQUARES[rank * 8 + file] : undefined

export const opposite = (side: Side): Side => side === 'white' ? 'black' : 'white'
export const forward = (side: Side) => side === 'white' ? 1 : -1
export const homeRank = (side: Side) => side === 'white' ? 0 : 7
export const pawnRank = (side: Side) => side === 'white' ? 1 : 6

type Offset = readonly [number, number]
const CARDINAL: readonly Offset[] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const DIAGONAL: readonly Offset[] = [[1, 1], [-1, 1], [1, -1], [-1, -1]]
const NEIGHBORS: readonly Offset[] = [...CARDINAL, ...DIAGONAL]
const KNIGHT: readonly Offset[] = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]

function offsetIndex(index: number, dx: number, dy: number): number {
  const file = (index & 7) + dx
  const rank = (index >> 3) + dy
  return file >= 0 && file < 8 && rank >= 0 && rank < 8 ? (rank << 3) + file : -1
}

function jumps(offsets: readonly Offset[]) {
  return SQUARES.map((_, index) => offsets
    .map(([dx, dy]) => offsetIndex(index, dx, dy))
    .filter(destination => destination >= 0))
}

const KNIGHT_TARGETS = jumps(KNIGHT)
export const NEARBY = jumps(NEIGHBORS)
const RAYS = SQUARES.map((_, index) => NEIGHBORS.map(([dx, dy]) => {
  const ray: number[] = []
  for (let step = 1; step <= 7; step++) {
    const destination = offsetIndex(index, dx * step, dy * step)
    if (destination < 0) break
    ray.push(destination)
  }
  return ray
}))

export function adjacent(a: Square, b: Square): boolean {
  return NEARBY[squareIndex(a)].includes(squareIndex(b))
}

export type Board = readonly (Piece | undefined)[]

export function boardOf(state: Pick<GameState, 'pieces'>): (Piece | undefined)[] {
  const board = new Array<Piece | undefined>(64)
  for (const piece of state.pieces) board[squareIndex(piece.square)] = piece
  return board
}

export function canAttack(piece: Piece) {
  return piece.type !== 'bishop' && piece.affliction !== 'guilt' && piece.affliction !== 'devastated'
}

export function isSquareAttacked(board: Board, square: Square, attacker: Side): boolean {
  const target = squareIndex(square)
  for (const index of NEARBY[target]) {
    const piece = board[index]
    if (piece?.side === attacker && piece.type === 'king') return true
  }
  for (const dx of [-1, 1]) {
    const piece = board[offsetIndex(target, dx, -forward(attacker))]
    if (piece?.side === attacker && piece.type === 'pawn' && canAttack(piece)) return true
  }
  for (const index of KNIGHT_TARGETS[target]) {
    const piece = board[index]
    if (piece?.side === attacker && piece.type === 'knight' && canAttack(piece)) return true
  }
  for (let direction = 0; direction < NEIGHBORS.length; direction++) {
    for (const index of RAYS[target][direction]) {
      const piece = board[index]
      if (!piece) continue
      if (piece.side === attacker && canAttack(piece) &&
          (piece.type === 'queen' || (direction < CARDINAL.length && piece.type === 'rook'))) return true
      break
    }
  }
  return false
}

export function isInCheck(state: GameState, side = state.side, board = boardOf(state)): boolean {
  const king = state.pieces.find(piece => piece.side === side && piece.type === 'king')
  return !king || isSquareAttacked(board, king.square, opposite(side))
}

export interface MovePlan {
  readonly command: Move
  readonly piece: Piece
  readonly victim?: Piece
  readonly enPassant?: true
  readonly rook?: { readonly piece: Piece; readonly to: Square }
}

function enPassantVictim(state: GameState, piece: Piece, target: Square, board: Board) {
  if (state.enPassant?.availableTo !== piece.side || state.enPassant.target !== target) return undefined
  const victim = board[squareIndex(target) - forward(piece.side) * 8]
  if (victim?.id === state.enPassant.pawnId && victim.type === 'pawn' && victim.side !== piece.side) return victim
  return undefined
}

function castleRook(king: Piece, queenside: boolean, board: Board): MovePlan['rook'] {
  if (!king.castleEligible) return undefined
  const home = homeRank(king.side)
  const base = home * 8
  if (king.square !== SQUARES[base + 4]) return undefined
  const rook = board[base + (queenside ? 0 : 7)]
  if (rook?.side !== king.side || rook.type !== 'rook' || !rook.castleEligible ||
    rook.affliction === 'devastated' || rook.affliction === 'bloodlust') return undefined
  const emptyFiles = queenside ? [1, 2, 3] : [5, 6]
  if (emptyFiles.some(file => board[base + file])) return undefined
  const enemy = opposite(king.side)
  if (isSquareAttacked(board, king.square, enemy)) return undefined
  const kingCleared = board.slice()
  kingCleared[base + 4] = undefined
  const kingPath = queenside ? [3, 2] : [5, 6]
  if (kingPath.some(file => isSquareAttacked(kingCleared, SQUARES[base + file], enemy))) return undefined
  return { piece: rook, to: SQUARES[base + kingPath[0]] }
}

type VisitTarget = (to: number, victim?: Piece, enPassant?: true, rook?: MovePlan['rook']) => void

function visitTargets(state: GameState, piece: Piece, board: Board, visit: VisitTarget, castling: boolean) {
  if (piece.affliction === 'devastated') return
  const index = squareIndex(piece.square)
  const bloodlust = piece.affliction === 'bloodlust'
  const canCapture = canAttack(piece)
  const canTake = (victim: Piece) => canCapture && victim.type !== 'king' && (bloodlust || victim.side !== piece.side)
  const normalTarget = (destination: number) => {
    const victim = board[destination]
    if (victim ? canTake(victim) : !bloodlust) visit(destination, victim)
  }

  switch (piece.type) {
    case 'pawn': {
      const dy = forward(piece.side)
      const step = offsetIndex(index, 0, dy)
      if (!bloodlust && step >= 0 && !board[step]) {
        visit(step)
        const double = offsetIndex(index, 0, dy * 2)
        if (piece.pawnDoubleStepEligible && rankOf(piece.square) === pawnRank(piece.side) && !board[double]) visit(double)
      }
      if (!canCapture) break
      for (const dx of [-1, 1]) {
        const destination = offsetIndex(index, dx, dy)
        if (destination < 0) continue
        const victim = board[destination]
        if (victim) {
          if (canTake(victim)) visit(destination, victim)
        } else {
          const passing = enPassantVictim(state, piece, SQUARES[destination], board)
          if (passing) visit(destination, passing, true)
        }
      }
      break
    }
    case 'knight':
      for (const destination of KNIGHT_TARGETS[index]) normalTarget(destination)
      break
    case 'king':
      for (const destination of NEARBY[index]) normalTarget(destination)
      if (castling) {
        for (const queenside of [true, false]) {
          const rook = castleRook(piece, queenside, board)
          if (rook) visit(index + (queenside ? -2 : 2), undefined, undefined, rook)
        }
      }
      break
    default: {
      const firstRay = piece.type === 'bishop' ? CARDINAL.length : 0
      const lastRay = piece.type === 'rook' ? CARDINAL.length : NEIGHBORS.length
      for (let direction = firstRay; direction < lastRay; direction++) {
        for (const destination of RAYS[index][direction]) {
          const victim = board[destination]
          if (victim) {
            if (canTake(victim)) visit(destination, victim)
            break
          }
          if (!bloodlust) visit(destination)
        }
      }
    }
  }
}

export function movePlans(state: GameState, piece: Piece, board: Board): MovePlan[] {
  const plans: MovePlan[] = []
  const promotionRank = homeRank(opposite(piece.side))
  visitTargets(state, piece, board, (destination, victim, enPassant, rook) => {
    const to = SQUARES[destination]
    if (piece.type === 'pawn' && (destination >> 3) === promotionRank) {
      for (const promotion of PROMOTIONS) {
        plans.push({ command: { type: 'move', from: piece.square, to, promotion }, piece, victim })
      }
    } else {
      plans.push({ command: { type: 'move', from: piece.square, to }, piece, victim, enPassant, rook })
    }
  }, true)
  return plans
}

export function mobility(state: GameState, piece: Piece, board: Board = boardOf(state)): number {
  let count = 0
  visitTargets(state, piece, board, () => { count++ }, false)
  return count
}
