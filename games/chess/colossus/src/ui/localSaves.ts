import { DIFFICULTIES, HUNT_BOSSES, restoreGame, validateDeck } from '../core';
import type { CreateOptions, GameState } from '../core';

export const SAVE = 'colossus.save.v1';
export const PRACTICE = 'colossus.practice.v1';
type Slot = typeof SAVE | typeof PRACTICE;

export interface SavedRun { state: GameState; options: CreateOptions; attemptId: string }
export interface SaveNotice { damaged: boolean; archived: boolean }

// Each slot keeps its current save key and stores recovery copies separately.
const archiveKey = (slot: Slot) => slot + '.recovery';
const knownRuns = new Map<Slot, string>();

function optionsAreValid(options: CreateOptions): boolean {
  return (options.boss === undefined || HUNT_BOSSES.includes(options.boss))
    && (options.difficulty === undefined || Object.hasOwn(DIFFICULTIES, options.difficulty))
    && (options.mode === undefined || ['hunt', 'campaign', 'practice'].includes(options.mode))
    && (options.deck === undefined || validateDeck(options.deck).length === 0)
    && (options.coop === undefined || typeof options.coop === 'boolean')
    && (options.bossCards === undefined || typeof options.bossCards === 'boolean')
    && (options.seed === undefined || typeof options.seed === 'string' || Number.isFinite(options.seed))
    && (options.roundLimit === undefined || options.roundLimit === null
      || Number.isInteger(options.roundLimit) && options.roundLimit >= 1 && options.roundLimit <= 1000);
}

function decodeRun(slot: Slot, raw: string): SavedRun | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SavedRun> | null;
    if (!parsed || typeof parsed.attemptId !== 'string' || !parsed.options
      || typeof parsed.options !== 'object' || Array.isArray(parsed.options) || !optionsAreValid(parsed.options)) return null;
    const state = restoreGame(parsed.state);
    if (!state.secret || state.mode === 'tutorial' || (state.mode === 'practice') !== (slot === PRACTICE)) return null;
    return { state, options: parsed.options, attemptId: parsed.attemptId };
  } catch { return null; }
}

function readArchive(slot: Slot): string[] {
  const raw = localStorage.getItem(archiveKey(slot));
  if (raw === null) return [];
  try {
    const entries: unknown = JSON.parse(raw);
    if (Array.isArray(entries) && entries.every(entry => typeof entry === 'string')) return entries;
  } catch { /* Preserve the archive itself if it was damaged. */ }
  return [raw];
}

export function openLocalRun(slot: Slot): { saved: SavedRun | null; notice: SaveNotice } {
  try {
    const raw = localStorage.getItem(slot);
    const saved = raw === null ? null : decodeRun(slot, raw);
    if (saved && raw !== null) knownRuns.set(slot, raw);
    return { saved, notice: { damaged: raw !== null && !saved, archived: readArchive(slot).length > 0 } };
  } catch { return { saved: null, notice: { damaged: false, archived: false } }; }
}

/** Archive the original bytes first. A storage failure leaves the old slot intact. */
export function saveLocalRun(slot: Slot, save: SavedRun): boolean {
  const raw = JSON.stringify(save), previous = localStorage.getItem(slot);
  if (raw === previous) return false;
  const damaged = previous !== null && previous !== knownRuns.get(slot) && !decodeRun(slot, previous);
  if (damaged) {
    const copies = readArchive(slot);
    if (!copies.includes(previous)) localStorage.setItem(archiveKey(slot), JSON.stringify([...copies, previous]));
  }
  localStorage.setItem(slot, raw);
  knownRuns.set(slot, raw);
  return damaged;
}

export function downloadLocalRecovery(slot: Slot): boolean {
  const copies = readArchive(slot);
  const raw = localStorage.getItem(slot);
  if (raw !== null && !decodeRun(slot, raw) && !copies.includes(raw)) copies.push(raw);
  if (!copies.length) return false;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ slot, copies }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = slot + '-recovery.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
