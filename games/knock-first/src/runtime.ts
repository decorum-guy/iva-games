import Database from 'better-sqlite3';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, SessionError } from '@iva-games/session-kit';
import type { ActionEnvelope, GameRegistration, RealtimeGameRuntime, RealtimeInput, RealtimeSnapshot, StartMatchRequest } from '@iva-games/session-kit';
import { applyCommand, connectParticipant, createMission, disconnectParticipant, normalizeSettings, recoverMission, setInput, stepMission, viewForParticipant } from './core/mission';
import type { CommandPayload, CommandReceipt, MissionState, PlayerInput, PlayerView } from './core/types';

import { KNOCK_RULES, KNOCK_CONTENT, KNOCK_WIRE, KNOCK_BOT } from './core/version';
export { KNOCK_RULES, KNOCK_CONTENT, KNOCK_WIRE, KNOCK_BOT } from './core/version';
const STEP = 1 / 30;
const MAX_ROOMS = 12;
const fingerprint = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
function fail(code: string, message: string, status = 400): never { throw new SessionError(code, message, status); }
interface StoredMatch { match_id: string; room_id: string; start_id: string; request_hash: string; state_json: string; finished: number }
interface OwnedMatch { state: MissionState; lastSavedAt: number; savedRevision: number }
/** Local deterministic test/adapter lease; production speaks the shared iva-live@1 contract. */
export interface LiveGameSession {
  readonly controllerEpoch: number;
  readonly wireVersion: string;
  input(payload: unknown): void;
  command(actionId: string, payload: unknown): Promise<unknown>;
  snapshot(): { tick: number; view: unknown };
  isCurrent(): boolean;
  close(): void;
}
export interface RuntimeOptions { databasePath: string; autoTick?: boolean; now?: () => number; maxRooms?: number }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ACTION', 'Выберите действие ещё раз');
  return value as Record<string, unknown>;
}
function parseInput(value: unknown, epoch: number): PlayerInput {
  const v = object(value);
  if (!Number.isSafeInteger(v.seq) || Number(v.seq) < 0 || v.controllerEpoch !== epoch ||
      ![v.moveX, v.moveZ, v.yaw, v.pitch].every(n => typeof n === 'number' && Number.isFinite(n)) ||
      ![v.run, v.quiet, v.hand].every(n => typeof n === 'boolean') ||
      Math.abs(Number(v.moveX)) > 1.001 || Math.abs(Number(v.moveZ)) > 1.001 || Math.abs(Number(v.pitch)) > Math.PI / 2 || Math.abs(Number(v.yaw)) > 100000) {
    fail('INVALID_INPUT', 'Обновите управление');
  }
  return { seq: Number(v.seq), controllerEpoch: epoch, moveX: Number(v.moveX), moveZ: Number(v.moveZ), yaw: Number(v.yaw), pitch: Number(v.pitch), run: Boolean(v.run), quiet: Boolean(v.quiet), hand: Boolean(v.hand) };
}
function parseCommand(value: unknown): { payload: CommandPayload; expectedRevision?: number } {
  const envelope = object(value);
  const v = 'payload' in envelope ? object(envelope.payload) : envelope;
  const allowed: Record<string, readonly string[]> = {
    ready: [], knock: [], interact: ['targetId', 'handle'], hand: ['down', 'targetId'],
    takeHandle: ['batteryId', 'handle'], drop: [], door: ['doorId'], install: ['socket'],
    revive: ['actorId'], takeTimer: [], placeTimer: [], mark: ['kind', 'position'], call: [],
    pause: ['paused'], tutorial: ['action'],
  };
  const type = v.type;
  if (typeof type !== 'string' || !Object.hasOwn(allowed, type) || Object.keys(v).some(k => k !== 'type' && !allowed[type].includes(k))) fail('INVALID_ACTION', 'Выберите действие ещё раз');
  for (const key of ['targetId', 'batteryId', 'doorId', 'actorId']) if (v[key] !== undefined && !id(v[key])) fail('INVALID_ACTION', 'Выберите цель ещё раз');
  if ((type === 'takeHandle' && (!id(v.batteryId) || typeof v.handle !== 'number' || ![0, 1].includes(v.handle))) ||
      (type === 'door' && !id(v.doorId)) || (type === 'revive' && !id(v.actorId)) ||
      (type === 'hand' && typeof v.down !== 'boolean') || (type === 'pause' && typeof v.paused !== 'boolean') ||
      (type === 'tutorial' && !['sound', 'skip', 'restart'].includes(String(v.action))) ||
      (type === 'mark' && !['battery', 'here', 'danger', 'handle', 'help'].includes(String(v.kind))) ||
      (v.socket !== undefined && (typeof v.socket !== 'number' || ![0, 1].includes(v.socket))) ||
      (v.handle !== undefined && (typeof v.handle !== 'number' || ![0, 1].includes(v.handle)))) fail('INVALID_ACTION', 'Выберите действие ещё раз');
  if (v.position !== undefined) {
    const p = object(v.position);
    if (Object.keys(p).length !== 3 || !['x', 'y', 'z'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && Math.abs(Number(p[k])) < 1000)) fail('INVALID_ACTION', 'Поставьте метку ближе');
  }
  const revision = 'payload' in envelope ? envelope.expectedRevision : undefined;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || Number(revision) < 0)) fail('INVALID_ACTION', 'Обновите действие');
  return { payload: v as unknown as CommandPayload, ...(revision === undefined ? {} : { expectedRevision: Number(revision) }) };
}

/** One fixed-step owner per mission; rare events and their receipts share one durable snapshot. */
export class KnockRuntime implements RealtimeGameRuntime {
  readonly wireVersion = KNOCK_WIRE;
  private readonly db: Database.Database;
  private readonly owner = randomUUID();
  private readonly matches = new Map<string, OwnedMatch>();
  private readonly liveControllers = new Map<string, { epoch: string; session: LiveGameSession }>();
  private readonly now: () => number;
  private readonly maxRooms: number;
  private timer?: ReturnType<typeof setInterval>;
  private leaseTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private durations: number[] = [];
  private saveDurations: number[] = [];

  constructor(options: RuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.maxRooms = options.maxRooms ?? MAX_ROOMS;
    if (options.databasePath !== ':memory:') mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    this.db = new Database(options.databasePath);
    if (options.databasePath !== ':memory:') chmodSync(options.databasePath, 0o600);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('busy_timeout = 1500'); this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knock_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO knock_schema VALUES(1,1);
      CREATE TABLE IF NOT EXISTS knock_matches (
        match_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, start_id TEXT UNIQUE NOT NULL,
        request_hash TEXT NOT NULL, state_json TEXT NOT NULL, finished INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS knock_room ON knock_matches(room_id);
      CREATE TABLE IF NOT EXISTS knock_owners (match_id TEXT PRIMARY KEY REFERENCES knock_matches(match_id), owner TEXT NOT NULL, until_ms INTEGER NOT NULL);
    `);
    const schema = this.db.prepare('SELECT version FROM knock_schema WHERE id=1').get() as { version: number };
    if (schema.version !== 1) { this.db.close(); throw new Error('Unsupported Knock First save version'); }
    const rows = this.db.prepare('SELECT * FROM knock_matches WHERE finished=0').all() as StoredMatch[];
    for (const row of rows) {
      try { this.load(row.match_id, true); } catch (error) {
        if (!(error instanceof SessionError && error.code === 'MATCH_OWNED')) throw error;
      }
    }
    if (options.autoTick !== false) {
      let previous = performance.now(), accumulator = 0;
      this.timer = setInterval(() => {
        const current = performance.now(); accumulator += Math.min(0.25, (current - previous) / 1000); previous = current;
        let steps = 0;
        while (accumulator >= STEP && steps++ < 6) { this.tick(); accumulator -= STEP; }
      }, 1000 / 60);
      this.timer.unref();
    }
    this.leaseTimer = setInterval(() => this.renewLeases(), 1000); this.leaseTimer.unref();
  }

  registration(): GameRegistration {
    return { gameId: 'knock-first', collectionId: 'other', title: 'Сначала постучи', minPlayers: 2, maxPlayers: 5,
      supportsBots: true, rulesVersion: KNOCK_RULES, contentVersion: KNOCK_CONTENT, status: 'available', runtime: this,
      normalizeSettings: input => ({ ...normalizeSettings(input) }),
      resolveRoomVersion: (rules, content) => rules === KNOCK_RULES && content === KNOCK_CONTENT
        ? { normalizeSettings: input => ({ ...normalizeSettings(input) }), botVersion: KNOCK_BOT } : undefined,
      validateRoom: (settings, capacity, participants) => {
        const normalized = normalizeSettings(settings);
        if (normalized.tutorial && (capacity !== 2 || (participants && participants.filter(p => p.playerId).length !== 1))) fail('INVALID_SETTINGS', 'Для урока нужно два места: вы и бот');
      },
    };
  }

  async createMatch(request: StartMatchRequest): Promise<{ matchId: string }> {
    if (!id(request.startCommandId) || !id(request.roomId) || request.rulesVersion !== KNOCK_RULES || request.contentVersion !== KNOCK_CONTENT) fail('INCOMPATIBLE_VERSION', 'Создайте новую комнату', 409);
    if (!Array.isArray(request.participants) || request.participants.length < 2 || request.participants.length > 5 || !request.participants.some(p => p.controller.kind === 'human')) fail('INVALID_ROSTER', 'Нужно от двух до пяти участников');
    const ids = new Set<string>(), humans = new Set<string>(), seats = new Set<number>();
    for (const p of request.participants) {
      if (!id(p.participantId) || ids.has(p.participantId) || !Number.isSafeInteger(p.seatIndex) || p.seatIndex < 0 || p.seatIndex > 4 || seats.has(p.seatIndex) || typeof p.displayName !== 'string' || !p.displayName.trim() || p.displayName.length > 40) fail('INVALID_ROSTER', 'Проверьте состав команды');
      ids.add(p.participantId); seats.add(p.seatIndex);
      if (p.controller.kind === 'human') {
        if (!id(p.playerId) || p.playerId !== p.controller.playerId || humans.has(p.playerId)) fail('INVALID_ROSTER', 'У игрока одно место');
        humans.add(p.playerId);
      } else if (p.controller.kind !== 'bot' || p.playerId !== null || p.controller.botVersion !== KNOCK_BOT || !['easy', 'normal', 'hard'].includes(p.controller.difficulty)) fail('INVALID_ROSTER', 'Добавьте бота заново');
    }
    const settings = normalizeSettings(request.settings), hash = fingerprint(request);
    if (settings.tutorial && (request.participants.length !== 2 || humans.size !== 1 || !request.participants.some(p => p.controller.kind === 'bot'))) fail('INVALID_SETTINGS', 'Для урока нужно два места: вы и бот');
    const previous = this.db.prepare('SELECT * FROM knock_matches WHERE start_id=?').get(request.startCommandId) as StoredMatch | undefined;
    if (previous) {
      if (previous.request_hash !== hash) fail('START_CONFLICT', 'Вылазка уже началась', 409);
      this.load(previous.match_id); return { matchId: previous.match_id };
    }
    if ([...this.matches.values()].filter(m => m.state.phase !== 'finished').length >= this.maxRooms) fail('CAPACITY', 'Все лифты заняты. Попробуйте чуть позже', 503);
    const matchId = randomUUID();
    const state = createMission({ participants: request.participants, settings, seed: randomBytes(4).readUInt32LE() });
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO knock_matches VALUES(?,?,?,?,?,0)').run(matchId, request.roomId, request.startCommandId, hash, JSON.stringify(state));
      this.claim(matchId);
    }).immediate();
    this.matches.set(matchId, { state, lastSavedAt: this.now(), savedRevision: state.revision });
    return { matchId };
  }

  private claim(matchId: string): void {
    const result = this.db.prepare(`INSERT INTO knock_owners VALUES(?,?,?) ON CONFLICT(match_id) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms WHERE knock_owners.owner=? OR knock_owners.until_ms<?`).run(matchId, this.owner, this.now() + 4000, this.owner, this.now());
    if (!result.changes) fail('MATCH_OWNED', 'Восстанавливаем вылазку. Подождите', 503);
  }
  /** SQLite owner token fences a previous process even before its next lease heartbeat. */
  private owns(matchId: string): boolean {
    const row = this.db.prepare('SELECT owner FROM knock_owners WHERE match_id=?').get(matchId) as { owner: string } | undefined;
    return row?.owner === this.owner;
  }
  private renewLeases(): void {
    if (this.stopped) return;
    const update = this.db.prepare('UPDATE knock_owners SET until_ms=? WHERE match_id=? AND owner=?');
    this.db.transaction(() => {
      for (const [matchId] of this.matches) if (!update.run(this.now() + 4000, matchId, this.owner).changes) this.matches.delete(matchId);
    }).immediate();
  }
  private load(matchId: string, recover = false): OwnedMatch {
    if (this.stopped) fail('SERVER_RESTARTING', 'Обновляем игру', 503);
    const existing = this.matches.get(matchId);
    if (existing) {
      if (!this.owns(matchId)) { this.matches.delete(matchId); fail('MATCH_OWNED', 'Восстанавливаем вылазку. Подождите', 503); }
      return existing;
    }
    const row = this.db.prepare('SELECT * FROM knock_matches WHERE match_id=?').get(matchId) as StoredMatch | undefined;
    if (!row) fail('MATCH_NOT_FOUND', 'Вылазка не найдена', 404);
    const state = JSON.parse(row.state_json) as MissionState;
    if (state.version !== KNOCK_RULES || state.contentVersion !== KNOCK_CONTENT || state.wireVersion !== KNOCK_WIRE) fail('INCOMPATIBLE_VERSION', 'Эта вылазка требует другой версии игры', 409);
    this.db.transaction(() => this.claim(matchId)).immediate();
    if (state.phase !== 'finished' && (recover || !this.matches.has(matchId))) recoverMission(state);
    const owned = { state, lastSavedAt: this.now(), savedRevision: state.revision };
    this.matches.set(matchId, owned); this.persist(matchId, owned);
    return owned;
  }
  private participant(state: MissionState, playerId: string) {
    const actor = state.actors.find(a => a.kind === 'human' && a.playerId === playerId);
    if (!actor) fail('FORBIDDEN', 'Вы не участник этой вылазки', 403);
    return actor;
  }
  private persist(matchId: string, match: OwnedMatch): void {
    const started = performance.now();
    this.db.transaction(() => {
      const owner = this.db.prepare('SELECT owner FROM knock_owners WHERE match_id=?').get(matchId) as { owner: string } | undefined;
      if (owner?.owner !== this.owner) fail('MATCH_OWNED', 'Восстанавливаем вылазку', 503);
      this.db.prepare('UPDATE knock_matches SET state_json=?,finished=? WHERE match_id=?').run(JSON.stringify(match.state), match.state.phase === 'finished' ? 1 : 0, matchId);
    }).immediate();
    match.savedRevision = match.state.revision; match.lastSavedAt = this.now();
    this.saveDurations.push(performance.now() - started);
    if (this.saveDurations.length > 7200) this.saveDurations.splice(0, this.saveDurations.length - 7200);
  }

  /** Exposed for deterministic runtime tests; production scheduling is always fixed at 30 Hz. */
  tick(): void {
    if (this.stopped) return;
    const started = performance.now();
    for (const [matchId, match] of this.matches) {
      if (!this.owns(matchId)) { this.matches.delete(matchId); continue; }
      if (match.state.phase === 'finished') continue;
      stepMission(match.state, STEP);
      if (match.savedRevision !== match.state.revision || this.now() - match.lastSavedAt >= 2000) this.persist(matchId, match);
    }
    this.durations.push(performance.now() - started);
    if (this.durations.length > 7200) this.durations.splice(0, this.durations.length - 7200);
  }
  metrics(): { rooms: number; samples: number; p95TickMs: number; maxTickMs: number; saveSamples: number; p95SaveMs: number; maxSaveMs: number } {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const saves = [...this.saveDurations].sort((a, b) => a - b);
    return { rooms: this.matches.size, samples: sorted.length, p95TickMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0, maxTickMs: sorted.at(-1) ?? 0, saveSamples: saves.length, p95SaveMs: saves[Math.floor(saves.length * 0.95)] ?? 0, maxSaveMs: saves.at(-1) ?? 0 };
  }
  async viewForPlayer(matchId: string, playerId: string): Promise<PlayerView> {
    const { state } = this.load(matchId); return viewForParticipant(state, this.participant(state, playerId).id);
  }
  async status(matchId: string): Promise<{ finished: boolean; outcome?: unknown }> {
    const { state } = this.load(matchId); return { finished: state.phase === 'finished', ...(state.outcome ? { outcome: state.outcome } : {}) };
  }
  async applyAction(matchId: string, playerId: string, command: ActionEnvelope): Promise<CommandReceipt> {
    const match = this.load(matchId), actor = this.participant(match.state, playerId);
    const envelope = object(command.payload);
    if (typeof envelope.epoch !== 'string' || !id(envelope.epoch)) fail('STALE_CONTROLLER', 'Продолжите в текущем окне', 409);
    if (Object.keys(envelope).some(key => !['epoch', 'payload', 'expectedRevision'].includes(key)) || !Object.hasOwn(envelope, 'payload')) fail('INVALID_ACTION', 'Выберите действие ещё раз');
    const controller = this.liveController(matchId, playerId, envelope.epoch);
    return this.command(matchId, actor.id, controller.session.controllerEpoch, command.actionId, { payload: envelope.payload, expectedRevision: envelope.expectedRevision });
  }
  private liveController(matchId: string, playerId: string, epoch: string) {
    const entry = this.liveControllers.get(`${matchId}:${playerId}`);
    if (!entry || entry.epoch !== epoch || !entry.session.isCurrent()) fail('STALE_CONTROLLER', 'Продолжите в текущем окне', 409);
    return entry;
  }
  async liveConnect(matchId: string, playerId: string, epoch: string): Promise<RealtimeSnapshot> {
    if (!id(epoch) || epoch.length < 8) fail('INVALID_INPUT', 'Обновите управление');
    const session = this.openLiveSession(matchId, playerId);
    this.liveControllers.set(`${matchId}:${playerId}`, { epoch, session });
    return this.liveSnapshot(matchId, playerId, epoch);
  }
  liveInput(matchId: string, playerId: string, input: RealtimeInput): void {
    const controller = this.liveController(matchId, playerId, input.epoch), payload = object(input.payload);
    if (Object.keys(payload).some(key => !['moveX', 'moveZ', 'yaw', 'pitch', 'run', 'quiet', 'hand'].includes(key))) fail('INVALID_INPUT', 'Обновите управление');
    controller.session.input({ ...payload, seq: input.seq, controllerEpoch: controller.session.controllerEpoch });
  }
  async liveSnapshot(matchId: string, playerId: string, epoch: string): Promise<RealtimeSnapshot> {
    const { session } = this.liveController(matchId, playerId, epoch), snapshot = session.snapshot();
    const view = snapshot.view as PlayerView;
    return { ...snapshot, serverTime: this.now(), lastAcceptedSeq: view.self.acknowledgedSeq };
  }
  liveDisconnect(matchId: string, playerId: string, epoch: string): void {
    const key = `${matchId}:${playerId}`, entry = this.liveControllers.get(key);
    if (!entry || entry.epoch !== epoch) return;
    entry.session.close(); this.liveControllers.delete(key);
  }
  private command(matchId: string, participantId: string, epoch: number, actionId: string, payload: unknown): CommandReceipt {
    if (typeof actionId !== 'string' || !/^[A-Za-z0-9._:-]{8,100}$/.test(actionId)) fail('INVALID_ACTION', 'Повторите действие');
    const parsed = parseCommand(payload), match = this.load(matchId);
    const before = JSON.stringify(match.state);
    try {
      const receipt = applyCommand(match.state, participantId, { actionId, controllerEpoch: epoch, ...parsed });
      this.persist(matchId, match); return receipt;
    } catch (error) { match.state = JSON.parse(before) as MissionState; throw error; }
  }
  openLiveSession(matchId: string, playerId: string): LiveGameSession {
    const match = this.load(matchId), actor = this.participant(match.state, playerId);
    const participantId = actor.id, epoch = connectParticipant(match.state, participantId);
    this.persist(matchId, match);
    let closed = false;
    const current = (): boolean => !closed && !this.stopped && this.matches.get(matchId)?.state.actors.find(a => a.id === participantId)?.controllerEpoch === epoch && this.owns(matchId);
    const check = (): OwnedMatch => { if (!current()) fail('STALE_CONTROLLER', 'Продолжите в текущем окне', 409); return this.load(matchId); };
    return { controllerEpoch: epoch, wireVersion: KNOCK_WIRE, isCurrent: current,
      input: payload => { const owned = check(); setInput(owned.state, participantId, parseInput(payload, epoch)); },
      command: async (actionId, payload) => { check(); return this.command(matchId, participantId, epoch, actionId, payload); },
      snapshot: () => { const owned = check(); return { tick: owned.state.tick, view: viewForParticipant(owned.state, participantId) }; },
      close: () => {
        if (!current()) { closed = true; return; }
        closed = true;
        const owned = this.matches.get(matchId);
        if (owned && !this.stopped) { disconnectParticipant(owned.state, participantId, epoch); this.persist(matchId, owned); }
      },
    };
  }
  close(): void {
    if (this.stopped) return;
    clearInterval(this.timer); clearInterval(this.leaseTimer);
    for (const [matchId, match] of this.matches) {
      if (!this.owns(matchId)) continue;
      for (const actor of match.state.actors) if (actor.kind === 'human') disconnectParticipant(match.state, actor.id, actor.controllerEpoch);
      this.persist(matchId, match);
    }
    this.db.prepare('DELETE FROM knock_owners WHERE owner=?').run(this.owner);
    this.stopped = true; this.matches.clear(); this.liveControllers.clear(); this.db.close();
  }
}

export function createKnockRegistration(options: RuntimeOptions): GameRegistration & { close(): void; knock: KnockRuntime } {
  const runtime = new KnockRuntime(options);
  return { ...runtime.registration(), knock: runtime, close: () => runtime.close() };
}
