import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDistrictRegistration } from '@iva-games/district/runtime';
import { DEFAULT_ISLAND_MAP_ID, DISTRICT_ISLAND_MAPS, DISTRICT_MAPS } from '@iva-games/district/maps';
import type { DistrictView } from '@iva-games/district';
import { createPlatformLabRegistration } from '@iva-games/session-kit/lab';
import { PlatformService } from '../src/service';
import { createPlatformHttpServer } from '../src/http';
import { MemoryMailbox } from '../src/mail';
import type { Room } from '../src/types';

const fixtures: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => { for (const f of fixtures) await f.stop(); fixtures.length = 0; });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'iva-district-platform-'));
  const now = { value: 1_000_000 };
  const lab = createPlatformLabRegistration({ databasePath: join(directory, 'runtime.sqlite'), now: () => now.value });
  const district = createDistrictRegistration({ databasePath: join(directory, 'runtime.sqlite'), now: () => now.value });
  const mail = new MemoryMailbox();
  const platform = new PlatformService({ databasePath: join(directory, 'platform.sqlite'), publicOrigin: 'http://district.test', mail, games: [lab, district], now: () => now.value });
  await platform.ready;
  const server = createPlatformHttpServer(platform, { publicOrigin: 'http://district.test', allowedHosts: ['district.test'], secureCookies: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/platform/v1`;
  const stop = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await platform.settle(); platform.close(); lab.close(); district.close(); await rm(directory, { recursive: true, force: true });
  };
  fixtures.push({ stop });
  async function signup(handle: string) {
    const account = await platform.register({ email: `${handle}@example.test`, handle, displayName: handle, password: 'This is a long test password 101' });
    const link = mail.messages.find(message => message.to === `${handle}@example.test`)!.text.match(/https?:\/\/\S+/)![0];
    platform.verifyEmail(new URL(link).searchParams.get('token'));
    return {
      id: account.user.playerId,
      async request<T>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
        return new Promise((resolve, reject) => {
          const request = httpRequest(endpoint + path, { method: body === undefined ? 'GET' : 'POST', headers: {
            Host: 'district.test', Origin: 'http://district.test', Cookie: `iva_dev_session=${account.token}`,
            'X-CSRF-Token': account.session.csrfToken, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          } }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) as T }));
          });
          request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
        });
      },
    };
  }
  return { platform, district, signup, now, directory };
}

describe('District platform integration', () => {
  it('exposes a playable bot-capable game and validates/persists map selection through HTTP', async () => {
    const f = await fixture();
    const host = await f.signup('host');
    expect(f.platform.catalogue().find(game => game.gameId === 'district')).toMatchObject({ status: 'available', supportsBots: true, minPlayers: 2, maxPlayers: 4 });
    expect(f.platform.catalogue().find(game => game.gameId === 'district')).not.toHaveProperty('normalizeSettings');
    const map = DISTRICT_ISLAND_MAPS.find(item => item.id === DEFAULT_ISLAND_MAP_ID)!;
    const created = await host.request<{ room: Room }>('/rooms', { gameId: 'district', capacity: 3, settings: { mapId: map.id, mapVersion: map.version } });
    expect(created.status).toBe(200);
    let room = created.body.room;
    expect(room).toMatchObject({ rulesVersion: 'district@0.3', contentVersion: 'district-maps@0.2' });
    expect(room.settings).toEqual({ mapId: map.id, mapVersion: map.version });
    f.platform.setReady(host.id, room.roomId, { ready: true, expectedRevision: room.revision });
    const selected = DISTRICT_ISLAND_MAPS.find(item => item.id !== map.id) ?? map;
    const changed = await host.request<{ room: Room }>(`/rooms/${room.roomId}/settings`, { expectedRevision: room.revision, settings: { mapId: selected.id } });
    expect(changed.status).toBe(200);
    room = changed.body.room;
    expect(room.settings).toEqual({ mapId: selected.id, mapVersion: selected.version });
    expect(room.members[0].ready).toBe(false);
    const invalid = await host.request<{ error: { code: string } }>(`/rooms/${room.roomId}/settings`, { expectedRevision: room.revision, settings: { mapId: DISTRICT_MAPS[0].id } });
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: 'INVALID_SETTINGS' } } });
    expect(f.platform.getRoom(host.id, room.roomId).settings).toEqual(room.settings);
    expect(f.platform.getRoom(host.id, room.roomId).revision).toBe(room.revision);
    const extra = await host.request<{ error: { code: string } }>('/rooms', { gameId: 'district', capacity: 2, settings: { mapId: map.id, timerMs: 1 } });
    expect(extra.status).toBe(400);
    const labExtra = await host.request<{ error: { code: string } }>('/rooms', { gameId: 'platform-lab', capacity: 2, settings: { mapId: map.id } });
    expect(labExtra).toMatchObject({ status: 400, body: { error: { code: 'INVALID_SETTINGS' } } });
  });

  it('starts a persisted v0.2 lobby with its legacy map selection, bot version and snapshot', async () => {
    const f = await fixture();
    const host = await f.signup('host');
    const created = f.platform.createRoom(host.id, { gameId: 'district', capacity: 2 });
    expect(created.settings.mapId).toBe(DEFAULT_ISLAND_MAP_ID);
    const db = new Database(join(f.directory, 'platform.sqlite'));
    try {
      db.prepare('UPDATE rooms SET rules_version=?,content_version=?,settings_json=? WHERE room_id=?')
        .run('district@0.2', 'district-maps@0.1', JSON.stringify({ mapId: 'crossroads', mapVersion: '1' }), created.roomId);
    } finally { db.close(); }

    let room = f.platform.getRoom(host.id, created.roomId);
    const settingsPath = `/rooms/${room.roomId}/settings`;
    const rejected = await host.request(settingsPath, { expectedRevision: room.revision, settings: { mapId: DEFAULT_ISLAND_MAP_ID } });
    expect(rejected).toMatchObject({ status: 400, body: { error: { code: 'INVALID_SETTINGS' } } });
    const other = DISTRICT_MAPS.find(item => item.id !== 'crossroads')!;
    const changed = await host.request<{ room: Room }>(settingsPath, { expectedRevision: room.revision, settings: { mapId: other.id } });
    expect(changed.status).toBe(200);
    room = changed.body.room;
    expect(room.settings).toEqual({ mapId: other.id, mapVersion: other.version });
    room = f.platform.addBot(host.id, room.roomId, { expectedRevision: room.revision, difficulty: 'normal' });
    expect(room.members.find(member => member.controller.kind === 'bot')?.controller).toMatchObject({ botVersion: '1' });
    f.platform.setReady(host.id, room.roomId, { ready: true, expectedRevision: room.revision });
    const started = await host.request<{ room: Room }>(`/rooms/${room.roomId}/start`, { expectedRevision: room.revision });
    expect(started.body.room).toMatchObject({ state: 'playing', rulesVersion: 'district@0.2', contentVersion: 'district-maps@0.1' });
    const runtimeDb = new Database(join(f.directory, 'runtime.sqlite'), { readonly: true });
    try {
      const snapshot = runtimeDb.prepare('SELECT state FROM district_matches WHERE match_id=?').pluck().get(started.body.room.matchId) as string;
      expect(JSON.parse(snapshot)).toMatchObject({ schemaVersion: 1, rulesVersion: 'district@0.2', contentVersion: 'district-maps@0.1', map: other });
    } finally { runtimeDb.close(); }
  });

  it('starts a mixed room with friends, freezes its map, rejects outsiders and reports abandonment once', async () => {
    const f = await fixture();
    const host = await f.signup('host');
    const friend = await f.signup('friend');
    const outsider = await f.signup('outsider');
    const friendship = f.platform.requestFriend(host.id, friend.id);
    f.platform.respondFriend(friend.id, friendship.requestId, 'accept');
    const map = DISTRICT_ISLAND_MAPS.find(item => item.id === DEFAULT_ISLAND_MAP_ID)!;
    let room = f.platform.createRoom(host.id, { gameId: 'district', capacity: 3, settings: { mapId: map.id, mapVersion: map.version } });
    const invite = f.platform.invite(host.id, room.roomId, friend.id);
    f.platform.acceptInvitation(friend.id, invite.invitationId);
    room = f.platform.joinRoom(friend.id, room.roomId);
    room = f.platform.addBot(host.id, room.roomId, { difficulty: 'hard', expectedRevision: room.revision });
    expect(room.members.find(member => member.controller.kind === 'bot')?.controller).toMatchObject({ botVersion: '2' });
    expect(() => f.platform.changeSettings(friend.id, room.roomId, { expectedRevision: room.revision, settings: { mapId: 'crossroads' } })).toThrow();
    f.platform.setReady(host.id, room.roomId, { expectedRevision: room.revision, ready: true });
    f.platform.setReady(friend.id, room.roomId, { expectedRevision: room.revision, ready: true });
    const started = await host.request<{ room: Room }>(`/rooms/${room.roomId}/start`, { expectedRevision: room.revision });
    expect(started.status).toBe(200); room = started.body.room;
    expect(room.state).toBe('playing'); expect(room.matchId).toBeTruthy();
    const view = await f.platform.matchView(host.id, room.roomId) as DistrictView;
    expect(view.map.id).toBe(map.id);
    expect(view.players.filter(p => p.isBot)).toHaveLength(1);
    const changed = await host.request<{ error: { code: string } }>(`/rooms/${room.roomId}/settings`, { expectedRevision: room.revision, settings: { mapId: 'crossroads' } });
    expect(changed.status).toBe(409);
    await expect(f.platform.matchView(outsider.id, room.roomId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const firstLeave = await f.platform.matchAction(host.id, room.roomId, { actionId: 'host-leaves-match', expectedRevision: view.revision, payload: { phaseId: view.phaseId, type: 'leave' } }) as DistrictView;
    expect(firstLeave.phase).not.toBe('finished');
    const friendView = await f.platform.matchView(friend.id, room.roomId) as DistrictView;
    const abandoned = await f.platform.matchAction(friend.id, room.roomId, { actionId: 'friend-leaves-match', expectedRevision: friendView.revision, payload: { phaseId: friendView.phaseId, type: 'leave' } }) as DistrictView;
    expect(abandoned.outcome?.reason).toBe('abandoned');
    const completed = f.platform.getRoom(host.id, room.roomId);
    expect(completed.state).toBe('finished');
    expect(completed.outcome).toMatchObject({ reason: 'abandoned', winnerParticipantIds: [] });
    await f.platform.reconcile();
    expect(f.platform.getRoom(host.id, room.roomId).revision).toBe(completed.revision);
    expect(f.platform.catalogue().find(game => game.gameId === 'platform-lab')?.status).toBe('available');
  });
});
