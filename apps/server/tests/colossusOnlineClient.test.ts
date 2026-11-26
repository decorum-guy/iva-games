import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, publicView } from '@chess-2/colossus/core';
import { ONLINE_PROTOCOL } from '@chess-2/colossus/online/protocol';
import type { RoomSnapshot } from '@chess-2/colossus/online/protocol';
import { ColossusOnlineClient } from '../../../games/chess/colossus/src/online/client';

function room(id = 'room-one', revision = 0): RoomSnapshot {
  return { protocol: ONLINE_PROTOCOL, id, revision, status: 'playing', you: 'A', players: { A: { name: 'A', connected: true }, B: { name: 'B', connected: true } },
    state: publicView(createGame({ coop: true })), paused: false, pauseReason: null, takeoverAt: null, canTakeover: false,
    returnRequested: null, restoreScheduled: false, serverTime: 1_000, expiresAt: 100_000 };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('Colossus browser transport recovery', () => {
  it('retains the exact uncertain command across network, 5xx, rate-limit and truncated-response failures', async () => {
    const client = new ColossusOnlineClient(); client.snapshot = room();
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      if (bodies.length === 1) throw new Error('connection lost after possible commit');
      if (bodies.length === 2) return json({ error: 'serverError' }, 503);
      if (bodies.length === 3) return json({ error: 'rateLimited' }, 429);
      if (bodies.length === 4) return new Response('truncated', { status: 200 });
      const envelope = JSON.parse(String(init.body));
      return json({ ack: { commandId: envelope.commandId, revision: 1, gameRevision: 1 }, snapshot: room('room-one', 1) });
    }));
    await expect(client.action({ type: 'guard', unitId: 'king' })).rejects.toMatchObject({ code: 'networkError' });
    await expect(client.action({ type: 'end' })).rejects.toMatchObject({ code: 'commandPending' });
    for (let i = 0; i < 3; i++) { await expect(client.retryPending()).rejects.toBeDefined(); expect(client.hasPendingCommand()).toBe(true); }
    await client.retryPending();
    expect(bodies.length).toBe(5); expect(new Set(bodies).size).toBe(1); expect(client.hasPendingCommand()).toBe(false);
    expect(client.snapshot?.revision).toBe(1);
  });

  it('refreshes a definitively rejected stale command without automatically resending it', async () => {
    const client = new ColossusOnlineClient(); client.snapshot = room();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === 'POST' ? json({ error: 'staleRevision' }, 409) : json({ snapshot: room('room-one', 3) }));
    vi.stubGlobal('fetch', fetcher);
    await expect(client.action({ type: 'guard', unitId: 'king' })).rejects.toMatchObject({ code: 'staleRevision' });
    expect(client.hasPendingCommand()).toBe(false); expect(client.snapshot?.revision).toBe(3); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not let a late old-room heartbeat overwrite a newly loaded room', async () => {
    const client = new ColossusOnlineClient(); client.snapshot = room('old-room');
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/old-room/presence')) return new Promise<Response>(resolve => { release = resolve; });
      if (url.endsWith('/guest')) return json({ protocol: ONLINE_PROTOCOL });
      return json({ snapshot: room('new-room', 2) });
    }));
    const old = client.presence();
    await client.load('new-room');
    release(json({ snapshot: room('old-room', 50) })); await old;
    expect(client.snapshot?.id).toBe('new-room'); expect(client.snapshot?.revision).toBe(2);
  });

  it('reuses the create request ID after a lost response, preventing duplicate rooms', async () => {
    const client = new ColossusOnlineClient(); const requests: Array<{ requestId: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/guest')) return json({ protocol: ONLINE_PROTOCOL });
      requests.push(JSON.parse(String(init.body)));
      if (requests.length === 1) throw new Error('create receipt lost');
      return json({ snapshot: room(), invite: 'invitation' });
    }));
    await expect(client.create('A')).rejects.toMatchObject({ code: 'networkError' });
    await client.create('A'); expect(requests).toHaveLength(2); expect(requests[0].requestId).toBe(requests[1].requestId);
  });
});
