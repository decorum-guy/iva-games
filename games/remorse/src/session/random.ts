import type { DieFace } from '../core/types';

export function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export function nextDie(seed: number): { face: DieFace; seed: number } {
  let sample: number;
  do {
    seed = (seed + 0x9e3779b9) >>> 0;
    sample = seed;
    sample = Math.imul(sample ^ (sample >>> 16), 0x21f0aaad);
    sample = Math.imul(sample ^ (sample >>> 15), 0x735a2d97);
    sample = (sample ^ (sample >>> 15)) >>> 0;
  } while (sample >= 4_294_967_292);
  return { face: (sample % 6 + 1) as DieFace, seed };
}

export function randomSide(): 'white' | 'black' {
  return newSeed() % 2 === 0 ? 'white' : 'black';
}

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
