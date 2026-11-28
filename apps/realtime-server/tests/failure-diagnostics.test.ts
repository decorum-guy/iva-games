import { describe, expect, it, vi } from 'vitest';
import { RealtimeError } from '@iva-games/realtime-kit';
import { RealtimeEngine } from '../src/engine.js';
import type { MatchFailureObservation } from '../src/engine.js';
import { LocalStorageClient, RealtimeStore } from '../src/storage.js';
import { adapter, claims, request } from './fixture.js';

// Engine failure isolation with the small protocol fixture, not a Tyaga
// gameplay or browser acceptance claim.
async function runningFixture(onFailure?: (observation: MatchFailureObservation) => void) {
  const store = new RealtimeStore(':memory:'), storage = new LocalStorageClient(store);
  const clock = { wall: 1_800_000_000_000, mono: 1000 }, failures: MatchFailureObservation[] = [];
  let stepError: Error | null = null;
  const failingAdapter: typeof adapter = { ...adapter,
    step(world, inputs, context) { if (stepError) throw stepError; adapter.step(world, inputs, context); },
  };
  const engine = new RealtimeEngine({ storage, adapters: [failingAdapter], ownerId: 'failure-diagnostic-fixture', wallNow: () => clock.wall, monoNow: () => clock.mono,
  onMatchFailure: observation => { failures.push(observation); onFailure?.(observation); } });
  const advance = async (milliseconds: number) => {
    for (let elapsed = 0; elapsed < milliseconds;) {
      const step = Math.min(25, milliseconds - elapsed); elapsed += step; clock.wall += step; clock.mono += step; await engine.tick();
    }
  };
  await engine.initialize();
  const { matchId } = await engine.create(adapter.gameId, request());
  await engine.connect(claims(matchId, clock.wall), 'failure-observer'); await advance(3050);
  expect(engine.snapshot('failure-observer').phase).toBe('running');
  return { store, storage, engine, matchId, failures, advance, failStep: (error: Error) => { stepError = error; } };
}

describe('frozen match diagnostics', () => {
  it('records the first coded adapter failure once and keeps the committed recovery evidence', async () => {
    const f = await runningFixture();
    try {
      const before = f.store.recovery(f.matchId), committed = f.store.get(f.matchId).meta.journalSeq;
      f.failStep(new Error('UNKNOWN_BODY')); await f.advance(250);
      expect(f.failures).toHaveLength(1);
      expect(f.failures[0]).toEqual({ event: 'realtime-match-frozen', stage: 'tick', code: 'UNKNOWN_BODY',
        matchId: f.matchId, gameId: 'fixture', runtimeArtifactId: 'fixture-runtime@1',
        worldTick: f.store.get(f.matchId).meta.worldTick, lastCommittedJournalSeq: committed });
      expect(f.engine.metrics.failures).toBe(1);
      expect(f.engine.health()).toMatchObject({ ok: false, failedMatches: 1 });
      expect(() => f.engine.snapshot('failure-observer')).toThrow('RECOVERY_REQUIRED');
      expect(f.store.recovery(f.matchId)).toEqual(before);
    } finally { f.store.close(); }
  });

  it('counts a failed durable commit once when the error also reaches the tick boundary', async () => {
    const f = await runningFixture();
    try {
      const before = f.store.recovery(f.matchId), committed = f.store.get(f.matchId).meta.journalSeq;
      vi.spyOn(f.storage, 'call').mockRejectedValueOnce(new RealtimeError('WRITE_FAILED', 503, { privateInput: 'do-not-log-this' }));
      await f.advance(250);
      expect(f.failures).toHaveLength(1);
      expect(f.failures[0]).toMatchObject({ stage: 'persist', code: 'WRITE_FAILED', lastCommittedJournalSeq: committed });
      expect(f.engine.metrics.failures).toBe(1);
      expect(() => f.engine.snapshot('failure-observer')).toThrow('RECOVERY_REQUIRED');
      expect(f.store.recovery(f.matchId)).toEqual(before);
      expect(JSON.stringify(f.failures)).not.toMatch(/do-not-log-this|privateInput|player1|sessionId/);
    } finally { vi.restoreAllMocks(); f.store.close(); }
  });

  it('redacts arbitrary exception text and remains frozen even if the diagnostic sink fails', async () => {
    const f = await runningFixture(() => { throw new Error('sink unavailable'); });
    try {
      f.failStep(new Error('failed action includes secret-ticket-value'));
      await expect(f.advance(250)).resolves.toBeUndefined();
      expect(f.failures).toHaveLength(1);
      expect(f.failures[0].code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(f.failures)).not.toContain('secret-ticket-value');
      expect(f.engine.metrics.failures).toBe(1);
      expect(() => f.engine.snapshot('failure-observer')).toThrow('RECOVERY_REQUIRED');
    } finally { f.store.close(); }
  });
});
