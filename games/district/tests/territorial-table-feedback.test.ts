import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Participant, StartMatchRequest } from '@iva-games/session-kit';
import { randomStream } from '../src/random';
import { applyTerritory, createTerritory, fallbackTerritory, viewTerritory } from '../src/territorial/core';
import { territoryMaps } from '../src/territorial/maps';
import { chooseTerritoryBot } from '../src/territorial/bot';
import { TerritoryRuntime } from '../src/territorial/runtime';
import { emptyStock, TERRITORY_BOT, TERRITORY_CONTENT, TERRITORY_RULES } from '../src/territorial/types';
import type { Stock, TerritoryAction, TerritoryState } from '../src/territorial/types';

const human = (id: string, seatIndex: number): Participant => ({
  participantId: id, playerId: id, displayName: id, seatIndex, controller: { kind: 'human', playerId: id },
});
const bot = (id: string, seatIndex: number): Participant => ({
  participantId: id, playerId: null, displayName: id, seatIndex,
  controller: { kind: 'bot', botProfileId: 'district:normal', botVersion: TERRITORY_BOT, difficulty: 'normal' },
});
const stock = (values: Partial<Stock>): Stock => ({ ...emptyStock(), ...values });
function fresh() {
  const s = createTerritory({ matchId: 'table-test', roomId: 'room-test', map: territoryMaps.find(map => map.id === 'two-shores')!,
    participants: [human('a', 0), human('b', 1), human('c', 2)], seed: 'table-test-seed', preset: 'medium', now: 1_000 });
  s.phase = 'play'; s.turn = 1; s.round = 1; s.news.processedRound = 1; s.news.nextRound = 1_000;
  return s;
}
function seedFor(s: TerritoryState, wanted: number) {
  for (let n = 0; n < 1_000; n++) {
    const seed = 'fixture-roll-' + n;
    const rand = randomStream(seed, 'roll:' + s.turn);
    if (rand(6) + rand(6) + 2 === wanted) { s.seed = seed; return; }
  }
  throw new Error('Fixture dice seed not found');
}
const act = (s: TerritoryState, id: string, action: TerritoryAction) => applyTerritory(s, id, action, 2_000 + s.revision);

describe('Persistent and private table feedback', () => {
  it('keeps the actual last roll, actor, production and blockade after turn changes and serialization', () => {
    let s = fresh(); s.phase = 'roll';
    const tile = s.map.tiles.find(tile => tile.number === 6)!;
    const second = s.map.tiles.find(candidate => candidate.number === 6 && candidate.id !== tile.id)!;
    s.buildings[tile.nodeIds[0]] = { ownerId: 'a', level: 1 };
    s.buildings[second.nodeIds[0]] = { ownerId: 'b', level: 2 };
    s.blockedTileId = second.id;
    s.blockade = { actorId: 'b', reason: 'patrol', tileId: second.id, round: 0, turn: 0, revision: 0 };
    seedFor(s, 6);
    const before = structuredClone(s.players);
    s = act(s, 'a', { type: 'roll' });
    const rolled = viewTerritory(s, 'a', 2_000);
    expect(rolled.latestRoll).toMatchObject({ actorId: 'a', sum: 6, turn: 1, round: 1, dice: s.lastRoll });
    expect(rolled.latestRoll!.blocked).toContainEqual({ tileId: second.id, nodeId: second.nodeIds[0], reason: 'blockade', blockade: s.blockade });
    for (const grant of rolled.latestRoll!.production) {
      for (const resource of Object.keys(grant.resources) as (keyof Stock)[]) expect(grant.resources[resource]).toBe(s.players[grant.ownerId].hand[resource] - before[grant.ownerId].hand[resource]);
    }
    expect(rolled.history!.find(entry => entry.id === rolled.latestRoll!.eventId)).toMatchObject({ kind: 'roll', actorId: 'a', sum: 6 });
    expect(rolled.historyComplete).toBe(true);
    expect(rolled.history!.filter(entry => entry.kind === 'distribution')).toHaveLength(1);
    s = act(s, 'a', { type: 'end' });
    const reconnected = viewTerritory(JSON.parse(JSON.stringify(s)), 'b', 3_000);
    expect(reconnected.lastRoll).toBeNull();
    expect(reconnected.latestRoll).toEqual(rolled.latestRoll);
    expect(reconnected.blockade).toEqual(rolled.blockade);
    expect(new Set(reconnected.history!.map(entry => entry.id)).size).toBe(reconnected.history!.length);
  });

  it('records news production suppression only after an actual roll, without revealing pending forecasts', () => {
    let s = fresh(); s.phase = 'roll';
    const tile = s.map.tiles.find(tile => tile.number === 8)!;
    const node = s.map.nodes.find(node => node.id === tile.nodeIds[0])!;
    s.buildings[node.id] = { ownerId: 'a', level: 2 };
    s.news.modifiers.push({ eventInstanceId: 'applied-production-stop', zone: node.eventSectorId, spent: [], startsAfterRound: 1, endsAfterRound: 2,
      effect: { op: 'production', resource: 'all', mode: 'stop', amount: 1, floor: 0, rounds: 1 } });
    s.news.chains.push({ chainId: 'unannounced-private-chain', eventInstanceId: 'hidden-event', templateId: 'H04', zone: node.eventSectorId,
      warnings: 2, started: 1, at: 5, confirmAt: 3, outcome: true, stage: 'forecast', protected: [] });
    seedFor(s, 8); s = act(s, 'a', { type: 'roll' });
    const view = viewTerritory(s, 'c', 2_000);
    expect(view.latestRoll!.blocked).toContainEqual({ tileId: tile.id, nodeId: node.id, reason: 'news', eventInstanceId: 'applied-production-stop' });
    expect(view.latestRoll!.production).toEqual([]);
    expect(view.history!.some(entry => entry.kind === 'distribution')).toBe(false);
    expect(JSON.stringify(view)).not.toContain('unannounced-private-chain');
    expect(JSON.stringify(view)).not.toContain('hidden-event');
  });

  it('distinguishes seven and patrol, and keeps stolen resources private to the two players', () => {
    let s = fresh(); s.phase = 'roll'; seedFor(s, 7);
    s = act(s, 'a', { type: 'roll' });
    expect(viewTerritory(s, 'c', 2_000).pendingBlockade).toEqual({ actorId: 'a', reason: 'seven' });
    const tile = s.map.tiles.find(tile => tile.resource)!;
    s.buildings[tile.nodeIds[0]] = { ownerId: 'b', level: 1 };
    s.players.b.hand = stock({ ore: 1 });
    s = act(s, 'a', { type: 'block', tileId: tile.id, targetId: 'b' });
    expect(s.blockade?.reason).toBe('seven');
    for (const id of ['a', 'b']) expect(viewTerritory(s, id, 2_000).history!.at(-1)).toMatchObject({ kind: 'block', resources: stock({ ore: 1 }) });
    const observer = viewTerritory(s, 'c', 2_000).history!.at(-1)!;
    expect(observer).toMatchObject({ kind: 'block', reason: 'seven', targetId: 'b', count: 1 });
    expect(observer).not.toHaveProperty('resources');
    expect(observer).not.toHaveProperty('privateByParticipantId');
    s.players.a.cards.push({ id: 'ready-patrol', kind: 'patrol', bought: 0 });
    s = act(s, 'a', { type: 'play-card', cardId: 'ready-patrol' });
    expect(s.pendingBlockade).toEqual({ actorId: 'a', reason: 'patrol' });
    const next = viewTerritory(s, 'a', 2_000).legal.block.find(option => !option.targets.length)!;
    s = act(s, 'a', { type: 'block', tileId: next.tileId });
    s = act(s, 'a', { type: 'end' });
    expect(viewTerritory(s, 'b', 2_000).blockade).toMatchObject({ reason: 'patrol', actorId: 'a', tileId: next.tileId });
  });

  it('does not disclose a bought card or discarded resource through new history', () => {
    let s = fresh(); s.players.a.hand = stock({ wool: 1, grain: 1, ore: 2 }); s.deck = ['charter'];
    s = act(s, 'a', { type: 'buy-card' });
    expect(viewTerritory(s, 'a', 2_000).history!.at(-1)).toMatchObject({ kind: 'buy-card', cardKind: 'charter', paid: stock({ wool: 1, grain: 1, ore: 1 }) });
    expect(viewTerritory(s, 'b', 2_000).history!.at(-1)).not.toHaveProperty('cardKind');
    s.phase = 'discard'; s.discard = { a: 1, b: 0, c: 0 };
    s = act(s, 'a', { type: 'discard', resources: stock({ ore: 1 }) });
    expect(viewTerritory(s, 'a', 2_000).history!.at(-1)).toMatchObject({ kind: 'discard', resources: stock({ ore: 1 }), count: 1 });
    const other = viewTerritory(s, 'b', 2_000).history!.at(-1)!;
    expect(other).not.toHaveProperty('resources'); expect(other).not.toHaveProperty('paid');
    expect(JSON.stringify(viewTerritory(s, 'b', 2_000))).not.toContain('privateByParticipantId');
  });

  it('exposes real offer lifecycles only to participants and does not cancel temporary unaffordability', () => {
    let s = fresh(); s.players.a.hand = stock({ wood: 4 }); s.players.b.hand = stock({ brick: 2 });
    const offer: TerritoryAction = { type: 'offer', targetId: 'b', give: stock({ wood: 1 }), receive: stock({ brick: 1 }) };
    s = act(s, 'a', offer);
    const first = s.offers[0].id;
    expect(viewTerritory(s, 'b', 2_000).offers[0].canAccept).toBe(true);
    expect(viewTerritory(s, 'c', 2_000).history).toEqual([]);
    s = act(s, 'a', { type: 'bank', give: 'wood', receive: 'grain' });
    expect(viewTerritory(s, 'b', 2_000).offers[0]).toMatchObject({ id: first, canAccept: false, unavailableReason: 'author-resources' });
    expect(s.offerHistory).toEqual([]);
    expect(() => act(s, 'b', { type: 'accept', offerId: first })).toThrow();
    s = act(s, 'b', { type: 'decline', offerId: first });
    expect(s.offerHistory!.at(-1)?.status).toBe('declined');
    s.players.a.hand = stock({ wood: 4 });
    s = act(s, 'a', offer);
    const second = s.offers[0].id;
    s = act(s, 'b', { type: 'offer', targetId: 'a', parentId: second, give: stock({ brick: 1 }), receive: stock({ wood: 2 }) });
    expect(s.offerHistory!.at(-1)).toMatchObject({ id: second, status: 'replaced' });
    s = act(s, 'a', { type: 'accept', offerId: s.offers[0].id });
    expect(s.offerHistory!.at(-1)?.status).toBe('accepted');
    expect(viewTerritory(s, 'a', 2_000).history!.at(-1)).toMatchObject({ kind: 'accept', paid: stock({ wood: 2 }), received: stock({ brick: 1 }) });
    s = act(s, 'a', offer); s = act(s, 'a', { type: 'cancel', offerId: s.offers[0].id });
    expect(s.offerHistory!.at(-1)?.status).toBe('withdrawn');
    s = act(s, 'a', offer); s = act(s, 'a', { type: 'end' });
    expect(s.offerHistory!.at(-1)).toMatchObject({ status: 'expired', closedTurn: 1, closedRound: 1, closedRevision: s.revision });
    const outsider = viewTerritory(s, 'c', 2_000);
    expect(outsider.offerHistory).toEqual([]);
    expect(outsider.history!.every(entry => entry.offerId === undefined)).toBe(true);
  });

  it('loads legacy schema-one history honestly, without inventing an actor or missing past events', () => {
    const s = fresh(); delete s.history; delete s.offerHistory; delete s.latestRoll; delete s.blockade;
    s.blockedTileId = s.map.tiles[0].id; s.lastRoll = [2, 5]; s.revision = 45;
    const view = viewTerritory(JSON.parse(JSON.stringify(s)), 'a', 2_000);
    expect(view.history).toEqual([]); expect(view.latestRoll).toBeNull(); expect(view.historyComplete).toBe(false);
    expect(view.blockade).toEqual({ reason: 'unknown', tileId: s.map.tiles[0].id });
    const next = act(s, 'a', { type: 'end' });
    expect(next.history).toHaveLength(1);
    expect(next.history![0]).toMatchObject({ kind: 'end', revision: 46 });
  });

  it('retains all rolls in a long table history and uses pinned rules instead of current defaults', () => {
    let s = fresh(); s.phase = 'roll';
    s.rules.limits.turnMs = 91_000; s.rules.limits.handLimit = 9; s.rules.bankRate = 5;
    for (let turn = 0; turn < 180; turn++) {
      const id = s.participants[s.activeIndex].participantId;
      s = act(s, id, { type: 'roll' });
      while (s.phase !== 'play') {
        const fallback = fallbackTerritory(viewTerritory(s, id, 2_000));
        if (!fallback) throw new Error('Fixture could not resolve required action');
        s = act(s, id, fallback);
      }
      s = act(s, id, { type: 'end' });
    }
    const restored = viewTerritory(JSON.parse(JSON.stringify(s)), 'a', 3_000);
    expect(restored.history!.filter(entry => entry.kind === 'roll')).toHaveLength(180);
    expect(restored.history![0]).toMatchObject({ kind: 'roll', revision: 1, turn: 1 });
    expect(restored.historyComplete).toBe(true);
    expect(restored.latestRoll?.turn).toBe(180);
    expect(restored.rules?.limits).toMatchObject({ turnMs: 91_000, handLimit: 9 });
    expect(restored.rules?.bankRate).toBe(5);
  });
});

describe('Authoritative coupon prices', () => {
  it('explains the right sector, adjacent sector, sea path and actual surcharge without changing the payable amount', () => {
    let s = fresh();
    const land = s.map.edges.find(edge => edge.kind === 'land')!;
    const other = s.map.edges.find(edge => edge.kind === 'land' && edge.eventSectorId !== land.eventSectorId)!;
    const sea = s.map.edges.find(edge => edge.kind === 'sea')!;
    for (const edge of [land, other, sea]) s.buildings[edge.a] = { ownerId: 'a', level: 1 };
    s.players.a.hand = stock({ wood: 3, brick: 3, wool: 3 });
    s.news.coupons.push({ id: 'road-coupon', ownerId: 'a', kind: 'free-road', eventInstanceId: 'road-news', zone: land.eventSectorId, endsAfterRound: 2 });
    s.news.modifiers.push({ eventInstanceId: 'road-surcharge', zone: land.eventSectorId, startsAfterRound: 1, endsAfterRound: 2, spent: [],
      effect: { op: 'surcharge', action: 'road', resource: 'wood', amount: 1, rounds: 1 } });
    const v = viewTerritory(s, 'a', 2_000);
    expect(v.round + 1).toBe(2); // Displayed current round; one full round has already completed.
    expect(v.you.coupons[0].endsAfterRound).toBe(2); // Valid through the end of displayed round 2, not 3.
    const priced = (id: string) => v.legal.options.find(option => option.id === id && option.kind === 'route')!;
    expect(priced(land.id).pricing).toMatchObject({ base: stock({ wood: 1, brick: 1 }), discount: stock({ wood: 1, brick: 1 }),
      surcharge: stock({ wood: 1 }), total: stock({ wood: 1 }), couponId: 'road-coupon', reason: 'coupon' });
    expect(priced(other.id).pricing!.couponDecisions).toContainEqual({ couponId: 'road-coupon', applies: false, reason: 'sector' });
    expect(priced(sea.id).pricing!.couponDecisions).toContainEqual({ couponId: 'road-coupon', applies: false, reason: 'sea' });
    expect(v.legal.couponRoutes!['road-coupon']).toContain(land.id);
    expect(v.legal.couponRoutes!['road-coupon']).not.toContain(other.id);
    expect(v.legal.couponRoutes!['road-coupon']).not.toContain(sea.id);
    s = act(s, 'a', { type: 'route', edgeId: land.id });
    expect(s.players.a.hand).toEqual(stock({ wood: 2, brick: 3, wool: 3 }));
    expect(s.news.coupons).toEqual([]);
    expect(viewTerritory(s, 'a', 2_000).history!.at(-1)).toMatchObject({ kind: 'route', edgeId: land.id, paid: stock({ wood: 1 }) });
  });

  it('keeps the coupon when a tactic takes priority and removes eligible roads once it expires at the round boundary', () => {
    let s = fresh();
    const edge = s.map.edges.find(edge => edge.kind === 'land')!;
    s.buildings[edge.a] = { ownerId: 'a', level: 1 }; s.freeRoutes = 2;
    s.news.coupons.push({ id: 'coupon', ownerId: 'a', kind: 'free-road', eventInstanceId: 'coupon-news', zone: edge.eventSectorId, endsAfterRound: 2 });
    const v = viewTerritory(s, 'a', 2_000);
    expect(v.legal.options.find(option => option.kind === 'route' && option.id === edge.id)!.pricing).toMatchObject({ reason: 'tactic', freeRoutes: true,
      couponDecisions: [{ couponId: 'coupon', applies: false, reason: 'tactic-first' }] });
    expect(v.legal.couponRoutes!['coupon']).toEqual([]);
    s = act(s, 'a', { type: 'route', edgeId: edge.id });
    expect(s.news.coupons).toHaveLength(1); expect(s.freeRoutes).toBe(1);
    s.activeIndex = 2; s.phase = 'play';
    s = act(s, 'c', { type: 'end' });
    expect(s.round).toBe(2); expect(s.news.coupons).toEqual([]);
    expect(viewTerritory(s, 'a', 2_000).round + 1).toBe(3); // Expired before displayed round 3 begins.
    seedFor(s, 4); s = act(s, 'a', { type: 'roll' });
    const after = viewTerritory(s, 'a', 2_000);
    expect(after.legal.couponRoutes).toEqual({});
    expect(after.legal.options.filter(option => option.kind === 'route').every(option => option.pricing?.couponId === undefined)).toBe(true);
    expect(after.legal.buyCardPricing?.base).toEqual(stock({ wool: 1, grain: 1, ore: 1 }));
    expect(viewTerritory(s, 'b', 2_000).legal.buyCardPricing?.total).toEqual(stock({ wool: 1, grain: 1, ore: 1 }));
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
function runtimeFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'district-table-'));
  const path = join(directory, 'matches.sqlite');
  const clock = { now: 10_000 };
  let runtime = new TerritoryRuntime(path, () => clock.now);
  const db = new Database(path);
  cleanups.push(() => { runtime.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { clock, get runtime() { return runtime; },
    seed(id: string, botSeed: string) { db.prepare('UPDATE district_territorial_matches SET bot_seed=? WHERE match_id=?').run(botSeed, id); },
    reopen() { runtime.close(); runtime = new TerritoryRuntime(path, () => clock.now); },
    read(id: string): TerritoryState { return JSON.parse(db.prepare('SELECT state_json FROM district_territorial_matches WHERE match_id=?').pluck().get(id) as string); },
    write(s: TerritoryState) { db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(JSON.stringify(s), s.matchId); },
  };
}
function start(participants: Participant[]): StartMatchRequest {
  return { roomId: 'pace-room', startCommandId: 'pace-start', participants, rulesVersion: TERRITORY_RULES,
    contentVersion: TERRITORY_CONTENT, settings: { mapId: 'two-shores', newsPreset: 'medium' } };
}

describe('SQLite replay and paced bots', () => {
  it('measures scheduled pacing through the real runtime with fixed independent bot seeds', async () => {
    const f = runtimeFixture();
    const { matchId } = await f.runtime.createMatch(start([bot('bot', 0), human('a', 1)]));
    const baseline = f.read(matchId);
    const samples: { category: string; seed: string; delayMs: number; action: string; source: string | undefined }[] = [];
    for (const category of ['setup-home', 'setup-route', 'roll', 'upgrade', 'discard', 'accept', 'end', 'human-response', 'deadline-clamp']) {
      for (let index = 0; index < 32; index++) {
        f.clock.now = 10_000;
        let s = createTerritory({ matchId, roomId: baseline.roomId, map: baseline.map, participants: baseline.participants,
          preset: 'medium', seed: 'pacing-game-fixed', now: f.clock.now });
        s.turn = 1;
        const nodeId = s.map.nodes[0].id;
        if (category === 'setup-route') { s.phase = 'setup-route'; s.setupNode = nodeId; s.buildings[nodeId] = { ownerId: 'bot', level: 1 }; }
        else if (category === 'roll') { s.phase = 'roll'; seedFor(s, 6); }
        else if (category === 'upgrade') { s.phase = 'play'; s.buildings[nodeId] = { ownerId: 'bot', level: 1 }; s.players.bot.hand = stock({ grain: 2, ore: 3 }); }
        else if (category === 'discard') { s.phase = 'discard'; s.discard = { bot: 4, a: 0 }; s.players.bot.hand = stock({ wood: 8 }); }
        else if (category === 'end') s.phase = 'play';
        else if (category === 'human-response') {
          s.phase = 'play'; s.players.bot.hand = stock({ wood: 1 }); s.players.a.hand = stock({ brick: 1 });
          s = applyTerritory(s, 'bot', { type: 'offer', targetId: 'a', give: stock({ wood: 1 }), receive: stock({ brick: 1 }) }, f.clock.now);
        } else if (category === 'accept') {
          s.phase = 'play'; s.activeIndex = 1; s.players.a.hand = stock({ wood: 1 }); s.players.bot.hand = stock({ brick: 1 });
          s = applyTerritory(s, 'a', { type: 'offer', targetId: 'bot', give: stock({ wood: 1 }), receive: stock({ brick: 1 }) }, f.clock.now);
        } else if (category === 'deadline-clamp') s.deadlineAt = f.clock.now + 400;
        const seed = 'table-pacing-fixed-' + String(index).padStart(2, '0');
        f.write(s); f.seed(matchId, seed);
        const scheduled = await f.runtime.viewForPlayer(matchId, 'a');
        const delayMs = scheduled.botActionAt! - f.clock.now;
        expect(Number.isFinite(delayMs)).toBe(true);
        const range = category.startsWith('setup-') ? [1_000, 1_600] : category === 'end' ? [2_200, 3_500] :
          category === 'human-response' ? [40_000, 40_000] : category === 'deadline-clamp' ? [400, 400] : [1_800, 5_500];
        expect(delayMs).toBeGreaterThanOrEqual(range[0]); expect(delayMs).toBeLessThanOrEqual(range[1]);
        f.clock.now = scheduled.botActionAt!;
        const performed = await f.runtime.viewForPlayer(matchId, 'a');
        const action = performed.history!.find(entry => entry.revision === s.revision + 1 && entry.kind !== 'offer-closed')!;
        expect(action).toBeDefined();
        const expectedAction = category === 'setup-home' || category === 'deadline-clamp' ? 'place' : category === 'setup-route' ? 'route' : category === 'human-response' ? 'end' : category;
        expect(action.kind).toBe(expectedAction);
        samples.push({ category, seed, delayMs, action: action.kind, source: action.source });
      }
    }
    if (process.env.DISTRICT_PACING_REPORT_PATH) {
      const summary = Object.fromEntries([...new Set(samples.map(sample => sample.category))].map(category => {
        const delays = samples.filter(sample => sample.category === category).map(sample => sample.delayMs).sort((a, b) => a - b);
        return [category, { samples: delays.length, minMs: delays[0], medianMs: (delays[15] + delays[16]) / 2,
          p95Ms: delays[Math.ceil(delays.length * 0.95) - 1], maxMs: delays.at(-1), meanMs: Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) }];
      }));
      const files = ['types.ts', 'core.ts', 'runtime.ts'].map(file => 'games/district/src/territorial/' + file);
      writeFileSync(process.env.DISTRICT_PACING_REPORT_PATH, JSON.stringify({
        schema: 'district-table-pacing-measurements@1', measuredThrough: 'TerritoryRuntime + SQLite, controlled clock, 32 fixed bot seeds per category',
        wallClockGameDurationMeasured: false, browserAccepted: false,
        command: 'DISTRICT_PACING_REPORT_PATH=.qa/district/table-feedback.json npx vitest run --project district games/district/tests/territorial-table-feedback.test.ts',
        sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])),
        previous: { actionLoopMaximum: 32, computeBudgetMs: 65, perActionDelayMs: 0, humanResponseWindowMs: 8_000 },
        current: { attemptsPerPollMaximum: 4, setupMs: [1_000, 1_600], importantMs: [1_800, 4_500], rareImportantMs: [4_800, 5_500],
          endMs: [2_200, 3_500], humanResponseWindowMs: 40_000, cappedByPhaseDeadline: true, sleepsInHttpRequest: false },
        history: { truncated: false, legacyMissingHistoryFabricated: false, completenessField: 'historyComplete', automaticSourceField: 'history.source / latestRoll.source' },
        roundBoundary: { stateRoundMeans: 'completed rounds', displayedCurrentRound: 'state.round + 1',
          couponExample: { issuedStateRound: 1, endsAfterRound: 2, validThroughDisplayedRound: 2, absentAtDisplayedRound: 3 },
          dueRoundAndEndsAfterRoundNeedDisplayOffset: false },
        summary, samples,
      }, null, 2) + '\n');
    }
  });

  it('stores actual rolls and privacy-filtered receipts atomically; retries after restart never add another event', async () => {
    const f = runtimeFixture();
    const { matchId } = await f.runtime.createMatch(start([human('a', 0), human('b', 1)]));
    const setup = f.read(matchId); setup.phase = 'roll'; setup.turn = 1; seedFor(setup, 7); f.write(setup);
    const initial = await f.runtime.viewForPlayer(matchId, 'a');
    const command = { actionId: 'roll-exactly-once', expectedRevision: initial.revision, payload: { phaseId: initial.phaseId, type: 'roll' } };
    const receipt = await f.runtime.applyAction(matchId, 'a', command);
    expect(receipt.latestRoll).toMatchObject({ actorId: 'a', sum: 7 });
    f.reopen();
    expect(await f.runtime.applyAction(matchId, 'a', command)).toEqual(receipt);
    expect((await f.runtime.viewForPlayer(matchId, 'b')).latestRoll).toEqual(receipt.latestRoll);
    expect(f.read(matchId).history!.filter(entry => entry.kind === 'roll')).toHaveLength(1);
  });

  it('persists setup pacing across repeated views and process restarts, exposing each actual placement separately', async () => {
    const f = runtimeFixture();
    const { matchId } = await f.runtime.createMatch(start([bot('bot', 0), human('a', 1)]));
    const scheduled = await f.runtime.viewForPlayer(matchId, 'a');
    expect(scheduled.revision).toBe(0);
    expect(scheduled.botActionAt! - f.clock.now).toBeGreaterThanOrEqual(1000);
    expect(scheduled.botActionAt! - f.clock.now).toBeLessThanOrEqual(1600);
    expect(f.read(matchId).history).toEqual([]);
    f.reopen();
    expect((await f.runtime.viewForPlayer(matchId, 'a')).botActionAt).toBe(scheduled.botActionAt);
    f.clock.now = scheduled.botActionAt! - 1;
    expect((await f.runtime.viewForPlayer(matchId, 'a')).revision).toBe(0);
    f.clock.now++;
    const placed = await f.runtime.viewForPlayer(matchId, 'a');
    expect(placed.revision).toBe(1); expect(placed.history!.at(-1)).toMatchObject({ actorId: 'bot', kind: 'place' });
    expect(placed.botActionAt).toBeGreaterThan(f.clock.now);
    expect((await f.runtime.viewForPlayer(matchId, 'a')).revision).toBe(1);
    f.clock.now = placed.botActionAt!;
    const routed = await f.runtime.viewForPlayer(matchId, 'a');
    expect(routed.revision).toBe(2); expect(routed.history!.at(-1)).toMatchObject({ actorId: 'bot', kind: 'route', phase: 'setup-route' });
    expect(routed.activeParticipantId).toBe('a'); expect(routed.botActionAt).toBeUndefined();
  });

  it('does not advance state for an outsider, and records a deadline roll explicitly as automatic', async () => {
    const f = runtimeFixture();
    const { matchId } = await f.runtime.createMatch(start([human('a', 0), human('b', 1)]));
    const state = f.read(matchId); state.phase = 'roll'; state.turn = 1; state.deadlineAt = f.clock.now; seedFor(state, 7); f.write(state);
    await expect(f.runtime.viewForPlayer(matchId, 'outsider')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.read(matchId)).toEqual(state);
    const moved = await f.runtime.viewForPlayer(matchId, 'a');
    expect(moved.latestRoll).toMatchObject({ actorId: 'a', source: 'timeout', sum: 7 });
    expect(moved.history!.at(-1)).toMatchObject({ actorId: 'a', source: 'timeout', kind: 'roll' });
  });

  it('cancels a scheduled bot end after a human answer and does not repeat the deal after receipt replay', async () => {
    const f = runtimeFixture();
    const { matchId } = await f.runtime.createMatch(start([bot('bot', 0), human('a', 1)]));
    let s = f.read(matchId); s.phase = 'play'; s.turn = 1; s.players.bot.hand = stock({ wood: 1 }); s.players.a.hand = stock({ brick: 1 });
    s = applyTerritory(s, 'bot', { type: 'offer', targetId: 'a', give: stock({ wood: 1 }), receive: stock({ brick: 1 }) }, f.clock.now);
    f.write(s);
    const offered = await f.runtime.viewForPlayer(matchId, 'a');
    f.clock.now = offered.botActionAt! - 1;
    const command = { actionId: 'human-before-bot-due', expectedRevision: offered.revision,
      payload: { phaseId: offered.phaseId, type: 'accept', offerId: offered.offers[0].id } };
    const receipt = await f.runtime.applyAction(matchId, 'a', command);
    expect(f.read(matchId).botSchedule).toBeUndefined();
    expect(receipt.you.hand).toEqual(stock({ wood: 1 }));
    f.reopen(); f.clock.now++;
    const after = await f.runtime.viewForPlayer(matchId, 'a');
    expect(after.revision).toBe(receipt.revision);
    expect(after.botActionAt).toBeGreaterThan(f.clock.now);
    expect(await f.runtime.applyAction(matchId, 'a', command)).toEqual(receipt);
    expect(f.read(matchId).offerHistory!.filter(offer => offer.status === 'accepted')).toHaveLength(1);
    expect(f.read(matchId).history!.filter(entry => entry.kind === 'accept')).toHaveLength(1);
  });

  it('declines an unaffordable bot offer once and preserves the next scheduled action', async () => {
    const f = runtimeFixture();
    const { matchId } = await f.runtime.createMatch(start([bot('active', 0), bot('recipient', 1), human('a', 2)]));
    let s = f.read(matchId); s.phase = 'play'; s.turn = 1;
    s.players.active.hand = stock({ wood: 4 }); s.players.recipient.hand = stock({ brick: 1 });
    s = applyTerritory(s, 'active', { type: 'offer', targetId: 'recipient', give: stock({ wood: 1 }), receive: stock({ brick: 1 }) }, f.clock.now);
    s = applyTerritory(s, 'active', { type: 'bank', give: 'wood', receive: 'grain' }, f.clock.now);
    f.write(s);
    const answer = await f.runtime.viewForPlayer(matchId, 'a');
    expect(answer.botParticipantId).toBe('recipient');
    f.clock.now = answer.botActionAt!;
    const afterUnavailableAnswer = await f.runtime.viewForPlayer(matchId, 'a');
    expect(afterUnavailableAnswer.revision).toBe(s.revision + 1);
    expect(f.read(matchId).offerHistory!.at(-1)?.status).toBe('declined');
    expect(afterUnavailableAnswer.botParticipantId).toBe('active');
    for (let poll = 0; poll < 3; poll++) {
      const unchanged = await f.runtime.viewForPlayer(matchId, 'a');
      expect(unchanged.botParticipantId).toBe('active');
      expect(unchanged.botActionAt).toBe(afterUnavailableAnswer.botActionAt);
    }
    f.clock.now = afterUnavailableAnswer.botActionAt!;
    const advanced = await f.runtime.viewForPlayer(matchId, 'a');
    expect(advanced.revision).toBeGreaterThan(s.revision);
    expect(advanced.activeParticipantId).toBe('recipient');
    expect(f.read(matchId).offerHistory!.at(-1)?.status).toBe('declined');
  });

  it('leaves forty seconds for a human counteroffer while preserving the deadline and real expiry', async () => {
    const f = runtimeFixture();
    const { matchId } = await f.runtime.createMatch(start([bot('bot', 0), human('a', 1)]));
    let s = f.read(matchId); s.phase = 'play'; s.turn = 1; s.deadlineAt = f.clock.now + 60_000;
    s.players.bot.hand = stock({ wood: 1 }); s.players.a.hand = stock({ brick: 1 });
    s = applyTerritory(s, 'bot', { type: 'offer', targetId: 'a', give: stock({ wood: 1 }), receive: stock({ brick: 1 }) }, f.clock.now);
    f.write(s);
    const offered = await f.runtime.viewForPlayer(matchId, 'a');
    expect(offered.botActionAt).toBe(f.clock.now + 40_000);
    f.clock.now += 8_001;
    f.reopen();
    expect((await f.runtime.viewForPlayer(matchId, 'a')).offers).toHaveLength(1);
    expect(f.read(matchId).revision).toBe(s.revision);
    f.clock.now = offered.botActionAt! - 1;
    expect((await f.runtime.viewForPlayer(matchId, 'a')).offers).toHaveLength(1);
    f.clock.now++;
    const expired = await f.runtime.viewForPlayer(matchId, 'a');
    expect(expired.offers).toEqual([]);
    expect(expired.offerHistory!.at(-1)).toMatchObject({ status: 'expired', authorId: 'bot' });

    const limited = f.read(matchId); limited.phase = 'play'; limited.activeIndex = 0; limited.deadlineAt = f.clock.now + 400;
    limited.offers = [{ id: 'short-window', authorId: 'bot', targetId: 'a', give: stock({ wood: 1 }), receive: stock({ brick: 1 }), offeredAt: f.clock.now }];
    delete limited.botSchedule; f.write(limited);
    const bounded = await f.runtime.viewForPlayer(matchId, 'a');
    expect(bounded.botActionAt).toBe(limited.deadlineAt);
    f.clock.now = limited.deadlineAt;
    expect((await f.runtime.viewForPlayer(matchId, 'a')).offerHistory!.at(-1)).toMatchObject({ id: 'short-window', status: 'expired' });
  });
});


describe('Grouped negotiations and visual production receipts', () => {
  it('can negotiate a bounded counteroffer and execute it once', () => {
    let s = fresh();
    s.players.a.hand = stock({ wood: 1 }); s.players.b.hand = stock({ wood: 1, brick: 2 });
    s = act(s, 'a', { type: 'offer', targetId: 'b', give: stock({ wood: 1 }), receive: stock({ brick: 2 }) });
    const parentId = s.offers[0].id;
    const answer = chooseTerritoryBot(viewTerritory(s, 'b', 2000), 'normal', 'bounded-counter');
    expect(answer).toMatchObject({ type: 'offer', targetId: 'a', parentId, give: stock({ brick: 1 }), receive: stock({ wood: 1 }) });
    s = act(s, 'b', answer!);
    expect(s.offerHistory?.find(o => o.id === parentId)?.status).toBe('replaced');
    const id = s.offers[0].id;
    s = act(s, 'a', { type: 'accept', offerId: id });
    expect(s.players.a.hand).toEqual(stock({ brick: 1 }));
    expect(s.players.b.hand).toEqual(stock({ wood: 2, brick: 1 }));
    expect(() => act(s, 'a', { type: 'accept', offerId: id })).toThrow();
  });
  it('collects separate consents without transfer, chooses exactly one, keeps third-party terms private', () => {
    let s = fresh();
    s.players.a.hand = stock({ wood: 2 }); s.players.b.hand = stock({ brick: 2 }); s.players.c.hand = stock({ brick: 2 });
    s = act(s, 'a', { type: 'offer', targetId: 'b', targetIds: ['b', 'c'], give: stock({ wood: 1 }), receive: stock({ brick: 1 }) });
    const [one, two] = s.offers;
    expect(one.groupId).toBe(two.groupId);
    expect(viewTerritory(s, 'b', 0).offers.map(o => o.id)).toEqual([one.id]);
    const before = structuredClone(s.players);
    s = act(s, 'b', { type: 'accept', offerId: one.id });
    s = act(s, 'c', { type: 'accept', offerId: two.id });
    expect(s.players).toEqual(before);
    expect(viewTerritory(s, 'a', 0).offers.every(o => o.canAccept)).toBe(true);
    s = act(s, 'a', { type: 'accept', offerId: two.id });
    expect(s.players.a.hand).toEqual(stock({ wood: 1, brick: 1 }));
    expect(s.players.b).toEqual(before.b);
    expect(s.players.c.hand).toEqual(stock({ wood: 1, brick: 1 }));
    expect(s.offers).toEqual([]);
    expect(s.offerHistory?.find(o => o.id === one.id)?.status).toBe('withdrawn');
    expect(s.offerHistory?.find(o => o.id === two.id)?.status).toBe('accepted');
    expect(() => act(s, 'a', { type: 'accept', offerId: one.id })).toThrow();
  });
  it('attributes actually granted roll resources to eligible tiles, including scarcity', () => {
    let s = fresh(); s.phase = 'roll'; seedFor(s, 6);
    const tile = s.map.tiles.find(tile => tile.number === 6 && tile.resource)!;
    s.buildings[tile.nodeIds[0]] = { ownerId: 'a', level: 2 };
    s.blockedTileId = null;
    s.bank[tile.resource!] = 1;
    s = act(s, 'a', { type: 'roll' });
    const roll = s.latestRoll!;
    expect(roll.sources?.some(source => source.tileId === tile.id && source.resource === tile.resource && source.amount === 1)).toBe(true);
    for (const grant of roll.production) for (const resource of Object.keys(grant.resources) as (keyof Stock)[]) {
      expect(roll.sources?.filter(source => source.ownerId === grant.ownerId && source.resource === resource).reduce((sum, source) => sum + source.amount, 0)).toBe(grant.resources[resource]);
    }
  });
});
