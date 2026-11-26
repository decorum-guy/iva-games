import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPosition, legalCommands, pieceAt, positionKey } from '../../src/core';
import type { Command, DieFace, Move, Side } from '../../src/core';
import { calculateElo, displayDelta } from '../../src/rating/elo';
import { captureLedger, createContinuation, createMatch } from '../../src/session/match';
import type { GameSession, Source } from '../../src/session/match';
import { newId, nextDie } from '../../src/session/random';
import { exportMatch, importMatch, restoreMatch } from '../../src/session/save';
import { openGameStore } from '../../src/storage/database';
import type { GameStore } from '../../src/storage/database';

const connections: GameStore[] = [];

async function open(name = 'remorse-test-' + newId()) {
  const store = await openGameStore(name);
  connections.push(store);
  return store;
}

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  vi.restoreAllMocks();
});

function move(from: string, to: string): Move {
  return { type: 'move', from, to };
}

function apply(game: GameSession, command: Command, actor: Side = game.state.side, source?: Source) {
  const controller = source ?? (game.record.config.human && actor !== game.record.config.human ? 'bot' : 'human');
  return game.submit(game.envelope(command, actor), controller);
}

async function play(store: GameStore, game: GameSession, commands: readonly Command[]) {
  for (const command of commands) {
    const next = apply(game, command);
    await store.commit(game, next);
    game = next;
  }
  return game;
}

const foolsMate = [move('f2', 'f3'), move('e7', 'e5'), move('g2', 'g4'), move('d8', 'h4')];
const cycle = [move('g1', 'f3'), move('g8', 'f6'), move('f3', 'g1'), move('f6', 'g8')];
const claim = { type: 'claimRepetitionDraw' } as const;
const hotseat = { mode: 'hotseat', human: null, level: null, provenance: 'standard' } as const;

function findSeed(face: DieFace) {
  // Choose a repeatable starting stream. The game still makes the ordinary,
  // unbiased live draw rather than invoking any scripted roll provider.
  for (let seed = 0; seed < 100; seed += 1) {
    if (nextDie(seed).face === face) return seed;
  }
  throw new Error('No test seed found');
}

describe('local session contract, replay and capture branches', () => {
  it('rejects a stale or different game envelope and handles duplicate delivery idempotently', () => {
    const game = createMatch(hotseat, { seed: 37 });
    const primary = game.envelope(move('e2', 'e4'));
    const concurrent = game.envelope(move('d2', 'd4'));
    const next = game.submit(primary, 'human');
    expect(next.submit(primary, 'human')).toBe(next);
    expect(() => next.submit(concurrent, 'human')).toThrow('stale');
    expect(() => next.submit({ ...primary, gameId: 'other' }, 'human')).toThrow('stale');
    const resumed = restoreMatch(JSON.parse(JSON.stringify(next.record)));
    expect(resumed.snapshot()).toEqual(next.snapshot());
    expect(resumed.snapshot()).not.toHaveProperty('seed');
    expect(resumed.snapshot().state).not.toHaveProperty('rootSeed');
    expect(resumed.submit(primary, 'human')).toBe(resumed);
  });

  it('replays a persisted live bonus with exact RNG, captures and actual repetition history', async () => {
    const store = await open();
    const initial = createMatch(hotseat, { seed: findSeed(6) });
    await store.addPractice(initial);
    const reached = await play(store, initial, [move('e2', 'e4'), move('d7', 'd5'), move('e4', 'd5')]);
    expect(reached.state.phase).toBe('bonus');
    expect(reached.record.actions.at(-1)?.roll).toEqual({ face: 6, fixed: false });
    expect(reached.state.turnSerial).toBe(2);
    expect(Object.values(reached.state.repetition).reduce((a, b) => a + b, 0)).toBe(3);
    const reload = restoreMatch(await store.getMatch(reached.record.id));
    expect(reload.snapshot()).toEqual(reached.snapshot());
    expect(reload.current.seed).toBe(reached.current.seed);
    expect(captureLedger(reload)).toMatchObject([{
      capturer: { id: 'w-e2' }, victim: { id: 'b-d7', side: 'black', square: 'd5' }, landing: 'd5',
    }]);
    const end = apply(reload, { type: 'endTurn' });
    await store.commit(reload, end);
    const reloadedEnd = restoreMatch(await store.getMatch(reached.record.id));
    expect(reloadedEnd.state.turnSerial).toBe(3);
    expect(reloadedEnd.state.side).toBe('black');
    expect(reloadedEnd.state.repetition[positionKey(reloadedEnd.state)]).toBe(1);
    expect(captureLedger(reloadedEnd)).toHaveLength(1);
    expect((await store.overview()).ledger).toEqual([]);
  });

  it('undo and branching restore the same die stream regardless of newly allocated command IDs', () => {
    const start = createMatch(hotseat, { seed: findSeed(3) });
    const before = apply(apply(start, move('e2', 'e4')), move('d7', 'd5'));
    const first = apply(before, move('e4', 'd5'));
    const undo = first.undo();
    expect(undo.current.seed).toBe(before.current.seed);
    expect(undo.state.repetition).toEqual(before.state.repetition);
    expect(captureLedger(undo)).toEqual([]);
    expect(undo.redo().snapshot().state).toEqual(first.state);
    expect(captureLedger(undo.redo()).map(event => event.victim.id)).toEqual(['b-d7']);

    const alternate = apply(undo, move('g1', 'f3'));
    expect(() => alternate.redo()).toThrow('noRedo');
    expect(captureLedger(alternate)).toEqual([]);
    const second = apply(alternate.undo(), move('e4', 'd5'));
    expect(second.record.actions.at(-1)?.id).not.toBe(first.record.actions.at(-1)?.id);
    expect(second.record.actions.at(-1)?.roll).toEqual(first.record.actions.at(-1)?.roll);
    expect(second.record.actions.at(-1)?.roll?.face).toBe(3);
    expect(second.current.seed).toBe(first.current.seed);
    expect(second.state).toEqual(first.state);
    expect(captureLedger(second)).toHaveLength(1);
    expect(captureLedger(second)[0].id).not.toBe(captureLedger(first)[0].id);
  });

  it('undo in AI practice returns to the previous human decision even after a bonus opponent path', () => {
    const root = createPosition({ side: 'white', pieces: [
      { side: 'white', type: 'king', square: 'a1' },
      { side: 'black', type: 'king', square: 'h8' },
      { side: 'white', type: 'pawn', square: 'd4' },
      { side: 'black', type: 'rook', square: 'd6', affliction: 'berserk' },
    ] });
    const game = createMatch({ mode: 'practice', level: 4, human: 'white', provenance: 'handoff' }, { root });
    const human = apply(game, move('a1', 'a2'));
    const bot = apply(human, move('d6', 'd4'));
    expect(bot.state.phase).toBe('bonus');
    const rolledBack = bot.undo();
    expect(rolledBack.state).toEqual(root);
    expect(captureLedger(rolledBack)).toEqual([]);
    const resumedBonus = restoreMatch(JSON.parse(JSON.stringify(rolledBack.record))).redo();
    expect(resumedBonus.state).toEqual(bot.state);
    expect(captureLedger(resumedBonus)).toHaveLength(1);
  });

  it('creates a fresh normal undo root from the tutorial’s captured pieces, state and repetition', async () => {
    const store = await open();
    const reserved = await store.reserveRated('white', 4);
    await play(store, reserved, [move('e2', 'e4')]);

    const root = createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'a1' }, { side: 'black', type: 'king', square: 'h8' },
      { side: 'white', type: 'rook', square: 'd4' }, { side: 'black', type: 'pawn', square: 'd5' },
      { side: 'white', type: 'queen', square: 'b3' }, { side: 'black', type: 'pawn', square: 'b4' },
    ] });
    const initial = createMatch({ mode: 'tutorial', human: 'white', level: 4, provenance: 'lesson' }, { root });
    const first = initial.submit(initial.envelope(move('d4', 'd5')), 'human', () => 4);
    const lesson = apply(first, move('h8', 'h7'), 'black', 'script');
    expect(lesson.record.actions[0].roll).toEqual({ face: 4, fixed: true });

    const continuation = createContinuation(lesson);
    await store.addPractice(continuation);
    expect(continuation.state).toEqual(lesson.state);
    expect(continuation.record.config).toMatchObject({ mode: 'practice', level: 4, provenance: 'handoff' });
    expect(continuation.record.rootLedger).toEqual(captureLedger(lesson));
    expect(continuation.undoTarget()).toBeNull();
    expect(() => continuation.undo()).toThrow('noUndo');

    const next = await play(store, continuation, [move('b3', 'b4')]);
    expect(next.record.actions[0].roll).toEqual({ face: nextDie(continuation.current.seed).face, fixed: false });
    expect(captureLedger(next)).toHaveLength(2);
    expect(captureLedger(next.undo())).toEqual(captureLedger(lesson));
    const reloaded = restoreMatch(await store.getMatch(continuation.record.id));
    expect(captureLedger(reloaded)).toEqual(captureLedger(next));
    expect(reloaded.state.repetition).toEqual(next.state.repetition);
    const overview = await store.overview();
    expect(overview.profile).toMatchObject({ ratedId: reserved.record.id, rating: 1000 });
    expect(overview.matches.find(match => match.id === reserved.record.id)).toMatchObject({ status: 'open', activated: true });
    expect(overview.ledger).toEqual([]);
  });
});

describe('rated reservation and exactly-once IndexedDB settlement', () => {
  it('reserves one unfinished slot across two connections before activation, including a white bot opening', async () => {
    const name = 'remorse-concurrent-' + newId();
    const owner = await open(name);
    const other = await open(name);
    const attempted = await Promise.allSettled([owner.reserveRated('black', 4), other.reserveRated('black', 4)]);
    const created = attempted.find(result => result.status === 'fulfilled');
    expect(attempted.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempted.filter(result => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'ratedOccupied' } },
    ]);
    if (!created) throw new Error('Reservation unavailable');
    const first = created.value;
    expect(first.record.activated).toBe(false);
    expect(() => first.changeLevel(8)).toThrow('ratedLocked');
    expect(() => first.undo()).toThrow('ratedLocked');

    const botMoved = await play(owner, first, [move('e2', 'e4')]);
    expect(botMoved.record.activated).toBe(false);
    await expect(other.reserveRated('white', 4)).rejects.toThrow('ratedOccupied');
    await other.closeRated(restoreMatch(await other.getMatch(first.record.id)));
    expect(await owner.getMatch(first.record.id)).toMatchObject({ status: 'canceled', activated: false });
    expect((await owner.overview()).ledger).toEqual([]);

    const second = await other.reserveRated('black', 4);
    const opened = await play(other, second, [move('e2', 'e4'), move('e7', 'e5')]);
    expect(opened.record.activated).toBe(true);
    await expect(owner.closeRated(opened)).rejects.toThrow('ratedLocked');
    await owner.closeRated(opened, true);
    const ended = await other.overview();
    expect(ended.profile).toMatchObject({ rating: 1000, ratedId: null, wins: 0, draws: 0, losses: 0 });
    expect(ended.matches.find(match => match.id === opened.record.id)?.status).toBe('technical');
    expect(ended.ledger).toEqual([]);
  });

  it('settles a real checkmate once across duplicate tab deliveries, readback and unrated import', async () => {
    const name = 'remorse-duplicate-' + newId();
    const left = await open(name);
    const right = await open(name);
    const initial = await left.reserveRated('black', 4);
    const prior = await play(left, initial, foolsMate.slice(0, 3));
    const loaded = restoreMatch(await right.getMatch(prior.record.id));
    const envelope = prior.envelope(foolsMate[3]);
    const next = prior.submit(envelope, 'human');
    const duplicate = loaded.submit(envelope, 'human');
    expect(next.state.outcome).toEqual({ reason: 'checkmate', winner: 'black' });
    const settled = await Promise.all([left.commit(prior, next), right.commit(loaded, duplicate)]);
    expect(settled[0]).toMatchObject({ before: 1000, after: 1016, exactDelta: 16, score: 1 });
    expect(settled[1]).toEqual(settled[0]);
    const reopened = await open(name);
    const result = await reopened.overview();
    expect(result.profile).toMatchObject({ rating: 1016, best: 1016, wins: 1, ratedId: null });
    expect(result.ledger).toHaveLength(1);

    const restored = restoreMatch(await reopened.getMatch(initial.record.id));
    expect(restored.record.config.mode).toBe('rated');
    expect(() => restored.undo()).toThrow('ratedLocked');
    const imported = importMatch(exportMatch(restored));
    expect(imported.record.id).not.toBe(restored.record.id);
    expect(imported.record.activated).toBe(false);
    expect(imported.record.config).toMatchObject({ mode: 'practice', provenance: 'import' });
    expect(imported.record.config.rating).toBeUndefined();
    expect(imported.state).toEqual(restored.state);
    await reopened.addPractice(imported);
    expect((await reopened.overview()).ledger).toEqual(result.ledger);
    expect(() => importMatch('{"broken":true}')).toThrow('invalidSave');
    expect(await reopened.getMatch(initial.record.id)).toMatchObject({ status: 'finished' });
  });

  it('rolls back ledger, profile and terminal state together if interrupted before the match write', async () => {
    const name = 'remorse-aborted-' + newId();
    const store = await open(name);
    const tab = await open(name);
    const initial = await store.reserveRated('white', 4);
    const prior = await play(store, initial, foolsMate.slice(0, 3));
    const terminal = apply(prior, foolsMate[3]);
    expect(terminal.state.outcome).toEqual({ reason: 'checkmate', winner: 'black' });
    const originalPut = IDBObjectStore.prototype.put;
    const crash = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore, value: unknown, key?: IDBValidKey,
    ) {
      if (this.name === 'matches' && (value as { status?: string }).status === 'finished') {
        this.transaction.abort();
        throw new Error('crash before match write');
      }
      return originalPut.call(this, value, key);
    });
    await expect(store.commit(prior, terminal)).rejects.toThrow('crash before match write');
    const partial = await tab.overview();
    expect(partial.profile).toMatchObject({ rating: 1000, ratedId: initial.record.id, losses: 0 });
    expect(partial.ledger).toHaveLength(0);
    expect(partial.matches[0]).toMatchObject({ status: 'open', revision: prior.record.revision });
    crash.mockRestore();
    const retry = await tab.commit(prior, terminal);
    expect(retry).toMatchObject({ before: 1000, after: 984, exactDelta: -16, score: 0 });
    expect((await store.overview()).ledger).toHaveLength(1);
    expect((await store.overview()).profile).toMatchObject({ rating: 984, best: 1000, losses: 1, ratedId: null });
  });

  it('resumes a rated match with nicknames and permits an explicit off-turn resignation', async () => {
    const name = 'remorse-resignation-' + newId();
    const first = await open(name);
    const initial = await first.reserveRated('white', 4, { black: 'Ночной ферзь', white: 'Артём' });
    const opened = await play(first, initial, [move('e2', 'e4')]);
    const resumed = await open(name);
    const restored = restoreMatch(await resumed.getMatch(opened.record.id));
    expect(restored.record.config.names).toEqual({ white: 'Артём', black: 'Ночной ферзь' });
    expect(restored.state.side).toBe('black');
    const resigned = apply(restored, { type: 'resign' }, 'white', 'human');
    expect(resigned.state.turnSerial).toBe(restored.state.turnSerial);
    expect(resigned.state.outcome).toEqual({ reason: 'resignation', winner: 'black' });
    expect(await resumed.commit(restored, resigned)).toMatchObject({ before: 1000, after: 984, score: 0 });
    expect((await first.overview()).profile).toMatchObject({ rating: 984, ratedId: null, losses: 1 });
  });

  it('uses the frozen anchor for a real repetition draw, retaining floats across reload', async () => {
    const store = await open();
    const initial = await store.reserveRated('white', 5);
    const repeated = await play(store, initial, [...cycle, ...cycle]);
    expect(legalCommands(repeated.state)).toContainEqual(claim);
    const cloned = restoreMatch(await store.getMatch(initial.record.id));
    expect(cloned.state.repetition[positionKey(cloned.state)]).toBe(3);
    const claimed = apply(cloned, claim);
    expect(claimed.state.outcome).toEqual({ reason: 'repetition', winner: null });
    const entry = await store.commit(cloned, claimed);
    expect(entry).toMatchObject({ anchor: 1200, before: 1000, score: 0.5, k: 32 });
    expect(entry?.after).toBeCloseTo(1008.31190165, 8);
    expect(displayDelta(1000, entry!.after)).toBe(8);
    expect((await store.overview()).profile).toMatchObject({ rating: entry?.after, draws: 1, ratedId: null });
  });

  it('rejects conflicting writes from old revisions and retains the first complete version', async () => {
    const name = 'remorse-stale-' + newId();
    const store = await open(name);
    const tab = await open(name);
    const initial = await store.reserveRated('white', 4);
    const old = restoreMatch(await tab.getMatch(initial.record.id));
    const first = apply(initial, move('e2', 'e4'));
    const second = apply(old, move('d2', 'd4'));
    await store.commit(initial, first);
    await expect(tab.commit(old, second)).rejects.toThrow('stale');
    const readback = restoreMatch(await tab.getMatch(initial.record.id));
    expect(pieceAt(readback.state, 'e4')?.id).toBe('w-e2');
    expect(pieceAt(readback.state, 'd2')?.id).toBe('w-d2');
    expect(readback.record.activated).toBe(true);
    expect((await tab.overview()).ledger).toEqual([]);
  });

  it('computes stronger and weaker expectations, floor and displayed differences', () => {
    expect(calculateElo(1000, 1200, 1).after).toBeCloseTo(1024.31190165, 8);
    expect(calculateElo(1000, 1200, 0).after).toBeCloseTo(992.31190165, 8);
    expect(calculateElo(1000, 800, 0.5).after).toBeCloseTo(991.68809835, 8);
    expect(calculateElo(101, 400, 0)).toMatchObject({ after: 100, exactDelta: -1 });
    expect(calculateElo(2200, 2200, 1).after).toBe(2216);
    expect(displayDelta(1000.49, 1000.51)).toBe(1);
    expect(displayDelta(1000.1, 1000.4)).toBe(0);
  });
});
