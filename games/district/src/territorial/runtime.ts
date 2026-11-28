import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { canonicalJson, SessionError } from '@iva-games/session-kit';
import type { ActionEnvelope, GameRuntime, StartMatchRequest } from '@iva-games/session-kit';
import { chooseTerritoryBot } from './bot';
import { currentId, advanceTerritory, applyTerritory, createTerritory, fallbackTerritory, parseTerritoryAction, phaseIdOf, viewTerritory } from './core';
import { getTerritoryMap, territoryMaps } from './maps';
import { newsCatalogVersion, newsProfiles } from './news-catalog';
import type { NewsPreset } from './news-catalog';
import { TERRITORY_BOT, TERRITORY_CONTENT, TERRITORY_RULES, TERRITORY_SAVE } from './types';
import type { TerritoryAction, TerritoryState, TerritoryView } from './types';
import { DistrictError } from '../types';

export const territorialId = (id: string) => id.startsWith('d4-');
const hash = (input: unknown) => createHash('sha256').update(canonicalJson(input)).digest('hex');
const HUMAN_TRADE_WINDOW_MS = 40_000;

/** A separate deterministic pacing domain never consumes gameplay random draws. */
function botDelay(state: TerritoryState, botSeed: string, participantId: string, action: TerritoryAction) {
  const draw = Number.parseInt(hash(['district-pace-v1', botSeed, state.revision, participantId, action.type]).slice(0, 8), 16);
  if (state.phase === 'setup-home' || state.phase === 'setup-route') return 1_000 + draw % 601;
  if (action.type === 'end') return 2_200 + draw % 1_301;
  if (draw % 50 === 0) return 4_800 + draw % 701;
  return 1_800 + draw % 2_701;
}

export function territorySettings(input: unknown): { mapId: string; mapVersion: string; newsPreset: NewsPreset } {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    throw new SessionError('INVALID_SETTINGS', 'Проверьте настройки игры.');
  }
  const data = (input ?? {}) as Record<string, unknown>;
  const { mapId = territoryMaps[0].id, mapVersion, newsPreset = 'medium' } = data;
  if (Object.keys(data).some(key => !['mapId', 'mapVersion', 'newsPreset'].includes(key)) ||
    typeof mapId !== 'string' || (mapVersion !== undefined && typeof mapVersion !== 'string') || typeof newsPreset !== 'string' || !Object.hasOwn(newsProfiles, newsPreset)) {
    throw new SessionError('INVALID_SETTINGS', 'Проверьте карту и настройку новостей.');
  }
  try {
    const map = getTerritoryMap(mapId, mapVersion);
    return { mapId, mapVersion: map.version, newsPreset: newsPreset as NewsPreset };
  } catch { throw new SessionError('INVALID_SETTINGS', 'Выберите доступную карту.'); }
}

/** v0.4 uses sibling tables in the existing runtime volume. Published legacy
 * matches, receipts, migrations and their loader remain byte-compatible. */
export class TerritoryRuntime implements GameRuntime {
  private readonly db: Database.Database;
  private readonly driving = new Map<string, Promise<void>>();

  constructor(databasePath: string, private readonly now: () => number = Date.now) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS district_territorial_matches (
        match_id TEXT PRIMARY KEY, start_command_id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, state_json TEXT NOT NULL,
        bot_seed TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS district_territorial_receipts (
        match_id TEXT NOT NULL REFERENCES district_territorial_matches(match_id),
        participant_id TEXT NOT NULL, action_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, view_json TEXT NOT NULL,
        PRIMARY KEY (match_id,participant_id,action_id)
      );
    `);
  }
  close() { this.db.close(); }

  async createMatch(input: StartMatchRequest): Promise<{ matchId: string }> {
    const requestHash = hash(input);
    const { mapId, mapVersion, newsPreset } = territorySettings(input.settings);
    const result = this.db.transaction(() => {
      const prior = this.db.prepare('SELECT match_id,request_hash FROM district_territorial_matches WHERE room_id=? OR start_command_id=?')
        .get(input.roomId, input.startCommandId) as { match_id: string; request_hash: string } | undefined;
      if (prior) {
        if (prior.request_hash !== requestHash) throw new SessionError('START_CONFLICT', 'Партия уже началась.', 409);
        return { matchId: prior.match_id };
      }
      const matchId = 'd4-' + randomUUID();
      const state = createTerritory({ matchId, roomId: input.roomId, map: getTerritoryMap(mapId, mapVersion),
        participants: input.participants, preset: newsPreset, seed: randomBytes(32).toString('hex'), now: this.now() });
      this.db.prepare('INSERT INTO district_territorial_matches VALUES (?,?,?,?,?,?)')
        .run(matchId, input.startCommandId, input.roomId, requestHash, JSON.stringify(state), randomBytes(32).toString('hex'));
      return { matchId };
    }).immediate();
    await this.runBots(result.matchId);
    return result;
  }

  private read(matchId: string) {
    const row = this.db.prepare('SELECT state_json,bot_seed FROM district_territorial_matches WHERE match_id=?')
      .get(matchId) as { state_json: string; bot_seed: string } | undefined;
    if (!row) throw new SessionError('MATCH_NOT_FOUND', 'Партия не найдена.', 404);
    const state = JSON.parse(row.state_json) as TerritoryState;
    if (state.schemaVersion !== TERRITORY_SAVE || state.rulesVersion !== TERRITORY_RULES || state.contentVersion !== TERRITORY_CONTENT || state.botVersion !== TERRITORY_BOT ||
      state.map.profile !== TERRITORY_RULES || state.map.schemaVersion !== 3 ||
      state.news.version !== newsCatalogVersion || state.news.profile.version !== newsProfiles.medium.version) {
      throw new SessionError('INCOMPATIBLE_VERSION', 'Не удалось открыть эту партию.', 409);
    }
    return { state, botSeed: row.bot_seed };
  }
  private write(state: TerritoryState) {
    this.db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(JSON.stringify(state), state.matchId);
  }
  private human(state: TerritoryState, playerId: string): string {
    const member = state.participants.find(p => p.controller.kind === 'human' && p.controller.playerId === playerId);
    if (!member) throw new SessionError('FORBIDDEN', 'Вы не участник этой партии.', 403);
    return member.participantId;
  }
  private advance(matchId: string, playerId?: string) {
    return this.db.transaction(() => {
      const { state: previous, botSeed } = this.read(matchId);
      if (playerId !== undefined) this.human(previous, playerId);
      const state = advanceTerritory(previous, this.now());
      if (state !== previous) this.write(state);
      return { state, botSeed };
    }).immediate();
  }

  private async runBots(matchId: string) {
    const previous = this.driving.get(matchId);
    if (previous) return previous;
    const work = this.driveBots(matchId);
    this.driving.set(matchId, work);
    try { await work; } finally { this.driving.delete(matchId); }
  }
  private async driveBots(matchId: string) {
    // Reads schedule work; subsequent polling/status calls execute it when eligible.
    // Nothing sleeps in an HTTP request and a restart preserves the exact due time.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!this.db.open) return;
      const { state, botSeed } = this.advance(matchId);
      if (state.outcome) return;
      const scheduled = state.botSchedule?.revision === state.revision ? state.botSchedule : undefined;
      if (scheduled && scheduled.at > this.now()) return;
      const active = currentId(state);
      // Only the public board and this bot's own hand cross the policy boundary.
      const recipients = new Set(state.offers.filter(offer => offer.agreedAt === undefined).map(offer => offer.targetId));
      // Once another eligible bot has been scheduled, an unfulfillable incoming
      // offer must not keep replacing its timer on every poll.
      const priority = (id: string) => scheduled?.participantId === id ? -1 : recipients.has(id) ? 0 : id === active ? 1 : 2;
      const order = [...state.participants].sort((a, b) => priority(a.participantId) - priority(b.participantId));
      const eligible = order.filter(p => p.controller.kind === 'bot' || state.left.includes(p.participantId));
      let changed = false;
      for (const p of eligible) {
        const id = p.participantId;
        if (id !== active && !state.discard[id] && !state.offers.some(offer => offer.targetId === id && offer.agreedAt === undefined)) continue;
        const now = this.now();
        // Keep a real response window, including when a client refreshes or the process restarts.
        const responseUntil = id === active ? Math.max(0, ...state.offers.filter(offer => offer.authorId === id &&
          !state.left.includes(offer.targetId) && state.participants.some(member => member.participantId === offer.targetId && member.controller.kind === 'human'))
          .map(offer => (offer.offeredAt ?? now - HUMAN_TRADE_WINDOW_MS) + HUMAN_TRADE_WINDOW_MS)) : 0;
        const view = viewTerritory(state, id, now, false);
        const difficulty = p.controller.kind === 'bot' ? p.controller.difficulty : 'normal';
        const safe = fallbackTerritory(view);
        const action = chooseTerritoryBot(view, difficulty, `${botSeed}:${state.revision}:${id}`) ?? safe;
        if (!action) continue;
        const result = this.db.transaction(() => {
          const { state: current } = this.read(matchId);
          if (current.revision !== state.revision) return 'changed';
          let schedule = current.botSchedule;
          if (schedule?.revision !== current.revision || schedule.participantId !== id) {
            const desired = Math.max(now + botDelay(current, botSeed, id, action), responseUntil);
            schedule = { revision: current.revision, participantId: id,
              at: current.deadlineAt === null ? desired : Math.min(desired, current.deadlineAt) };
            current.botSchedule = schedule;
            this.write(current);
          }
          if (schedule.at > this.now()) return 'waiting';
          try { this.write(applyTerritory(current, id, action, this.now())); }
          catch (error) {
            if (!(error instanceof DistrictError)) throw error;
            if (!safe) return 'none';
            this.write(applyTerritory(current, id, safe, this.now()));
          }
          return 'changed';
        }).immediate();
        if (result === 'waiting') return;
        if (result === 'changed') { changed = true; break; }
      }
      if (!changed) return;
    }
  }
  async viewForPlayer(matchId: string, playerId: string): Promise<TerritoryView> {
    this.advance(matchId, playerId);
    await this.runBots(matchId);
    const { state } = this.read(matchId);
    return viewTerritory(state, this.human(state, playerId), this.now());
  }
  async applyAction(matchId: string, playerId: string, command: ActionEnvelope): Promise<TerritoryView> {
    if (!command || typeof command.actionId !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(command.actionId) ||
      !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
      throw new SessionError('INVALID_ACTION', 'Выберите действие ещё раз.');
    }
    const requestHash = hash(command);
    const result = this.db.transaction(() => {
      const { state: previous } = this.read(matchId);
      const id = this.human(previous, playerId);
      const receipt = this.db.prepare('SELECT request_hash,view_json FROM district_territorial_receipts WHERE match_id=? AND participant_id=? AND action_id=?')
        .get(matchId, id, command.actionId) as { request_hash: string; view_json: string } | undefined;
      if (receipt) {
        if (receipt.request_hash !== requestHash) throw new SessionError('ACTION_ID_REUSED', 'Выберите действие ещё раз.', 409);
        return { view: JSON.parse(receipt.view_json) as TerritoryView };
      }
      if (previous.left.includes(id)) throw new SessionError('FORBIDDEN', 'Это место ведёт автоматический игрок.', 403);
      const now = this.now();
      const state = advanceTerritory(previous, now);
      if (state !== previous) this.write(state);
      if (state.revision !== command.expectedRevision) return { error: new SessionError('STALE_REVISION', 'Игра обновилась. Выберите ещё раз.', 409) };
      if (!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) throw new SessionError('INVALID_ACTION', 'Выберите действие ещё раз.');
      const { phaseId, ...payload } = command.payload as Record<string, unknown>;
      if (phaseId !== phaseIdOf(state)) throw new SessionError('STALE_PHASE', 'Ход завершён. Выберите новое действие.', 409);
      const next = applyTerritory(state, id, parseTerritoryAction(payload), now);
      const view = viewTerritory(next, id, now);
      this.write(next);
      this.db.prepare('INSERT INTO district_territorial_receipts VALUES (?,?,?,?,?)').run(matchId, id, command.actionId, requestHash, JSON.stringify(view));
      return { view };
    }).immediate();
    if (result.error) throw result.error;
    return result.view!;
  }
  async status(matchId: string) {
    await this.runBots(matchId);
    const { state } = this.read(matchId);
    return { finished: !!state.outcome, ...(state.outcome ? { outcome: state.outcome } : {}) };
  }
}
