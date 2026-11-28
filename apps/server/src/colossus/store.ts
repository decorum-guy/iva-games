import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameState, Seat } from '@chess-2/colossus/core';
import { ONLINE_SAVE_VERSION } from '@chess-2/colossus/online/protocol';
import type { CommandAck, RoomSnapshot } from '@chess-2/colossus/online/protocol';
import { ColossusError } from './validation';

export interface StoredSeat { guest: string; name: string; connected: boolean; lastSeen: number; disconnectedAt: number | null }
export interface StoredRoom {
  version: typeof ONLINE_SAVE_VERSION;
  id: string; owner: string; createRequest: string; createPayload: string; inviteHash: string | null;
  revision: number; status: RoomSnapshot['status']; players: Record<Seat, StoredSeat | null>;
  state: GameState; returnRequested: Seat | null; restoreScheduled: boolean;
  createdAt: number; updatedAt: number; expiresAt: number;
}
export class ColossusStore {
  private readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000');
    const app = this.db.pragma('application_id', { simple: true }) as number;
    const version = this.db.pragma('user_version', { simple: true }) as number;
    const occupied = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rooms'").get();
    if ((app === 0 && occupied) || (app !== 0 && app !== 0x434f4c53) || (version !== 0 && version !== ONLINE_SAVE_VERSION)) {
      this.db.close(); throw new ColossusError('protocolMismatch', 503);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS guests(hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, owner TEXT NOT NULL, create_request TEXT NOT NULL,
        status TEXT NOT NULL, expires_at INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(owner,create_request));
      CREATE INDEX IF NOT EXISTS room_expiry ON rooms(expires_at);
      CREATE TABLE IF NOT EXISTS commands(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL, guest TEXT NOT NULL, payload TEXT NOT NULL, ack TEXT NOT NULL, PRIMARY KEY(room_id,command_id));
      PRAGMA application_id=1129270355; PRAGMA user_version=1;`);
  }
  transaction<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
  health() { this.db.prepare('SELECT 1').get(); }
  close() { this.db.close(); }
  guest(hash: string, now: number) { return Boolean(this.db.prepare('SELECT 1 FROM guests WHERE hash=? AND expires_at>?').get(hash, now)); }
  saveGuest(hash: string, expires: number) { this.db.prepare('INSERT INTO guests VALUES (?,?) ON CONFLICT(hash) DO UPDATE SET expires_at=excluded.expires_at').run(hash, expires); }
  load(id: string): StoredRoom | null {
    const row = this.db.prepare('SELECT data FROM rooms WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) return null;
    const room = JSON.parse(row.data) as StoredRoom;
    if (room.version !== ONLINE_SAVE_VERSION) throw new ColossusError('protocolMismatch', 409);
    return room;
  }
  created(owner: string, request: string) {
    const row = this.db.prepare('SELECT id FROM rooms WHERE owner=? AND create_request=?').get(owner, request) as { id: string } | undefined;
    return row ? this.load(row.id) : null;
  }
  activeCount(owner: string) { return (this.db.prepare("SELECT count(*) n FROM rooms WHERE owner=? AND status IN ('waiting','playing')").get(owner) as { n: number }).n; }
  active(): StoredRoom[] { return (this.db.prepare("SELECT data FROM rooms WHERE status IN ('waiting','playing')").all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  save(room: StoredRoom) {
    this.db.prepare(`INSERT INTO rooms VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, expires_at=excluded.expires_at, data=excluded.data`)
      .run(room.id, room.owner, room.createRequest, room.status, room.expiresAt, JSON.stringify(room));
  }
  ack(room: string, command: string): { guest: string; payload: string; ack: CommandAck } | null {
    const row = this.db.prepare('SELECT guest,payload,ack FROM commands WHERE room_id=? AND command_id=?').get(room, command) as { guest: string; payload: string; ack: string } | undefined;
    return row ? { ...row, ack: JSON.parse(row.ack) } : null;
  }
  saveAck(room: string, guest: string, payload: string, ack: CommandAck) {
    this.db.prepare('INSERT INTO commands VALUES (?,?,?,?,?)').run(room, ack.commandId, guest, payload, JSON.stringify(ack));
  }
  prune(now: number) {
    this.db.prepare("DELETE FROM rooms WHERE expires_at<? AND status='expired'").run(now - 7 * 86_400_000);
    this.db.prepare('DELETE FROM guests WHERE expires_at<?').run(now);
  }
}
