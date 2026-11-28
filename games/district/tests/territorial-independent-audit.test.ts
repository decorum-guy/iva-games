import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { ActionEnvelope, Participant } from '@iva-games/session-kit';
import { applyTerritory, createTerritory, viewTerritory } from '../src/territorial/core';
import { TerritoryRuntime } from '../src/territorial/runtime';
import { territoryMaps } from '../src/territorial/maps';
import { randomStream } from '../src/random';
import { emptyStock, RESOURCES, TERRITORY_CONTENT, TERRITORY_RULES } from '../src/territorial/types';
import type { Stock, TerritoryState, TerritoryView } from '../src/territorial/types';

const stock = (values: Partial<Stock>): Stock => ({ ...emptyStock(), ...values });
const participants: Participant[] = ['a', 'b', 'c'].map((id, seatIndex) => ({
  participantId: id, playerId: id, displayName: id, seatIndex, controller: { kind: 'human', playerId: id },
}));
const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'district-independent-'));
  const path = join(directory, 'matches.sqlite');
  const clock = { now: 10_000 };
  let runtime = new TerritoryRuntime(path, () => clock.now);
  const db = new Database(path);
  const { matchId } = await runtime.createMatch({ roomId: 'group-room', startCommandId: 'group-start', participants,
    rulesVersion: TERRITORY_RULES, contentVersion: TERRITORY_CONTENT, settings: { mapId: 'two-shores' } });
  const read = (): TerritoryState => JSON.parse(db.prepare('SELECT state_json FROM district_territorial_matches WHERE match_id=?').pluck().get(matchId) as string);
  const s = read(); s.phase = 'play'; s.turn = 1;
  s.players.a.hand = stock({ wood: 2 }); s.players.b.hand = stock({ brick: 1 }); s.players.c.hand = stock({ brick: 1 });
  db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(JSON.stringify(s), matchId);
  cleanups.push(() => { runtime.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { clock, matchId, path, read, get runtime() { return runtime; },
    reopen() { runtime.close(); runtime = new TerritoryRuntime(path, () => clock.now); },
    async view(id: string) { return runtime.viewForPlayer(matchId, id); },
    async action(id: string, actionId: string, payload: Record<string, unknown>) {
      const view = await runtime.viewForPlayer(matchId, id);
      return runtime.applyAction(matchId, id, envelope(view, actionId, payload));
    },
  };
}
function envelope(view: TerritoryView, actionId: string, action: Record<string, unknown>): ActionEnvelope {
  return { actionId, expectedRevision: view.revision, payload: { phaseId: view.phaseId, ...action } };
}
async function group(f: Awaited<ReturnType<typeof fixture>>) {
  await f.action('a', 'group-original', { type: 'offer', targetId: 'b', targetIds: ['b', 'c'], give: stock({ wood: 1 }), receive: stock({ brick: 1 }) });
  const offers = f.read().offers;
  await f.action('b', 'consent-b-first', { type: 'accept', offerId: offers[0].id });
  await f.action('c', 'consent-c-first', { type: 'accept', offerId: offers[1].id });
  return offers;
}

describe('Independent PR26 transactional and provenance audit', () => {
  it('broadcasts addressed input, keeps a sole consent pending, and cancels the whole group without transfer', async () => {
    const f = await fixture(); const before = f.read().players;
    await f.action('a', 'broadcast', { type: 'offer', targetId: 'b', give: stock({ wood: 1 }), receive: stock({ brick: 1 }) });
    const offers = f.read().offers;
    expect(offers.map(offer => offer.targetId)).toEqual(['b', 'c']);
    await f.action('c', 'decline-broadcast', { type: 'decline', offerId: offers[1].id });
    await f.action('b', 'sole-consent', { type: 'accept', offerId: offers[0].id });
    expect(f.read().players).toEqual(before);
    expect(f.read().offers[0].agreedAt).toBeDefined();
    f.reopen();
    await f.action('a', 'cancel-broadcast', { type: 'cancel', offerId: offers[0].id });
    expect(f.read().offers).toEqual([]);
    expect(f.read().players).toEqual(before);
    expect(f.read().offerHistory?.map(offer => offer.status)).toEqual(['declined', 'withdrawn']);
  });

  it('requires author choice even in a two-seat match and reads old addressed offers unchanged', () => {
    let state = createTerritory({ matchId: 'two', roomId: 'two', map: territoryMaps[0], participants: participants.slice(0, 2), preset: 'medium', seed: 'two', now: 0 });
    state.phase = 'play'; state.players.a.hand = stock({wood:1}); state.players.b.hand = stock({brick:1});
    state = applyTerritory(state, 'a', {type:'offer',targetId:'b',give:stock({wood:1}),receive:stock({brick:1})}, 1);
    const before = structuredClone(state.players), id = state.offers[0].id;
    const legacy = structuredClone(state); delete legacy.offers[0].groupId;
    expect(applyTerritory(legacy,'b',{type:'accept',offerId:id},2).players.a.hand).toEqual(stock({brick:1}));
    state = applyTerritory(state,'b',{type:'accept',offerId:id},2);
    expect(state.players).toEqual(before);
    state = applyTerritory(state,'a',{type:'accept',offerId:id},3);
    expect(state.players.a.hand).toEqual(stock({brick:1}));
    expect(() => applyTerritory(state,'a',{type:'accept',offerId:id},4)).toThrow();
  });

  it('keeps other recipients live after a counteroffer and isolates their responses and terms', async () => {
    const f=await fixture();
    await f.action('a','broadcast-counter-parent',{type:'offer',targetId:'b',give:stock({wood:1}),receive:stock({brick:1})});
    const [forB,forC]=f.read().offers;
    await f.action('b','counter-with-own-terms',{type:'offer',targetId:'a',parentId:forB.id,give:stock({brick:1}),receive:stock({wood:2})});
    expect(f.read().offers.find(offer=>offer.id===forC.id)).toMatchObject({authorId:'a',targetId:'c'});
    expect(f.read().offerHistory?.find(offer=>offer.id===forB.id)?.status).toBe('replaced');
    await f.action('c','original-consent-c',{type:'accept',offerId:forC.id});
    const bView=await f.view('b');
    expect(bView.offers.every(offer=>offer.authorId==='b'||offer.targetId==='b')).toBe(true);
    expect(JSON.stringify(bView)).not.toContain(forC.id);
    expect(bView.history?.some(entry=>entry.reason==='consent'&&entry.actorId==='c')).toBe(false);
    await f.action('a','choose-original-c',{type:'accept',offerId:forC.id});
    expect(f.read().players.a.hand).toEqual(stock({wood:1,brick:1}));
    expect(f.read().players.b.hand).toEqual(stock({brick:1}));
    expect(f.read().players.c.hand).toEqual(stock({wood:1}));
    expect(f.read().offerHistory?.filter(offer=>offer.status==='accepted')).toHaveLength(1);
    expect(f.read().offers.every(offer=>offer.authorId==='b')).toBe(true);
    expect((await f.view('b')).offerHistory?.some(offer=>offer.id===forC.id)).toBe(false);
  });

  it('records every recipient consent but forbids transfer between two inactive seats', async () => {
    const f=await fixture();
    await f.action('b','inactive-author-offer',{type:'offer',targetId:'a',give:stock({brick:1}),receive:stock({wood:1})});
    const [active,other]=f.read().offers;
    expect((await f.view('c')).offers[0].canAccept).toBe(false);
    // This recipient lacks wood; a funded inactive recipient may consent.
    const dbState=f.read(); dbState.players.c.hand=stock({wood:1});
    const db=new Database(f.path); db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(JSON.stringify(dbState),f.matchId); db.close();
    const funded=f.read().players;
    await f.action('c','inactive-seat-consent',{type:'accept',offerId:other.id});
    expect((await f.view('b')).offers.find(offer=>offer.id===other.id)).toMatchObject({canAccept:false,unavailableReason:'inactive-pair'});
    await expect(f.action('b','invalid-inactive-choice',{type:'accept',offerId:other.id})).rejects.toMatchObject({code:'INVALID_ACTION'});
    expect(f.read().players).toEqual(funded);
    await f.action('a','active-seat-consent',{type:'accept',offerId:active.id});
    expect(f.read().players).toEqual(funded);
    expect((await f.view('b')).offers.find(offer=>offer.id===active.id)?.canAccept).toBe(true);
    await f.action('b','author-choose-active',{type:'accept',offerId:active.id});
    expect(f.read().players.b.hand).toEqual(stock({wood:1}));
    expect(f.read().players.c).toEqual(funded.c);
  });

  it('collects both inactive recipients in a four-seat game without executing their pair', () => {
    const members=[...participants,{...participants[0],participantId:'d',playerId:'d',displayName:'d',seatIndex:3,controller:{kind:'human' as const,playerId:'d'}}];
    let state=createTerritory({matchId:'four-consents',roomId:'four-consents',map:territoryMaps[0],participants:members,preset:'medium',seed:'four',now:0});
    state.phase='play'; state.players.b.hand=stock({brick:1});
    for(const id of ['a','c','d']) state.players[id].hand=stock({wood:1});
    state=applyTerritory(state,'b',{type:'offer',targetId:'a',give:stock({brick:1}),receive:stock({wood:1})},1);
    const before=structuredClone(state.players);
    for(const id of ['c','d']) {
      const offer=state.offers.find(item=>item.targetId===id)!;
      expect(viewTerritory(state,id,2).offers[0].canAccept).toBe(true);
      state=applyTerritory(state,id,{type:'accept',offerId:offer.id},2);
      expect(viewTerritory(state,'b',2).offers.find(item=>item.id===offer.id)).toMatchObject({canAccept:false,unavailableReason:'inactive-pair'});
      expect(()=>applyTerritory(state,'b',{type:'accept',offerId:offer.id},3)).toThrow();
    }
    expect(state.players).toEqual(before);
    const active=state.offers.find(item=>item.targetId==='a')!;
    state=applyTerritory(state,'a',{type:'accept',offerId:active.id},4);
    state=applyTerritory(state,'b',{type:'accept',offerId:active.id},5);
    expect(state.players.c).toEqual(before.c); expect(state.players.d).toEqual(before.d);
    expect(state.players.b.hand).toEqual(stock({wood:1})); expect(state.offers).toEqual([]);
  });

  it('serializes competing author choices after restart and preserves the exact receipt without another transfer', async () => {
    const f = await fixture(); const before = f.read().players;
    const offers = await group(f);
    expect(f.read().players).toEqual(before);
    f.reopen();
    const other = new TerritoryRuntime(f.path, () => f.clock.now);
    try {
      const view = await f.view('a');
      const commands = offers.map((offer, index) => envelope(view, 'author-confirm-' + index, { type: 'accept', offerId: offer.id }));
      const writes = await Promise.allSettled([f.runtime.applyAction(f.matchId, 'a', commands[0]), other.applyAction(f.matchId, 'a', commands[1])]);
      expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(writes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'STALE_REVISION' } });
      const winner = writes.findIndex(result => result.status === 'fulfilled');
      const committed = writes[winner]; if (committed.status !== 'fulfilled') throw new Error('No winning transaction');
      const final = f.read();
      expect(final.offers).toEqual([]);
      expect(final.players.a.hand).toEqual(stock({ wood: 1, brick: 1 }));
      expect(final.players[offers[winner].targetId].hand).toEqual(stock({ wood: 1 }));
      expect(final.players[offers[1 - winner].targetId]).toEqual(before[offers[1 - winner].targetId]);
      expect(final.offerHistory?.filter(offer => offer.status === 'accepted')).toHaveLength(1);
      expect(final.offerHistory?.filter(offer => offer.status === 'withdrawn')).toHaveLength(1);
      f.reopen();
      expect(await f.runtime.applyAction(f.matchId, 'a', commands[winner])).toEqual(committed.value);
      expect(f.read()).toEqual(final);
      await expect(f.action('a', 'other-consent-retry', { type: 'accept', offerId: offers[1 - winner].id })).rejects.toMatchObject({ code: 'INVALID_ACTION' });
      expect(f.read()).toEqual(final);
    } finally { other.close(); }
  });

  it('rechecks a consent after a separate trade spent its resources and rolls back a failed author choice completely', async () => {
    const f = await fixture(); const offers = await group(f);
    await f.action('c', 'separate-offer', { type: 'offer', targetId: 'a', give: stock({ brick: 1 }), receive: stock({ wood: 1 }) });
    const separate = f.read().offers.find(offer => offer.authorId === 'c')!;
    await f.action('a', 'separate-accept', { type: 'accept', offerId: separate.id });
    await f.action('c', 'separate-confirm', { type: 'accept', offerId: separate.id });
    const before = f.read();
    expect(before.players.c.hand).toEqual(stock({ wood: 1 }));
    await expect(f.action('a', 'unfunded-selection', { type: 'accept', offerId: offers[1].id })).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    expect(f.read()).toEqual(before);
    await f.action('a', 'remaining-selection', { type: 'accept', offerId: offers[0].id });
    expect(f.read().players.a.hand).toEqual(stock({ brick: 2 }));
  });

  it('expires every consent at the deadline before accepting a stale author confirmation', async () => {
    const f = await fixture(); const offers = await group(f); const before = f.read().players;
    const command = envelope(await f.view('a'), 'late-group-selection', { type: 'accept', offerId: offers[0].id });
    f.clock.now = f.read().deadlineAt!;
    await expect(f.runtime.applyAction(f.matchId, 'a', command)).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(f.read().offers).toEqual([]);
    expect(f.read().players).toEqual(before);
    expect(f.read().offerHistory?.map(offer => offer.status)).toEqual(['expired', 'expired']);
  });

  it('attributes only actual grants across every map/dice number with blockade, scarcity, reduction and bonus overlaps', () => {
    const modes = ['normal', 'reduce', 'bonus', 'reduce-bonus', 'stop-bonus'] as const;
    for (const map of territoryMaps) for (const number of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) for (const mode of modes) {
      const s = createTerritory({ matchId: 'provenance', roomId: 'provenance', map, participants, preset: 'medium', seed: 'fixed', now: 0 });
      s.phase = 'roll'; s.turn = 1;
      for (let n = 0; ; n++) {
        const seed = 'provenance-' + n; const rand = randomStream(seed, 'roll:1');
        if (rand(6) + rand(6) + 2 === number) { s.seed = seed; break; }
      }
      const eligible = map.tiles.filter(tile => tile.resource && tile.number === number);
      if (!eligible.length) continue;
      s.blockedTileId = eligible.length > 1 ? eligible[0].id : null;
      const selected: string[] = [];
      for (const tile of eligible) for (const nodeId of tile.nodeIds) {
        if (selected.includes(nodeId) || map.edges.some(edge => edge.kind === 'land' &&
          (edge.a === nodeId && selected.includes(edge.b) || edge.b === nodeId && selected.includes(edge.a)))) continue;
        selected.push(nodeId);
      }
      for (const [index, nodeId] of selected.entries()) s.buildings[nodeId] = { ownerId: participants[index % 3].participantId, level: index % 2 ? 1 : 2 };
      for (const resource of RESOURCES) s.bank[resource] = 3;
      for (const kind of ['reduce', 'stop', 'bonus'] as const) if (mode.includes(kind)) s.news.modifiers.push({
        eventInstanceId: kind, zone: null, startsAfterRound: 0, endsAfterRound: 2, spent: [],
        effect: { op: 'production', resource: 'all', mode: kind, amount: 1, floor: 0, rounds: 2 },
      });
      const after = applyTerritory(s, 'a', { type: 'roll' }, 1);
      const roll = viewTerritory(after, 'c', 1).latestRoll!;
      const heathIds = new Set(map.tiles.filter(tile => tile.resource === null).map(tile => tile.id));
      expect(roll.triggeredTileIds!.every(id => !heathIds.has(id))).toBe(true);
      for (const source of roll.sources!) {
        expect(heathIds.has(source.tileId)).toBe(false);
        const tile = map.tiles.find(tile => tile.id === source.tileId)!;
        expect(source.amount).toBeGreaterThan(0);
        expect(tile.number).toBe(number); expect(tile.resource).toBe(source.resource);
        expect(source.tileId).not.toBe(s.blockedTileId);
        expect(tile.nodeIds.some(nodeId => s.buildings[nodeId]?.ownerId === source.ownerId)).toBe(true);
      }
      for (const participant of participants) for (const resource of RESOURCES) {
        const actual = after.players[participant.participantId].hand[resource] - s.players[participant.participantId].hand[resource];
        const reported = roll.sources!.filter(item => item.ownerId === participant.participantId && item.resource === resource).reduce((total, item) => total + item.amount, 0);
        expect(reported, [map.id, number, mode, participant.participantId, resource].join('/')).toBe(actual);
      }
      for (const resource of RESOURCES) expect(after.bank[resource] + participants.reduce((total, p) => total + after.players[p.participantId].hand[resource], 0)).toBe(3);
    }
  });
});
