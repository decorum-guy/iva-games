import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { canonicalJson, SessionError } from '@iva-games/session-kit';
import type { ActionEnvelope, GameRegistration, GameRuntime, Participant, StartMatchRequest } from '@iva-games/session-kit';
import { advanceDistrictTime, applyDistrictAction, createDistrictState, parseDistrictAction } from './core';
import { viewDistrict } from './view';
import { chooseDistrictBotAction } from './bot';
import { DISTRICT_CONTENT_VERSION, getDistrictMap, resolveDistrictMapSettings } from './maps';
import { DISTRICT_BOT_VERSION, DISTRICT_RULES_VERSION, DistrictError } from './types';
import type { DistrictAction, DistrictState, DistrictView } from './types';

interface MatchRow { match_id: string; request_hash: string; state: string; bot_seed: string }
interface ReceiptRow { request_hash: string; response: string }
const digest = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
const MAX_BOT_ACTIONS_PER_PASS = 24;
const BOT_PASS_BUDGET_MS = 40;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);

function normalizeSettings(input: unknown): { mapId: string; mapVersion: string } {
  try { return resolveDistrictMapSettings(input); }
  catch { throw new SessionError('INVALID_SETTINGS', 'Выберите доступную карту.'); }
}

function validateStart(input: StartMatchRequest): void {
  if (!input || !identifier(input.startCommandId) || !identifier(input.roomId)) throw new SessionError('INVALID_ROSTER', 'Проверьте участников комнаты.');
  if (input.rulesVersion !== DISTRICT_RULES_VERSION || input.contentVersion !== DISTRICT_CONTENT_VERSION) {
    throw new SessionError('INCOMPATIBLE_VERSION', 'Игра обновилась. Создайте новую комнату.', 409);
  }
  if (!Array.isArray(input.participants) || input.participants.length < 2 || input.participants.length > 4) {
    throw new SessionError('INVALID_ROSTER', 'Нужно от двух до четырёх участников.');
  }
  const ids = new Set<string>();
  const seats = new Set<number>();
  const humans = new Set<string>();
  for (const p of input.participants) {
    if (!p || !identifier(p.participantId) || ids.has(p.participantId) || !Number.isInteger(p.seatIndex) || p.seatIndex < 0 || p.seatIndex > 3 || seats.has(p.seatIndex) || typeof p.displayName !== 'string' || !p.displayName.trim() || p.displayName.length > 40) {
      throw new SessionError('INVALID_ROSTER', 'Проверьте участников комнаты.');
    }
    ids.add(p.participantId); seats.add(p.seatIndex);
    if (p.controller?.kind === 'human') {
      if (!identifier(p.playerId) || p.playerId !== p.controller.playerId || humans.has(p.playerId)) throw new SessionError('INVALID_ROSTER', 'У каждого игрока должно быть одно место.');
      humans.add(p.playerId);
    } else if (p.controller?.kind === 'bot') {
      if (p.playerId !== null || !['easy', 'normal', 'hard'].includes(p.controller.difficulty) || p.controller.botVersion !== DISTRICT_BOT_VERSION || p.controller.botProfileId !== `district:${p.controller.difficulty}`) {
        throw new SessionError('INCOMPATIBLE_VERSION', 'Добавьте бота заново.', 409);
      }
    } else throw new SessionError('INVALID_ROSTER', 'Проверьте участников комнаты.');
  }
  if (!humans.size) throw new SessionError('INVALID_ROSTER', 'В комнате должен быть хотя бы один человек.');
}

function fallback(view: DistrictView): DistrictAction | null {
  if (view.legal.chooseGoal && view.you.goalOptions[0]) return { type: 'choose-goal', goal: view.you.goalOptions[0] };
  if (view.legal.confirmBid) return { type: 'confirm-bid' };
  if (view.legal.develop) return { type: 'work' };
  if (view.legal.negotiate) {
    const incoming = view.you.offers.find(offer => offer.status === 'open' && offer.authorId !== view.you.participantId && (
      offer.kind === 'trade' ? offer.targetId === view.you.participantId : !offer.signedBy.includes(view.you.participantId)
    ));
    if (incoming) return { type: 'decline-offer', offerId: incoming.id, version: incoming.version };
    if (!view.players.find(player => player.participantId === view.you.participantId)?.ready) return { type: 'ready', ready: true };
  }
  return null;
}

/** Durable game adapter. Every SQL transaction is short; bot planning runs outside it. */
export class DistrictRuntime implements GameRuntime {
  private readonly db: Database.Database;
  private readonly now: () => number;
  private readonly driving = new Map<string, Promise<void>>();

  constructor(options: { databasePath: string; now?: () => number }) {
    this.now = options.now ?? Date.now;
    if (options.databasePath !== ':memory:') mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    this.db = new Database(options.databasePath);
    if (options.databasePath !== ':memory:') chmodSync(options.databasePath, 0o600);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    // This database may also contain the platform lab. Its user_version belongs to
    // that adapter; District uses its own metadata and table namespace.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS district_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO district_schema VALUES (1,1);
    `);
    const schema = this.db.prepare('SELECT version FROM district_schema WHERE singleton=1').get() as { version: number };
    if (schema.version !== 1) { this.db.close(); throw new Error('Unsupported District database schema'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS district_matches (
        match_id TEXT PRIMARY KEY, start_command_id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, state TEXT NOT NULL,
        bot_seed TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS district_action_receipts (
        match_id TEXT NOT NULL REFERENCES district_matches(match_id),
        participant_id TEXT NOT NULL, action_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, response TEXT NOT NULL,
        PRIMARY KEY (match_id,participant_id,action_id)
      );
    `);
  }

  registration(): GameRegistration {
    return { gameId: 'district', collectionId: 'other', title: 'Район', minPlayers: 2, maxPlayers: 4,
      supportsBots: true, rulesVersion: DISTRICT_RULES_VERSION, contentVersion: DISTRICT_CONTENT_VERSION,
      status: 'available', runtime: this, normalizeSettings };
  }

  close(): void { this.db.close(); }

  async createMatch(input: StartMatchRequest): Promise<{ matchId: string }> {
    validateStart(input);
    const hash = digest(input);
    const result = this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM district_matches WHERE start_command_id=? OR room_id=?').get(input.startCommandId, input.roomId) as MatchRow | undefined;
      if (previous) {
        if (previous.request_hash !== hash) throw new SessionError('START_CONFLICT', 'Партия уже началась.', 409);
        return { matchId: previous.match_id };
      }
      const settings = normalizeSettings(input.settings);
      const map = getDistrictMap(settings.mapId, settings.mapVersion);
      if (!map.supportedPlayers.includes(input.participants.length)) throw new SessionError('INVALID_ROSTER', 'Выберите другое число участников.');
      const matchId = randomUUID();
      const state = createDistrictState({ matchId, roomId: input.roomId,
        participants: structuredClone(input.participants), map: structuredClone(map), now: this.now(), seed: randomBytes(32).toString('hex') });
      this.db.prepare('INSERT INTO district_matches VALUES (?,?,?,?,?,?)').run(matchId, input.startCommandId, input.roomId, hash, JSON.stringify(state), randomBytes(32).toString('hex'));
      return { matchId };
    }).immediate();
    await this.runBots(result.matchId);
    return result;
  }

  private read(matchId: string): { state: DistrictState; botSeed: string } {
    const row = this.db.prepare('SELECT state,bot_seed FROM district_matches WHERE match_id=?').get(matchId) as { state: string; bot_seed: string } | undefined;
    if (!row) throw new SessionError('MATCH_NOT_FOUND', 'Партия не найдена.', 404);
    const state = JSON.parse(row.state) as DistrictState;
    if (state.schemaVersion !== 1 || state.rulesVersion !== DISTRICT_RULES_VERSION || state.contentVersion !== DISTRICT_CONTENT_VERSION) {
      throw new SessionError('INCOMPATIBLE_VERSION', 'Не удалось открыть эту партию.', 409);
    }
    return { state, botSeed: row.bot_seed };
  }

  private write(state: DistrictState): void {
    this.db.prepare('UPDATE district_matches SET state=? WHERE match_id=?').run(JSON.stringify(state), state.matchId);
  }

  private human(state: DistrictState, playerId: string): Participant {
    const participant = state.participants.find(p => p.controller.kind === 'human' && p.controller.playerId === playerId);
    if (!participant) throw new SessionError('FORBIDDEN', 'Вы не участник этой партии.', 403);
    return participant;
  }

  private advance(matchId: string, playerId?: string): DistrictState {
    return this.db.transaction(() => {
      const previous = this.read(matchId).state;
      if (playerId !== undefined) this.human(previous, playerId);
      const state = advanceDistrictTime(previous, this.now());
      if (state.revision !== previous.revision) this.write(state);
      return state;
    }).immediate();
  }

  private async runBots(matchId: string): Promise<void> {
    const existing = this.driving.get(matchId);
    if (existing) return existing;
    const work = this.driveBots(matchId);
    this.driving.set(matchId, work);
    try { await work; } finally { this.driving.delete(matchId); }
  }

  private async driveBots(matchId: string): Promise<void> {
    const started = performance.now();
    for (let step = 0; step < MAX_BOT_ACTIONS_PER_PASS && performance.now() - started < BOT_PASS_BUDGET_MS; step++) {
      if (!this.db.open) return;
      const current = this.advance(matchId);
      if (current.phase === 'finished') return;
      const { botSeed } = this.read(matchId);
      let selected: { participantId: string; action: DistrictAction; view: DistrictView } | undefined;
      // Only this seat's permitted view crosses the policy boundary. Decision RNG
      // is independent of deck/goal randomness and never includes another seat's secrets.
      for (const participant of current.participants) {
        if (participant.controller.kind !== 'bot') continue;
        const view = viewDistrict(current, participant.participantId, this.now());
        const decisionSeed = createHash('sha256').update(`${botSeed}:${participant.participantId}:${current.revision}`).digest('hex');
        let action: DistrictAction | null;
        try { action = chooseDistrictBotAction(view, participant.controller.difficulty, decisionSeed); }
        catch { action = fallback(view); }
        if (action) { selected = { participantId: participant.participantId, action, view }; break; }
      }
      if (!selected) return;
      const commit = (action: DistrictAction): 'changed' | 'stale' | 'invalid' => this.db.transaction(() => {
        const prior = this.read(matchId).state;
        const operationNow = this.now();
        const state = advanceDistrictTime(prior, operationNow);
        if (state.revision !== prior.revision) this.write(state);
        if (state.revision !== current.revision || state.phaseId !== current.phaseId) return 'stale';
        try {
          const next = applyDistrictAction(state, selected!.participantId, action, operationNow);
          this.write(next);
          return 'changed';
        } catch (error) {
          if (error instanceof DistrictError) return 'invalid';
          throw error;
        }
      }).immediate();
      const result = commit(selected.action);
      if (result === 'invalid') {
        const safe = fallback(selected.view);
        if (!safe || commit(safe) === 'invalid') return;
      }
      if (step % 4 === 3) await setImmediate();
    }
  }

  async viewForPlayer(matchId: string, playerId: string): Promise<DistrictView> {
    this.advance(matchId, playerId);
    await this.runBots(matchId);
    const state = this.advance(matchId, playerId);
    return viewDistrict(state, this.human(state, playerId).participantId, this.now());
  }

  async applyAction(matchId: string, playerId: string, command: ActionEnvelope): Promise<DistrictView> {
    if (!command || typeof command.actionId !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(command.actionId) || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
      throw new SessionError('INVALID_ACTION', 'Выберите действие ещё раз.');
    }
    const hash = digest(command);
    const result = this.db.transaction(() => {
      const previous = this.read(matchId).state;
      const participant = this.human(previous, playerId);
      const receipt = this.db.prepare('SELECT request_hash,response FROM district_action_receipts WHERE match_id=? AND participant_id=? AND action_id=?').get(matchId, participant.participantId, command.actionId) as ReceiptRow | undefined;
      if (receipt) {
        if (receipt.request_hash !== hash) return { error: new SessionError('ACTION_ID_REUSED', 'Выберите действие ещё раз.', 409) };
        return { view: JSON.parse(receipt.response) as DistrictView };
      }
      const operationNow = this.now();
      const state = advanceDistrictTime(previous, operationNow);
      // Commit elapsed deadlines even when the incoming action is stale or invalid.
      if (state.revision !== previous.revision) this.write(state);
      try {
        if (state.revision !== command.expectedRevision) throw new SessionError('STALE_REVISION', 'Игра обновилась. Выберите ещё раз.', 409);
        if (!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) throw new SessionError('INVALID_ACTION', 'Выберите действие ещё раз.');
        const { phaseId, ...payload } = command.payload as Record<string, unknown>;
        if (phaseId !== state.phaseId) throw new SessionError('STALE_PHASE', 'Ход завершён. Выберите новое действие.', 409);
        const action = parseDistrictAction(payload);
        const next = applyDistrictAction(state, participant.participantId, action, operationNow);
        const view = viewDistrict(next, participant.participantId, this.now());
        this.write(next);
        this.db.prepare('INSERT INTO district_action_receipts VALUES (?,?,?,?,?)').run(matchId, participant.participantId, command.actionId, hash, JSON.stringify(view));
        return { view };
      } catch (error) {
        if (error instanceof DistrictError || error instanceof SessionError) return { error };
        throw error;
      }
    }).immediate();
    if (result.error) throw result.error;
    return result.view!;
  }

  async status(matchId: string): Promise<{ finished: boolean; outcome?: unknown }> {
    this.advance(matchId);
    await this.runBots(matchId);
    const state = this.advance(matchId);
    return { finished: state.phase === 'finished', ...(state.outcome ? { outcome: structuredClone(state.outcome) } : {}) };
  }
}

export function createDistrictRegistration(options: { databasePath: string; now?: () => number }): GameRegistration & { close: () => void } {
  const runtime = new DistrictRuntime(options);
  return { ...runtime.registration(), close: () => runtime.close() };
}
