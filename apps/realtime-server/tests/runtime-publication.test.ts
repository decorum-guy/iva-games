import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { StoredMatch } from '../src/store';
import type { NewMatch, Peer } from '../src/runtime';
import type { World } from '@iva-games/forpost/core';

const io = vi.hoisted(() => ({ records: new Map<string, StoredMatch>(), results: [] as unknown[], finish: false,
  release: [] as (() => void)[], admissionBarrier: null as null | Promise<void>,
  barrier: null as null | { wait: Promise<void>; entered: (value: { match: StoredMatch }) => void } }));
vi.mock('../src/worker-rpc', async () => {
  const core = await import('@iva-games/forpost/core');
  return { WorkerRpc: class {
    private worlds = new Map<string, World>();
    private store: boolean;
    constructor(path: URL) { this.store = path.href.endsWith('/store-worker.js'); }
    async call(method: string, ...args: unknown[]) {
      if (this.store) {
        if (method === 'list') return [];
        if (method === 'byStart') return [...io.records.values()].find(match => match.startId === args[0]) ?? null;
        if (method === 'create') { const match = structuredClone(args[0] as StoredMatch); io.records.set(match.matchId, match); return structuredClone(match); }
        if (method === 'checkAdmission') { await io.admissionBarrier; return true; }
        if (method === 'commit') {
          const value = structuredClone(args[0] as { match: StoredMatch; result?: unknown }), barrier = io.barrier;
          io.barrier = null;
          if (barrier) { barrier.entered(value); await barrier.wait; }
          io.records.set(value.match.matchId, value.match); if (value.result) io.results.push(value.result);
        }
        return null;
      }
      if (method === 'drop') { this.worlds.delete(args[0] as string); return; }
      let world: World;
      if (method === 'create') { world = core.createWorld(args[0] as Parameters<typeof core.createWorld>[0]); this.worlds.set(world.matchId, world); }
      else {
        world = this.worlds.get(args[0] as string)!; world.tick++;
        if (io.finish) { world.phase = 'finished'; world.winner = 'A'; world.resultId = world.matchId + ':result'; }
      }
      return { world: core.serializeWorld(world), tick: world.tick, phase: world.phase,
        outcome: world.phase === 'finished' ? { winner: world.winner, resultId: world.resultId, operations: [] } : null,
        views: Object.fromEntries(world.participants.map(person => [person.id, core.viewForPlayer(world, person.id)])), results: [] };
    }
    async stop() {}
  } };
});
import { RealtimeRuntime } from '../src/runtime';

const runtimes: RealtimeRuntime[] = [];
beforeEach(() => {
  io.records.clear(); io.results.length = 0; io.release.length = 0; io.finish = false; io.barrier = null; io.admissionBarrier = null;
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-11-28T00:00:00Z'));
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - Date.parse('2026-11-28T00:00:00Z'));
});
afterEach(async () => {
  for (const release of io.release) release(); await vi.advanceTimersByTimeAsync(0);
  for (const runtime of runtimes) await runtime.close().catch(() => {});
  runtimes.length = 0; vi.restoreAllMocks(); vi.useRealTimers();
});

async function fixture() {
  const runtime = new RealtimeRuntime({ databasePath: '/unused-controlled-writer.sqlite', maxRooms: 4, artifactId: 'test-runtime' });
  runtimes.push(runtime); await runtime.ready;
  const input: NewMatch = { startId: 'start', roomId: 'room', kind: 'practice', ownerHash: 'owner', rulesVersion: 'forpost-0.1', contentVersion: 'forpost-content-1',
    roster: [{ participantId: 'human', playerId: 'player', displayName: 'Human fixture', team: 'A', controller: 'human' },
      { participantId: 'bot', playerId: null, displayName: 'Explicit bot fixture', team: 'B', controller: 'bot' }],
    config: { mapId: 'FP01', teamSize: 1, seed: 5, mode: 'training', participants: [
      { id: 'human', name: 'Human fixture', team: 'A', controller: 'human' }, { id: 'bot', name: 'Explicit bot fixture', team: 'B', controller: 'bot' }] } };
  const match = await runtime.create(input);
  const sent: Record<string, unknown>[] = [];
  const peer: Peer = { id: 'socket-1', claims: { issuer: 'iva-realtime-practice', audience: 'iva-realtime', keyId: 'test-key', ticketId: 'ticket',
    playerId: 'player', participantId: 'human', matchId: match.matchId, roomId: 'room', rosterHash: match.rosterHash, gameId: 'forpost', protocolVersion: 1,
    rulesVersion: match.rulesVersion, contentVersion: match.contentVersion, allowedOrigin: 'http://localhost', permission: 'control',
    issuedAt: Date.now(), expiresAt: Date.now() + 30_000, admissionId: 'admission' },
    send: value => sent.push(structuredClone(value) as Record<string, unknown>), close: vi.fn(), queuedBytes: () => 0,
    rttMs: 0, lastSeen: Date.now(), lastAdmissionCheck: Date.now(), blockedSince: 0 };
  await runtime.connect(peer);
  const resync = () => runtime.message(peer, { type: 'resync', protocolVersion: 1, matchId: match.matchId,
    epoch: match.epoch, controllerGeneration: runtime.get(match.matchId)!.controls.human.generation });
  return { runtime, matchId: match.matchId, peer, sent, resync };
}
function blockedCommit() {
  let release!: () => void, reject!: (error: Error) => void, entered!: (value: { match: StoredMatch }) => void;
  const wait = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  io.release.push(release);
  const started = new Promise<{ match: StoredMatch }>(resolve => { entered = resolve; });
  io.barrier = { wait, entered }; return { release, reject, started };
}

describe('publication waits for durable writer confirmation', () => {
  it('keeps resync, committed sequence and platform outcome on the previous state while the result write is blocked', async () => {
    const { runtime, matchId, sent, resync } = await fixture(); await vi.advanceTimersByTimeAsync(3200);
    const before = runtime.get(matchId)!; io.finish = true; const block = blockedCommit();
    await vi.advanceTimersByTimeAsync(40); const candidate = await block.started;
    expect(candidate.match.tick).toBeGreaterThan(before.tick); expect(candidate.match.phase).toBe('finished');
    expect(runtime.get(matchId)).toEqual(before); expect(runtime.view(matchId, 'player')).toMatchObject({ finished: false, outcome: null });
    expect(io.results).toEqual([]); await resync();
    expect(sent.at(-1)).toMatchObject({ type: 'full', worldTick: before.tick, committedJournalSeq: before.journalSeq,
      phase: 'running', view: { tick: before.tick, resultId: null } });
    block.release(); await vi.advanceTimersByTimeAsync(0);
    expect(runtime.get(matchId)).toMatchObject({ tick: candidate.match.tick, phase: 'finished', outcome: { winner: 'A' } });
    expect(runtime.view(matchId, 'player')).toMatchObject({ finished: true, outcome: { winner: 'A' } });
    expect(io.results).toHaveLength(1);
  });

  it('never promotes a failed result or re-persists its dirty worker world on reconnect, drain or shutdown', async () => {
    const { runtime, matchId, peer, resync } = await fixture(); await vi.advanceTimersByTimeAsync(3200);
    const before = runtime.get(matchId)!; io.finish = true; const block = blockedCommit();
    await vi.advanceTimersByTimeAsync(40); await block.started;
    block.reject(new Error('INJECTED_STORAGE_FAILURE')); await vi.advanceTimersByTimeAsync(0);
    expect(runtime.get(matchId)).toEqual(before); expect(io.records.get(matchId)).toEqual(before); expect(io.results).toEqual([]);
    expect(runtime.view(matchId, 'player')).toMatchObject({ phase: 'failed-recoverable', finished: false, outcome: null });
    await expect(resync()).rejects.toThrow('SERVER_UNAVAILABLE');
    await expect(runtime.connect({ ...peer, id: 'new-socket' })).rejects.toThrow('SERVER_UNAVAILABLE');
    runtime.disconnect(peer); await vi.advanceTimersByTimeAsync(0);
    await expect(runtime.abandon(matchId, 'owner')).rejects.toThrow('SERVER_UNAVAILABLE');
    await expect(runtime.resume()).rejects.toThrow('SERVER_UNAVAILABLE');
    await expect(runtime.drain()).rejects.toThrow('RECOVERY_REQUIRED');
    await expect(runtime.close()).rejects.toThrow('RECOVERY_REQUIRED');
    expect(io.records.get(matchId)).toEqual(before); expect(io.results).toEqual([]);
  });

  it('pauses a silent still-open socket ten seconds after the last signal, without adding a second grace period', async () => {
    const { runtime, matchId } = await fixture(); await vi.advanceTimersByTimeAsync(9990);
    expect(runtime.get(matchId)!.phase).toBe('running');
    await vi.advanceTimersByTimeAsync(50); const paused = runtime.get(matchId)!;
    expect(paused.phase).toBe('paused'); expect(paused.tick).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1000); expect(runtime.get(matchId)!.tick).toBe(paused.tick);
  });

  it('does not let an admission that began before drain unpause the room after the durable drain succeeds', async () => {
    const { runtime, matchId, peer } = await fixture();
    let release!: () => void;
    io.admissionBarrier = new Promise<void>(resolve => { release = resolve; }); io.release.push(release);
    const connecting = runtime.connect({ ...peer, id: 'late-socket', claims: { ...peer.claims, ticketId: 'late-ticket' } });
    await vi.advanceTimersByTimeAsync(0); await runtime.drain();
    const drained = runtime.get(matchId)!; expect(drained.phase).toBe('paused');
    const rejected = expect(connecting).rejects.toThrow('SERVER_BUSY'); release(); await rejected;
    expect(runtime.get(matchId)).toEqual(drained);
  });
});
