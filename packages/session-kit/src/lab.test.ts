import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlatformLabRuntime, chooseLabBotMove } from './lab';
import type { StartMatchRequest } from './types';

const directories: string[] = [];
const runtimes: PlatformLabRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) { try { runtime.close(); } catch { /* explicitly reopened in restart check */ } } for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function runtime(now?: () => number, databasePath = ':memory:') {
  const result = new PlatformLabRuntime({ databasePath, now }); runtimes.push(result); return result;
}
function request(withBot = false): StartMatchRequest {
  return { startCommandId: 'start-command', roomId: 'room-one', rulesVersion: 'lab-1', contentVersion: 'lab-1', settings: {},
    participants: [
      { participantId: 'seat-a', playerId: 'account-a', displayName: 'Первый', seatIndex: 0, controller: { kind: 'human', playerId: 'account-a' } },
      withBot
        ? { participantId: 'seat-b', playerId: null, displayName: 'Бот', seatIndex: 1, controller: { kind: 'bot', botProfileId: 'platform-lab:normal', botVersion: '1', difficulty: 'normal' } }
        : { participantId: 'seat-b', playerId: 'account-b', displayName: 'Второй', seatIndex: 1, controller: { kind: 'human', playerId: 'account-b' } },
    ] };
}

describe('durable authoritative technical sessions', () => {
  it('pins start identity and refuses a replay with a different roster or unsupported version', async () => {
    const game = runtime(); const input = request(); const first = await game.createMatch(input);
    expect(await game.createMatch(structuredClone(input))).toEqual(first);
    await expect(game.createMatch({ ...input, settings: { changed: true } })).rejects.toMatchObject({ code: 'START_CONFLICT' });
    await expect(game.createMatch({ ...input, rulesVersion: 'future' })).rejects.toMatchObject({ code: 'INCOMPATIBLE_VERSION' });
    await expect(game.createMatch({ ...input, participants: [input.participants[0], { ...input.participants[0], participantId: 'seat-c', seatIndex: 2 }] })).rejects.toMatchObject({ code: 'INVALID_ROSTER' });
  });

  it('never exposes an opponent choice before reveal, including reconnect, and rejects outsiders', async () => {
    const game = runtime(); const { matchId } = await game.createMatch(request());
    const command = { actionId: 'command-a', expectedRevision: 0, payload: { type: 'choose', value: 3 } };
    const accepted = await game.applyAction(matchId, 'account-a', command);
    expect(accepted.you.choice).toBe(3);
    const peer = await game.viewForPlayer(matchId, 'account-b');
    expect(peer.you.choice).toBeNull(); expect(peer.history).toEqual([]);
    expect(peer.players[0]).toEqual({ participantId: 'seat-a', displayName: 'Первый', seatIndex: 0, isBot: false, submitted: true, score: 0 });
    expect(JSON.stringify(peer)).not.toMatch(/botSeed|account-a|"choices"/);
    await expect(game.viewForPlayer(matchId, 'intruder')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(game.applyAction(matchId, 'intruder', command)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await game.applyAction(matchId, 'account-a', command)).toEqual(accepted);
    await expect(game.applyAction(matchId, 'account-a', { ...command, payload: { type: 'choose', value: 2 } })).rejects.toMatchObject({ code: 'ACTION_ID_REUSED' });
    await expect(game.applyAction(matchId, 'account-b', { actionId: 'command-b', expectedRevision: 0, payload: { type: 'choose', value: 1 } })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    const resolved = await game.applyAction(matchId, 'account-b', { actionId: 'command-b', expectedRevision: peer.revision, payload: { type: 'choose', value: 1 } });
    expect(resolved.history[0]).toEqual({ round: 1, choices: { 'seat-a': 3, 'seat-b': 1 }, winnerParticipantId: 'seat-a', timedOut: [] });
    expect(resolved.round).toBe(2); expect(resolved.players[0].score).toBe(1);
  });

  it('restores private state and action receipts after closing the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'iva-session-')); directories.push(directory);
    const databasePath = join(directory, 'lab.sqlite'); const first = runtime(undefined, databasePath);
    const { matchId } = await first.createMatch(request());
    const command = { actionId: 'persisted-action', expectedRevision: 0, payload: { type: 'choose', value: 2 } };
    const accepted = await first.applyAction(matchId, 'account-a', command); first.close();
    const second = runtime(undefined, databasePath);
    expect(await second.createMatch(request())).toEqual({ matchId });
    expect(await second.applyAction(matchId, 'account-a', command)).toEqual(accepted);
    expect((await second.viewForPlayer(matchId, 'account-a')).you.choice).toBe(2);
    expect((await second.viewForPlayer(matchId, 'account-b')).you.choice).toBeNull();
  });

  it('advances all expired rounds without active clients and persists elapsed deadlines after stale commands', async () => {
    let now = 10_000; const game = runtime(() => now); const { matchId } = await game.createMatch(request());
    now += 61_000;
    await expect(game.applyAction(matchId, 'account-a', { actionId: 'late-command', expectedRevision: 0, payload: { type: 'choose', value: 3 } })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect((await game.viewForPlayer(matchId, 'account-a')).round).toBe(2);
    now += 121_000;
    const result = await game.viewForPlayer(matchId, 'account-b');
    expect(result.phase).toBe('finished'); expect(result.history).toHaveLength(3);
    expect(result.history.every(round => round.timedOut.length === 2)).toBe(true);
    expect(result.outcome?.winnerParticipantIds).toEqual(['seat-a', 'seat-b']);
    expect((await game.status(matchId)).finished).toBe(true);
  });

  it('supports one human and bots through legal selections, without exposing their account or private state', async () => {
    const game = runtime(); const { matchId } = await game.createMatch(request(true));
    for (let round = 1; round <= 3; round += 1) {
      const before = await game.viewForPlayer(matchId, 'account-a');
      expect(before.players[1].isBot).toBe(true); expect(before.players[1].submitted).toBe(true);
      expect(before.history).toHaveLength(round - 1);
      await game.applyAction(matchId, 'account-a', { actionId: `human-round-${round}`, expectedRevision: before.revision, payload: { type: 'choose', value: 3 } });
    }
    const result = await game.viewForPlayer(matchId, 'account-a'); expect(result.phase).toBe('finished');
    expect(result.history.every(round => [1, 2, 3].includes(round.choices['seat-b']))).toBe(true);
    await expect(game.applyAction(matchId, 'seat-b', { actionId: 'spoof-bot-seat', expectedRevision: result.revision, payload: { type: 'choose', value: 3 } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('finishes a six-seat room and refuses an unsupported bot policy version', async () => {
    const game = runtime();
    const input = request(true);
    const prototype = input.participants[1];
    input.participants = [input.participants[0], ...Array.from({ length: 5 }, (_, index) => ({
      ...prototype, participantId: `bot-${index + 1}`, seatIndex: index + 1, displayName: `Бот ${index + 1}`,
    }))];
    const unsupported = structuredClone(input);
    const bot = unsupported.participants[1];
    if (bot.controller.kind !== 'bot') throw new Error('The fixture must contain a bot');
    bot.controller.botVersion = 'future';
    await expect(game.createMatch(unsupported)).rejects.toMatchObject({ code: 'INCOMPATIBLE_VERSION' });
    const { matchId } = await game.createMatch(input);
    for (let round = 1; round <= 3; round += 1) {
      const view = await game.viewForPlayer(matchId, 'account-a');
      expect(view.players).toHaveLength(6);
      expect(view.players.filter(player => player.isBot && player.submitted)).toHaveLength(5);
      await game.applyAction(matchId, 'account-a', {
        actionId: `six-seat-round-${round}`, expectedRevision: view.revision, payload: { type: 'choose', value: 2 },
      });
    }
    const finished = await game.viewForPlayer(matchId, 'account-a');
    expect(finished.phase).toBe('finished');
    expect(finished.history).toHaveLength(3);
    expect(finished.history.every(round => Object.keys(round.choices).length === 6)).toBe(true);
  });

  it('gives bot policies only the permitted player view and is repeatable with the same observation and entropy', async () => {
    const game = runtime(); const { matchId } = await game.createMatch(request());
    const permitted = await game.viewForPlayer(matchId, 'account-a');
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      expect(chooseLabBotMove(permitted, difficulty, 0.45)).toBe(chooseLabBotMove(structuredClone(permitted), difficulty, 0.45));
      expect(permitted.legalChoices).toContain(chooseLabBotMove(permitted, difficulty, 0.45));
    }
  });
});
