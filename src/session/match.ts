import {
  applyResolvedCommand, commandRejection, createInitialState, enumerateOutcomes, legalCommands,
} from '../core';
import type {
  CaptureEvent, Command, DieFace, GameEvent, GameState, RejectionCode, Side,
} from '../core';
import type { RatedContract } from '../rating/elo';
import { newId, newSeed, nextDie } from './random';

export const SAVE_VERSION = 1;
export type Mode = 'rated' | 'practice' | 'hotseat' | 'tutorial';
export type Source = 'human' | 'bot' | 'script';
export type Provenance = 'standard' | 'lesson' | 'handoff' | 'import';
export type MatchStatus = 'open' | 'finished' | 'canceled' | 'technical';

export interface SessionConfig {
  readonly mode: Mode;
  readonly human: Side | null;
  readonly level: number | null;
  readonly names?: Readonly<Partial<Record<Side, string>>>;
  readonly provenance: Provenance;
  readonly rating?: RatedContract;
}

export interface CommandEnvelope {
  readonly commandId: string;
  readonly gameId: string;
  readonly expectedRevision: number;
  readonly actor: Side;
  readonly command: Command;
}

export interface RecordedAction {
  readonly id: string;
  readonly actor: Side;
  readonly command: Command;
  readonly roll?: { readonly face: DieFace; readonly fixed: boolean };
}

export interface Checkpoint {
  readonly state: GameState;
  readonly seed: number;
  readonly events: readonly GameEvent[];
}

export interface MatchRecord {
  readonly version: typeof SAVE_VERSION;
  readonly id: string;
  readonly config: SessionConfig;
  readonly revision: number;
  readonly status: MatchStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activated: boolean;
  readonly root: GameState;
  readonly rootLedger: readonly CaptureEvent[];
  readonly rootSeed: number;
  readonly tutorialOrigin?: MatchRecord;
  readonly actions: readonly RecordedAction[];
  readonly cursor: number;
  readonly redo: readonly number[];
}

export interface GameSnapshot {
  readonly gameId: string;
  readonly revision: number;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly rootLedger: readonly CaptureEvent[];
}

// A remote implementation would enforce the same envelope/seat then return the
// authoritative snapshot and ordered events, without exposing the private PRNG.
export interface GameTransport {
  snapshot(): GameSnapshot;
  submit(envelope: CommandEnvelope, source: Source): GameTransport | Promise<GameTransport>;
}

export type SessionCode = RejectionCode | 'stale' | 'ratedLocked' | 'invalidSave' | 'storage'
  | 'storageTimeout' | 'storageBlocked' | 'storageClosed' | 'practiceCopied'
  | 'ratedOccupied' | 'tutorialChoice' | 'tutorialBroken' | 'workerFailed' | 'noUndo' | 'noRedo';

export class SessionError extends Error {
  constructor(readonly code: SessionCode) {
    super(code);
    this.name = 'SessionError';
  }
}

export type TutorialRollProvider = (envelope: CommandEnvelope, state: GameState) => DieFace;

export function createMatch(config: SessionConfig, options: {
  root?: GameState; rootLedger?: readonly CaptureEvent[]; tutorialOrigin?: MatchRecord; seed?: number; id?: string; now?: number;
} = {}): GameSession {
  const time = options.now ?? Date.now();
  const root = options.root ?? createInitialState();
  const rootSeed = options.seed ?? newSeed();
  const record: MatchRecord = {
    version: SAVE_VERSION, id: options.id ?? newId(), config, revision: 0,
    status: root.outcome ? 'finished' : 'open', createdAt: time, updatedAt: time,
    activated: false, root, rootLedger: options.rootLedger ?? [], rootSeed,
    actions: [], cursor: 0, redo: [],
    ...(options.tutorialOrigin ? { tutorialOrigin: options.tutorialOrigin } : {}),
  };
  return new GameSession(record, [{ state: root, seed: rootSeed, events: [] }]);
}

function namespacedEvents(id: string, actionId: string, events: readonly GameEvent[]) {
  return events.map(event => ({ ...event, id: `${id}/${actionId}/${event.id}` }));
}

export function hydrateMatch(record: MatchRecord): GameSession {
  const history: Checkpoint[] = [{ state: record.root, seed: record.rootSeed, events: [] }];
  for (const action of record.actions) {
    const { state, seed } = history[history.length - 1];
    const requiresRoll = enumerateOutcomes(state, action.command).some(outcome => outcome.face !== undefined);
    if (requiresRoll !== Boolean(action.roll)) throw new SessionError('invalidSave');
    const roll = requiresRoll && !action.roll?.fixed ? nextDie(seed) : null;
    if (roll && roll.face !== action.roll?.face) throw new SessionError('invalidSave');
    const next = applyResolvedCommand(state, action.command, action.roll?.face, action.actor);
    history.push({
      state: next.state, seed: roll?.seed ?? seed, events: namespacedEvents(record.id, action.id, next.events),
    });
  }
  const current = history[record.cursor];
  if (!current || Boolean(current.state.outcome) !== (record.status === 'finished')) {
    throw new SessionError('invalidSave');
  }
  return new GameSession(record, history);
}

export class GameSession implements GameTransport {
  constructor(readonly record: MatchRecord, private readonly history: readonly Checkpoint[]) {}

  get current(): Checkpoint { return this.history[this.record.cursor]; }
  get state(): GameState { return this.current.state; }
  get events(): readonly GameEvent[] {
    return this.eventsAt(this.record.cursor);
  }

  eventsAt(cursor: number): readonly GameEvent[] {
    return this.history.slice(1, Math.min(this.record.cursor, cursor) + 1).flatMap(point => point.events);
  }

  snapshot(): GameSnapshot {
    return { gameId: this.record.id, revision: this.record.revision, state: this.state, events: this.events, rootLedger: this.record.rootLedger };
  }

  envelope(command: Command, actor: Side = this.state.side): CommandEnvelope {
    return { commandId: newId(), gameId: this.record.id, expectedRevision: this.record.revision, actor, command };
  }

  submit(envelope: CommandEnvelope, source: Source, tutorialRoll?: TutorialRollProvider): GameSession {
    if (envelope.gameId !== this.record.id) throw new SessionError('stale');
    if (this.record.actions.some(action => action.id === envelope.commandId)) return this;
    if (envelope.expectedRevision !== this.record.revision) throw new SessionError('stale');
    if (this.record.status !== 'open') throw new SessionError('finished');
    const { command, actor, commandId } = envelope;
    const { mode, human } = this.record.config;
    const sourceAllowed = mode === 'hotseat' ? source === 'human'
      : actor === human ? source === 'human'
      : mode === 'tutorial' ? source === 'script' : source === 'bot';
    if (!sourceAllowed) throw new SessionError('wrongSide');
    if (command.type === 'agreeDraw' && mode !== 'hotseat') throw new SessionError('invalidCommand');
    if (source !== 'human' && (command.type === 'resign' || command.type === 'agreeDraw')) {
      throw new SessionError('invalidCommand');
    }
    const rejection = commandRejection(this.state, command, actor);
    if (rejection) throw new SessionError(rejection);
    const chances = enumerateOutcomes(this.state, command);
    const needsRoll = chances.some(chance => chance.face !== undefined);
    let seed = this.current.seed;
    let roll: RecordedAction['roll'];
    if (needsRoll) {
      if (mode === 'tutorial') {
        if (!tutorialRoll) throw new SessionError('tutorialBroken');
        roll = { face: tutorialRoll(envelope, this.state), fixed: true };
      } else {
        const die = nextDie(seed);
        seed = die.seed;
        roll = { face: die.face, fixed: false };
      }
    }
    const transition = applyResolvedCommand(this.state, command, roll?.face, actor);
    const action: RecordedAction = { id: commandId, actor, command, ...(roll ? { roll } : {}) };
    const index = this.record.cursor;
    const activated = this.record.activated ||
      (mode === 'rated' && source === 'human' && command.type === 'move' && this.state.phase === 'primary');
    return new GameSession({
      ...this.record, activated, revision: this.record.revision + 1, updatedAt: Date.now(),
      status: transition.state.outcome ? 'finished' : 'open',
      actions: [...this.record.actions.slice(0, index), action], cursor: index + 1, redo: [],
    }, [...this.history.slice(0, index + 1), {
      state: transition.state, seed, events: namespacedEvents(this.record.id, action.id, transition.events),
    }]);
  }

  private ensureEditable(): void {
    if (this.record.config.mode === 'rated' || this.record.config.mode === 'tutorial') {
      throw new SessionError('ratedLocked');
    }
    if (this.record.status === 'technical' || this.record.status === 'canceled') {
      throw new SessionError('finished');
    }
  }

  undoTarget(): number | null {
    const { config, cursor } = this.record;
    if (config.mode === 'rated' || config.mode === 'tutorial') return null;
    for (let index = cursor - 1; index >= 0; index -= 1) {
      const state = this.history[index].state;
      if (state.outcome) continue;
      if (config.mode === 'hotseat' ? state.phase === 'primary' : state.side === config.human) return index;
    }
    return null;
  }

  undo(): GameSession {
    this.ensureEditable();
    const target = this.undoTarget();
    if (target === null) throw new SessionError('noUndo');
    return this.seek(target, [...this.record.redo, this.record.cursor]);
  }

  redo(): GameSession {
    this.ensureEditable();
    const target = this.record.redo.at(-1);
    if (target === undefined) throw new SessionError('noRedo');
    return this.seek(target, this.record.redo.slice(0, -1));
  }

  private seek(cursor: number, redo: readonly number[]): GameSession {
    return new GameSession({
      ...this.record, cursor, redo, revision: this.record.revision + 1, updatedAt: Date.now(),
      status: this.history[cursor].state.outcome ? 'finished' : 'open',
    }, this.history);
  }

  changeLevel(level: number): GameSession {
    this.ensureEditable();
    if (this.record.config.mode !== 'practice' || this.record.status !== 'open'
      || this.state.side !== this.record.config.human || this.state.phase !== 'primary'
      || !Number.isInteger(level) || level < 1 || level > 10) throw new SessionError('invalidCommand');
    return new GameSession({
      ...this.record, config: { ...this.record.config, level },
      revision: this.record.revision + 1, updatedAt: Date.now(),
    }, this.history);
  }

  legal(): readonly Command[] { return legalCommands(this.state); }

  review(cursor: number): Checkpoint {
    return this.history[Math.max(0, Math.min(cursor, this.record.cursor))];
  }
}

export function captureLedger(session: GameSession): readonly CaptureEvent[] {
  return [...session.record.rootLedger, ...session.events.filter(event => event.type === 'capture')];
}

export function createContinuation(lesson: GameSession): GameSession {
  if (lesson.record.config.mode !== 'tutorial' || lesson.state.outcome) throw new SessionError('tutorialBroken');
  return createMatch({ mode: 'practice', human: 'white', level: 4, provenance: 'handoff' }, {
    root: lesson.state, rootLedger: captureLedger(lesson), tutorialOrigin: lesson.record,
  });
}

const originEvents = new WeakMap<MatchRecord, readonly GameEvent[]>();

export function tutorialHistory(session: GameSession): readonly GameEvent[] {
  const origin = session.record.tutorialOrigin;
  if (!origin) return [];
  const existing = originEvents.get(origin);
  if (existing) return existing;
  const events = hydrateMatch(origin).events;
  originEvents.set(origin, events);
  return events;
}
