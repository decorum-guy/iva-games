import type { Side, Square } from './types'
export const opposite = (side: Side): Side => side === 'white' ? 'black' : 'white'
export const validSquare = (square: unknown): square is Square => typeof square === 'string' && /^[a-h][1-8]$/.test(square)
export const file = (square: Square): number => square.charCodeAt(0) - 97
export const rank = (square: Square): number => Number(square[1]) - 1
export const squareAt = (x: number, y: number): Square | null => x >= 0 && x < 8 && y >= 0 && y < 8 ? `${String.fromCharCode(97 + x)}${y + 1}` : null
export const offset = (square: Square, dx: number, dy: number): Square | null => squareAt(file(square) + dx, rank(square) + dy)
export const adjacent = (a: Square, b: Square): boolean => Math.max(Math.abs(file(a) - file(b)), Math.abs(rank(a) - rank(b))) === 1
export const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
export const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const
export const KING_STEPS = [...ORTHOGONAL, ...DIAGONAL]
export const KNIGHT_STEPS = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]] as const
export const pawnDirection = (side: Side): number => side === 'white' ? 1 : -1
export const pawnStartRank = (side: Side): number => side === 'white' ? 1 : 6
export const homeRank = (side: Side): number => side === 'white' ? 0 : 7
export const promotionRank = (side: Side): number => side === 'white' ? 7 : 0
export function raidMiddles(from: Square, to: Square): readonly Square[] {
  const dx = file(to) - file(from), dy = rank(to) - rank(from)
  if (Math.abs(dx) === 2 && Math.abs(dy) === 1) return [offset(from, Math.sign(dx), 0)!, offset(from, Math.sign(dx), dy)!]
  if (Math.abs(dx) === 1 && Math.abs(dy) === 2) return [offset(from, 0, Math.sign(dy))!, offset(from, dx, Math.sign(dy))!]
  return []
}
