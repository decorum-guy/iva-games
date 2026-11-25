import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyResolvedCommand, createInitialState, createPosition } from '../../src/core';
import type { Command, DieFace, Move } from '../../src/core';
import type { OnlineRoomCallbacks, OnlineTransportState } from '../../src/online/client';
import { OnlineGame, exportOnlineGame } from '../../src/online/game';
import { ONLINE_PROTOCOL } from '../../src/online/protocol';
import type { OnlineAction, RoomSnapshot } from '../../src/online/protocol';
import { Cabinet } from '../../src/session/cabinet';
import * as database from '../../src/storage/database';

const mock = vi.hoisted(() => ({ fetch: vi.fn(), clients: [] as { callbacks: OnlineRoomCallbacks; sent: unknown[] }[] }));
vi.mock('../../src/online/client', () => ({
  OnlineApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  ensureOnlineGuest: async () => {}, fetchOnlineRoom: mock.fetch,
  createOnlineRoom: vi.fn(), joinOnlineRoom: vi.fn(), refreshOnlineInvite: vi.fn(),
  OnlineRoomClient: class {
    sent: unknown[] = [];
    state: OnlineTransportState = { status: 'connected', pending: false, attempt: 0 };
    constructor(_id: string, readonly callbacks: OnlineRoomCallbacks) { mock.clients.push(this); }
    getState() { return this.state; }
    connect() { this.callbacks.onTransport(this.state); }
    disconnect() { this.state = { ...this.state, status: 'closed' }; this.callbacks.onTransport(this.state); }
    destroy() {}
    send(command: unknown) { this.sent.push(command); return 'sent-id'; }
  },
}));

function room(root = createInitialState()): RoomSnapshot {
  return { protocol: ONLINE_PROTOCOL, id: 'room-public-123', revision: 0, status: 'playing', you: 'white',
    players: { white: { name: 'Anna', ready: true, connected: true }, black: { name: 'Ben', ready: true, connected: true } },
    game: { id: 'game-public-123', revision: 0, createdAt: 1, updatedAt: 1, root, state: root, actions: [] },
    drawOffer: null, rematchVotes: [], expiresAt: 1_000_000, serverTime: 1 };
}

function commit(snapshot: RoomSnapshot, command: Command, face?: DieFace): RoomSnapshot {
  const actor = snapshot.game.state.side;
  const next = applyResolvedCommand(snapshot.game.state, command, face, actor);
  const id = `action-${snapshot.game.revision + 1}`;
  const action: OnlineAction = { id, actor, command, ...(face ? { roll: { face, source: 'server' as const } } : {}),
    events: next.events.map(event => ({ ...event, id: `${snapshot.game.id}/${id}/${event.id}` })) };
  return { ...snapshot, revision: snapshot.revision + 1, status: next.state.outcome ? 'finished' : 'playing',
    game: { ...snapshot.game, revision: snapshot.game.revision + 1, updatedAt: snapshot.game.updatedAt + 1,
      actions: [...snapshot.game.actions, action], state: next.state } };
}

const captureRoot = () => createPosition({ side: 'black', pieces: [
  { type: 'king', side: 'black', square: 'h8' }, { type: 'king', side: 'white', square: 'a1' },
  { type: 'rook', side: 'black', square: 'd4' }, { type: 'pawn', side: 'white', square: 'd5' },
  { type: 'pawn', side: 'white', square: 'f5' }, { type: 'pawn', side: 'white', square: 'b2' },
] });
const move = (from: string, to: string): Move => ({ type: 'move', from, to });

describe('read-only public online history', () => {
  it('reconstructs the same dice, phases and captures without a private RNG or local write methods', () => {
    const initial = room(captureRoot());
    const first = commit(initial, move('d4', 'd5'), 6);
    const second = commit(first, move('d5', 'f5'));
    const game = OnlineGame.fromRoom(second, OnlineGame.fromRoom(first));
    expect(game.state).toEqual(second.game.state);
    expect(game.review(1).state.phase).toBe('bonus');
    expect(game.at(1).record.revision).toBe(1);
    expect(game.events.filter(event => event.type === 'capture')).toHaveLength(2);
    expect(game.record.config).toMatchObject({ mode: 'online', level: null, human: 'white' });
    expect('submit' in game).toBe(false);
    expect(exportOnlineGame(game)).not.toMatch(/rootSeed|"seed"|"fixed"|"rating"|"redo"/);
  });

  it('rejects a journal that would show a different board from the server snapshot', () => {
    const snapshot = commit(room(), move('e2', 'e4'));
    expect(() => OnlineGame.fromRoom({ ...snapshot, game: { ...snapshot.game, state: createInitialState() } })).toThrow('Inconsistent');
    expect(() => OnlineGame.fromRoom({ ...snapshot, game: { ...snapshot.game, revision: 5 } })).toThrow('revision');
  });
});

describe('online cabinet presentation, independent of authoritative arrival speed', () => {
  const openStore = database.openGameStore;
  let cabinet: Cabinet;
  let store: database.GameStore;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('BroadcastChannel', undefined);
    mock.clients.length = 0;
    store = await openStore('online-presentation-' + crypto.randomUUID());
    vi.spyOn(database, 'openGameStore').mockResolvedValue(store);
    cabinet = new Cabinet();
    await cabinet.initialize();
  });
  afterEach(async () => {
    await cabinet.home(); store.close(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  async function enter(snapshot: RoomSnapshot) {
    mock.fetch.mockResolvedValue({ snapshot });
    expect(await cabinet.resumeRoom(snapshot.id)).toBe(true);
    return mock.clients.at(-1)!;
  }

  it.each([false, true])('queues a second commit through dice and the full visible reading interval (reduced=%s)', async reduced => {
    cabinet.setShortMotion(reduced);
    const first = commit(room(captureRoot()), move('d4', 'd5'), 6);
    const second = commit(first, move('d5', 'f5'));
    const client = await enter(room(captureRoot()));
    client.callbacks.onSnapshot(first, 'live');
    const cue = cabinet.getSnapshot().audioCue!;
    expect(cabinet.getSnapshot().remoteGame?.record.cursor).toBe(1);
    client.callbacks.onSnapshot(second, 'live');
    expect(cabinet.getSnapshot()).toMatchObject({ onlineQueued: 1, onlineRoom: { game: { revision: 2 } }, remoteGame: { record: { cursor: 1 } } });
    expect(cabinet.onlineCommand(move('b2', 'b3'))).toBe(false);
    await vi.advanceTimersByTimeAsync(cue.plan.end + 5000);
    expect(cabinet.getSnapshot().remoteGame?.record.cursor).toBe(1);
    const read = cabinet.getSnapshot().resultRead!;
    cabinet.acknowledgeResult(read.id);
    await vi.advanceTimersByTimeAsync(read.durationMs - 1);
    expect(cabinet.getSnapshot().remoteGame?.record.cursor).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cabinet.getSnapshot()).toMatchObject({ onlineQueued: 0, remoteGame: { record: { cursor: 2 } }, animating: true });
    expect(cabinet.getSnapshot().audioCue?.id).toMatch(/\/action-2$/);
    expect(client.sent).toEqual([]);
  });

  it('does not restart or erase a current throw on heartbeat or a presence-only update', async () => {
    const initial = room(captureRoot());
    const first = commit(initial, move('d4', 'd5'), 6);
    const client = await enter(initial);
    client.callbacks.onSnapshot(first, 'live');
    const cue = cabinet.getSnapshot().audioCue;
    const motionKey = cabinet.getSnapshot().motionKey;
    client.callbacks.onSnapshot({ ...first, revision: first.revision + 1, players: { ...first.players,
      black: { ...first.players.black!, connected: false } } }, 'live');
    expect(cabinet.getSnapshot().audioCue).toBe(cue);
    expect(cabinet.getSnapshot().motionKey).toBe(motionKey);
    expect(cabinet.getSnapshot().onlineQueued).toBe(0);
  });

  it('restores a reconnect snapshot without old rolls, sounds or mate scenes', async () => {
    const initial = room(captureRoot());
    const first = commit(initial, move('d4', 'd5'), 6);
    const second = commit(first, move('d5', 'f5'));
    const client = await enter(initial);
    client.callbacks.onSnapshot(first, 'live');
    client.callbacks.onSnapshot(second, 'welcome');
    expect(cabinet.getSnapshot()).toMatchObject({ remoteGame: { record: { cursor: 2 } },
      animating: false, audioCue: null, royalCue: null, resultRead: null, onlineQueued: 0 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(cabinet.getSnapshot().audioCue).toBeNull();
  });

  it('catches up a hidden tab statically and never changes local matches or Elo', async () => {
    const initial = room(captureRoot());
    const client = await enter(initial);
    const before = await store.overview();
    cabinet.setPageVisible(false);
    const first = commit(initial, move('d4', 'd5'), 6);
    client.callbacks.onSnapshot(first, 'live');
    expect(cabinet.getSnapshot()).toMatchObject({ remoteGame: { record: { cursor: 1 } }, animating: false, audioCue: null });
    cabinet.setPageVisible(true);
    expect(cabinet.getSnapshot().audioCue).toBeNull();
    expect(await store.overview()).toEqual(before);
  });

  it('switches colors and clears finished presentation only when a new rematch game arrives', async () => {
    const initial = room();
    const client = await enter(initial);
    const finished = commit(initial, { type: 'resign' });
    client.callbacks.onSnapshot(finished, 'live');
    expect(cabinet.getSnapshot().remoteGame?.state.outcome?.winner).toBe('black');
    const rematch = { ...room(), you: 'black' as const, game: { ...room().game, id: 'new-game-id-456' } };
    client.callbacks.onSnapshot(rematch, 'live');
    expect(cabinet.getSnapshot()).toMatchObject({ audioCue: null, remoteGame: {
      record: { id: 'new-game-id-456', cursor: 0, config: { human: 'black' } }, state: { outcome: null } } });
  });

  it('leaving the room invalidates late network callbacks without discarding the saved local game', async () => {
    await cabinet.startGame({ mode: 'hotseat', human: null, level: null, provenance: 'standard' });
    const local = cabinet.getSnapshot().game;
    const initial = room();
    const client = await enter(initial);
    await cabinet.home();
    client.callbacks.onSnapshot(commit(initial, move('e2', 'e4')), 'live');
    expect(cabinet.getSnapshot().view).toBe('home');
    expect(cabinet.getSnapshot().game).toBe(local);
    expect(cabinet.getSnapshot().audioCue).toBeNull();
  });

  it('ignores a late HTTP response after the player cancels entry and starts a local game', async () => {
    let release!: (value: { snapshot: RoomSnapshot }) => void;
    mock.fetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const request = cabinet.resumeRoom('room-public-123');
    await Promise.resolve();
    cabinet.cancelOnlineEntry();
    await cabinet.startGame({ mode: 'hotseat', human: null, level: null, provenance: 'standard' });
    const local = cabinet.getSnapshot().game;
    release({ snapshot: room() });
    expect(await request).toBe(false);
    expect(cabinet.getSnapshot()).toMatchObject({ view: 'game', onlineWorking: false });
    expect(cabinet.getSnapshot().game).toBe(local);
    expect(mock.clients).toHaveLength(0);
  });
});
