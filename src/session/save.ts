import { AFFLICTIONS, PIECE_TYPES, PROMOTIONS, REACTIONS, SIDES, validateState } from '../core';
import type { CaptureEvent, Command, Piece } from '../core';
import { RATING_VERSION } from '../rating/elo';
import { newId } from './random';
import { captureLedger, hydrateMatch, SAVE_VERSION, SessionError } from './match';
import type { GameSession, MatchRecord, RecordedAction, SessionConfig } from './match';

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new SessionError('invalidSave');
}

function object(input: unknown): Record<string, unknown> {
  requireValid(typeof input === 'object' && input !== null && !Array.isArray(input));
  return input as Record<string, unknown>;
}

function integer(input: unknown, maximum = Number.MAX_SAFE_INTEGER): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && input <= maximum;
}

function numeric(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input);
}

function string(input: unknown, maximum: number): input is string {
  return typeof input === 'string' && input.length > 0 && input.length <= maximum;
}

function oneOf<T extends string>(choices: readonly T[], input: unknown): input is T {
  return typeof input === 'string' && choices.includes(input as T);
}

function square(input: unknown): input is string {
  return typeof input === 'string' && /^[a-h][1-8]$/.test(input);
}

function parseCommand(input: unknown): Command {
  const { type, from, to, promotion } = object(input);
  if (type === 'move') {
    requireValid(square(from) && square(to) && (promotion === undefined || oneOf(PROMOTIONS, promotion)));
    return { type, from, to, ...(promotion ? { promotion } : {}) };
  }
  requireValid(type === 'endTurn' || type === 'claimRepetitionDraw' || type === 'resign' || type === 'agreeDraw');
  return { type };
}

function parseAction(input: unknown, config: SessionConfig): RecordedAction {
  const { id, actor, command, roll } = object(input);
  requireValid(string(id, 100) && oneOf(SIDES, actor));
  const action = { id, actor, command: parseCommand(command) };
  requireValid(action.command.type !== 'agreeDraw' || config.mode === 'hotseat');
  if (!roll) return action;
  const { face, fixed } = object(roll);
  requireValid(integer(face, 6) && face >= 1 && fixed === (config.mode === 'tutorial'));
  return { ...action, roll: { face: face as 1 | 2 | 3 | 4 | 5 | 6, fixed } };
}

function parseCapturePiece(input: unknown): Piece {
  const piece = object(input);
  requireValid(string(piece.id, 128) && oneOf(SIDES, piece.side) && oneOf(PIECE_TYPES, piece.type)
    && square(piece.square) && oneOf(AFFLICTIONS, piece.affliction) && oneOf(REACTIONS, piece.captureReaction)
    && integer(piece.capturesSinceRebirth) && typeof piece.pawnDoubleStepEligible === 'boolean'
    && typeof piece.castleEligible === 'boolean'
    && ['devastationDue', 'cureArmedAt', 'shameArmedAt'].every(key => piece[key] === null || integer(piece[key])));
  return piece as unknown as Piece;
}

function parseCapture(input: unknown): CaptureEvent {
  const { id, type, capturer, victim, landing, friendly, mercy, kind } = object(input);
  requireValid(type === 'capture' && string(id, 300) && square(landing)
    && typeof mercy === 'boolean' && (kind === 'ordinary' || kind === 'mercy' || kind === 'enPassant'));
  const fromPiece = parseCapturePiece(capturer);
  const toPiece = parseCapturePiece(victim);
  requireValid(toPiece.type !== 'king' && fromPiece.id !== toPiece.id && friendly === (fromPiece.side === toPiece.side));
  return { id, type, capturer: fromPiece, victim: toPiece, landing, kind, friendly, mercy };
}

function parseConfig(input: unknown): SessionConfig {
  const { mode, human, level, provenance, names, rating } = object(input);
  requireValid(mode === 'rated' || mode === 'practice' || mode === 'hotseat' || mode === 'tutorial');
  requireValid(mode === 'hotseat' ? human === null && level === null
    : oneOf(SIDES, human) && integer(level, 10) && level >= 1);
  requireValid(provenance === 'standard' || provenance === 'lesson' || provenance === 'handoff' || provenance === 'import');
  requireValid((mode === 'tutorial') === (provenance === 'lesson'));
  const record: SessionConfig = { mode, human: human as SessionConfig['human'], level: level as SessionConfig['level'], provenance };
  const nicknames = names === undefined ? {} : object(names);
  const verifiedNames: Partial<Record<'white' | 'black', string>> = {};
  for (const side of SIDES) {
    const name = nicknames[side];
    if (name === undefined) continue;
    requireValid(string(name, 48));
    verifiedNames[side] = name;
  }
  if (mode !== 'rated') {
    requireValid(rating === undefined);
    return { ...record, names: verifiedNames };
  }
  const { ratingBefore, profileRevision, anchor, scaleVersion, engineVersion, presetVersion } = object(rating);
  requireValid(provenance === 'standard' && numeric(ratingBefore) && ratingBefore >= 100 && integer(profileRevision)
    && numeric(anchor) && anchor >= 100 && scaleVersion === RATING_VERSION
    && string(engineVersion, 80) && string(presetVersion, 80));
  return { ...record, names: verifiedNames, rating: { ratingBefore, profileRevision, anchor, scaleVersion, engineVersion, presetVersion } };
}

function parseRecord(input: unknown, origin = false): MatchRecord {
  const data = object(input);
  const { id, revision, status, createdAt, updatedAt, activated, rootSeed, cursor, actions: rawActions, redo, rootLedger: rawLedger } = data;
  requireValid(data.version === SAVE_VERSION && string(id, 128) && integer(revision)
    && (status === 'open' || status === 'finished' || status === 'technical' || status === 'canceled')
    && integer(createdAt, 8.64e15) && integer(updatedAt, 8.64e15)
    && typeof activated === 'boolean' && integer(rootSeed, 0xffffffff)
    && Array.isArray(rawActions) && rawActions.length <= 10_000
    && integer(cursor, rawActions.length) && Array.isArray(redo)
    && redo.every((index, indexOfRedo) => integer(index, (redo[indexOfRedo - 1] ?? rawActions.length + 1) - 1) && index > cursor)
    && Array.isArray(rawLedger) && rawLedger.length <= 4096);
  const config = parseConfig(data.config);
  requireValid(config.mode === 'rated' ? cursor === rawActions.length && !redo.length : !activated);
  const actions = rawActions.map(action => parseAction(action, config));
  const rootLedger = rawLedger.map(parseCapture);
  requireValid(new Set(actions.map(action => action.id)).size === actions.length
    && new Set(rootLedger.map(event => event.id)).size === rootLedger.length);
  const root = validateState(data.root);
  let tutorialOrigin: MatchRecord | undefined;
  if (data.tutorialOrigin !== undefined) {
    requireValid(!origin && config.mode === 'practice' && (config.provenance === 'handoff' || config.provenance === 'import'));
    tutorialOrigin = parseRecord(data.tutorialOrigin, true);
    requireValid(tutorialOrigin.config.mode === 'tutorial');
    const lesson = hydrateMatch(tutorialOrigin);
    requireValid(JSON.stringify(validateState(lesson.state)) === JSON.stringify(root)
      && JSON.stringify(captureLedger(lesson).map(parseCapture)) === JSON.stringify(rootLedger));
  }
  return {
    version: SAVE_VERSION, id, revision, status, createdAt, updatedAt, activated, config, root, rootLedger,
    rootSeed, cursor, redo, actions, ...(tutorialOrigin ? { tutorialOrigin } : {}),
  };
}

export function restoreMatch(data: unknown): GameSession {
  try {
    return hydrateMatch(parseRecord(data));
  } catch {
    throw new SessionError('invalidSave');
  }
}

const FORMAT = 'remorse-match';

export function exportMatch(session: GameSession): string {
  return JSON.stringify({ format: FORMAT, match: session.record }, null, 2);
}

export function importMatch(text: string): GameSession {
  try {
    requireValid(text.length < 12_000_000);
    const envelope = object(JSON.parse(text));
    requireValid(envelope.format === FORMAT);
    const record = parseRecord(envelope.match);
    requireValid(record.config.mode !== 'tutorial' && (record.status === 'open' || record.status === 'finished'));
    const { human, level, names } = record.config;
    return hydrateMatch({
      ...record, id: newId(), createdAt: Date.now(), updatedAt: Date.now(), revision: 0, activated: false,
      config: { mode: record.config.mode === 'hotseat' ? 'hotseat' : 'practice', human, level, names, provenance: 'import' },
    });
  } catch {
    throw new SessionError('invalidSave');
  }
}
