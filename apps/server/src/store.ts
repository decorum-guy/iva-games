import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Side } from '@chess-2/remorse/core'
import type { OnlineAck, OnlineGameSnapshot, RoomStatus } from '@chess-2/remorse/online/protocol'
import { ONLINE_SAVE_VERSION } from '@chess-2/remorse/online/protocol'
import { OnlineError } from './validation'

export interface StoredSeat { guest: string; name: string; ready: boolean }
export interface StoredRoom {
  version: typeof ONLINE_SAVE_VERSION
  id: string
  owner: string
  createRequest: string
  createPayload: string
  inviteHash: string | null
  revision: number
  status: RoomStatus
  players: Record<Side, StoredSeat | null>
  game: OnlineGameSnapshot
  drawOffer: { id: string; from: Side } | null
  rematchVotes: Side[]
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export class RoomStore {
  private readonly db: Database.Database
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version !== 0 && version !== ONLINE_SAVE_VERSION) {
      this.db.close()
      throw new OnlineError('protocolMismatch', 503)
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guests (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, create_request TEXT NOT NULL,
        status TEXT NOT NULL, expires_at INTEGER NOT NULL, data TEXT NOT NULL,
        UNIQUE(owner, create_request)
      );
      CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires_at);
      CREATE TABLE IF NOT EXISTS commands (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL, guest TEXT NOT NULL, payload TEXT NOT NULL, ack TEXT NOT NULL,
        PRIMARY KEY(room_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS finished_games (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        data TEXT NOT NULL, finished_at INTEGER NOT NULL
      );
      PRAGMA user_version = 1;
    `)
  }

  transaction<T>(work: () => T): T { return this.db.transaction(work)() }
  health() { this.db.prepare('SELECT 1').get() }
  close() { this.db.close() }

  guest(hash: string, now: number): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM guests WHERE hash = ? AND expires_at > ?').get(hash, now))
  }
  saveGuest(hash: string, expiresAt: number) {
    this.db.prepare('INSERT INTO guests(hash, expires_at) VALUES (?, ?) ON CONFLICT(hash) DO UPDATE SET expires_at = excluded.expires_at').run(hash, expiresAt)
  }
  load(id: string): StoredRoom | null {
    const row = this.db.prepare('SELECT data FROM rooms WHERE id = ?').get(id) as { data: string } | undefined
    if (!row) return null
    const room = JSON.parse(row.data) as StoredRoom
    if (room.version !== ONLINE_SAVE_VERSION) throw new OnlineError('protocolMismatch', 409)
    return room
  }
  findCreated(owner: string, requestId: string): StoredRoom | null {
    const row = this.db.prepare('SELECT id FROM rooms WHERE owner = ? AND create_request = ?').get(owner, requestId) as { id: string } | undefined
    return row ? this.load(row.id) : null
  }
  activeOwned(owner: string): number {
    return (this.db.prepare("SELECT count(*) AS n FROM rooms WHERE owner = ? AND status IN ('waiting', 'playing')").get(owner) as { n: number }).n
  }
  save(room: StoredRoom) {
    this.db.prepare(`INSERT INTO rooms(id, owner, create_request, status, expires_at, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, expires_at = excluded.expires_at, data = excluded.data`)
      .run(room.id, room.owner, room.createRequest, room.status, room.expiresAt, JSON.stringify(room))
    if (room.game.state.outcome) {
      this.db.prepare('INSERT OR IGNORE INTO finished_games(id, room_id, data, finished_at) VALUES (?, ?, ?, ?)')
        .run(room.game.id, room.id, JSON.stringify(room.game), room.game.updatedAt)
    }
  }
  previousGame(id: string): OnlineGameSnapshot | null {
    const row = this.db.prepare('SELECT data FROM finished_games WHERE id = ?').get(id) as { data: string } | undefined
    return row ? JSON.parse(row.data) as OnlineGameSnapshot : null
  }
  ack(roomId: string, commandId: string): { guest: string; payload: string; ack: OnlineAck } | null {
    const row = this.db.prepare('SELECT guest, payload, ack FROM commands WHERE room_id = ? AND command_id = ?')
      .get(roomId, commandId) as { guest: string; payload: string; ack: string } | undefined
    return row ? { ...row, ack: JSON.parse(row.ack) as OnlineAck } : null
  }
  saveAck(roomId: string, guest: string, payload: string, ack: OnlineAck) {
    this.db.prepare('INSERT INTO commands(room_id, command_id, guest, payload, ack) VALUES (?, ?, ?, ?, ?)')
      .run(roomId, ack.commandId, guest, payload, JSON.stringify(ack))
  }
  due(now: number): string[] {
    return (this.db.prepare("SELECT id FROM rooms WHERE expires_at <= ? AND status != 'expired' ORDER BY expires_at LIMIT 100").all(now) as { id: string }[]).map(row => row.id)
  }
  prune(now: number, retention: number) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM rooms WHERE id IN (SELECT id FROM rooms WHERE status = 'expired' AND expires_at < ? LIMIT 100)").run(now - retention)
      this.db.prepare('DELETE FROM guests WHERE hash IN (SELECT hash FROM guests WHERE expires_at < ? LIMIT 100)').run(now)
    })
  }
}
