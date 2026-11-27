import { once } from 'node:events';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { PlatformService } from '../src/service';
import { createPlatformHttpServer } from '../src/http';
import type { GameRegistration } from '../src/types';

it('drains an authenticated partial upload without creating an account or closing the database early', async () => {
  const platform = new PlatformService({ databasePath: ':memory:', publicOrigin: 'http://portal.test' });
  await platform.ready;
  const session = platform.createSession(null);
  const server = createPlatformHttpServer(platform, { publicOrigin: 'http://portal.test', shutdownGraceMs: 25 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = connect((server.address() as AddressInfo).port, '127.0.0.1');
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    const accepted = once(server, 'request');
    socket.write(`POST /api/platform/v1/auth/register HTTP/1.1\r\nHost: portal.test\r\nOrigin: http://portal.test\r\nCookie: iva_dev_session=${session.token}\r\nX-CSRF-Token: ${session.session.csrfToken}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
    await accepted;
    const closing = server.shutdown();
    expect(server.shutdown()).toBe(closing);
    await closing;
    expect(platform.db.open).toBe(true);
    expect(platform.db.prepare('SELECT count(*) AS count FROM players').get()).toEqual({ count: 0 });
  } finally { socket.destroy(); await server.shutdown(); platform.close(); }
}, 3_000);

it('finishes in-flight reconciliation but leaves remaining durable work for the next process', async () => {
  let release!: () => void, began!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  const calls: string[] = [];
  const game: GameRegistration = {
    gameId: 'shutdown-test', title: 'Shutdown fixture', minPlayers: 2, maxPlayers: 4,
    supportsBots: true, rulesVersion: '1', contentVersion: '1', status: 'available',
    runtime: {
      createMatch: async () => ({ matchId: 'unused' }),
      viewForPlayer: async () => ({}), applyAction: async () => ({}),
      status: async matchId => {
        calls.push(matchId); if (calls.length === 4) began();
        await gate; return { finished: false };
      },
    },
  };
  const platform = new PlatformService({ databasePath: ':memory:', publicOrigin: 'http://portal.test', games: [game] });
  await platform.ready;
  try {
    platform.db.exec("INSERT INTO players VALUES ('owner','owner','Owner','owner@example.invalid','test-hash',1,0)");
    const insert = platform.db.prepare("INSERT INTO rooms VALUES (?, 'shutdown-test', 'Fixture', 'owner', 'playing', 2, '1', '1', 0, '{}', 0, ?, NULL)");
    for (let index = 0; index < 20; index++) insert.run(`room-${index}`, `match-${index}`);
    const working = platform.reconcile();
    await started;
    platform.stopReconciliation();
    release();
    await Promise.all([working, platform.settle()]);
    expect(calls).toHaveLength(4);
    await platform.reconcile();
    expect(calls).toHaveLength(4);
    expect(platform.db.prepare("SELECT count(*) AS count FROM rooms WHERE state='playing'").get()).toEqual({ count: 20 });
  } finally { release(); await platform.settle(); platform.close(); }
});

it('keeps the runtime database open for adapter work after its response deadline', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtimeDb = new Database(':memory:');
  runtimeDb.exec('CREATE TABLE effects (value TEXT NOT NULL)');
  let wrote = false, drained = false;
  const game: GameRegistration = {
    gameId: 'slow-adapter', title: 'Slow adapter fixture', minPlayers: 2, maxPlayers: 4,
    supportsBots: true, rulesVersion: '1', contentVersion: '1', status: 'available',
    runtime: {
      createMatch: async () => ({ matchId: 'unused' }),
      viewForPlayer: async () => ({}), applyAction: async () => ({}),
      status: async () => {
        await gate;
        runtimeDb.prepare('INSERT INTO effects VALUES (?)').run('finished after response timeout');
        wrote = true;
        return { finished: false };
      },
    },
  };
  const platform = new PlatformService({ databasePath: ':memory:', publicOrigin: 'http://portal.test', games: [game], runtimeTimeoutMs: 5 });
  await platform.ready;
  try {
    platform.db.exec("INSERT INTO players VALUES ('owner','owner','Owner','owner@example.invalid','test-hash',1,0)");
    platform.db.exec("INSERT INTO rooms VALUES ('room', 'slow-adapter', 'Fixture', 'owner', 'playing', 2, '1', '1', 0, '{}', 0, 'match', NULL)");
    await platform.reconcile(); // The response deadline expires; the adapter is still gated.
    platform.stopReconciliation();
    const settled = platform.settle().then(() => { drained = true; runtimeDb.close(); });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(wrote).toBe(false);
    expect(drained).toBe(false);
    expect(runtimeDb.open).toBe(true);
    release(); await settled;
    expect(wrote).toBe(true);
    expect(drained).toBe(true);
  } finally {
    release(); await platform.settle(); platform.close();
    if (runtimeDb.open) runtimeDb.close();
  }
});
