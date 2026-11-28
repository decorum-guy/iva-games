import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Action, UnitType } from '@chess-2/colossus/core';
import { ONLINE_PROTOCOL } from '@chess-2/colossus/online/protocol';
import type { CommandEnvelope, CommandResponse, CreateRoomResponse, OnlineCommand, RoomSnapshot } from '@chess-2/colossus/online/protocol';
import { createOnlineServer } from '../src/http';

let app: ReturnType<typeof createOnlineServer>;
let directory: string;
let origin: string;
let now: number;
async function boot() {
  app = createOnlineServer({ databasePath: join(directory, 'remorse.sqlite'), staticDir: join(directory, 'dist'), now: () => now });
  const address = await app.listen(0); origin = 'http://127.0.0.1:' + address.port;
}
async function request(path: string, data?: unknown, cookie = '', requestOrigin = origin) {
  return fetch(origin + '/api/colossus' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, Origin: requestOrigin, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function guest() {
  const response = await request('/guest', {}); expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toContain('colossus_guest='); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
  return cookie.split(';')[0];
}
async function snapshot(id: string, cookie: string): Promise<RoomSnapshot> {
  const response = await request('/rooms/' + id, undefined, cookie); expect(response.status).toBe(200);
  return (await response.json() as { snapshot: RoomSnapshot }).snapshot;
}
async function presence(id: string, cookie: string, connected: boolean) {
  const response = await request('/rooms/' + id + '/presence', { protocol: ONLINE_PROTOCOL, connected }, cookie);
  expect(response.status).toBe(200); return (await response.json() as { snapshot: RoomSnapshot }).snapshot;
}
async function pair() {
  const a = await guest(), b = await guest();
  const createdResponse = await request('/rooms', { protocol: ONLINE_PROTOCOL, requestId: randomUUID(), name: 'Artem', options: {} }, a);
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json() as CreateRoomResponse;
  const joined = await request('/rooms/' + created.snapshot.id + '/join', { protocol: ONLINE_PROTOCOL, name: 'Partner', invite: created.invite }, b);
  expect(joined.status).toBe(200);
  return { a, b, id: created.snapshot.id, created };
}
async function command(id: string, cookie: string, command: OnlineCommand, envelope?: CommandEnvelope) {
  const current = await snapshot(id, cookie);
  const input: CommandEnvelope = envelope ?? { protocol: ONLINE_PROTOCOL, commandId: randomUUID(), expectedRevision: current.revision, command };
  const response = await request('/rooms/' + id + '/commands', input, cookie);
  return { response, data: await response.json() as CommandResponse & { error?: string }, envelope: input };
}
async function act(id: string, cookie: string, action: Action) {
  const result = await command(id, cookie, { type: 'action', action });
  expect(result.response.status, JSON.stringify(result.data)).toBe(200); return result;
}
function unit(s: RoomSnapshot, type: UnitType) { return s.state.units.find(u => u.type === type && u.hp > 0)!.id; }
async function takeOver() {
  const room = await pair(); await presence(room.id, room.b, false); now += 60_001;
  await presence(room.id, room.a, true);
  const result = await command(room.id, room.a, { type: 'takeover' });
  expect(result.response.status, JSON.stringify(result.data)).toBe(200); return room;
}

beforeEach(async () => {
  now = 1_000_000;
  directory = await mkdtemp(join(tmpdir(), 'colossus-http-'));
  await mkdir(join(directory, 'dist', 'colossus'), { recursive: true });
  await writeFile(join(directory, 'dist', 'index.html'), '<!doctype html><title>REMORSE</title>');
  await writeFile(join(directory, 'dist', 'colossus', 'index.html'), '<!doctype html><title>COLOSSUS</title>');
  await boot();
});
afterEach(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

describe('Colossus real HTTP cooperative rooms', () => {
  it('serves its own entry and health with distinct protocol and asset misses', async () => {
    for (const path of ['/colossus', '/colossus/', '/colossus/index.html']) expect(await (await fetch(origin + path)).text()).toContain('COLOSSUS');
    expect(await (await fetch(origin + '/')).text()).toContain('REMORSE');
    expect((await fetch(origin + '/colossus/assets/missing')).status).toBe(404);
    expect(await (await request('/health')).json()).toEqual({ ok: true, protocol: ONLINE_PROTOCOL, rulesVersion: 'colossus-v1' });
  });

  it('serves a standalone Colossus build at both its root and collection route', async () => {
    const standalone = join(directory, 'colossus-only');
    await mkdir(standalone);
    await writeFile(join(standalone, 'index.html'), '<!doctype html><title>Standalone COLOSSUS</title>');
    await app.close();
    app = createOnlineServer({ databasePath: join(directory, 'standalone.sqlite'), staticDir: standalone, now: () => now });
    const address = await app.listen(0); origin = 'http://127.0.0.1:' + address.port;
    for (const path of ['/', '/colossus', '/colossus/']) {
      const response = await fetch(origin + path); expect(response.status).toBe(200);
      expect(await response.text()).toContain('Standalone COLOSSUS');
    }
    expect((await fetch(origin + '/colossus/assets/missing')).status).toBe(404);
  });

  it('uses independent cookies, a single-use invite, protected seats and origin checks', async () => {
    const { a, b, id, created } = await pair(); const stranger = await guest();
    expect(a).not.toBe(b);
    expect((await request('/rooms/' + id)).status).toBe(401);
    expect((await request('/rooms/' + id, undefined, stranger)).status).toBe(403);
    expect((await request('/rooms/' + id, undefined, a.replace('colossus_guest=', 'remorse_guest='))).status).toBe(401);
    expect((await request('/rooms/' + id + '/join', { protocol: ONLINE_PROTOCOL, name: 'Other', invite: created.invite }, stranger)).status).toBe(409);
    const state = await snapshot(id, a);
    const bad = await request('/rooms/' + id + '/commands', { protocol: ONLINE_PROTOCOL, commandId: randomUUID(), expectedRevision: state.revision,
      command: { type: 'action', action: { type: 'guard', unitId: unit(state, 'K') } } }, a, 'https://other.invalid');
    expect(bad.status).toBe(403); expect((await snapshot(id, a)).state).toEqual(state.state);
  });

  it('never sends run seeds or future deck order in either player view or an ACK response', async () => {
    const { a, b, id } = await pair();
    const first = await snapshot(id, a); const second = await snapshot(id, b);
    expect(first.state.secret).toBeNull(); expect(second.state.secret).toBeNull();
    expect(app.colossus.store.load(id)!.state.secret).not.toBeNull();
    const accepted = await act(id, a, { type: 'guard', unitId: unit(first, 'K') });
    for (const value of [first, second, accepted.data]) {
      const text = JSON.stringify(value);
      for (const key of ['runSeed', 'playerDeck', 'bossDeck', 'inviteHash', 'guest']) expect(text).not.toContain('"' + key + '"');
    }
    expect(second.you).toBe('B'); expect(first.you).toBe('A');
  });

  it('plays A–B–A and a full boss response through two independent HTTP clients', async () => {
    const { a, b, id } = await pair(); const start = await snapshot(id, a);
    await act(id, a, { type: 'guard', unitId: unit(start, 'K') });
    const unauthorized = await command(id, a, { type: 'action', action: { type: 'guard', unitId: unit(start, 'R') } });
    expect(unauthorized.response.status).toBe(409);
    await act(id, b, { type: 'guard', unitId: unit(start, 'Q') });
    await act(id, a, { type: 'guard', unitId: unit(start, 'R') });
    const end = await act(id, a, { type: 'end' });
    expect(end.data.snapshot.state.round).toBe(2);
    expect((await snapshot(id, b)).state).toEqual(end.data.snapshot.state);
    await act(id, b, { type: 'guard', unitId: unit(end.data.snapshot, 'Q') });
  });

  it('deduplicates exact commands, rejects changed payloads and stale proposals without spending resources', async () => {
    const { a, b, id } = await pair(); const start = await snapshot(id, a);
    const first = await act(id, a, { type: 'guard', unitId: unit(start, 'K') });
    const replay = await command(id, a, first.envelope.command, first.envelope);
    expect(replay.response.status).toBe(200); expect(replay.data.ack).toEqual(first.data.ack);
    expect(replay.data.snapshot.state).toEqual(first.data.snapshot.state);
    const conflict = await command(id, a, first.envelope.command, { ...first.envelope, command: { type: 'action', action: { type: 'guard', unitId: unit(start, 'R') } } });
    expect(conflict.data.error).toBe('commandConflict');
    const stale = await command(id, b, { type: 'action', action: { type: 'guard', unitId: unit(start, 'Q') } },
      { protocol: ONLINE_PROTOCOL, commandId: randomUUID(), expectedRevision: start.revision, command: { type: 'action', action: { type: 'guard', unitId: unit(start, 'Q') } } });
    expect(stale.data.error).toBe('staleRevision');
    expect((await snapshot(id, b)).state.commands).toBe(2);
    const stolen = await command(id, b, first.envelope.command, first.envelope); expect(stolen.data.error).toBe('commandConflict');
  });

  it('rejects editor fields, forged actors, unknown rules and client-provided seeds', async () => {
    const { a, id } = await pair(); const s = await snapshot(id, a);
    for (const extra of [{ actor: 'solo' }, { state: {} }]) {
      const result = await request('/rooms/' + id + '/commands', { protocol: ONLINE_PROTOCOL, commandId: randomUUID(), expectedRevision: s.revision,
        command: { type: 'action', action: { type: 'guard', unitId: unit(s, 'K'), ...extra } } }, a);
      expect(result.status).toBe(400);
    }
    expect((await request('/rooms', { protocol: ONLINE_PROTOCOL, requestId: randomUUID(), name: 'X', options: { seed: 1 } }, a)).status).toBe(400);
    expect((await request('/rooms', { protocol: 'other-v1', requestId: randomUUID(), name: 'X', options: {} }, a)).status).toBe(409);
    expect((await snapshot(id, a)).state).toEqual(s.state);
  });

  it('keeps the training boss and tutorial/editor modes outside the network protocol', async () => {
    const a = await guest();
    for (const options of [{ boss: 'sentinel' }, { mode: 'tutorial' }, { mode: 'practice' }, { boss: 'sentinel', mode: 'hunt' }]) {
      const response = await request('/rooms', { protocol: ONLINE_PROTOCOL, requestId: randomUUID(), name: 'Training', options }, a);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalidMessage' });
    }
  });

  it('finishes an accepted command body and preserves its exact receipt while HTTP drains', async () => {
    const { a, id } = await pair();
    const state = await snapshot(id, a);
    const input: CommandEnvelope = { protocol: ONLINE_PROTOCOL, commandId: randomUUID(), expectedRevision: state.revision,
      command: { type: 'action', action: { type: 'guard', unitId: unit(state, 'K') } } };
    const body = JSON.stringify(input);
    const address = new URL(origin);
    const socket = connect(Number(address.port), address.hostname);
    socket.on('error', () => {});
    let response = '';
    socket.on('data', chunk => { response += chunk.toString(); });
    try {
      await once(socket, 'connect');
      const accepted = once(app.server, 'request');
      socket.write(`POST /api/colossus/rooms/${id}/commands HTTP/1.1\r\nHost: ${address.host}\r\nOrigin: ${origin}\r\nCookie: ${a}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n` + body.slice(0, 1));
      await accepted;
      const received = once(socket, 'end');
      const closing = app.close();
      expect(app.close()).toBe(closing);
      socket.write(body.slice(1));
      await Promise.all([closing, received]);
      expect(response).toContain('200 OK');
      await boot();
      const replay = await command(id, a, input.command, input);
      expect(replay.response.status).toBe(200);
      expect(replay.data.ack.commandId).toBe(input.commandId);
      expect(replay.data.snapshot.state.commands).toBe(state.state.commands - 1);
      expect(replay.data.snapshot.state.units.find(candidate => candidate.id === unit(state, 'K'))?.shield).toBe(1);
    } finally { socket.destroy(); }
  });

  it('serializes simultaneous HTTP commands and simultaneous exact retries', async () => {
    const { a, b, id } = await pair(); const s = await snapshot(id, a);
    const make = (unitId: string): CommandEnvelope => ({ protocol: ONLINE_PROTOCOL, commandId: randomUUID(), expectedRevision: s.revision,
      command: { type: 'action', action: { type: 'guard', unitId } } });
    const responses = await Promise.all([unit(s, 'K'), unit(s, 'R')].map(u => request('/rooms/' + id + '/commands', make(u), a)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await snapshot(id, a)).state.commands).toBe(2);
    const current = await snapshot(id, b);
    const input: CommandEnvelope = { protocol: ONLINE_PROTOCOL, commandId: randomUUID(), expectedRevision: current.revision,
      command: { type: 'action', action: { type: 'guard', unitId: unit(current, 'Q') } } };
    const duplicates = await Promise.all([request('/rooms/' + id + '/commands', input, b), request('/rooms/' + id + '/commands', input, b)]);
    const data = await Promise.all(duplicates.map(r => r.json() as Promise<CommandResponse>));
    expect(duplicates.map(r => r.status)).toEqual([200, 200]); expect(data[0].ack).toEqual(data[1].ack);
    expect((await snapshot(id, a)).state.commands).toBe(1);
  });

  it('persists the complete private state and exact receipt across a real SQLite restart', async () => {
    const { a, b, id } = await pair(); const s = await snapshot(id, a);
    const first = await act(id, a, { type: 'guard', unitId: unit(s, 'K') });
    const privateBefore = app.colossus.store.load(id)!.state;
    await app.close(); await boot();
    expect(app.colossus.store.load(id)!.state).toEqual(privateBefore);
    const resumed = await snapshot(id, a); expect(resumed.paused).toBe(true); expect(resumed.state).toEqual(first.data.snapshot.state);
    const replay = await command(id, a, first.envelope.command, first.envelope);
    expect(replay.response.status).toBe(200); expect(replay.data.ack).toEqual(first.data.ack);
    await presence(id, a, true); await presence(id, b, true);
    const next = await act(id, b, { type: 'guard', unitId: unit(s, 'Q') }); expect(next.data.snapshot.state.commands).toBe(1);
  });

  it('pauses on explicit disconnect, enforces sixty seconds, then gives the survivor every role', async () => {
    const { a, b, id } = await pair(); const start = await snapshot(id, a);
    await presence(id, b, false);
    const paused = await snapshot(id, a); expect(paused.paused).toBe(true); expect(paused.canTakeover).toBe(false);
    expect((await command(id, a, { type: 'takeover' })).data.error).toBe('takeoverUnavailable');
    expect((await command(id, a, { type: 'action', action: { type: 'guard', unitId: unit(start, 'K') } })).data.error).toBe('partnerOffline');
    now += 60_001; await presence(id, a, true);
    const takeover = await command(id, a, { type: 'takeover' }); expect(takeover.response.status).toBe(200);
    expect(takeover.data.snapshot.state.control).toBe('A'); expect(takeover.data.snapshot.state.assisted).toBe(true);
    await act(id, a, { type: 'guard', unitId: unit(start, 'K') });
    await act(id, a, { type: 'guard', unitId: unit(start, 'Q') });
    await act(id, a, { type: 'guard', unitId: unit(start, 'R') });
    const next = await act(id, a, { type: 'end' }); expect(next.data.snapshot.state.round).toBe(2);
    await act(id, a, { type: 'card', cardId: 'stone-skin', targets: [unit(start, 'K')] });
    const finish = await act(id, a, { type: 'surrender' }); expect(finish.data.snapshot.state.outcome?.reason).toBe('surrender');
    expect(finish.data.snapshot.status).toBe('finished');
  });

  it('detects a lost polling lease and bases the grace period on disconnection rather than a new request', async () => {
    const { a, id } = await pair(); now += 15_001;
    const state = await presence(id, a, true); expect(state.players.B?.connected).toBe(false); expect(state.paused).toBe(true);
    expect(state.takeoverAt).toBe(1_000_000 + 15_000 + 60_000);
    now += 60_000; const later = await presence(id, a, true); expect(later.canTakeover).toBe(true);
    expect((await command(id, a, { type: 'takeover' })).response.status).toBe(200);
  });

  it('returns the partner only after survivor consent and at the next round boundary', async () => {
    const { a, b, id } = await takeOver(); await presence(id, b, true);
    const s = await snapshot(id, a);
    expect((await command(id, b, { type: 'request-return' })).response.status).toBe(200);
    expect((await command(id, b, { type: 'restore-control', accept: true })).response.status).toBe(403);
    const accepted = await command(id, a, { type: 'restore-control', accept: true });
    expect(accepted.data.snapshot.restoreScheduled).toBe(true); expect(accepted.data.snapshot.state.control).toBe('A');
    expect((await command(id, b, { type: 'action', action: { type: 'guard', unitId: unit(s, 'Q') } })).response.status).toBe(409);
    await act(id, a, { type: 'guard', unitId: unit(s, 'K') });
    await act(id, a, { type: 'guard', unitId: unit(s, 'Q') });
    await act(id, a, { type: 'guard', unitId: unit(s, 'R') });
    const next = await act(id, a, { type: 'end' });
    expect(next.data.snapshot.state.control).toBe('shared'); expect(next.data.snapshot.restoreScheduled).toBe(false);
    expect(next.data.snapshot.state.round).toBe(2); expect(next.data.snapshot.state.assisted).toBe(true);
    await act(id, b, { type: 'guard', unitId: unit(s, 'Q') });
  });

  it('does not restart an already elapsed takeover grace period when the server restarts', async () => {
    const { a, id } = await pair();
    now += 75_001; await app.close(); await boot();
    const resumed = await presence(id, a, true);
    expect(resumed.takeoverAt).toBe(1_000_000 + 15_000 + 60_000);
    expect(resumed.canTakeover).toBe(true);
    expect((await command(id, a, { type: 'takeover' })).response.status).toBe(200);
  });

  it('commits a terminal victory once and preserves its receipt after restart', async () => {
    const { a, b, id } = await pair();
    // Controlled server-only position; no HTTP editor or custom-state endpoint exists.
    const stored = app.colossus.store.load(id)!;
    stored.state.boss.armor = 0; stored.state.boss.hp = 1;
    stored.state.units.find(u => u.type === 'Q')!.square = 27;
    app.colossus.store.save(stored);
    await act(id, a, { type: 'transfer' });
    const before = await snapshot(id, b);
    const win = await act(id, b, { type: 'attack', unitId: unit(before, 'Q'), target: before.state.boss.anchor });
    expect(win.data.snapshot.status).toBe('finished'); expect(win.data.snapshot.state.outcome?.winner).toBe('army');
    expect((await command(id, b, { type: 'action', action: { type: 'end' } })).data.error).toBe('finished');
    const duplicate = await command(id, b, win.envelope.command, win.envelope); expect(duplicate.data.ack).toEqual(win.data.ack);
    await app.close(); await boot();
    const replay = await command(id, b, win.envelope.command, win.envelope); expect(replay.data.ack).toEqual(win.data.ack);
    expect(replay.data.snapshot.state).toEqual(win.data.snapshot.state);
  });
});
