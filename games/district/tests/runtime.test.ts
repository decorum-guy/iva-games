import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Participant, StartMatchRequest } from '@iva-games/session-kit';
import { createPlatformLabRegistration } from '@iva-games/session-kit/lab';
import { DistrictRuntime } from '../src/runtime';
import { DISTRICT_CONTENT_VERSION, DISTRICT_MAPS } from '../src/maps';
import { DISTRICT_RULES_VERSION } from '../src/types';
import type { DistrictAction, DistrictState, DistrictView } from '../src/types';

const human = (i: number): Participant => ({ participantId: `seat-${i}`, playerId: `human-${i}`, displayName: `Игрок ${i + 1}`, seatIndex: i,
  controller: { kind: 'human', playerId: `human-${i}` } });
const bot = (i: number): Participant => ({ participantId: `seat-${i}`, playerId: null, displayName: `Бот ${i + 1}`, seatIndex: i,
  controller: { kind: 'bot', botProfileId: 'district:normal', botVersion: '1', difficulty: 'normal' } });
const fixtures: Array<{ directory: string; runtime: DistrictRuntime }> = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'district-runtime-'));
  const path = join(directory, 'sessions.sqlite');
  const time = { value: 1_000_000 };
  const item = { directory, runtime: new DistrictRuntime({ databasePath: path, now: () => time.value }) };
  fixtures.push(item);
  return {
    path, time, get runtime() { return item.runtime; },
    reopen: () => { item.runtime.close(); item.runtime = new DistrictRuntime({ databasePath: path, now: () => time.value }); },
    state: (matchId: string) => {
      const db = new Database(path, { readonly: true });
      try { return JSON.parse((db.prepare('SELECT state FROM district_matches WHERE match_id=?').get(matchId) as { state: string }).state) as DistrictState; }
      finally { db.close(); }
    },
  };
}
afterEach(() => {
  for (const f of fixtures) { f.runtime.close(); rmSync(f.directory, { recursive: true, force: true }); }
  fixtures.length = 0;
});
function request(participants: Participant[] = [human(0), human(1)], settings: Record<string, unknown> = {}): StartMatchRequest {
  return { startCommandId: 'start-command-1', roomId: 'room-1', rulesVersion: DISTRICT_RULES_VERSION, contentVersion: DISTRICT_CONTENT_VERSION, participants, settings };
}
let commandSequence = 0;
function envelope(view: DistrictView, action: DistrictAction) {
  return { actionId: `action-${++commandSequence}`, expectedRevision: view.revision, payload: { phaseId: view.phaseId, ...action } };
}
async function action(runtime: DistrictRuntime, matchId: string, playerId: string, input: DistrictAction) {
  const view = await runtime.viewForPlayer(matchId, playerId);
  return runtime.applyAction(matchId, playerId, envelope(view, input));
}
async function selectGoals(runtime: DistrictRuntime, matchId: string, humans = 2) {
  for (let i = 0; i < humans; i++) {
    const view = await runtime.viewForPlayer(matchId, `human-${i}`);
    await runtime.applyAction(matchId, `human-${i}`, envelope(view, { type: 'choose-goal', goal: view.you.goalOptions[0] }));
  }
}

describe('District durable runtime', () => {
  it('pins a selectable map snapshot, accepts a repeated start, and survives a restart', async () => {
    const f = fixture();
    const selected = DISTRICT_MAPS[1];
    const input = request([human(0), human(1)], { mapId: selected.id, mapVersion: selected.version });
    const result = await f.runtime.createMatch(input);
    expect(await f.runtime.createMatch(input)).toEqual(result);
    const view = await f.runtime.viewForPlayer(result.matchId, 'human-0');
    expect(view.map).toEqual(selected);
    expect(f.state(result.matchId).map).toEqual(selected);
    f.reopen();
    expect(await f.runtime.createMatch(input)).toEqual(result);
    const restored = await f.runtime.viewForPlayer(result.matchId, 'human-0');
    expect(restored).toEqual(view);
    await expect(f.runtime.createMatch({ ...input, participants: [human(0), bot(1)] })).rejects.toMatchObject({ code: 'START_CONFLICT' });
  });

  it('rejects unavailable map versions, extra settings, unsupported bots, duplicate seats and bot-only rosters', async () => {
    const f = fixture();
    await expect(f.runtime.createMatch(request(undefined, { mapId: 'crossroads', mapVersion: '999999' }))).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
    await expect(f.runtime.createMatch(request(undefined, { timerMs: 1 }))).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
    await expect(f.runtime.createMatch(request([human(0), { ...bot(1), controller: { kind: 'bot', botProfileId: 'platform-lab:normal', botVersion: '1', difficulty: 'normal' } }]))).rejects.toMatchObject({ code: 'INCOMPATIBLE_VERSION' });
    await expect(f.runtime.createMatch(request([human(0), { ...human(1), seatIndex: 0 }]))).rejects.toMatchObject({ code: 'INVALID_ROSTER' });
    await expect(f.runtime.createMatch(request([bot(0), bot(1)]))).rejects.toMatchObject({ code: 'INVALID_ROSTER' });
    await expect(f.runtime.createMatch({ ...request(), rulesVersion: 'district@9' })).rejects.toMatchObject({ code: 'INCOMPATIBLE_VERSION' });
  });

  it('replays the exact durable receipt after lost response/restart without charging twice', async () => {
    const f = fixture(); const { matchId } = await f.runtime.createMatch(request());
    await selectGoals(f.runtime, matchId);
    const view = await f.runtime.viewForPlayer(matchId, 'human-0');
    const command = envelope(view, { type: 'bank', resource: 'materials', direction: 'buy', quantity: 1 });
    const response = await f.runtime.applyAction(matchId, 'human-0', command);
    expect(response.you.resources).toEqual({ coins: 9, materials: 3, crews: 2 });
    f.reopen();
    expect(await f.runtime.applyAction(matchId, 'human-0', command)).toEqual(response);
    expect(f.state(matchId).players.find(p => p.participant.participantId === 'seat-0')!.resources).toEqual(response.you.resources);
    await expect(f.runtime.applyAction(matchId, 'human-0', { ...command, payload: { ...command.payload, quantity: 2 } })).rejects.toMatchObject({ code: 'ACTION_ID_REUSED' });
    await expect(f.runtime.applyAction(matchId, 'human-0', { ...command, actionId: 'new-bank-action' })).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });

  it('authenticates the roster before viewing or replaying a command', async () => {
    const f = fixture(); const { matchId } = await f.runtime.createMatch(request());
    const view = await f.runtime.viewForPlayer(matchId, 'human-0');
    const command = envelope(view, { type: 'choose-goal', goal: view.you.goalOptions[0] });
    await f.runtime.applyAction(matchId, 'human-0', command);
    await expect(f.runtime.viewForPlayer(matchId, 'outsider')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.runtime.applyAction(matchId, 'outsider', command)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.runtime.applyAction(matchId, 'human-1', { ...envelope(await f.runtime.viewForPlayer(matchId, 'human-1'), { type: 'choose-goal', goal: 'variety' }), payload: { phaseId: view.phaseId, type: 'work', participantId: 'seat-0' } })).rejects.toBeDefined();
  });

  it('resolves an exact deadline before rejecting the late action, persists it, and grants the next phase its full time', async () => {
    const f = fixture(); const { matchId } = await f.runtime.createMatch(request());
    const view = await f.runtime.viewForPlayer(matchId, 'human-0');
    f.time.value = view.deadlineAt!;
    await expect(f.runtime.applyAction(matchId, 'human-0', envelope(view, { type: 'choose-goal', goal: view.you.goalOptions[1] }))).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(f.state(matchId)).toMatchObject({ phase: 'negotiation', deadlineAt: f.time.value + 120_000 });
    f.reopen();
    const restarted = await f.runtime.viewForPlayer(matchId, 'human-0');
    expect(restarted.phase).toBe('negotiation');
    expect(restarted.you.goal).toBe(view.you.goalOptions[0]);
    expect(restarted.deadlineAt).toBe(f.time.value + 120_000);
    f.time.value += 86_400_000;
    const recovered = await f.runtime.viewForPlayer(matchId, 'human-0');
    expect(recovered.phase).toBe('auction');
    expect(recovered.deadlineAt).toBe(f.time.value + 60_000);
    expect((await f.runtime.viewForPlayer(matchId, 'human-0')).revision).toBe(recovered.revision);
  });

  it('requires the phase identifier even with a current revision', async () => {
    const f = fixture(); const { matchId } = await f.runtime.createMatch(request());
    const view = await f.runtime.viewForPlayer(matchId, 'human-0');
    const command = envelope(view, { type: 'choose-goal', goal: view.you.goalOptions[0] });
    await expect(f.runtime.applyAction(matchId, 'human-0', { ...command, payload: { ...command.payload, phaseId: 'old-phase' } })).rejects.toMatchObject({ code: 'STALE_PHASE' });
    expect((await f.runtime.viewForPlayer(matchId, 'human-0')).revision).toBe(view.revision);
  });

  it('keeps other players’ unfinished proposals, bids, goals, reserves and future events out of views', async () => {
    const f = fixture(); const { matchId } = await f.runtime.createMatch(request([human(0), human(1), human(2)]));
    await selectGoals(f.runtime, matchId, 3);
    const proposal = await action(f.runtime, matchId, 'human-0', { type: 'offer-trade', targetId: 'seat-1', give: { coins: 1, materials: 0, crews: 0, lots: [] }, receive: { coins: 0, materials: 1, crews: 0, lots: [] } });
    expect(proposal.you.offers).toHaveLength(1);
    const other = await f.runtime.viewForPlayer(matchId, 'human-2');
    expect(other.you.offers).toHaveLength(0);
    expect(other.players[0]).not.toHaveProperty('goal');
    expect(other.players[0]).not.toHaveProperty('reserved');
    expect(other).not.toHaveProperty('eventDeck');
    expect(other).not.toHaveProperty('seed');
    for (let i = 0; i < 3; i++) await action(f.runtime, matchId, `human-${i}`, { type: 'ready', ready: true });
    const auction = await f.runtime.viewForPlayer(matchId, 'human-0');
    const lotId = auction.cells.find(c => c.kind === 'lot')!.id;
    await action(f.runtime, matchId, 'human-0', { type: 'bid', bid: { lotId, amount: 7 } });
    await action(f.runtime, matchId, 'human-0', { type: 'confirm-bid' });
    const bidder = await f.runtime.viewForPlayer(matchId, 'human-0');
    const observer = await f.runtime.viewForPlayer(matchId, 'human-1');
    expect(bidder.you.bid).toEqual({ lotId, amount: 7 });
    expect(observer.players[0]).toMatchObject({ resources: { coins: 12 }, submitted: true });
    expect(observer.players[0]).not.toHaveProperty('bid');
    expect(observer.you.bid).toBeNull();
    expect(observer.history.some(entry => entry.type === 'auction')).toBe(false);
  });

  it('shares the runtime database with the lab without schema or receipt collisions', async () => {
    const f = fixture();
    const lab = createPlatformLabRegistration({ databasePath: f.path, now: () => f.time.value });
    try {
      const district = await f.runtime.createMatch(request());
      const other = await lab.runtime!.createMatch({ ...request(), rulesVersion: 'lab-1', contentVersion: 'lab-1' });
      expect((await f.runtime.viewForPlayer(district.matchId, 'human-0')).gameId).toBe('district');
      expect((await lab.runtime!.viewForPlayer(other.matchId, 'human-0') as { gameId: string }).gameId).toBe('platform-lab');
    } finally { lab.close(); }
  });

  it('advances bots through reconciliation, keeps human negotiation open, and finishes after offline deadlines', async () => {
    const f = fixture(); const { matchId } = await f.runtime.createMatch(request([human(0), bot(1), bot(2), bot(3)]));
    const start = await f.runtime.viewForPlayer(matchId, 'human-0');
    await f.runtime.applyAction(matchId, 'human-0', envelope(start, { type: 'choose-goal', goal: start.you.goalOptions[0] }));
    await f.runtime.status(matchId);
    const negotiation = await f.runtime.viewForPlayer(matchId, 'human-0');
    expect(negotiation.phase).toBe('negotiation');
    expect(negotiation.players.find(p => !p.isBot)!.ready).toBe(false);
    let completed = false;
    for (let i = 0; i < 100; i++) {
      const state = f.state(matchId);
      if (state.phase === 'finished') { completed = true; break; }
      f.time.value = state.deadlineAt!;
      await f.runtime.status(matchId);
      if (i === 5) f.reopen();
    }
    expect(completed).toBe(true);
    const view = await f.runtime.viewForPlayer(matchId, 'human-0');
    expect(view.outcome?.reason).toBe('completed');
    expect(view.outcome?.results).toHaveLength(4);
    expect(view.outcome?.results.every(result => Number.isSafeInteger(result.capital) && result.capital >= 0)).toBe(true);
    const final = await f.runtime.status(matchId);
    f.reopen();
    expect(await f.runtime.status(matchId)).toEqual(final);
  });

  it('explicitly leaving as the last human abandons the game; polling or restarting cannot resume it', async () => {
    const f = fixture(); const { matchId } = await f.runtime.createMatch(request([human(0), bot(1)]));
    const outcome = await action(f.runtime, matchId, 'human-0', { type: 'leave' });
    expect(outcome.outcome).toMatchObject({ reason: 'abandoned', winnerParticipantIds: [], results: [] });
    f.time.value += 86_400_000;
    f.reopen();
    expect(await f.runtime.viewForPlayer(matchId, 'human-0')).toMatchObject({ phase: 'finished', outcome: { reason: 'abandoned' } });
    await expect(action(f.runtime, matchId, 'human-0', { type: 'return' })).rejects.toBeDefined();
  });
});
