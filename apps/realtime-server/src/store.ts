import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hash } from './crypto.js';

export interface FrozenParticipant { participantId: string; playerId: string | null; displayName: string; team: 'A' | 'B'; controller: 'human' | 'bot' }
export interface Control { generation: number; connectionId: string | null; lastActivity: number; lastInputAt: number; inputSeq: number; consumed: number; temporaryBot: boolean }
export interface StoredMatch {
  matchId: string; startId: string; fingerprint: string; roomId: string; kind: 'account' | 'practice'; ownerHash: string | null;
  roster: FrozenParticipant[]; rosterHash: string; rulesVersion: string; contentVersion: string; manifest: Record<string, string>;
  world: string; worldHash: string; tick: number; epoch: number; ownerEpoch: number; journalSeq: number;
  controls: Record<string, Control>; phase: string; lastHumanAt: number; pausedAt: number | null;
  expiresAt: number; pendingOutcome: unknown; outcome: unknown; countdownUntil: number; createdAt: number;
}
export interface Receipt { matchId: string; participantId: string; actionId: string; payloadHash: string; result: unknown; epoch: number; seq: number }
export interface Commit {
  match: StoredMatch; leaseOwner: string; journal: unknown; receipts: Receipt[]; result?: { resultId: string; outcome: unknown };
}
export class RealtimeStore {
  readonly db: Database.Database;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL'); this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 3000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rt_matches (
        match_id TEXT PRIMARY KEY, start_id TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
        record_json TEXT NOT NULL, world_hash TEXT NOT NULL, owner_epoch INTEGER NOT NULL,
        lease_owner TEXT NOT NULL, lease_until INTEGER NOT NULL, journal_seq INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, phase TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rt_journal (
        match_id TEXT NOT NULL REFERENCES rt_matches(match_id), seq INTEGER NOT NULL,
        tick INTEGER NOT NULL, record_json TEXT NOT NULL, world_hash TEXT NOT NULL,
        PRIMARY KEY (match_id, seq)
      );
      CREATE TABLE IF NOT EXISTS rt_checkpoints (
        match_id TEXT NOT NULL REFERENCES rt_matches(match_id), seq INTEGER NOT NULL,
        record_json TEXT NOT NULL, world_hash TEXT NOT NULL, PRIMARY KEY (match_id,seq)
      );
      CREATE TABLE IF NOT EXISTS rt_actions (
        match_id TEXT NOT NULL REFERENCES rt_matches(match_id), action_id TEXT NOT NULL,
        participant_id TEXT NOT NULL, payload_hash TEXT NOT NULL, record_json TEXT NOT NULL,
        PRIMARY KEY(match_id, action_id)
      );
      CREATE TABLE IF NOT EXISTS rt_tickets (ticket_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rt_bridge_requests (request_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rt_outbox (result_id TEXT PRIMARY KEY, match_id TEXT NOT NULL, payload_json TEXT NOT NULL, delivered_at INTEGER);
      CREATE TABLE IF NOT EXISTS rt_admissions (admission_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    `);
  }
  status() { return { journalMode: this.db.pragma('journal_mode', { simple: true }), synchronous: this.db.pragma('synchronous', { simple: true }), integrity: this.db.pragma('quick_check', { simple: true }) }; }
  list(): StoredMatch[] { return (this.db.prepare("SELECT record_json FROM rt_matches WHERE expires_at>? OR phase NOT IN ('finished','abandoned')").all(Date.now()) as {record_json: string}[]).map(r => JSON.parse(r.record_json) as StoredMatch); }
  get(matchId: string): StoredMatch | null {
    const row = this.db.prepare('SELECT record_json,world_hash FROM rt_matches WHERE match_id=?').get(matchId) as {record_json: string; world_hash: string} | undefined;
    if (!row) return null;
    const match = JSON.parse(row.record_json) as StoredMatch;
    if (hash(match.world) !== row.world_hash || match.worldHash !== row.world_hash) throw new Error('RECOVERY_CHECKSUM');
    if (match.journalSeq > 0) {
      const journal = this.db.prepare('SELECT tick,world_hash FROM rt_journal WHERE match_id=? AND seq=?').get(matchId, match.journalSeq) as {tick: number; world_hash: string} | undefined;
      if (!journal || journal.tick !== match.tick || journal.world_hash !== match.worldHash) throw new Error('RECOVERY_CHECKSUM');
    }
    return match;
  }
  byStart(startId: string): StoredMatch | null {
    const row = this.db.prepare('SELECT match_id FROM rt_matches WHERE start_id=?').get(startId) as {match_id: string} | undefined;
    return row ? this.get(row.match_id) : null;
  }
  create(match: StoredMatch, leaseOwner: string): StoredMatch {
    return this.db.transaction(() => {
      const old = this.byStart(match.startId);
      if (old) { if (old.fingerprint !== match.fingerprint) throw new Error('START_CONFLICT'); return old; }
      this.db.prepare('INSERT INTO rt_matches VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(match.matchId, match.startId, match.fingerprint,
        JSON.stringify(match), match.worldHash, match.ownerEpoch, leaseOwner, Date.now() + 15_000, match.journalSeq, match.expiresAt, match.phase);
      this.db.prepare('INSERT INTO rt_checkpoints VALUES (?,?,?,?)').run(match.matchId, match.journalSeq, JSON.stringify(match), match.worldHash);
      return match;
    }).immediate();
  }
  acquire(matchId: string, leaseOwner: string, now = Date.now()): StoredMatch {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT lease_owner,lease_until FROM rt_matches WHERE match_id=?').get(matchId) as {lease_owner: string; lease_until: number} | undefined;
      if (!row) throw new Error('MATCH_UNAVAILABLE');
      if (row.lease_owner !== leaseOwner && row.lease_until > now) throw new Error('MATCH_OWNED');
      const match = this.get(matchId)!;
      match.ownerEpoch++; match.epoch++; match.countdownUntil = now + 3000;
      for (const control of Object.values(match.controls)) { control.connectionId = null; control.generation++; control.lastActivity = 0; control.lastInputAt = 0; }
      if (!['finished', 'abandoned'].includes(match.phase)) { match.phase = 'paused'; match.pausedAt ??= now; }
      this.db.prepare('UPDATE rt_matches SET record_json=?,owner_epoch=?,lease_owner=?,lease_until=?,phase=? WHERE match_id=?').run(
        JSON.stringify(match), match.ownerEpoch, leaseOwner, now + 15_000, match.phase, matchId);
      return match;
    }).immediate();
  }
  commit(value: Commit): void {
    this.db.transaction(() => {
      const { match } = value;
      if (hash(match.world) !== match.worldHash) throw new Error('STATE_CHECKSUM');
      const changed = this.db.prepare('UPDATE rt_matches SET record_json=?,world_hash=?,journal_seq=?,lease_until=?,expires_at=?,phase=? WHERE match_id=? AND owner_epoch=? AND lease_owner=?')
        .run(JSON.stringify(match), match.worldHash, match.journalSeq, Date.now() + 15_000, match.expiresAt, match.phase, match.matchId, match.ownerEpoch, value.leaseOwner);
      if (changed.changes !== 1) throw new Error('LEASE_LOST');
      this.db.prepare('INSERT INTO rt_journal VALUES (?,?,?,?,?)').run(match.matchId, match.journalSeq, match.tick, JSON.stringify(value.journal), match.worldHash);
      for (const receipt of value.receipts) this.db.prepare('INSERT INTO rt_actions VALUES (?,?,?,?,?)').run(receipt.matchId, receipt.actionId, receipt.participantId, receipt.payloadHash, JSON.stringify(receipt));
      if (match.tick % 60 === 0 || match.phase !== 'running') {
        this.db.prepare('INSERT OR REPLACE INTO rt_checkpoints VALUES (?,?,?,?)').run(match.matchId, match.journalSeq, JSON.stringify(match), match.worldHash);
        this.db.prepare('DELETE FROM rt_checkpoints WHERE match_id=? AND seq NOT IN (SELECT seq FROM rt_checkpoints WHERE match_id=? ORDER BY seq DESC LIMIT 2)').run(match.matchId, match.matchId);
      }
      if (value.result) this.db.prepare('INSERT OR IGNORE INTO rt_outbox VALUES (?,?,?,NULL)').run(value.result.resultId, match.matchId, JSON.stringify(value.result.outcome));
    }).immediate();
  }
  receipt(matchId: string, actionId: string): Receipt | null {
    const row = this.db.prepare('SELECT record_json FROM rt_actions WHERE match_id=? AND action_id=?').get(matchId, actionId) as {record_json: string} | undefined;
    return row ? JSON.parse(row.record_json) as Receipt : null;
  }
  consumeTicket(ticketId: string, expiresAt: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM rt_tickets WHERE expires_at<?').run(Date.now() - 10_000);
      this.db.prepare('INSERT INTO rt_tickets VALUES (?,?)').run(ticketId, expiresAt);
    }).immediate();
  }
  consumeBridge(requestId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM rt_bridge_requests WHERE expires_at<?').run(Date.now());
      this.db.prepare('INSERT INTO rt_bridge_requests VALUES (?,?)').run(requestId, Date.now() + 60_000);
    }).immediate();
  }
  admission(admissionId: string, playerId: string, expiresAt: number): void {
    this.db.prepare('INSERT INTO rt_admissions VALUES (?,?,?,0) ON CONFLICT(admission_id) DO UPDATE SET expires_at=excluded.expires_at WHERE revoked=0').run(admissionId, playerId, expiresAt);
  }
  checkAdmission(admissionId: string, playerId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM rt_admissions WHERE admission_id=? AND player_id=? AND revoked=0 AND expires_at>?').get(admissionId, playerId, Date.now());
  }
  revoke(admissionId: string): void { this.db.prepare('UPDATE rt_admissions SET revoked=1 WHERE admission_id=?').run(admissionId); }
  release(leaseOwner: string): void { this.db.prepare('UPDATE rt_matches SET lease_until=0 WHERE lease_owner=?').run(leaseOwner); }
  outbox() { return this.db.prepare('SELECT result_id,match_id,payload_json FROM rt_outbox WHERE delivered_at IS NULL').all(); }
  delivered(resultId: string, matchId: string) { this.db.prepare('UPDATE rt_outbox SET delivered_at=COALESCE(delivered_at,?) WHERE result_id=? AND match_id=?').run(Date.now(), resultId, matchId); }
  close(): void { this.db.pragma('wal_checkpoint(TRUNCATE)'); this.db.close(); }
}
