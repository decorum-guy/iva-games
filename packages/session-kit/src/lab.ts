import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, SessionError } from './types';
import type { ActionEnvelope, BotDifficulty, GameRegistration, GameRuntime, Participant, StartMatchRequest } from './types';

const RULES_VERSION = 'lab-1';
const CONTENT_VERSION = 'lab-1';
const ROUND_MS = 60_000;
const TOTAL_ROUNDS = 3;

type Choice = 1 | 2 | 3;
interface RoundResult {
  round: number;
  choices: Record<string, Choice>;
  winnerParticipantId: string | null;
  timedOut: string[];
}
interface LabState {
  schemaVersion: 1;
  matchId: string;
  roomId: string;
  revision: number;
  round: number;
  phase: 'choosing' | 'finished';
  deadlineAt: number;
  participants: Participant[];
  scores: Record<string, number>;
  choices: Record<string, Choice>;
  history: RoundResult[];
  botSeed: string;
}

export interface LabView {
  gameId: 'platform-lab';
  matchId: string;
  roomId: string;
  revision: number;
  round: number;
  totalRounds: number;
  phase: 'choosing' | 'finished';
  deadlineAt: number | null;
  you: { participantId: string; choice: Choice | null };
  players: Array<{ participantId: string; displayName: string; seatIndex: number; isBot: boolean; submitted: boolean; score: number }>;
  history: RoundResult[];
  legalChoices: Choice[];
  outcome: { reason: 'completed'; winnerParticipantIds: string[] } | null;
}

interface MatchRow { match_id: string; request_hash: string; state: string }
interface ReceiptRow { request_hash: string; response: string }

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validateStart(input: StartMatchRequest): void {
  if (!input.startCommandId || !input.roomId || input.rulesVersion !== RULES_VERSION || input.contentVersion !== CONTENT_VERSION) {
    throw new SessionError('INCOMPATIBLE_VERSION', 'Эта партия пока недоступна.', 409);
  }
  if (input.participants.length < 2 || input.participants.length > 6) throw new SessionError('INVALID_ROSTER', 'Нужно от двух до шести участников.');
  const ids = new Set<string>();
  const seats = new Set<number>();
  const humans = new Set<string>();
  for (const p of input.participants) {
    if (!p.participantId || ids.has(p.participantId) || !Number.isInteger(p.seatIndex) || p.seatIndex < 0 || p.seatIndex > 5 || seats.has(p.seatIndex) || !p.displayName?.trim()) {
      throw new SessionError('INVALID_ROSTER', 'Проверьте участников комнаты.');
    }
    ids.add(p.participantId); seats.add(p.seatIndex);
    if (p.controller.kind === 'human') {
      if (!p.playerId || p.playerId !== p.controller.playerId || humans.has(p.playerId)) throw new SessionError('INVALID_ROSTER', 'Учётная запись может занимать только одно место.');
      humans.add(p.playerId);
    } else if (p.controller.kind === 'bot') {
      if (p.playerId !== null || !p.controller.botProfileId || !p.controller.botVersion || !['easy', 'normal', 'hard'].includes(p.controller.difficulty)) {
        throw new SessionError('INVALID_ROSTER', 'Добавьте бота заново.');
      }
      if (p.controller.botVersion !== '1' || p.controller.botProfileId !== `platform-lab:${p.controller.difficulty}`) {
        throw new SessionError('INCOMPATIBLE_VERSION', 'Этот бот пока недоступен.', 409);
      }
    } else throw new SessionError('INVALID_ROSTER', 'Проверьте участников комнаты.');
  }
  if (!humans.size) throw new SessionError('INVALID_ROSTER', 'В комнате должен быть хотя бы один человек.');
}

function view(state: LabState, participantId: string): LabView {
  const p = state.participants.find(item => item.participantId === participantId);
  if (!p) throw new SessionError('FORBIDDEN', 'Вы не участник этой партии.', 403);
  const maxScore = Math.max(...Object.values(state.scores));
  return {
    gameId: 'platform-lab', matchId: state.matchId, roomId: state.roomId, revision: state.revision,
    round: state.round, totalRounds: TOTAL_ROUNDS, phase: state.phase,
    deadlineAt: state.phase === 'finished' ? null : state.deadlineAt,
    you: { participantId, choice: state.choices[participantId] ?? null },
    players: state.participants.map(item => ({
      participantId: item.participantId, displayName: item.displayName, seatIndex: item.seatIndex,
      isBot: item.controller.kind === 'bot', submitted: state.choices[item.participantId] !== undefined,
      score: state.scores[item.participantId],
    })),
    history: structuredClone(state.history),
    legalChoices: state.phase === 'choosing' && state.choices[participantId] === undefined ? [1, 2, 3] : [],
    outcome: state.phase === 'finished' ? { reason: 'completed', winnerParticipantIds: state.participants.filter(item => state.scores[item.participantId] === maxScore).map(item => item.participantId) } : null,
  };
}

/** A bot only receives this permitted view. No pending opponents' choices or RNG state. */
export function chooseLabBotMove(permittedView: LabView, difficulty: BotDifficulty, random: number): Choice {
  const legal = permittedView.legalChoices;
  if (!legal.length) throw new SessionError('NO_LEGAL_ACTION', 'Нет доступного действия.');
  if (difficulty === 'easy') return legal[Math.floor(Math.max(0, Math.min(0.999999, random)) * legal.length)];
  const last = permittedView.history.at(-1);
  if (!last || difficulty === 'normal') return legal[(permittedView.round + Math.floor(random * legal.length)) % legal.length];
  const frequencies = new Map<Choice, number>(legal.map(choice => [choice, Object.values(last.choices).filter(item => item === choice).length]));
  return [...legal].sort((a, b) => (frequencies.get(a)! - frequencies.get(b)!) || b - a)[0];
}

/** This is a test game for the transport, not a District implementation or calibrated AI. */
export class PlatformLabRuntime implements GameRuntime {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(options: { databasePath: string; now?: () => number }) {
    this.now = options.now ?? Date.now;
    if (options.databasePath !== ':memory:') mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    this.db = new Database(options.databasePath);
    if (options.databasePath !== ':memory:') chmodSync(options.databasePath, 0o600);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 1) { this.db.close(); throw new Error('Unsupported session database schema'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY, start_command_id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_receipts (
        match_id TEXT NOT NULL REFERENCES matches(match_id), participant_id TEXT NOT NULL,
        action_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL,
        PRIMARY KEY (match_id, participant_id, action_id)
      );
      PRAGMA user_version = 1;
    `);
  }

  registration(): GameRegistration {
    return { gameId: 'platform-lab', title: 'Пробный стол', minPlayers: 2, maxPlayers: 6,
      supportsBots: true, rulesVersion: RULES_VERSION, contentVersion: CONTENT_VERSION, status: 'available', runtime: this };
  }

  close(): void { this.db.close(); }

  async createMatch(input: StartMatchRequest): Promise<{ matchId: string }> {
    validateStart(input);
    const hash = digest(input);
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM matches WHERE start_command_id=? OR room_id=?').get(input.startCommandId, input.roomId) as MatchRow | undefined;
      if (previous) {
        if (previous.request_hash !== hash) throw new SessionError('START_CONFLICT', 'Партия уже началась.', 409);
        return { matchId: previous.match_id };
      }
      const matchId = randomUUID();
      const state: LabState = { schemaVersion: 1, matchId, roomId: input.roomId, revision: 0, round: 1,
        phase: 'choosing', deadlineAt: this.now() + ROUND_MS, participants: structuredClone(input.participants),
        scores: Object.fromEntries(input.participants.map(p => [p.participantId, 0])), choices: {}, history: [], botSeed: randomBytes(32).toString('hex') };
      this.runBots(state);
      this.db.prepare('INSERT INTO matches VALUES (?, ?, ?, ?, ?)').run(matchId, input.startCommandId, input.roomId, hash, JSON.stringify(state));
      return { matchId };
    }).immediate();
  }

  private read(matchId: string): LabState {
    const row = this.db.prepare('SELECT state FROM matches WHERE match_id=?').get(matchId) as { state: string } | undefined;
    if (!row) throw new SessionError('MATCH_NOT_FOUND', 'Партия не найдена.', 404);
    const state = JSON.parse(row.state) as LabState;
    if (state.schemaVersion !== 1) throw new SessionError('INCOMPATIBLE_VERSION', 'Не удалось открыть эту партию.', 409);
    return state;
  }

  private write(state: LabState): void {
    this.db.prepare('UPDATE matches SET state=? WHERE match_id=?').run(JSON.stringify(state), state.matchId);
  }

  private human(state: LabState, playerId: string): Participant {
    const p = state.participants.find(item => item.controller.kind === 'human' && item.controller.playerId === playerId);
    if (!p) throw new SessionError('FORBIDDEN', 'Вы не участник этой партии.', 403);
    return p;
  }

  private select(state: LabState, participantId: string, value: Choice): void {
    if (state.phase !== 'choosing' || state.choices[participantId] !== undefined || !state.participants.some(p => p.participantId === participantId)) {
      throw new SessionError('ACTION_UNAVAILABLE', 'Это действие уже недоступно.', 409);
    }
    state.choices[participantId] = value;
    state.revision += 1;
  }

  private runBots(state: LabState): void {
    if (state.phase !== 'choosing') return;
    for (const participant of state.participants) {
      if (participant.controller.kind !== 'bot' || state.choices[participant.participantId] !== undefined) continue;
      const random = createHash('sha256').update(`${state.botSeed}:${state.round}:${participant.participantId}`).digest().readUInt32BE(0) / 0x100000000;
      const action = chooseLabBotMove(view(state, participant.participantId), participant.controller.difficulty, random);
      this.select(state, participant.participantId, action);
    }
  }

  private resolveRound(state: LabState, timedOut: string[], nextDeadline: number): void {
    const unique = ([3, 2, 1] as Choice[]).find(choice => Object.values(state.choices).filter(value => value === choice).length === 1);
    const winner = unique === undefined ? null : state.participants.find(p => state.choices[p.participantId] === unique)!.participantId;
    if (winner) state.scores[winner] += 1;
    state.history.push({ round: state.round, choices: { ...state.choices }, winnerParticipantId: winner, timedOut });
    state.revision += 1;
    if (state.round === TOTAL_ROUNDS) { state.phase = 'finished'; return; }
    state.round += 1;
    state.choices = {};
    state.deadlineAt = nextDeadline;
    this.runBots(state);
  }

  private applyDeadlines(state: LabState): void {
    const current = this.now();
    while (state.phase === 'choosing' && state.deadlineAt <= current) {
      const missing = state.participants.filter(p => state.choices[p.participantId] === undefined).map(p => p.participantId);
      for (const id of missing) this.select(state, id, 1);
      this.resolveRound(state, missing, state.deadlineAt + ROUND_MS);
    }
  }

  async viewForPlayer(matchId: string, playerId: string): Promise<LabView> {
    return this.db.transaction(() => {
      const state = this.read(matchId);
      const participant = this.human(state, playerId);
      this.applyDeadlines(state); this.write(state);
      return view(state, participant.participantId);
    }).immediate();
  }

  async applyAction(matchId: string, playerId: string, command: ActionEnvelope): Promise<LabView> {
    if (!command || typeof command.actionId !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(command.actionId) || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
      throw new SessionError('INVALID_ACTION', 'Выберите действие ещё раз.');
    }
    const payload = command.payload as { type?: unknown; value?: unknown } | null;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.type !== 'choose' || ![1, 2, 3].includes(payload.value as number) || Object.keys(payload).some(key => !['type', 'value'].includes(key))) {
      throw new SessionError('INVALID_ACTION', 'Выберите число от 1 до 3.');
    }
    const requestHash = digest(command);
    const result = this.db.transaction(() => {
      const state = this.read(matchId);
      const participant = this.human(state, playerId);
      const receipt = this.db.prepare('SELECT request_hash, response FROM action_receipts WHERE match_id=? AND participant_id=? AND action_id=?').get(matchId, participant.participantId, command.actionId) as ReceiptRow | undefined;
      if (receipt) {
        if (receipt.request_hash !== requestHash) throw new SessionError('ACTION_ID_REUSED', 'Выберите действие ещё раз.', 409);
        return JSON.parse(receipt.response) as LabView;
      }
      this.applyDeadlines(state);
      if (state.revision !== command.expectedRevision) {
        // A rejected command must still persist already elapsed authoritative deadlines.
        this.write(state);
        return { error: new SessionError('STALE_REVISION', 'Игра обновилась. Выберите ещё раз.', 409) };
      }
      this.select(state, participant.participantId, payload.value as Choice);
      if (Object.keys(state.choices).length === state.participants.length) this.resolveRound(state, [], this.now() + ROUND_MS);
      this.write(state);
      const response = view(state, participant.participantId);
      this.db.prepare('INSERT INTO action_receipts VALUES (?, ?, ?, ?, ?)').run(matchId, participant.participantId, command.actionId, requestHash, JSON.stringify(response));
      return response;
    }).immediate();
    if ('error' in result) throw result.error;
    return result;
  }

  async status(matchId: string): Promise<{ finished: boolean; outcome?: unknown }> {
    return this.db.transaction(() => {
      const state = this.read(matchId);
      this.applyDeadlines(state); this.write(state);
      return { finished: state.phase === 'finished', ...(state.phase === 'finished' ? { outcome: view(state, state.participants[0].participantId).outcome } : {}) };
    }).immediate();
  }
}

export function createPlatformLabRegistration(options: { databasePath: string; now?: () => number }): GameRegistration & { close: () => void } {
  const runtime = new PlatformLabRuntime(options);
  return { ...runtime.registration(), close: () => runtime.close() };
}
