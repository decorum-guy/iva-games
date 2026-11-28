import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { build } from 'vite';
import type { Participant, StartMatchRequest } from '@iva-games/session-kit';
import type { Receipt, ShiftView } from '../src/core/types';
import { ShiftRuntime, shiftRoomSettings, validateShiftRoom } from '../src/server/runtime';

const active: { runtime: ShiftRuntime; directory: string }[] = [];
afterEach(() => { for (const f of active) { f.runtime.close(); rmSync(f.directory, { recursive: true, force: true }); } active.length = 0; });
const roster = (size = 2): Participant[] => Array.from({ length: size * 2 }, (_, index) => index % size === 0 ? {
  participantId: `seat-${index}`, playerId: `player-${index}`, displayName: `Pilot ${index}`, seatIndex: index,
  controller: { kind: 'human' as const, playerId: `player-${index}` },
} : {
  participantId: `seat-${index}`, playerId: null, displayName: `Bot ${index}`, seatIndex: index,
  controller: { kind: 'bot' as const, botProfileId: 'shift:normal', botVersion: 'shift-bot@1', difficulty: 'normal' as const },
});
function request(size: 2 | 3 = 2): StartMatchRequest {
  return { startCommandId: `start-${size}`, roomId: `room-${size}`, rulesVersion: 'shift@1', contentVersion: 'shift-content@1',
    participants: roster(size), settings: { arena: 'foundry', teamSize: size, rotateRoles: false, difficulty: 'normal' } };
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'iva-shift-runtime-'));
  const f = { directory, runtime: new ShiftRuntime({ databasePath: join(directory, 'runtime.sqlite'), autoTick: false }) };
  active.push(f); return f;
}

describe('durable Shift runtime', () => {
  it('validates exact capacities, complete mixed rosters, team symmetry and one account per seat', () => {
    const settings = shiftRoomSettings({ teamSize: 2 });
    expect(settings).toMatchObject({ arena: 'foundry', teamSize: 2, rotateRoles: true });
    expect(() => validateShiftRoom({ ...settings }, 5)).toThrow();
    expect(() => validateShiftRoom({ ...settings }, 4, roster().slice(0, 3))).toThrow();
    expect(() => validateShiftRoom({ ...settings }, 4, roster())).not.toThrow();
    expect(() => validateShiftRoom({ ...settings, teams: { 'seat-0': 'amber' } }, 4, roster())).toThrow();
    expect(() => validateShiftRoom({ ...settings, initialNavigators: { teal: 'seat-3' } }, 4, roster())).toThrow();
    const duplicate = roster(); duplicate[2] = { ...duplicate[0], participantId: 'seat-2', seatIndex: 2 };
    expect(() => validateShiftRoom({ ...settings }, 4, duplicate)).toThrow();
    expect(() => shiftRoomSettings({ admin: true })).toThrow();
  });

  it.each([2, 3] as const)('creates one durable match with %i players per team for one start ID and restricts its frozen roster', async size => {
    const { runtime } = fixture(), input = request(size);
    const first = await runtime.createMatch(input);
    expect(await runtime.createMatch(input)).toEqual(first);
    await expect(runtime.createMatch({ ...input, settings: { ...input.settings, arena: 'depot' } })).rejects.toThrow();
    await expect(runtime.viewForPlayer(first.matchId, 'outsider')).rejects.toThrow();
    const view = await runtime.viewForPlayer(first.matchId, 'player-0') as ShiftView;
    expect(view.seats).toHaveLength(size * 2);
    expect(JSON.stringify(view)).not.toContain('player-0');
    expect(view.self.seatId).toBe('seat-0');
  });

  it('batches opposing shifts, persists the accepted receipt, and survives restart during a move', async () => {
    const f = fixture(), { matchId } = await f.runtime.createMatch(request());
    const teal = f.runtime.openLiveSession(matchId, 'player-0'), amber = f.runtime.openLiveSession(matchId, 'player-2');
    f.runtime.advanceTicks(211);
    const view = teal.snapshot().view as ShiftView;
    const a = { type: 'shift', roundId: view.round, controllerEpoch: teal.controllerEpoch, roomId: 'O', expectedBoardRevision: view.boardRevision };
    const b = { ...a, roomId: 'F', controllerEpoch: amber.controllerEpoch };
    const first = teal.command('shift-action-a', a), second = amber.command('shift-action-b', b);
    f.runtime.advanceTicks();
    const [one, two] = await Promise.all([first, second]) as Receipt[];
    expect([one.accepted, two.accepted].filter(Boolean)).toHaveLength(1);
    expect(one.accepted).toBe(true);
    const moving = teal.snapshot().view as ShiftView;
    expect(moving.motion?.roomId).toBe('O');
    expect(await teal.command('shift-action-a', a)).toEqual(one);
    f.runtime.close();
    f.runtime = new ShiftRuntime({ databasePath: join(f.directory, 'runtime.sqlite'), autoTick: false });
    const resumed = f.runtime.openLiveSession(matchId, 'player-0');
    const restored = resumed.snapshot().view as ShiftView;
    expect(restored.motion?.roomId).toBe('O');
    expect(restored.recoveryTicksRemaining).toBe(150);
    const frozen = restored.tick;
    const duringRecovery = { ...a, controllerEpoch: resumed.controllerEpoch };
    const pendingRecovery = resumed.command('recovery-rejected-action', duringRecovery);
    f.runtime.advanceTicks();
    const recoveryReceipt = await pendingRecovery as Receipt;
    expect(recoveryReceipt).toMatchObject({ accepted: false, reason: 'PHASE', tick: frozen });
    f.runtime.advanceTicks(149);
    expect((resumed.snapshot().view as ShiftView).tick).toBe(frozen);
    f.runtime.advanceTicks(20);
    const arrived = resumed.snapshot().view as ShiftView;
    expect(arrived.motion).toBeNull(); expect(arrived.board[7]).toBe('O'); expect(arrived.board[4]).toBeNull();
    // A rejected recovery key cannot turn into a later action when the client retries.
    expect(await resumed.command('recovery-rejected-action', duringRecovery)).toEqual(recoveryReceipt);
    expect(await resumed.command('shift-action-a', a)).toEqual(one);
    expect((resumed.snapshot().view as ShiftView).boardRevision).toBe(arrived.boardRevision);
  });

  it('replaces controller epochs, ignores stale closing sockets, and rejects malformed pilot input', async () => {
    const { runtime } = fixture(), { matchId } = await runtime.createMatch(request());
    const first = runtime.openLiveSession(matchId, 'player-0'), second = runtime.openLiveSession(matchId, 'player-0');
    expect(first.isCurrent()).toBe(false); expect(second.isCurrent()).toBe(true);
    first.close(); expect(second.isCurrent()).toBe(true);
    expect(() => first.input({})).toThrow();
    expect(() => second.input({ type: 'input', roundId: 1, controllerEpoch: second.controllerEpoch, seq: 1, moveX: Infinity, moveZ: 0, aim: 0, fireHeld: false })).toThrow();
    expect(() => second.input({ type: 'input', roundId: 1, controllerEpoch: first.controllerEpoch, seq: 1, moveX: 0, moveZ: 0, aim: 0, fireHeld: false })).toThrow();
  });

  it('flushes a pending discrete command during graceful shutdown before its receipt resolves', async () => {
    const f = fixture(), { matchId } = await f.runtime.createMatch(request());
    const lease = f.runtime.openLiveSession(matchId, 'player-0');
    const payload = { type: 'shift', roundId: 1, controllerEpoch: lease.controllerEpoch, roomId: 'O', expectedBoardRevision: 0 };
    const pending = lease.command('shutdown-command', payload);
    f.runtime.close();
    const receipt = await pending as Receipt;
    expect(receipt.accepted).toBe(false);
    f.runtime = new ShiftRuntime({ databasePath: join(f.directory, 'runtime.sqlite'), autoTick: false });
    const next = f.runtime.openLiveSession(matchId, 'player-0');
    expect(await next.command('shutdown-command', payload)).toEqual(receipt);
  });

  it('evicts completed residents, keeps final receipt replay durable, and starts a distinct rematch', async () => {
    const f = fixture(), input = request(), first = await f.runtime.createMatch(input);
    const residentCount = (): number => (Reflect.get(f.runtime, 'matches') as Map<string, unknown>).size;
    const firstLease = f.runtime.openLiveSession(first.matchId, 'player-0');
    const payload = { type: 'shift', roundId: 1, controllerEpoch: firstLease.controllerEpoch, roomId: 'O', expectedBoardRevision: 0 };
    const pending = firstLease.command('before-finish-receipt', payload);
    f.runtime.advanceTicks(); const receipt = await pending;
    firstLease.close();
    // Real fixed steps and public-view bot substitutes, without setting scores or deadlines.
    f.runtime.advanceTicks(16_000);
    expect(residentCount()).toBe(0);
    const completed = await f.runtime.status(first.matchId);
    expect(completed.finished).toBe(true);
    await f.runtime.viewForPlayer(first.matchId, 'player-0');
    expect(residentCount()).toBe(0); // Historical HTTP reads do not join the 30 Hz clock.
    const resultTab = f.runtime.openLiveSession(first.matchId, 'player-0');
    const takeover = f.runtime.openLiveSession(first.matchId, 'player-0');
    resultTab.close(); expect(takeover.isCurrent()).toBe(true); expect(residentCount()).toBe(1);
    expect(await takeover.command('before-finish-receipt', payload)).toEqual(receipt);
    expect(() => takeover.command('before-finish-receipt', { ...payload, roomId: 'F' })).toThrow(expect.objectContaining({ code: 'ACTION_CONFLICT' }));
    for (let index = 0; index < 100; index++) expect(() => takeover.command(`after-finish-${index}`, { ...payload, controllerEpoch: takeover.controllerEpoch })).toThrow(expect.objectContaining({ code: 'MATCH_FINISHED' }));
    expect((takeover.snapshot().view as ShiftView).phase).toBe('finished');
    takeover.close(); expect(residentCount()).toBe(0);
    const second = await f.runtime.createMatch({ ...input, startCommandId: 'fresh-rematch-start' });
    expect(second.matchId).not.toBe(first.matchId);
    expect((await f.runtime.status(second.matchId)).finished).toBe(false);
    f.runtime.close();
    f.runtime = new ShiftRuntime({ databasePath: join(f.directory, 'runtime.sqlite'), autoTick: false });
    expect(await f.runtime.status(first.matchId)).toEqual(completed);
    const final = await f.runtime.viewForPlayer(first.matchId, 'player-0') as ShiftView;
    expect(final.phase).toBe('finished'); expect(final.recoveryTicksRemaining).toBe(0);
    expect(residentCount()).toBe(1); // Only the unfinished rematch was restored.
    const restoredFinal = f.runtime.openLiveSession(first.matchId, 'player-0');
    expect(await restoredFinal.command('before-finish-receipt', payload)).toEqual(receipt);
    expect(() => restoredFinal.command('after-restart-finish', { ...payload, controllerEpoch: restoredFinal.controllerEpoch })).toThrow(expect.objectContaining({ code: 'MATCH_FINISHED' }));
    restoredFinal.close(); expect(residentCount()).toBe(1);
  }, 30_000);

  it('recovers an acknowledged shift after an actual SIGKILL with no graceful runtime close', async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const qa = join(root, '.qa'); mkdirSync(qa, { recursive: true });
    const compiled = mkdtempSync(join(qa, 'shift-crash-'));
    const directory = mkdtempSync(join(tmpdir(), 'iva-shift-crash-'));
    const databasePath = join(directory, 'runtime.sqlite');
    let runtime: ShiftRuntime | undefined;
    try {
      await build({ root, configFile: false, logLevel: 'silent', ssr: { noExternal: ['@iva-games/session-kit'] },
        build: { ssr: join(root, 'games/shift/tests/server-crash-child.ts'), outDir: compiled, emptyOutDir: true, minify: false } });
      const child = fork(join(compiled, 'server-crash-child.js'), [databasePath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      let message: { matchId: string; receipt: Receipt; command: unknown; tick: number; motion: ShiftView['motion'] };
      try {
        message = await new Promise((yes, no) => {
          const timeout = setTimeout(() => no(new Error('Crash fixture did not acknowledge shift')), 10_000);
          child.once('message', value => { clearTimeout(timeout); yes(value as typeof message); });
          child.once('error', error => { clearTimeout(timeout); no(error); });
          child.once('exit', (code, signal) => { clearTimeout(timeout); no(new Error(`Crash fixture exited early ${code}/${signal}`)); });
        });
        expect(message.receipt.accepted).toBe(true); expect(message.motion?.roomId).toBe('O');
        const exited = new Promise<string | null>(yes => child.once('exit', (_code, signal) => yes(signal)));
        child.kill('SIGKILL'); expect(await exited).toBe('SIGKILL');
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
      runtime = new ShiftRuntime({ databasePath, autoTick: false });
      const controller = runtime.openLiveSession(message.matchId, 'player-0');
      const recovered = controller.snapshot().view as ShiftView;
      expect(recovered.tick).toBe(message.tick); expect(recovered.motion).toEqual(message.motion);
      expect(recovered.recoveryTicksRemaining).toBe(150);
      expect(await controller.command('crash-shift-action', message.command)).toEqual(message.receipt);
      runtime.advanceTicks(150 + 17);
      const complete = controller.snapshot().view as ShiftView;
      expect(complete.motion).toBeNull(); expect(complete.board[7]).toBe('O'); expect(complete.board[4]).toBeNull();
    } finally {
      runtime?.close(); rmSync(directory, { recursive: true, force: true }); rmSync(compiled, { recursive: true, force: true });
    }
  }, 30_000);
});
