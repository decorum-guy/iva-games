import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, Move } from '../../src/core';
import { createMatch } from '../../src/session/match';
import type { GameSession } from '../../src/session/match';
import { restoreMatch } from '../../src/session/save';
import { openGameStore } from '../../src/storage/database';
import type { GameStore } from '../../src/storage/database';

const TIMEOUT = 40;
const stores: GameStore[] = [];
const nativeConnections = new Set<IDBDatabase>();
const blockers = new Set<() => Promise<void>>();
const nativeOpen = indexedDB.open.bind(indexedDB);
const hotseat = { mode: 'hotseat', human: null, level: null, provenance: 'standard' } as const;

beforeEach(() => {
  // The application deadline is controlled; IndexedDB's request and transaction
  // tasks still run normally through fake-indexeddb's real setImmediate queue.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
    const request = nativeOpen(name, version);
    request.addEventListener('success', () => nativeConnections.add(request.result));
    return request;
  });
});

afterEach(async () => {
  for (const release of blockers) await release();
  blockers.clear();
  for (const store of stores.splice(0)) store.close();
  for (const database of nativeConnections) database.close();
  nativeConnections.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function databaseName() { return `remorse-storage-recovery-${crypto.randomUUID()}`; }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

async function open(name: string, onUnavailable = vi.fn()) {
  const store = await openGameStore(name, { timeoutMs: TIMEOUT, onUnavailable });
  stores.push(store);
  return store;
}

/** A second tab with an active write transaction, not a mocked store promise. */
async function holdWriteLock(name: string) {
  const database = await requestResult(indexedDB.open(name));
  const transaction = database.transaction(['profiles', 'matches', 'ratingLedger'], 'readwrite');
  const finished = new Promise<void>(resolve => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => resolve(), { once: true });
  });
  let keepAlive = true;
  await new Promise<void>((resolve, reject) => {
    const ping = () => {
      const request = transaction.objectStore('matches').get('__test_lock__');
      request.addEventListener('success', () => {
        resolve();
        if (keepAlive) ping();
      }, { once: true });
      request.addEventListener('error', () => { if (keepAlive) reject(request.error); }, { once: true });
    };
    ping();
  });
  const release = async () => {
    keepAlive = false;
    try { transaction.abort(); } catch { /* Already released by an earlier cleanup. */ }
    await finished;
    database.close();
  };
  blockers.add(release);
  return release;
}

function move(from: string, to: string): Move { return { type: 'move', from, to }; }

function apply(game: GameSession, command: Command) {
  const source = game.record.config.human === game.state.side ? 'human' : 'bot';
  return game.submit(game.envelope(command), source);
}

describe('bounded storage recovery', () => {
  it('times out a read queued behind another connection without losing saved data', async () => {
    const name = databaseName();
    const unavailable = vi.fn();
    const store = await open(name, unavailable);
    const game = createMatch(hotseat, { seed: 17 });
    await store.addPractice(game);
    const release = await holdWriteLock(name);

    const rejected = expect(store.overview()).rejects.toMatchObject({ code: 'storageTimeout' });
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await rejected;
    expect(unavailable).toHaveBeenCalledExactlyOnceWith('storageTimeout');
    await expect(store.getMatch(game.record.id)).rejects.toMatchObject({ code: 'storageClosed' });

    await release();
    const recovered = await open(name);
    expect(await recovered.getMatch(game.record.id)).toEqual(game.record);
    expect((await recovered.overview()).ledger).toEqual([]);
  });

  it('aborts a queued rated result and settles its retry exactly once after recovery', async () => {
    const name = databaseName();
    const unavailable = vi.fn();
    const store = await open(name, unavailable);
    let prior = await store.reserveRated('white', 4);
    await expect(store.savePracticeOnReconnect(prior)).rejects.toMatchObject({ code: 'ratedLocked' });
    for (const command of [move('f2', 'f3'), move('e7', 'e5'), move('g2', 'g4')]) {
      const next = apply(prior, command);
      await store.commit(prior, next);
      prior = next;
    }
    const terminal = apply(prior, move('d8', 'h4'));
    expect(terminal.state.outcome).toEqual({ reason: 'checkmate', winner: 'black' });
    const release = await holdWriteLock(name);

    const rejected = expect(store.commit(prior, terminal)).rejects.toMatchObject({ code: 'storageTimeout' });
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await rejected;
    expect(unavailable).toHaveBeenCalledExactlyOnceWith('storageTimeout');
    await release();

    const recovered = await open(name);
    const beforeRetry = await recovered.overview();
    expect(beforeRetry.matches).toContainEqual(prior.record);
    expect(beforeRetry.profile).toMatchObject({ rating: 1000, losses: 0, ratedId: prior.record.id });
    expect(beforeRetry.ledger).toHaveLength(0);

    const other = await open(name);
    const restored = restoreMatch(await recovered.getMatch(prior.record.id));
    const duplicate = restoreMatch(await other.getMatch(prior.record.id));
    const results = await Promise.all([
      recovered.commit(restored, terminal),
      other.commit(duplicate, terminal),
    ]);
    expect(results[0]).toMatchObject({ before: 1000, after: 984, score: 0 });
    expect(results[1]).toEqual(results[0]);
    const finished = await recovered.overview();
    expect(finished.profile).toMatchObject({ rating: 984, losses: 1, ratedId: null });
    expect(finished.ledger).toHaveLength(1);
    expect(finished.matches).toContainEqual(terminal.record);
  });

  it('closes a connection whose open succeeds only after the caller timed out', async () => {
    const name = databaseName();
    const initial = await open(name);
    initial.close();
    const held = await requestResult(indexedDB.open(name));
    // This unique test database is disposable. Deletion queues the following
    // open request, allowing the real API's uncancellable-open case to occur.
    const deleting = indexedDB.deleteDatabase(name);
    const deletion = requestResult(deleting);
    await new Promise<void>(resolve => deleting.addEventListener('blocked', () => resolve(), { once: true }));

    const unavailable = vi.fn();
    const rejected = expect(openGameStore(name, { timeoutMs: TIMEOUT, onUnavailable: unavailable }))
      .rejects.toMatchObject({ code: 'storageTimeout' });
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await rejected;
    held.close();
    await deletion;

    // This delete is queued after the abandoned open. If its late connection
    // leaks, this request will be blocked instead of completing.
    const deletingAgain = indexedDB.deleteDatabase(name);
    const completed = requestResult(deletingAgain);
    const blocked = new Promise<never>((_, reject) => {
      deletingAgain.addEventListener('blocked', () => reject(new Error('Late connection remained open')), { once: true });
    });
    await Promise.race([completed, blocked]);
    expect(unavailable).toHaveBeenCalledExactlyOnceWith('storageTimeout');
  });

  it('reports unexpected connection termination and reopens the saved checkpoint', async () => {
    const name = databaseName();
    const unavailable = vi.fn();
    const store = await open(name, unavailable);
    const checkpoint = { lesson: 3, position: 1, marker: 'unchanged' };
    await store.putLearning(checkpoint);
    const native = [...nativeConnections].find(database => database.name === name);
    if (!native) throw new Error('Opened connection was not observed');
    const closed = new Promise<void>(resolve => native.addEventListener('close', () => resolve(), { once: true }));
    // fake-indexeddb's declaration incorrectly names the constructor type here;
    // its force-close utility accepts the actual database instance.
    forceCloseDatabase(native as unknown as Parameters<typeof forceCloseDatabase>[0]);
    await closed;

    expect(unavailable).toHaveBeenCalledExactlyOnceWith('storageClosed');
    await expect(store.getLearning()).rejects.toMatchObject({ code: 'storageClosed' });
    const recovered = await open(name);
    expect(await recovered.getLearning()).toEqual(checkpoint);
  });

  it('contains a synchronous clone failure without a later timeout or poisoned connection', async () => {
    const unavailable = vi.fn();
    const store = await open(databaseName(), unavailable);
    await expect(store.putLearning({ cannotClone: () => true })).rejects.toMatchObject({ name: 'DataCloneError' });
    await vi.advanceTimersByTimeAsync(TIMEOUT * 2);
    expect(unavailable).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    await store.putLearning({ saved: true });
    expect(await store.getLearning()).toEqual({ saved: true });
  });
});
