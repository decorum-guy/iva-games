import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_PROTOCOL } from '@iva-games/session-kit';
import { KnockConnection } from '../src/client/network';
import { connectParticipant, createMission, viewForParticipant } from '../src/core/mission';
import { KNOCK_CONTENT, KNOCK_RULES, KNOCK_WIRE } from '../src/core/version';
import type { CommandReceipt } from '../src/core/types';

// Transport-only fixtures: no browser, real socket, WebGL, audio or playthrough.
type Frame = Record<string, unknown>;
class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  bufferedAmount = 0;
  readonly sent: Frame[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: URL) { MockWebSocket.instances.push(this); }
  send(text: string): void { this.sent.push(JSON.parse(text) as Frame); }
  receive(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }); }
  disconnect(code = 1006): void { this.readyState = 3; this.onclose?.({ code }); }
  close = vi.fn((code = 1000) => { this.disconnect(code); });
}

const base = { protocol: LIVE_PROTOCOL, wireVersion: KNOCK_WIRE, gameId: 'knock-first', rulesVersion: KNOCK_RULES, contentVersion: KNOCK_CONTENT, roomId: 'room-a', matchId: 'match-a' };
function snapshot(epoch = 'epoch-first-0001', tick = 1): Frame {
  const state = createMission({ seed: 29, participants: [
    { participantId: 'seat-a', playerId: 'account-a', displayName: 'A', kind: 'human' },
    { participantId: 'seat-b', playerId: 'account-b', displayName: 'B', kind: 'human' },
  ] });
  connectParticipant(state, 'seat-a'); state.tick = tick;
  return { ...base, type: 'snapshot', epoch, tick, serverTime: 1000, lastAcceptedSeq: -1, view: viewForParticipant(state, 'seat-a') };
}
function receipt(socket: MockWebSocket, command: Frame, epoch: string, overrides: Frame = {}): CommandReceipt {
  const result: CommandReceipt = { actionId: String(command.actionId), ok: true, code: 'OK', tick: 2, revision: 3 };
  socket.receive({ ...base, type: 'receipt', epoch, actionId: command.actionId, tick: 2, result, ...overrides });
  return result;
}
const sentCommands = (socket: MockWebSocket) => socket.sent.filter(frame => frame.type === 'command');

describe('Knock connection lifecycle and outbox (mocked WebSocket)', () => {
  let connection: KnockConnection;
  const onView = vi.fn(), onState = vi.fn(), onError = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('location', { origin: 'https://knock.test', protocol: 'https:' });
    connection = new KnockConnection('room-a', 'match-a', onView, onState, onError);
  });
  afterEach(() => { connection.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('sends exactly the seven runtime input fields even when scene input contains interact and other fields', () => {
    connection.start(); connection.start();
    const socket = MockWebSocket.instances[0]; expect(MockWebSocket.instances).toHaveLength(1);
    expect(String(socket.url)).toBe('wss://knock.test/api/platform/v1/rooms/room-a/live');
    const sceneInput = { moveX: 0.2, moveZ: -0.7, yaw: 0.4, pitch: -0.2, run: true, quiet: false, interact: true, hand: true, seq: 99, controllerEpoch: 99 };
    connection.input(sceneInput);
    vi.advanceTimersByTime(34); expect(socket.sent).toEqual([]);
    socket.receive(snapshot()); vi.advanceTimersByTime(34);
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toEqual({ protocol: LIVE_PROTOCOL, wireVersion: KNOCK_WIRE, roomId: 'room-a', matchId: 'match-a', epoch: 'epoch-first-0001', type: 'input', seq: 0,
      payload: { moveX: 0.2, moveZ: -0.7, yaw: 0.4, pitch: -0.2, run: true, quiet: false, hand: true } });
  });

  it('does not establish scope from non-object, inconsistent or incomplete snapshots', () => {
    connection.start(); const socket = MockWebSocket.instances[0];
    socket.receive(null); socket.receive([]); socket.onmessage?.({ data: '{broken' });
    socket.receive({ ...snapshot(), epoch: '' });
    socket.receive({ ...snapshot(), tick: 99 });
    socket.receive({ ...snapshot(), view: { version: KNOCK_RULES } });
    socket.receive({ ...snapshot(), lastAcceptedSeq: 6 });
    expect(onView).not.toHaveBeenCalled(); expect(onState).not.toHaveBeenCalledWith('connected');
    vi.advanceTimersByTime(100); expect(socket.sent).toEqual([]);
    socket.receive(snapshot()); expect(onView).toHaveBeenCalledTimes(1); expect(onState).toHaveBeenLastCalledWith('connected');
  });

  it.each([
    [{ roomId: 'another-room' }, 'MATCH_CHANGED'],
    [{ matchId: 'another-match' }, 'MATCH_CHANGED'],
    [{ gameId: 'another-game' }, 'MATCH_CHANGED'],
    [{ contentVersion: 'old-content' }, 'INCOMPATIBLE_VERSION'],
  ] as const)('rejects incompatible initial scope %j', (change, code) => {
    connection.start(); const socket = MockWebSocket.instances[0]; socket.receive({ ...snapshot(), ...change });
    expect(onView).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledWith(code); expect(onState).toHaveBeenLastCalledWith('closed');
  });

  it('ordinary reconnect retains action ID and payload while updating both epochs, and ignores stale receipts', async () => {
    connection.start(); const first = MockWebSocket.instances[0]; first.receive(snapshot());
    const done = vi.fn(); const promise = connection.command({ type: 'door', doorId: 'C-X' }, 7).then(done);
    const original = sentCommands(first)[0]; first.disconnect(); vi.advanceTimersByTime(350);
    const second = MockWebSocket.instances[1]; second.receive(snapshot('epoch-second-0001', 3));
    const repeated = sentCommands(second)[0];
    expect(repeated.actionId).toBe(original.actionId); expect(repeated.expectedRevision).toBe(original.expectedRevision);
    expect(repeated.epoch).toBe('epoch-second-0001');
    expect(repeated.payload).toEqual({ payload: { type: 'door', doorId: 'C-X' }, expectedRevision: 7, epoch: 'epoch-second-0001' });
    receipt(first, original, 'epoch-first-0001');
    receipt(second, repeated, 'epoch-first-0001');
    second.receive({ ...base, type: 'error', epoch: 'epoch-first-0001', actionId: original.actionId, code: 'STALE_CONTROLLER' });
    receipt(second, repeated, 'epoch-second-0001', { result: null });
    await Promise.resolve(); expect(done).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    const result = receipt(second, repeated, 'epoch-second-0001'); await promise; expect(done).toHaveBeenCalledExactlyOnceWith(result);
    second.receive(snapshot('epoch-second-0001', 4)); expect(sentCommands(second)).toHaveLength(1);
  });

  it('graphics suspend/resume preserves pending IDs and neutralizes controls until a fresh scope is established', async () => {
    connection.start(); const first = MockWebSocket.instances[0]; first.receive(snapshot());
    const movement = { moveX: 1, moveZ: 0, yaw: 0.3, pitch: 0, run: true, quiet: false, hand: true };
    connection.input(movement);
    const promise = connection.command({ type: 'takeTimer' }); const original = sentCommands(first)[0];
    connection.suspend(); connection.suspend(); connection.input(movement);
    vi.advanceTimersByTime(5000); expect(MockWebSocket.instances).toHaveLength(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    connection.resume(); connection.resume(); expect(MockWebSocket.instances).toHaveLength(2);
    const second = MockWebSocket.instances[1]; vi.advanceTimersByTime(34); expect(second.sent).toEqual([]);
    second.receive(snapshot('epoch-restored-0001', 2));
    const repeated = sentCommands(second)[0]; expect(repeated.actionId).toBe(original.actionId);
    expect(repeated.payload).toEqual({ payload: { type: 'takeTimer' }, epoch: 'epoch-restored-0001' });
    vi.advanceTimersByTime(34);
    expect(second.sent.find(frame => frame.type === 'input')?.payload).toMatchObject({ moveX: 0, moveZ: 0, run: false, hand: false });
    const result = receipt(second, repeated, 'epoch-restored-0001'); await expect(promise).resolves.toEqual(result);
  });

  it('recovers an ambiguous gateway timeout with the same action ID instead of dropping the durable receipt', async () => {
    connection.start(); const first = MockWebSocket.instances[0]; first.receive(snapshot());
    const promise = connection.command({ type: 'placeTimer' }); const original = sentCommands(first)[0];
    first.receive({ ...base, type: 'error', epoch: 'epoch-first-0001', actionId: original.actionId, code: 'GAME_TIMEOUT' });
    first.disconnect(4003); vi.advanceTimersByTime(350);
    const second = MockWebSocket.instances[1]; second.receive(snapshot('epoch-second-0001', 2));
    const repeated = sentCommands(second)[0]; expect(repeated.actionId).toBe(original.actionId);
    await expect(promise).resolves.toEqual(receipt(second, repeated, 'epoch-second-0001'));
  });

  it('waits for explicit reclaim after supersession, preserving the unresolved action ID', async () => {
    connection.start(); const first = MockWebSocket.instances[0]; first.receive(snapshot());
    const promise = connection.command({ type: 'ready' }); const original = sentCommands(first)[0];
    first.disconnect(4001); vi.advanceTimersByTime(10000); expect(MockWebSocket.instances).toHaveLength(1);
    expect(onState).toHaveBeenLastCalledWith('superseded');
    connection.reclaim(); const second = MockWebSocket.instances[1]; second.receive(snapshot('epoch-reclaimed-0001', 2));
    const repeated = sentCommands(second)[0]; expect(repeated.actionId).toBe(original.actionId);
    await expect(promise).resolves.toEqual(receipt(second, repeated, 'epoch-reclaimed-0001'));
  });

  it('final close rejects pending commands, clears retries and cannot reopen via resume/reclaim/start', async () => {
    connection.start(); const first = MockWebSocket.instances[0]; first.receive(snapshot());
    const result = connection.command({ type: 'knock' }).catch(error => error as Error);
    first.disconnect(); connection.close(); connection.close(); connection.resume(); connection.reclaim(); connection.start();
    vi.advanceTimersByTime(10000); expect(MockWebSocket.instances).toHaveLength(1);
    expect(await result).toMatchObject({ message: 'CLOSED' });
    await expect(connection.command({ type: 'knock' })).rejects.toThrow('CLOSED');
    expect(onState.mock.calls.filter(([state]) => state === 'closed')).toHaveLength(1);
  });
});
