import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createGame, editPractice } from '../../src/core';
import type { GameEvent } from '../../src/core';
import { cuesForEvents, playSound, setSoundEnabled, soundForEvents, soundForTransition, stopSounds, unlockSounds } from '../../src/ui/audio';
import { battleFeedback } from '../../src/ui/battleFeedback';

const played: string[] = [];
const active = new Set<MockAudio>();
class MockAudio {
  volume = 0; preload = ''; onended: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(readonly src: string) {}
  play() { played.push(this.src.split('/').at(-1)!); active.add(this); return Promise.resolve(); }
  pause() { active.delete(this); }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('Audio', MockAudio); vi.stubGlobal('AudioContext', undefined);
  played.length = 0; active.clear(); stopSounds(); setSoundEnabled(true);
});
afterEach(() => { stopSounds(); setSoundEnabled(false); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Colossus semantic sound and feedback', () => {
  it.each(['N', 'B', 'R', 'Q'] as const)('keeps the pawn move and a distinct %s promotion cue', promotion => {
    const state = createGame({ mode: 'practice', seed: 1 });
    const pawn = state.units.find(unit => unit.type === 'P')!;
    const before = editPractice(state, { units: [{ id: pawn.id, square: 48 }] });
    const after = applyAction(before, { type: 'move', unitId: pawn.id, to: 56, promotion });
    const cues = cuesForEvents(after.events, { before, after });
    expect(cues.map(cue => cue.name)).toEqual(['move', promotion === 'Q' ? 'promotion-queen' : promotion === 'R' ? 'promotion-rook' : 'promotion-minor']);
    expect(cues[1].delayMs).toBeGreaterThan(cues[0].delayMs);
    expect(battleFeedback(before, after)?.units[pawn.id].promotion).toBe(promotion);
  });

  it('retains armour impact, shell break and victory as ordered cues', () => {
    const before = createGame({ seed: 1 }), after = structuredClone(before);
    after.boss.armor = 0; after.boss.hp = 0;
    const events: GameEvent[] = [{ type: 'attack', armor: before.boss.armor, hp: before.boss.hp }, { type: 'victory' }];
    const cues = cuesForEvents(events, { before, after });
    expect(cues.map(cue => cue.name)).toEqual(['armour', 'armor-break', 'victory']);
    expect(cues[2].delayMs).toBeGreaterThan(cues[1].delayMs);
  });

  it('does not suppress captures or promotion behind a card or defeat', () => {
    const events: GameEvent[] = [{ type: 'card' }, { type: 'damage', amount: 4 }, { type: 'death' }, { type: 'defeat' }];
    expect(cuesForEvents(events).map(cue => cue.name)).toEqual(['card', 'wound', 'capture', 'defeat']);
    expect(cuesForEvents([{ type: 'card' }, { type: 'promote', key: 'Q' }]).map(cue => cue.name)).toContain('promotion-queen');
  });

  it('announces new threats after the response and distinguishes a fully absorbed hit', () => {
    const before = createGame({ seed: 1 }), after = structuredClone(before);
    expect(cuesForEvents([{ type: 'damage', amount: 0, absorbed: 2 }, { type: 'round' }], { after }).map(cue => cue.name)).toEqual(['shield', 'telegraph']);
    after.intent.rest = true;
    expect(cuesForEvents([{ type: 'round' }], { after })).toEqual([]);
  });

  it('aggregates simultaneous casualties and keeps dead figures linked to their actual squares', () => {
    const before = createGame({ seed: 1 }), after = structuredClone(before);
    after.revision++;
    const unit = before.units.find(unit => unit.type === 'P')!;
    after.events = [{ type: 'damage', unitId: unit.id, amount: unit.hp }, { type: 'death', unitId: unit.id, from: unit.square! }];
    expect(battleFeedback(before, after)?.units[unit.id]).toMatchObject({ damage: unit.hp, killed: true, square: unit.square });
    expect(cuesForEvents([...after.events, ...after.events]).filter(cue => cue.name === 'capture')).toHaveLength(1);
  });

  it('is silent on initial room adoption, duplicate snapshots and multi-revision catch-up', () => {
    const before = createGame({ seed: 1 }), after = structuredClone(before);
    after.events = [{ type: 'move', unitId: 'pawn', from: 8, to: 16 }];
    after.revision = 1;
    expect(soundForTransition(null, after, 'room/1')).toEqual([]);
    expect(soundForTransition(before, after, 'room/1')).toHaveLength(1);
    expect(soundForTransition(before, after, 'room/1')).toEqual([]);
    expect(soundForTransition(after, after, 'room/1')).toEqual([]);
    const later = { ...after, revision: 4 };
    expect(soundForTransition(after, later, 'room/4')).toEqual([]);
    expect(played).toEqual(['move.wav']);
  });

  it('cancels delayed cues on mute/exit and bounds concurrent fallback voices', () => {
    soundForEvents([{ type: 'move' }, { type: 'promote', key: 'Q' }]);
    expect(played).toEqual(['move.wav']);
    setSoundEnabled(false); vi.runAllTimers();
    expect(played).toEqual(['move.wav']); expect(active.size).toBe(0);
    setSoundEnabled(true);
    for (let i = 0; i < 12; i++) playSound('move');
    expect(active.size).toBe(4);
    stopSounds(); expect(active.size).toBe(0);
  });

  it('survives unsupported audio and rejected autoplay without breaking gameplay', async () => {
    vi.stubGlobal('Audio', undefined);
    expect(() => { unlockSounds(); playSound('move'); }).not.toThrow();
    vi.stubGlobal('Audio', class extends MockAudio { play() { return Promise.reject(new Error('autoplay')); } });
    expect(() => soundForEvents([{ type: 'move' }])).not.toThrow();
    await Promise.resolve();
  });
});
