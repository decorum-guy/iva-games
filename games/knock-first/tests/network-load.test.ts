import { afterEach, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanupNetworkFixtures, fixture, scope } from './helpers/network-fixture';
import type { Frame, Peer } from './helpers/network-fixture';
afterEach(cleanupNetworkFixtures);

it('serves six simultaneous five-seat rooms with real sockets and SQLite while the lobby remains responsive', async () => {
    const f = await fixture({ autoTick: true, capacity: 5 }), rooms = [f.room];
    for (let i = 1; i < 6; i++) rooms.push(await f.createRoom(i, 5));
    const streams: { peer: Peer; first: Frame; seq: number }[] = [];
    for (const room of rooms) for (const client of f.clients.slice(0, 2)) {
      const peer = f.connect(client, { room }), first = await peer.frame('snapshot');
      streams.push({ peer, first, seq: first.view!.self.acknowledgedSeq + 1 });
      expect((await peer.command(first, { type: 'ready' })).result?.ok).toBe(true);
    }
    const start = performance.now(), httpLatencies: number[] = [], httpErrors: number[] = [];
    let inputs = 0;
    const inputTimer = setInterval(() => {
      const elapsed = performance.now() - start;
      for (const stream of streams) {
        stream.peer.send({ ...scope(stream.first), type: 'input', seq: ++stream.seq, payload: { moveX: Math.floor(elapsed / 1500) % 2 ? 1 : -1, moveZ: 0, yaw: 0, pitch: 0, run: false, quiet: true, hand: false } });
        inputs++;
      }
    }, 34);
    const lobbyTimer = setInterval(() => {
      const before = performance.now();
      void f.http(f.clients[0], `/rooms/${f.room.roomId}`).then(reply => { httpLatencies.push(performance.now() - before); if (reply.status !== 200) httpErrors.push(reply.status); });
    }, 1000);
    try { await new Promise<void>(resolve => setTimeout(resolve, 20_000)); }
    finally { clearInterval(inputTimer); clearInterval(lobbyTimer); }
    const elapsedMs = performance.now() - start, metrics = f.game.knock.metrics();
    const snapshots = streams.flatMap(s => s.peer.messages.filter(m => m.type === 'snapshot'));
    const errors = streams.flatMap(s => s.peer.messages.filter(m => m.type === 'error' && m.code !== 'INPUT_RATE'));
    const sizes = snapshots.map(frame => Buffer.byteLength(JSON.stringify(frame))).sort((a, b) => a - b);
    const delays = [...httpLatencies].sort((a, b) => a - b);
    const report = { method: 'Node WebSocket clients and real SQLite, scripted inputs; no browser or human playtest', expectedRooms: 6, seats: 30, scriptedHumanControllers: 12, explicitBots: 18, elapsedMs, inputs, snapshots: snapshots.length, ...metrics, p95SnapshotBytes: sizes[Math.floor(sizes.length * .95)], maxSnapshotBytes: sizes.at(-1), lobbySamples: delays.length, p95LobbyMs: delays[Math.floor(delays.length * .95)], maxLobbyMs: delays.at(-1), errors: errors.map(e => e.code), httpErrors, node: process.version, platform: process.platform };
    await mkdir(resolve('.qa/knock-first'), { recursive: true });
    await writeFile(resolve('.qa/knock-first/network-load.json'), JSON.stringify(report, null, 2));
    console.info('Knock First network load', JSON.stringify(report));
    expect(metrics.rooms).toBe(6); expect(metrics.samples).toBeGreaterThan(450);
    expect(snapshots.length).toBeGreaterThan(12 * 150); expect(httpLatencies.length).toBeGreaterThan(10);
    expect(errors).toEqual([]); expect(httpErrors).toEqual([]);
    expect(streams.every(s => s.peer.closeCode === null)).toBe(true);
  }, 35_000);
