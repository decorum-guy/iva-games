import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertCheckpointBudget, CHECKPOINT_STALE_MS, WAL_LIMIT_BYTES, WalCheckpointer, walBytes } from '../src/checkpoint';
import type { CheckpointStatus } from '../src/checkpoint';
import { RealtimeStore } from '../src/store';
import { writerFixture } from '../scripts/writer-fixture';

const directories: string[] = [], connections: Database.Database[] = [], checkpointers: WalCheckpointer[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'forpost-wal-')); directories.push(directory);
  const path = join(directory, 'test.sqlite'), store = new RealtimeStore(path, { separateCheckpoint: true });
  connections.push(store.db); return { path, store };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const checkpoint of checkpointers.splice(0)) checkpoint.close();
  for (const db of connections.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
describe('separate bounded WAL checkpoint', () => {
  it('preserves FULL durability and committed records while checkpointing on a second connection', () => {
    const { store, path } = fixture();
    expect(store.db.pragma('synchronous', { simple: true })).toBe(2);
    expect(store.db.pragma('wal_autocheckpoint', { simple: true })).toBe(0);
    store.enqueueStart({ startId: 'first', hostId: 'host', fingerprint: 'frozen', requestJson: '{}' });
    const checkpoint = new WalCheckpointer(path); checkpointers.push(checkpoint);
    const status = checkpoint.poll(true);
    expect(status.failures).toBe(0); expect(status.runs).toBe(1);
    expect(status.checkpointedFrames).toBe(status.logFrames);
    expect(status.pageSize).toBeGreaterThan(0); expect(status.walBytes).toBeLessThan(WAL_LIMIT_BYTES);
    expect(() => assertCheckpointBudget(status, path)).not.toThrow();
    expect(store.starts()[0]).toMatchObject({ startId: 'first', fingerprint: 'frozen' });
  });
  it('does not wait for a pinned reader and resumes progress after that reader leaves', () => {
    const { store, path } = fixture(), reader = new Database(path, { readonly: true }); connections.push(reader);
    const checkpoint = new WalCheckpointer(path); checkpointers.push(checkpoint); checkpoint.poll(true);
    reader.exec('BEGIN'); reader.prepare('SELECT * FROM rt_start_queue').all();
    store.enqueueStart({ startId: 'new', hostId: 'host', fingerprint: 'frozen', requestJson: '{}' });
    const blocked = checkpoint.poll(true);
    expect(blocked.failures).toBe(0); expect(blocked.checkpointedFrames).toBeLessThan(blocked.logFrames);
    expect(reader.prepare('SELECT count(*) AS count FROM rt_start_queue').get()).toEqual({ count: 0 });
    expect(store.starts()).toHaveLength(1);
    reader.exec('ROLLBACK'); const complete = checkpoint.poll(true);
    expect(complete.checkpointedFrames).toBe(complete.logFrames);
  });
  it('reclaims a fully checkpointed native WAL after a pinned reader leaves without losing committed worlds', () => {
    const { store, path } = fixture(), { match, leaseOwner } = writerFixture({ teamSize: 1, advanceTicks: 0, temporaryBot: false });
    store.create(match, leaseOwner);
    // A native SQLite payload makes the file exceed the real hard guard. It is
    // a storage fixture, not a larger game world or manually resized WAL file.
    store.db.exec('CREATE TABLE qa_checkpoint_payload (payload BLOB NOT NULL)');
    const checkpoint = new WalCheckpointer(path); checkpointers.push(checkpoint);
    const initial = checkpoint.poll(true);
    const reader = new Database(path, { readonly: true }); connections.push(reader);
    reader.exec('BEGIN'); reader.prepare('SELECT world_hash FROM rt_matches').all();
    expect(() => assertCheckpointBudget(initial, path)).not.toThrow();
    store.db.prepare('INSERT INTO qa_checkpoint_payload VALUES (zeroblob(?))').run(WAL_LIMIT_BYTES);
    const blocked = checkpoint.poll(true);
    expect(blocked.checkpointedFrames).toBeLessThan(blocked.logFrames);
    expect(() => assertCheckpointBudget(blocked, path)).toThrow('CHECKPOINT_WAL_LIMIT');
    reader.exec('ROLLBACK');
    const reclaimed = checkpoint.poll(true);
    expect(() => assertCheckpointBudget(reclaimed, path)).not.toThrow();
    expect(walBytes(path)).toBe(0);
    expect(reclaimed).toMatchObject({ logFrames: 0, checkpointedFrames: 0, failures: 0, busy: 0, reclaimAttempts: 1, reclaimBusy: 0 });
    expect(store.status()).toMatchObject({ integrity: 'ok', synchronous: 2, journalMode: 'wal' });
    expect(store.db.pragma('wal_autocheckpoint', { simple: true })).toBe(0);
    expect(store.db.pragma('journal_size_limit', { simple: true })).toBe(16 * 1024 * 1024);
    expect(store.get(match.matchId)).toEqual(match);
    // The unchanged guard now permits the next durable admission operation.
    store.enqueueStart({ startId: 'after-reclaim', hostId: 'fixture-host', fingerprint: 'fixture', requestJson: '{}' });
    expect(store.starts()[0]?.startId).toBe('after-reclaim');
    expect(store.get(match.matchId)?.worldHash).toBe(match.worldHash);
  });
  it.each([17 * 1024 * 1024, WAL_LIMIT_BYTES])('keeps a current reader intact for a %i-byte payload and bounds reclaim retries', payloadBytes => {
    // Integer fake clock checks the exact retry boundary without binary-float
    // rounding of an arbitrary real performance.now() origin.
    let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { store, path } = fixture();
    store.db.exec('CREATE TABLE qa_checkpoint_payload (payload BLOB NOT NULL)');
    store.db.prepare('INSERT INTO qa_checkpoint_payload VALUES (zeroblob(?))').run(payloadBytes);
    const reader = new Database(path, { readonly: true }); connections.push(reader);
    reader.exec('BEGIN');
    expect(reader.prepare('SELECT length(payload) AS length FROM qa_checkpoint_payload').get()).toEqual({ length: payloadBytes });
    const checkpoint = new WalCheckpointer(path); checkpointers.push(checkpoint);
    const busy = checkpoint.poll(true);
    expect(busy.checkpointedFrames).toBe(busy.logFrames);
    expect(busy).toMatchObject({ failures: 0, busy: 1, reclaimAttempts: 1, reclaimBusy: 1 });
    expect(walBytes(path)).toBeGreaterThan(16 * 1024 * 1024);
    if (payloadBytes >= WAL_LIMIT_BYTES) expect(() => assertCheckpointBudget(busy, path)).toThrow('CHECKPOINT_WAL_LIMIT');
    else expect(() => assertCheckpointBudget(busy, path)).not.toThrow();
    for (let i = 0; i < 3; i++) expect(checkpoint.poll(true).reclaimAttempts).toBe(1);
    expect(reader.prepare('SELECT length(payload) AS length FROM qa_checkpoint_payload').get()).toEqual({ length: payloadBytes });
    reader.exec('ROLLBACK'); now += 249;
    expect(checkpoint.poll(true).reclaimAttempts).toBe(1);
    now++;
    const reclaimed = checkpoint.poll(true);
    expect(reclaimed).toMatchObject({ failures: 0, busy: 0, reclaimAttempts: 2, reclaimBusy: 1 });
    expect(walBytes(path)).toBe(0);
    expect(() => assertCheckpointBudget(reclaimed, path)).not.toThrow();
    expect(reclaimed.reclaimMaxMs).toBeGreaterThanOrEqual(0);
    expect(reclaimed.reclaimP99Ms).toBeGreaterThanOrEqual(0);
    expect(store.status().integrity).toBe('ok');
  });
  it('fails conservatively on a dead or failed checkpointer and on excessive retained WAL', () => {
    const { path } = fixture(), checkpoint = new WalCheckpointer(path); checkpointers.push(checkpoint);
    const status = checkpoint.poll(true), now = status.observedAt;
    expect(() => assertCheckpointBudget(null, path, now)).toThrow('CHECKPOINT_UNAVAILABLE');
    expect(() => assertCheckpointBudget({ ...status, failures: 1 }, path, now)).toThrow('CHECKPOINT_UNAVAILABLE');
    expect(() => assertCheckpointBudget(status, path, now + CHECKPOINT_STALE_MS + 1)).toThrow('CHECKPOINT_UNAVAILABLE');
    const oversized = join(directories.at(-1)!, 'size-fixture.sqlite');
    writeFileSync(oversized + '-wal', ''); truncateSync(oversized + '-wal', WAL_LIMIT_BYTES);
    expect(() => assertCheckpointBudget(status, oversized, now)).toThrow('CHECKPOINT_WAL_LIMIT');
  });
  it('reports safe checkpoint numbers and does not include database contents', () => {
    const { path } = fixture(), checkpoint = new WalCheckpointer(path); checkpointers.push(checkpoint);
    const status: CheckpointStatus = checkpoint.poll();
    expect(Object.keys(status).sort()).toEqual(['busy', 'checkpointedFrames', 'failures', 'logFrames', 'maxMs', 'observedAt', 'p99Ms', 'pageSize',
      'reclaimAttempts', 'reclaimBusy', 'reclaimMaxMs', 'reclaimP99Ms', 'runs', 'sqliteVersion', 'walBytes'].sort());
  });
});
