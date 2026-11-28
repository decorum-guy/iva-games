import { BOSSES } from './data';
import type { Boss, GameState, Unit } from './types';

export const DIRECTIONS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]] as const;
export const ORTHOGONAL = [DIRECTIONS[0], DIRECTIONS[2], DIRECTIONS[4], DIRECTIONS[6]];
export const DIAGONAL = [DIRECTIONS[1], DIRECTIONS[3], DIRECTIONS[5], DIRECTIONS[7]];
export const KNIGHT_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
export const file = (square: number) => square % 8;
export const rank = (square: number) => Math.floor(square / 8);
export const isSquare = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 64;
export const squareName = (square: number) => isSquare(square) ? String.fromCharCode(97 + file(square)) + (rank(square) + 1) : '?';
export function squareFromName(name: string): number {
  return /^[a-h][1-8]$/.test(name) ? name.charCodeAt(0) - 97 + (Number(name[1]) - 1) * 8 : -1;
}
export function shift(square: number, dx: number, dy: number): number | null {
  const x = file(square) + dx, y = rank(square) + dy;
  return x >= 0 && x < 8 && y >= 0 && y < 8 ? x + y * 8 : null;
}
export const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
export function bossCells(boss: Pick<Boss, 'id' | 'anchor'>): number[] {
  const { width, height } = BOSSES[boss.id];
  if (!isSquare(boss.anchor) || file(boss.anchor) + width > 8 || rank(boss.anchor) + height > 8) return [];
  return Array.from({ length: width * height }, (_, i) => boss.anchor + i % width + Math.floor(i / width) * 8);
}
export const chebyshev = (a: number, b: number) => Math.max(Math.abs(file(a) - file(b)), Math.abs(rank(a) - rank(b)));
export const bodyDistance = (boss: Pick<Boss, 'id' | 'anchor'>, square: number) => Math.min(...bossCells(boss).map(cell => chebyshev(cell, square)));
export const bodyRing = (boss: Pick<Boss, 'id' | 'anchor'>, distance = 1) => Array.from({ length: 64 }, (_, s) => s).filter(s => bodyDistance(boss, s) === distance);
export function ray(from: number, direction: readonly number[], maximum = 8): number[] {
  const result: number[] = [];
  for (let n = 1; n <= maximum; n++) {
    const s = shift(from, direction[0] * n, direction[1] * n);
    if (s === null) break;
    result.push(s);
  }
  return result;
}
export const knightSquares = (from: number) => KNIGHT_OFFSETS.map(([x, y]) => shift(from, x, y)).filter((v): v is number => v !== null);
export const unitAt = (state: Pick<GameState, 'units'>, square: number): Unit | undefined => state.units.find(u => u.hp > 0 && u.square === square);
export const isFree = (state: Pick<GameState, 'units' | 'boss'>, square: number, excludingId?: string) => isSquare(square) && !bossCells(state.boss).includes(square) && !state.units.some(u => u.hp > 0 && u.square === square && u.id !== excludingId);
export function frontRays(boss: Pick<Boss, 'id' | 'anchor'>, direction: readonly number[]): number[][] {
  const cells = bossCells(boss);
  return cells.filter(s => {
    const next = shift(s, direction[0], direction[1]);
    return next === null || !cells.includes(next);
  }).map(s => ray(s, direction)).filter(r => r.length);
}
export function allLines(kind: 'file' | 'rank' | 'diagonal'): number[][] {
  if (kind === 'file') return Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, y) => x + y * 8));
  if (kind === 'rank') return Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => x + y * 8));
  const lines = new Map<string, number[]>();
  for (let s = 0; s < 64; s++) for (const d of [[1, 1], [1, -1]]) {
    if (shift(s, -d[0], -d[1]) !== null) continue;
    const line = unique([s, ...ray(s, d)]);
    if (line.length >= 2) lines.set(line.join(','), line);
  }
  return [...lines.values()];
}
export function hashSeed(seed: number | string): number {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let x = seed || 0x9e3779b9;
  for (let i = result.length - 1; i > 0; i--) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const j = (x >>> 0) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
