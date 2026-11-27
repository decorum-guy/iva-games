import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { applyAction, createGame, publicView, restoreGame, RuleError, setControl } from '@chess-2/colossus/core';
import type { Seat } from '@chess-2/colossus/core';
import { ONLINE_PROTOCOL, ONLINE_SAVE_VERSION, PRESENCE_TIMEOUT_MS, TAKEOVER_AFTER_MS } from '@chess-2/colossus/online/protocol';
import type { CommandEnvelope, CommandResponse, CreateRoomRequest, CreateRoomResponse, JoinRoomRequest, RoomSnapshot } from '@chess-2/colossus/online/protocol';
import { ColossusStore } from './store';
import type { StoredRoom } from './store';
import { canonical, ColossusError } from './validation';

const DAY = 86_400_000;
const secret = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const opposite = (seat: Seat): Seat => seat === 'A' ? 'B' : 'A';
export interface ServiceOptions { now?: () => number; inactiveMs?: number; finishedMs?: number; presenceTimeoutMs?: number }

export class ColossusRooms {
  private readonly now: () => number;
  private readonly presenceTimeout: number;
  private readonly inactiveMs: number;
  private readonly finishedMs: number;
  constructor(readonly store: ColossusStore, options: ServiceOptions = {}) {
    this.now = options.now ?? Date.now; this.presenceTimeout = options.presenceTimeoutMs ?? PRESENCE_TIMEOUT_MS;
    this.inactiveMs = options.inactiveMs ?? DAY; this.finishedMs = Math.max(7 * DAY, options.finishedMs ?? 0);
    // A restarted process has no live clients. Reconnection renews each seat explicitly.
    this.store.transaction(() => {
      for (const room of this.store.active()) {
        let changed = false;
        for (const seat of ['A', 'B'] as const) { const p = room.players[seat]; if (p?.connected) { p.connected = false; p.disconnectedAt = Math.min(this.now(), p.lastSeen + this.presenceTimeout); changed = true; } }
        if (changed) { room.revision++; this.store.save(room); }
      }
    });
  }
  ensureGuest(token?: string) {
    const valid = token && /^[a-zA-Z0-9_-]{43}$/.test(token) && this.store.guest(hash(token), this.now());
    const value = valid ? token! : secret(); const guest = hash(value);
    this.store.saveGuest(guest, this.now() + 30 * DAY); return { token: value, guest };
  }
  authenticate(token?: string) {
    if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
    const guest = hash(token); return this.store.guest(guest, this.now()) ? guest : null;
  }
  private seat(room: StoredRoom, guest: string): Seat {
    if (room.players.A?.guest === guest) return 'A'; if (room.players.B?.guest === guest) return 'B';
    throw new ColossusError('notYourSeat', 403);
  }
  private load(id: string): StoredRoom {
    const room = this.store.load(id); if (!room) throw new ColossusError('roomMissing', 404);
    try { room.state = restoreGame(room.state); } catch { throw new ColossusError('serverError', 500); }
    this.refresh(room); return room;
  }
  private refresh(room: StoredRoom) {
    let changed = false;
    if (room.status !== 'expired' && room.expiresAt <= this.now()) { room.status = 'expired'; changed = true; }
    for (const seat of ['A', 'B'] as const) {
      const player = room.players[seat];
      if (player?.connected && player.lastSeen + this.presenceTimeout <= this.now()) {
        player.connected = false; player.disconnectedAt = player.lastSeen + this.presenceTimeout; changed = true;
      }
    }
    if (changed) { room.revision++; this.store.save(room); }
  }
  private public(room: StoredRoom, guest: string): RoomSnapshot {
    const you = this.seat(room, guest); const other = room.players[opposite(you)];
    const owner = room.state.control === 'shared' ? null : room.players[room.state.control];
    const pauseReason = room.status === 'waiting' ? 'waiting'
      : room.status !== 'playing' ? null
      : room.state.control !== 'shared' ? owner?.connected ? null : 'controller-offline'
      : room.players.A?.connected && room.players.B?.connected ? null : 'partner-offline';
    const takeoverAt = room.status === 'playing' && other && !other.connected && room.state.control !== you
      ? (other.disconnectedAt ?? this.now()) + TAKEOVER_AFTER_MS : null;
    const player = (seat: Seat) => room.players[seat] ? { name: room.players[seat]!.name, connected: room.players[seat]!.connected } : null;
    return { protocol: ONLINE_PROTOCOL, id: room.id, revision: room.revision, status: room.status, you,
      players: { A: player('A'), B: player('B') }, state: publicView(room.state), paused: pauseReason !== null, pauseReason,
      takeoverAt, canTakeover: Boolean(room.players[you]?.connected && takeoverAt !== null && this.now() >= takeoverAt),
      returnRequested: room.returnRequested, restoreScheduled: room.restoreScheduled, serverTime: this.now(), expiresAt: room.expiresAt };
  }
  snapshot(id: string, guest: string) { return this.store.transaction(() => this.public(this.load(id), guest)); }
  create(guest: string, input: CreateRoomRequest): CreateRoomResponse {
    return this.store.transaction(() => {
      const payload = canonical({ name: input.name, options: input.options });
      const previous = this.store.created(guest, input.requestId);
      if (previous) {
        if (previous.createPayload !== payload) throw new ColossusError('commandConflict', 409);
        const room = this.load(previous.id); if (room.status === 'expired') throw new ColossusError('roomExpired', 410);
        const invite = room.status === 'waiting' ? secret() : '';
        if (invite) { room.inviteHash = hash(invite); this.store.save(room); }
        return { snapshot: this.public(room, guest), invite };
      }
      if (this.store.activeCount(guest) >= 6) throw new ColossusError('rateLimited', 429);
      const now = this.now(); const invite = secret();
      let state;
      try { state = createGame({ ...input.options, coop: true, seed: randomBytes(4).readUInt32BE() }); }
      catch (error) { if (error instanceof RuleError) throw new ColossusError(error.code, 409); throw error; }
      const room: StoredRoom = { version: ONLINE_SAVE_VERSION, id: randomUUID(), owner: guest, createRequest: input.requestId,
        createPayload: payload, inviteHash: hash(invite), revision: 0, status: 'waiting',
        players: { A: { guest, name: input.name, connected: true, lastSeen: now, disconnectedAt: null }, B: null },
        state, returnRequested: null, restoreScheduled: false, createdAt: now, updatedAt: now, expiresAt: now + this.inactiveMs };
      this.store.save(room); return { snapshot: this.public(room, guest), invite };
    });
  }
  join(id: string, guest: string, input: JoinRoomRequest): RoomSnapshot {
    return this.store.transaction(() => {
      const room = this.load(id);
      if (room.status === 'expired') throw new ColossusError('roomExpired', 410);
      if (room.players.A?.guest === guest) throw new ColossusError('sameGuest', 409);
      if (room.players.B?.guest === guest) return this.public(room, guest);
      if (room.status !== 'waiting' || room.players.B) throw new ColossusError('roomFull', 409);
      if (!room.inviteHash || !timingSafeEqual(Buffer.from(room.inviteHash, 'hex'), Buffer.from(hash(input.invite), 'hex'))) throw new ColossusError('inviteInvalid', 403);
      room.players.B = { guest, name: input.name, connected: true, lastSeen: this.now(), disconnectedAt: null };
      room.inviteHash = null; room.status = 'playing'; room.revision++; room.updatedAt = this.now(); room.expiresAt = this.now() + this.inactiveMs;
      this.store.save(room); return this.public(room, guest);
    });
  }
  invite(id: string, guest: string) {
    return this.store.transaction(() => {
      const room = this.load(id); if (room.owner !== guest) throw new ColossusError('notYourSeat', 403);
      if (room.status !== 'waiting') throw new ColossusError('roomFull', 409);
      const token = secret(); room.inviteHash = hash(token); this.store.save(room); return token;
    });
  }
  presence(id: string, guest: string, connected: boolean) {
    return this.store.transaction(() => {
      const room = this.load(id); const player = room.players[this.seat(room, guest)]!;
      if (player.connected !== connected) room.revision++;
      player.connected = connected;
      if (connected) { player.lastSeen = this.now(); player.disconnectedAt = null; }
      else player.disconnectedAt ??= this.now();
      this.store.save(room); return this.public(room, guest);
    });
  }
  execute(id: string, guest: string, input: CommandEnvelope): CommandResponse {
    return this.store.transaction(() => {
      const room = this.load(id); const seat = this.seat(room, guest); const payload = canonical(input);
      const previous = this.store.ack(id, input.commandId);
      if (previous) {
        if (previous.guest !== guest || previous.payload !== payload) throw new ColossusError('commandConflict', 409);
        return { ack: previous.ack, snapshot: this.public(room, guest) };
      }
      if (room.status === 'expired') throw new ColossusError('roomExpired', 410);
      if (input.expectedRevision !== room.revision) throw new ColossusError('staleRevision', 409);
      if (room.status === 'waiting') throw new ColossusError('notReady', 409);
      if (room.status === 'finished') throw new ColossusError('finished', 409);
      if (!room.players[seat]?.connected) throw new ColossusError('notConnected', 409);
      const command = input.command;
      if (command.type === 'takeover') {
        if (!this.public(room, guest).canTakeover) throw new ColossusError('takeoverUnavailable', 409);
        room.state = setControl(room.state, seat); room.returnRequested = null; room.restoreScheduled = false;
      } else if (command.type === 'request-return') {
        if (room.state.control === 'shared' || room.state.control === seat) throw new ColossusError('notTakenOver', 409);
        room.returnRequested = seat;
      } else if (command.type === 'restore-control') {
        if (room.state.control !== seat || !room.returnRequested) throw new ColossusError('notYourSeat', 403);
        if (!room.players[opposite(seat)]?.connected) throw new ColossusError('partnerOffline', 409);
        room.restoreScheduled = command.accept;
        if (!command.accept) room.returnRequested = null;
      } else {
        if (this.public(room, guest).paused) throw new ColossusError('partnerOffline', 409);
        const beforeRound = room.state.round, beforeBattle = room.state.campaignIndex;
        try { room.state = applyAction(room.state, command.action, seat); }
        catch (error) { if (error instanceof RuleError) throw new ColossusError(error.code, 409); throw error; }
        const boundary = room.state.round !== beforeRound || room.state.campaignIndex !== beforeBattle;
        if (room.restoreScheduled && boundary && room.players.A?.connected && room.players.B?.connected) {
          room.state = setControl(room.state, 'shared'); room.restoreScheduled = false; room.returnRequested = null;
        }
      }
      room.revision++; room.updatedAt = this.now();
      if (room.state.phase === 'finished') room.status = 'finished';
      room.expiresAt = this.now() + (room.status === 'finished' ? this.finishedMs : this.inactiveMs);
      const ack = { commandId: input.commandId, revision: room.revision, gameRevision: room.state.revision };
      this.store.save(room); this.store.saveAck(id, guest, payload, ack);
      return { ack, snapshot: this.public(room, guest) };
    });
  }
  cleanup() { this.store.transaction(() => { for (const room of this.store.active()) this.refresh(room); this.store.prune(this.now()); }); }
  close() {
    this.store.transaction(() => {
      for (const room of this.store.active()) {
        let changed = false;
        for (const seat of ['A', 'B'] as const) { const p = room.players[seat]; if (p?.connected) { p.connected = false; p.disconnectedAt = Math.min(this.now(), p.lastSeen + this.presenceTimeout); changed = true; } }
        if (changed) { room.revision++; this.store.save(room); }
      }
    });
    this.store.close();
  }
}
