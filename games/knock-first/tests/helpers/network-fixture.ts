import { expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createKnockRegistration } from '../../src/runtime';
import type { CommandReceipt, PlayerView } from '../../src/core/types';
import { PlatformService } from '../../../../apps/platform/src/service';
import { createPlatformHttpServer } from '../../../../apps/platform/src/http';
import { MemoryMailbox } from '../../../../apps/platform/src/mail';
import type { LiveScope } from '@iva-games/session-kit';
import type { Room } from '../../../../apps/platform/src/types';

export const ORIGIN = 'http://knock-network.test';
export interface Frame extends LiveScope { type: string; tick?: number; view?: PlayerView; lastAcceptedSeq?: number; actionId?: string; result?: CommandReceipt; code?: string }
export const scope = (frame: Frame): LiveScope => ({ protocol: frame.protocol, wireVersion: frame.wireVersion, roomId: frame.roomId, matchId: frame.matchId, epoch: frame.epoch });
export class Peer {
  readonly messages: Frame[] = [];
  private waiters = new Set<() => void>();
  closeCode: number | null = null;
  constructor(readonly socket: WebSocket) {
    socket.on('message', data => { this.messages.push(JSON.parse(data.toString()) as Frame); for (const waiter of this.waiters) waiter(); });
    socket.on('close', code => { this.closeCode = code; for (const waiter of this.waiters) waiter(); });
    socket.on('error', () => {});
  }
  async until<T>(read: () => T | undefined, timeout = 2000): Promise<T> {
    const value = read(); if (value !== undefined) return value;
    return new Promise<T>((resolve, reject) => {
      const check = () => { const value = read(); if (value === undefined) return; clearTimeout(timer); this.waiters.delete(check); resolve(value); };
      const timer = setTimeout(() => { this.waiters.delete(check); reject(new Error('Timed out waiting for network event')); }, timeout);
      this.waiters.add(check);
    });
  }
  frame(type: string, actionId?: string): Promise<Frame> { return this.until(() => this.messages.find(m => m.type === type && (actionId === undefined || m.actionId === actionId))); }
  closed(): Promise<number> { return this.until(() => this.closeCode ?? undefined); }
  send(frame: Record<string, unknown>): void { this.socket.send(JSON.stringify(frame)); }
  async command(first: Frame, payload: unknown, actionId = randomUUID()): Promise<Frame> {
    this.send({ ...scope(first), type: 'command', actionId, expectedRevision: first.view!.revision, payload: { epoch: first.epoch, payload } });
    return this.until(() => this.messages.find(m => ['receipt', 'error'].includes(m.type) && m.actionId === actionId));
  }
}
interface Client { playerId: string; cookie: string; csrf: string; sessionHash: string }
const cleanups: (() => Promise<void>)[] = [];
export async function fixture(options: { autoTick?: boolean; capacity?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'knock-live-'));
  const game = createKnockRegistration({ databasePath: join(directory, 'runtime.sqlite'), autoTick: options.autoTick ?? false });
  const mail = new MemoryMailbox();
  const platform = new PlatformService({ databasePath: join(directory, 'platform.sqlite'), publicOrigin: ORIGIN, mail, games: [game] });
  await platform.ready;
  const clients: Client[] = [];
  for (const name of ['first', 'second', 'outside']) {
    const auth = await platform.register({ email: `${name}@example.test`, password: 'A local network test password 2026', handle: `knock_${name}`, displayName: name });
    const token = new URL(mail.messages.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token');
    platform.verifyEmail(token);
    clients.push({ playerId: auth.user.playerId, cookie: `iva_dev_session=${auth.token}`, csrf: auth.session.csrfToken, sessionHash: auth.session.sessionHash });
  }
  const [host, guest] = clients;
  const friendship = platform.requestFriend(host.playerId, guest.playerId); platform.respondFriend(guest.playerId, friendship.requestId, 'accept');
  async function createRoom(index = 0, capacity = 3): Promise<Room> {
    const owner = clients[index % 2], partner = clients[(index + 1) % 2];
    let current = platform.createRoom(owner.playerId, { gameId: 'knock-first', capacity, title: `Network test ${index}`, settings: { route: ['archive', 'pump', 'relay'][index % 3], difficulty: 'normal' } });
    const invite = platform.invite(owner.playerId, current.roomId, partner.playerId); platform.acceptInvitation(partner.playerId, invite.invitationId);
    current = platform.joinRoom(partner.playerId, current.roomId);
    for (let i = 2; i < capacity; i++) current = platform.addBot(owner.playerId, current.roomId, { difficulty: 'normal', expectedRevision: current.revision });
    platform.setReady(owner.playerId, current.roomId, { ready: true, expectedRevision: current.revision });
    platform.setReady(partner.playerId, current.roomId, { ready: true, expectedRevision: current.revision });
    platform.startRoom(owner.playerId, current.roomId, { expectedRevision: current.revision }); await platform.reconcile();
    current = platform.getRoom(owner.playerId, current.roomId); expect(current.state).toBe('playing'); return current;
  }
  const room = await createRoom(0, options.capacity ?? 3);
  const server = createPlatformHttpServer(platform, { publicOrigin: ORIGIN, allowedHosts: ['knock-network.test'], secureCookies: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const peers: Peer[] = [];
  cleanups.push(async () => { for (const peer of peers) peer.socket.terminate(); await server.shutdown(); await platform.settle(); platform.close(); game.close(); await rm(directory, { recursive: true, force: true }); });
  function connect(client = host, override: { origin?: string; cookie?: string; query?: string; room?: Room } = {}): Peer {
    const selected = override.room ?? room;
    const socket = new WebSocket(`ws://${endpoint}/api/platform/v1/rooms/${selected.roomId}/live${override.query ?? ''}`, { headers: { Host: 'knock-network.test', Origin: override.origin ?? ORIGIN, Cookie: override.cookie ?? client.cookie } });
    const peer = new Peer(socket); peers.push(peer); return peer;
  }
  async function denied(client: Client, override: Parameters<typeof connect>[1] = {}): Promise<number> {
    const peer = connect(client, override);
    return new Promise<number>((resolve, reject) => {
      peer.socket.on('unexpected-response', (_request, response) => { response.resume(); peer.socket.terminate(); resolve(response.statusCode!); });
      peer.socket.on('open', () => reject(new Error('Unauthorized upgrade accepted')));
    });
  }
  async function http(client: Client, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; data: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`http://${endpoint}/api/platform/v1${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Host: 'knock-network.test', Origin: ORIGIN, Cookie: client.cookie, 'X-CSRF-Token': client.csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra } }, res => {
        const chunks: Buffer[] = []; res.on('data', b => chunks.push(Buffer.from(b))); res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> }));
      }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  return { game, platform, clients, room, server, endpoint, connect, denied, http, createRoom };
}
export async function cleanupNetworkFixtures(): Promise<void> { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
