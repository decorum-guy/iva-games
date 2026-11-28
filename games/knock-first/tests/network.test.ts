import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { LIVE_PROTOCOL } from '@iva-games/session-kit';
import { KNOCK_WIRE } from '../src/runtime';
import { cleanupNetworkFixtures, fixture, ORIGIN, scope } from './helpers/network-fixture';
afterEach(cleanupNetworkFixtures);

describe('Knock First through the shared authenticated HTTP/WebSocket gateway', () => {
  it('two independent sessions receive personalized first snapshots in a mixed room', async () => {
    const f = await fixture(), a = f.connect(f.clients[0]), b = f.connect(f.clients[1]);
    const [first, second] = await Promise.all([a.frame('snapshot'), b.frame('snapshot')]);
    expect(first.view!.self.id).not.toBe(second.view!.self.id);
    expect(first.view!.team).toHaveLength(3); expect(first.view!.team.filter(p => p.kind === 'bot')).toHaveLength(1);
    for (const frame of [first, second]) {
      expect(frame.protocol).toBe(LIVE_PROTOCOL); expect(frame.wireVersion).toBe(KNOCK_WIRE); expect(frame.matchId).toBe(f.room.matchId); expect(frame.tick).toBe(0);
      expect(frame.view!.listener).toBeNull(); expect(frame.view!.batteries).toEqual([]);
      const serialized = JSON.stringify(frame); for (const key of ['patrolIndex', 'botTarget', 'knownBatteries', 'request_hash', 'state_json']) expect(serialized).not.toContain(key);
    }
    expect((await a.command(first, { type: 'ready' })).result?.ok).toBe(true);
    expect((await b.command(second, { type: 'ready' })).result?.ok).toBe(true);
    f.game.knock.tick();
    const next = await a.until(() => a.messages.find(m => m.type === 'snapshot' && m.view!.phase === 'active'));
    expect(next.view!.team.every(p => p.ready)).toBe(true);
    expect((await f.http(f.clients[0], `/rooms/${f.room.roomId}`)).status).toBe(200);
  });

  it('rejects untrusted origin, anonymous, non-member, and URL credentials or scope before upgrade', async () => {
    const f = await fixture();
    expect(await f.denied(f.clients[0], { origin: 'http://other.test' })).toBe(403);
    expect(await f.denied(f.clients[0], { cookie: '' })).toBe(401);
    expect(await f.denied(f.clients[2])).toBe(403);
    expect(await f.denied(f.clients[0], { query: '?matchId=not-the-room-match' })).toBe(400);
    expect(await f.denied(f.clients[0], { query: '?token=forbidden-url-token' })).toBe(400);
  });

  it('reconnect gives exactly one current controller and replays a durable receipt without repeating the action', async () => {
    const f = await fixture(), a = f.connect(), first = await a.frame('snapshot'), actionId = randomUUID();
    const accepted = await a.command(first, { type: 'ready' }, actionId);
    const b = f.connect(), second = await b.frame('snapshot');
    expect(second.epoch).not.toBe(first.epoch);
    expect(second.view!.self.controllerEpoch).toBe(first.view!.self.controllerEpoch + 1);
    expect(await a.closed()).toBe(4001);
    const retried = await b.command(second, { type: 'ready' }, actionId);
    expect(retried.result).toEqual(accepted.result);
    expect(second.epoch).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('rejects supplied mismatched session scopes and correlates malformed actions to their request', async () => {
    const f = await fixture();
    for (const override of [{ matchId: 'another-match' }, { epoch: 'old-epoch' }, { wireVersion: 'old' }]) {
      const a = f.connect(), first = await a.frame('snapshot'), actionId = randomUUID();
      const frame: Record<string, unknown> = { ...scope(first), type: 'command', actionId, expectedRevision: 0, payload: { epoch: first.epoch, payload: { type: 'ready' } } };
      a.send(Object.assign(frame, override));
      expect((await a.frame('error')).code).toBe('LIVE_SCOPE_MISMATCH');
      expect(await a.closed()).toBe(4003);
    }
    const a = f.connect(), first = await a.frame('snapshot');
    const invalid = await a.command(first, { type: 'takeHandle', batteryId: 'battery-1', handle: '0' });
    expect(invalid.type).toBe('error'); expect(invalid.code).toBe('INVALID_ACTION');
  });

  it('revoking a platform cookie closes its existing live channel', async () => {
    const f = await fixture(), a = f.connect(); await a.frame('snapshot');
    expect((await f.http(f.clients[0], '/auth/logout', {})).status).toBe(200);
    expect(await a.closed()).toBe(4003);
    expect(await f.denied(f.clients[0])).toBe(401);
  });

  it('bounds input traffic and rejects invalid JSON, binary frames, and oversized packets', async () => {
    const f = await fixture(), a = f.connect(), first = await a.frame('snapshot');
    for (let seq = 0; seq < 40; seq++) a.send({ ...scope(first), type: 'input', seq, payload: { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, run: false, quiet: false, hand: false } });
    const accepted = await a.until(() => a.messages.find(m => m.type === 'snapshot' && (m.lastAcceptedSeq ?? -1) >= 0));
    expect(accepted.lastAcceptedSeq).toBeLessThanOrEqual(29);
    a.socket.send('{'); expect((await a.frame('error')).code).toBe('INVALID_FRAME');
    a.socket.send(Buffer.from('binary')); expect(await a.closed()).toBe(1008);
    const b = f.connect(); await b.frame('snapshot'); b.socket.send('x'.repeat(20_000)); expect(await b.closed()).toBe(1009);
  });

  it('a malformed HTTP upgrade does not steal the active controller', async () => {
    const f = await fixture(), a = f.connect(), first = await a.frame('snapshot');
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`http://${f.endpoint}/api/platform/v1/rooms/${f.room.roomId}/live`, { headers: { Host: 'knock-network.test', Origin: ORIGIN, Cookie: f.clients[0].cookie, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'bad-key' } }, res => { res.resume(); resolve(res.statusCode!); });
      req.on('error', reject); req.end();
    });
    expect(status).toBe(400);
    expect((await a.command(first, { type: 'ready' })).result?.ok).toBe(true);
    expect(a.closeCode).toBeNull();
  });

});
