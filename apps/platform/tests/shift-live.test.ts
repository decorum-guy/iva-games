import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';
import type { ShiftView } from '@iva-games/shift/core';
import { createShiftRegistration } from '@iva-games/shift/runtime';
import { PlatformService } from '../src/service';
import { MemoryMailbox } from '../src/mail';
import { createPlatformHttpServer } from '../src/http';
import type { Room } from '../src/types';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { try { for (const close of cleanup.splice(0)) await close(); } finally { vi.useRealTimers(); } });
type Frame = { type: string; view?: ShiftView; actionId?: string; code?: string; controllerEpoch?: number; result?: { accepted: boolean; reason?: string } };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'iva-shift-live-'));
  const shift = createShiftRegistration({ databasePath: join(directory, 'runtime.sqlite'), autoTick: false });
  const mail = new MemoryMailbox();
  const platform = new PlatformService({ databasePath: join(directory, 'platform.sqlite'), publicOrigin: 'http://shift.test', mail, games: [shift] });
  await platform.ready;
  const server = createPlatformHttpServer(platform, { publicOrigin: 'http://shift.test', allowedHosts: ['shift.test'], secureCookies: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sockets: WebSocket[] = [];
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    for (const socket of sockets) socket.terminate();
    await server.shutdown(); await platform.settle(); shift.close(); platform.close();
    await rm(directory, { recursive: true, force: true });
  };
  cleanup.push(stop);
  async function signup(handle: string) {
    const created = await platform.register({ email: handle + '@example.test', handle, displayName: handle, password: 'Long isolated testing password 304' });
    const message = mail.messages.find(item => item.to === handle + '@example.test')!;
    platform.verifyEmail(new URL(message.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token'));
    return { id: created.user.playerId, token: created.token, session: created.session };
  }
  type Player = Awaited<ReturnType<typeof signup>>;
  function connect(player: Player, room: Room, headers: Record<string, string> = {}, version = 'shift-wire@1') {
    const frames: Frame[] = [];
    const socket = new WebSocket(`${base}/api/platform/v1/rooms/${room.roomId}/live?matchId=${room.matchId}&version=${encodeURIComponent(version)}`, { headers: {
      Host: 'shift.test', Origin: 'http://shift.test', Cookie: `iva_dev_session=${player.token}`, ...headers,
    } });
    sockets.push(socket);
    socket.on('message', data => { frames.push(JSON.parse(data.toString()) as Frame); });
    // Authentication rejection is inspected through unexpected-response below.
    socket.on('error', () => {});
    const wait = (predicate: (frame: Frame) => boolean, start = 0): Promise<Frame> => new Promise((resolve, reject) => {
      const poll = setInterval(() => { const match = frames.slice(start).find(predicate); if (match) { clearInterval(poll); clearTimeout(deadline); resolve(match); } }, 5);
      const deadline = setTimeout(() => { clearInterval(poll); reject(new Error('Live frame not received: ' + JSON.stringify(frames.map(f => f.type)))); }, 3000);
    });
    return { socket, frames, wait };
  }
  async function room(host: Player, other: Player, size: 2 | 3 = 2) {
    const friends = platform.requestFriend(host.id, other.id); platform.respondFriend(other.id, friends.requestId, 'accept');
    let room = platform.createRoom(host.id, { gameId: 'shift', capacity: size * 2, settings: { teamSize: size } });
    const invitation = platform.invite(host.id, room.roomId, other.id);
    platform.acceptInvitation(other.id, invitation.invitationId); room = platform.joinRoom(other.id, room.roomId);
    while (room.members.length < room.capacity) room = platform.addBot(host.id, room.roomId, { expectedRevision: room.revision, difficulty: 'normal' });
    const teams = Object.fromEntries(room.members.map((p, index) => [p.participantId, index % 2 ? 'amber' : 'teal']));
    room = platform.changeSettings(host.id, room.roomId, { expectedRevision: room.revision, settings: {
      arena: 'foundry', teamSize: size, rotateRoles: false, difficulty: 'normal', teams,
      initialNavigators: { teal: room.members[0].participantId, amber: room.members[1].participantId },
    } });
    platform.setReady(host.id, room.roomId, { expectedRevision: room.revision, ready: true });
    platform.setReady(other.id, room.roomId, { expectedRevision: room.revision, ready: true });
    platform.startRoom(host.id, room.roomId, { expectedRevision: room.revision }); await platform.reconcile();
    return platform.getRoom(host.id, room.roomId);
  }
  return { platform, shift, server, stop, signup, connect, room };
}

describe('shared authenticated live gateway with Shift', () => {
  it.each([2, 3] as const)('opens independent views with %i players per team and settles same-tick competing room commands once', async size => {
    const f = await fixture(), a = await f.signup('live_a'), b = await f.signup('live_b');
    const room = await f.room(a, b, size);
    expect(room.state).toBe('playing');
    const first = f.connect(a, room), second = f.connect(b, room);
    const [fa, fb] = await Promise.all([first.wait(frame => frame.type === 'snapshot'), second.wait(frame => frame.type === 'snapshot')]);
    expect(fa.view!.self.team).toBe('teal'); expect(fb.view!.self.team).toBe('amber');
    expect(fa.view!.actors.every(actor => actor.team === 'teal')).toBe(true);
    expect(fb.view!.actors.every(actor => actor.team === 'amber')).toBe(true);
    expect(JSON.stringify(fa)).not.toContain(b.token);
    expect(JSON.stringify(fa)).not.toContain(b.id);
    f.shift.runtime.advanceTicks(211);
    const active = await f.platform.matchView(a.id, room.roomId) as ShiftView;
    first.socket.send(JSON.stringify({ type: 'command', version: 'shift-wire@1', actionId: 'live-shift-teal', payload: {
      type: 'shift', roundId: active.round, controllerEpoch: fa.controllerEpoch, roomId: 'O', expectedBoardRevision: active.boardRevision,
    } }));
    second.socket.send(JSON.stringify({ type: 'command', version: 'shift-wire@1', actionId: 'live-shift-amber', payload: {
      type: 'shift', roundId: active.round, controllerEpoch: fb.controllerEpoch, roomId: 'F', expectedBoardRevision: active.boardRevision,
    } }));
    // Both socket callbacks enqueue before the explicit authoritative tick.
    await new Promise(resolve => setTimeout(resolve, 25)); f.shift.runtime.advanceTicks();
    const receipts = await Promise.all([first.wait(frame => frame.actionId === 'live-shift-teal'), second.wait(frame => frame.actionId === 'live-shift-amber')]);
    expect(receipts.filter(frame => frame.result?.accepted)).toHaveLength(1);
    expect(receipts[0].result?.accepted).toBe(true);
    const one = await f.platform.matchView(a.id, room.roomId) as ShiftView;
    const two = await f.platform.matchView(b.id, room.roomId) as ShiftView;
    expect(one.motion).toEqual(two.motion);
  });

  it('synchronously stops live snapshot timers and leases before the platform databases close', async () => {
    // Real sockets and databases; only interval dispatch is controlled so a
    // queued snapshot cannot hide behind a lucky close-event ordering.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const f = await fixture(), a = await f.signup('shutdown_a'), b = await f.signup('shutdown_b');
    const room = await f.room(a, b, 3);
    const first = f.connect(a, room), second = f.connect(b, room);
    await Promise.all([first, second].map(client => new Promise<void>(resolve => client.socket.once('message', () => resolve()))));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const sessionReads = vi.spyOn(f.platform, 'getSession');
    const shutdown = f.server.shutdown();
    // This happens before asynchronous WS close events get a turn.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(sessionReads).not.toHaveBeenCalled();
    await shutdown; await f.stop();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(sessionReads).not.toHaveBeenCalled();
  });

  it('rejects foreign origins, missing sessions, non-members, mismatched matches and wire versions', async () => {
    const f = await fixture(), a = await f.signup('auth_a'), b = await f.signup('auth_b'), outside = await f.signup('auth_out');
    const room = await f.room(a, b);
    for (const [player, headers, version, candidate] of [
      [a, { Origin: 'http://foreign.test' }, 'shift-wire@1', room],
      [a, { Cookie: '' }, 'shift-wire@1', room],
      [outside, {}, 'shift-wire@1', room],
      [a, {}, 'shift-wire@2', room],
      [a, {}, 'shift-wire@1', { ...room, matchId: 'another-match' }],
    ] as const) {
      const client = f.connect(player, candidate, headers, version);
      const status = await new Promise<number>(resolve => client.socket.once('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode!); client.socket.terminate(); }));
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });

  it('releases a controller lease when a later WebSocket handshake field is rejected', async () => {
    const f = await fixture(), a = await f.signup('handshake_a'), b = await f.signup('handshake_b');
    const room = await f.room(a, b);
    const rejected = f.connect(a, room, { 'Sec-WebSocket-Protocol': ',' });
    const status = await new Promise<number>(resolve => rejected.socket.once('unexpected-response', (_request, response) => {
      response.resume(); resolve(response.statusCode!); rejected.socket.terminate();
    }));
    expect(status).toBe(400);
    await vi.waitFor(async () => {
      const view = await f.platform.matchView(a.id, room.roomId) as ShiftView;
      expect(view.self.connected).toBe(false);
    });
  });

  it('takes over one seat with a new epoch and closes a revoked session', async () => {
    const f = await fixture(), a = await f.signup('epoch_a'), b = await f.signup('epoch_b'), room = await f.room(a, b);
    const first = f.connect(a, room), initial = await first.wait(frame => frame.type === 'snapshot');
    const oldClosed = new Promise<number>(resolve => first.socket.once('close', resolve));
    const second = f.connect(a, room), replacement = await second.wait(frame => frame.type === 'snapshot');
    expect(replacement.controllerEpoch).toBeGreaterThan(initial.controllerEpoch!);
    expect(await oldClosed).toBe(4001);
    const revoked = new Promise<number>(resolve => second.socket.once('close', resolve));
    f.platform.revokeSession(a.session.sessionHash);
    expect(await revoked).toBe(4003);
  });

  it('sends each finished view once without rebuilding it and still enforces takeover and revocation', async () => {
    const f = await fixture(), a = await f.signup('final_a'), b = await f.signup('final_b');
    const room = await f.room(a, b);
    const openLive = f.platform.openLiveSession.bind(f.platform), snapshotCalls: number[] = [];
    vi.spyOn(f.platform, 'openLiveSession').mockImplementation((...args) => {
      const lease = openLive(...args), originalSnapshot = lease.snapshot.bind(lease), index = snapshotCalls.length;
      snapshotCalls.push(0);
      lease.snapshot = () => { snapshotCalls[index]++; return originalSnapshot(); };
      return lease;
    });
    const first = f.connect(a, room); await first.wait(frame => frame.type === 'snapshot');
    // A normal match completes through fixed steps and public-view substitute bots.
    f.shift.runtime.advanceTicks(16_000);
    const final = await first.wait(frame => frame.type === 'snapshot' && frame.view?.phase === 'finished');
    expect(final).not.toHaveProperty('finished'); // The terminal hint stays internal.
    const callsAtFinal = snapshotCalls[0], auth = vi.spyOn(f.platform, 'getSession');
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(first.frames.filter(frame => frame.type === 'snapshot' && frame.view?.phase === 'finished')).toHaveLength(1);
    expect(snapshotCalls[0]).toBe(callsAtFinal);
    expect(auth).toHaveBeenCalled();
    const oldClosed = new Promise<number>(resolve => first.socket.once('close', resolve));
    const second = f.connect(a, room), replacement = await second.wait(frame => frame.type === 'snapshot');
    expect(replacement.view?.phase).toBe('finished');
    expect(replacement.controllerEpoch).toBeGreaterThan(final.controllerEpoch!);
    expect(await oldClosed).toBe(4001);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(second.frames.filter(frame => frame.type === 'snapshot')).toHaveLength(1);
    expect(snapshotCalls[1]).toBe(1);
    const revoked = new Promise<number>(resolve => second.socket.once('close', resolve));
    f.platform.revokeSession(a.session.sessionHash);
    expect(await revoked).toBe(4003);
  }, 30_000);

  it('accepts a bounded input burst after network jitter while continuing to limit a flood', async () => {
    const f = await fixture(), a = await f.signup('jitter_a'), b = await f.signup('jitter_b'), room = await f.room(a, b);
    const client = f.connect(a, room), first = await client.wait(frame => frame.type === 'snapshot');
    let seq = 0;
    const sendInputs = (count: number) => { for (let i = 0; i < count; i++) client.socket.send(JSON.stringify({ type: 'input', version: 'shift-wire@1', payload: {
      type: 'input', roundId: first.view!.round, controllerEpoch: first.controllerEpoch, seq: ++seq, moveX: 0, moveZ: 0, aim: 0, fireHeld: false,
    } })); };
    let start = client.frames.length;
    sendInputs(6); await client.wait(frame => frame.type === 'snapshot', start);
    expect(client.frames.slice(start).filter(frame => frame.code === 'INPUT_RATE')).toHaveLength(0);
    start = client.frames.length;
    sendInputs(60); await client.wait(frame => frame.code === 'INPUT_RATE', start);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    await new Promise(resolve => setTimeout(resolve, 400));
    start = client.frames.length;
    sendInputs(6); await client.wait(frame => frame.type === 'snapshot', start);
    expect(client.frames.slice(start).filter(frame => frame.code === 'INPUT_RATE')).toHaveLength(0);
  });

  it('rejects invalid lobby capacity and resets human readiness after team changes', async () => {
    const f = await fixture(), a = await f.signup('lobby_a');
    expect(() => f.platform.createRoom(a.id, { gameId: 'shift', capacity: 5, settings: { teamSize: 2 } })).toThrow();
    let room = f.platform.createRoom(a.id, { gameId: 'shift', capacity: 4, settings: { teamSize: 2 } });
    f.platform.setReady(a.id, room.roomId, { expectedRevision: room.revision, ready: true });
    room = f.platform.changeSettings(a.id, room.roomId, { expectedRevision: room.revision, settings: { teamSize: 2, rotateRoles: false } });
    expect(room.members[0].ready).toBe(false);
    while (room.members.length < 4) room = f.platform.addBot(a.id, room.roomId, { expectedRevision: room.revision, difficulty: 'normal' });
    f.platform.setReady(a.id, room.roomId, { expectedRevision: room.revision, ready: true });
    expect(() => f.platform.startRoom(a.id, room.roomId, { expectedRevision: room.revision })).toThrow();
    expect(f.platform.getRoom(a.id, room.roomId).state).toBe('lobby');
    const removed = room.members.find(p => !p.playerId)!;
    room = f.platform.changeSettings(a.id, room.roomId, { expectedRevision: room.revision, settings: {
      ...room.settings, initialNavigators: { ...(room.settings.initialNavigators as object), teal: removed.participantId },
    } });
    room = f.platform.removeBot(a.id, room.roomId, removed.participantId, { expectedRevision: room.revision });
    room = f.platform.addBot(a.id, room.roomId, { expectedRevision: room.revision, difficulty: 'normal' });
    expect(Object.keys(room.settings.teams as object)).toEqual(expect.arrayContaining(room.members.map(p => p.participantId)));
    expect(JSON.stringify(room.settings)).not.toContain(removed.participantId);
    expect(Object.values(room.settings.teams as object).filter(team => team === 'teal')).toHaveLength(2);
  });

  it('reopens the same finished room for a host rematch and revokes its previous live channel', async () => {
    const f = await fixture(), a = await f.signup('rematch_a'), b = await f.signup('rematch_b');
    const room = await f.room(a, b);
    const client = f.connect(a, room); await client.wait(frame => frame.type === 'snapshot');
    f.shift.runtime.advanceTicks(16_000);
    await client.wait(frame => frame.view?.phase === 'finished');
    // The live runtime finishes before the platform's periodic reconciliation.
    // A visible final frame alone must not imply that rematch is ready yet.
    const pending = f.platform.getRoom(a.id, room.roomId);
    expect(pending.state).toBe('playing');
    const port = (f.server.address() as AddressInfo).port;
    const premature = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port, path: `/api/platform/v1/rooms/${room.roomId}/rematch`,
        method: 'POST', headers: {
          Host: 'shift.test', Origin: 'http://shift.test', Cookie: `iva_dev_session=${a.token}`,
          'Content-Type': 'application/json', 'X-CSRF-Token': a.session.csrfToken, 'Idempotency-Key': 'rematch-before-reconciliation',
        },
      }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += String(chunk); });
        response.on('end', () => { try { resolve({ status: response.statusCode!, body: JSON.parse(body) }); } catch (error) { reject(error); } });
      });
      request.on('error', reject); request.end(JSON.stringify({ expectedRevision: pending.revision }));
    });
    expect(premature.status).toBe(409);
    expect(premature.body).toMatchObject({ error: { code: 'MATCH_NOT_FINISHED' } });
    expect(f.platform.getRoom(a.id, room.roomId).matchId).toBe(room.matchId);
    await f.platform.reconcile();
    const finished = f.platform.getRoom(a.id, room.roomId);
    expect(finished.state).toBe('finished');
    expect(() => f.platform.rematch(b.id, room.roomId, { expectedRevision: finished.revision })).toThrow();
    const disconnected = new Promise<number>(resolve => client.socket.once('close', resolve));
    const again = f.platform.rematch(a.id, room.roomId, { expectedRevision: finished.revision });
    expect(again.state).toBe('lobby'); expect(again.matchId).toBeNull();
    expect(again.members.map(p => p.participantId)).toEqual(room.members.map(p => p.participantId));
    expect(again.members.filter(p => p.playerId).every(p => !p.ready)).toBe(true);
    expect(await disconnected).toBe(4004);
    f.platform.setReady(a.id, again.roomId, { expectedRevision: again.revision, ready: true });
    f.platform.setReady(b.id, again.roomId, { expectedRevision: again.revision, ready: true });
    f.platform.startRoom(a.id, again.roomId, { expectedRevision: again.revision }); await f.platform.reconcile();
    const restarted = f.platform.getRoom(a.id, again.roomId);
    expect(restarted.state).toBe('playing'); expect(restarted.matchId).not.toBe(room.matchId);
    expect((await f.shift.runtime.status(room.matchId!)).finished).toBe(true);
  }, 30_000);
});
