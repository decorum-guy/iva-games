import { describe, expect, it } from 'vitest';
import type { Participant } from '@iva-games/session-kit';
import { createTerritory, applyTerritory, advanceTerritory, currentId, fallbackTerritory, viewTerritory } from '../src/territorial/core';
import { chooseTerritoryBot } from '../src/territorial/bot';
import { price, portRate, tradeRate } from '../src/territorial/economy';
import { territoryMaps } from '../src/territorial/maps';
import type { Resource, TerritoryNode } from '../src/territorial/maps';
import { availableZones, exposedThreat, initNews, newsBoundary, produce, tutorialNews } from '../src/territorial/news';
import { newsCatalog } from '../src/territorial/news-catalog';
import type { NewsPreset } from '../src/territorial/news-catalog';
import type { PublicNews, TerritoryState } from '../src/territorial/types';

const participants: Participant[] = ['a', 'b'].map((id, seatIndex) => ({
  participantId: id, playerId: id, displayName: id, seatIndex, controller: { kind: 'human', playerId: id },
}));

function fresh(preset: NewsPreset = 'hard') {
  const map = territoryMaps.find(item => item.id === 'two-shores')!;
  const s = createTerritory({ map, participants, preset, seed: 'news-check', matchId: 'news-match', roomId: 'room', now: 0 });
  s.round = 10;
  s.phase = 'play';
  s.news.processedRound = s.round;
  s.news.nextRound = 1000;
  return s;
}

function target(s: TerritoryState, templateId: string, level: 1 | 2) {
  const template = s.news.catalog.find(item => item.templateId === templateId)!;
  for (const node of s.map.nodes) {
    s.buildings = { [node.id]: { level, ownerId: 'a' } };
    if (templateId === 'G10') s.news.damage = { [node.id]: { round: 9, level: 2 } };
    if (availableZones(s, template).includes(node.eventSectorId)) return node;
  }
  throw new Error('No fixture target for ' + templateId);
}

function advance(s: TerritoryState, toRound = s.round + 1) {
  while (s.round < toRound) {
    s.round++;
    newsBoundary(s);
  }
}

function dice(...values: number[]) {
  return (bound: number) => {
    const value = values.shift();
    if (value === undefined || value < 0 || value >= bound) throw new Error('Unexpected fixture draw, bound ' + bound);
    return value;
  };
}

function assertForecast(m: PublicNews, stage: string, zone?: string | null) {
  expect(m.stage).toBe(stage);
  const keys = ['messageId', 'eventInstanceId', 'templateId', 'chainId', 'headline', 'round', 'stage', 'dueRound'];
  if (zone !== undefined) keys.push('zone');
  expect(Object.keys(m).sort()).toEqual(keys.sort());
  expect(m.zone).toBe(zone);
  expect(m.headline.en).not.toBe('');
  expect(m.headline.ru).not.toBe('');
}

function production(s: TerritoryState, node: TerritoryNode, resource: Resource, base: number, ownerId = 'a') {
  const before = s.players[ownerId].hand[resource];
  produce(s, [{ nodeId: node.id, ownerId, sector: node.eventSectorId, level: s.buildings[node.id].level, resource, base }]);
  return s.players[ownerId].hand[resource] - before;
}

describe('District territorial news, actual operators', () => {
  it('has the 25 distinct production families and pins independent preset, catalog and schedule copies', () => {
    const expected = ['G01','G02','G03','G04','G05','G06','G07','G08','G09','G10','B01','B02','B03','B04','B05','B06','B07','B08','H01','H02','H03','H04','P01','P02','E01'];
    expect(newsCatalog.map(template => template.templateId).sort()).toEqual(expected.sort());
    for (const preset of ['easy','medium','hard','very-hard'] as const) {
      const n = initNews('fixture', preset);
      expect(n.nextRound).toBeGreaterThanOrEqual(n.profile.firstRound[0]);
      expect(n.nextRound).toBeLessThanOrEqual(n.profile.firstRound[1]);
      n.catalog[0].headlines.applied!.ru = 'changed';
      n.profile.warningWeights[0] = 99;
      expect(initNews('fixture', preset)).not.toEqual(n);
      expect(newsCatalog[0].headlines.applied!.ru).not.toBe('changed');
    }
  });

  it.each(['G01','G02','G03','G04','G05','G06','G07','G08','G09','G10','B01','B02','B03','B04','B05','B06','B07','B08'])('%s changes the economy of a legal sector', id => {
    const s = fresh();
    const node = target(s, id, id === 'G01' || id === 'B02' ? 2 : 1);
    const sector = node.eventSectorId;
    const before = structuredClone(s.players.a.hand);
    const oldPortRate = portRate(s, 'a', 'ore');
    tutorialNews(s, id, sector, dice());
    expect(s.news.messages).toHaveLength(1);
    expect(s.news.messages[0]).toMatchObject({ templateId: id, zone: sector, stage: 'applied', changes: expect.any(Array) });
    const cost = (action: Parameters<typeof price>[2]) => price(s, 'a', action, sector, node.id).cost;
    switch (id) {
      case 'G01': expect(s.players.a.hand.ore - before.ore).toBe(2); break;
      case 'G02': expect(s.players.a.hand).toEqual({ ...before, wood: before.wood + 1, brick: before.brick + 1 }); break;
      case 'G03': expect(production(s, node, 'grain', 1)).toBe(2); break;
      case 'G04': expect(s.buildings[node.id].level).toBe(2); break;
      case 'G05': expect(portRate(s, 'a', 'ore')).toBe(oldPortRate - 1); break;
      case 'G06': expect(cost('land')).toMatchObject({ wood: 0, brick: 0 }); break;
      case 'G07': expect(cost('upgrade').ore).toBe(s.rules.costs.upgrade.ore - 1); break;
      case 'G08': expect(cost('card').ore).toBe(s.rules.costs.card.ore - 1); break;
      case 'G09': expect(tradeRate(s, 'a', 'wood')).toBe(2); break;
      case 'G10': expect(cost('upgrade')).toMatchObject({ grain: 0, ore: 0 }); break;
      case 'B01': expect(production(s, node, 'wood', 1)).toBe(0); break;
      case 'B02': expect(production(s, node, 'wood', 2)).toBe(1); break;
      case 'B03':
        expect(production(s, node, 'grain', 1)).toBe(0);
        expect(production(s, node, 'wood', 1)).toBe(1); break;
      case 'B04': expect(portRate(s, 'a', s.map.ports.find(port => port.nodeId === node.id)?.resource ?? 'wood')).toBe(s.rules.bankRate); break;
      case 'B05': expect(cost('build').brick).toBe(s.rules.costs.build.brick + 1); break;
      case 'B06': expect(cost('land').wood).toBe(s.rules.costs.land.wood + 1); break;
      case 'B07': expect(cost('upgrade').ore).toBe(s.rules.costs.upgrade.ore + 1); break;
      case 'B08': expect(cost('sea').wool).toBe(s.rules.costs.sea.wool + 1); break;
      default: throw new Error(id);
    }
    expect(s.news.coupons.every(coupon => coupon.ownerId === 'a')).toBe(true);
    advance(s);
    expect(s.news.modifiers).toHaveLength(0);
    expect(s.news.coupons).toHaveLength(0);
  });

  it.each(['H01','H02','H03','H04'])('%s has a genuine surprise branch and preserves roads and level one', id => {
    const s = fresh();
    const node = target(s, id, 2);
    const other = s.map.nodes.find(other => other.id !== node.id && other.eventSectorId === node.eventSectorId)!;
    s.buildings[other.id] = { level: 1, ownerId: 'b' };
    const way = s.map.edges[0].id;
    s.routes[way] = 'a';
    tutorialNews(s, id, node.eventSectorId, dice(0));
    expect(s.news.messages.map(m => m.stage)).toEqual(['applied']);
    expect(s.news.chains).toHaveLength(0);
    expect(s.news.damage[node.id]).toEqual({ level: 2, round: 10 });
    expect(s.buildings[node.id]).toEqual({ level: 1, ownerId: 'a' });
    expect(s.buildings[other.id]).toEqual({ level: 1, ownerId: 'b' });
    expect(s.routes[way]).toBe('a');
  });

  it.each(['P01','P02'])('%s persists each outcome and resolves its independent support windows', id => {
    for (const success of [false, true]) {
      let s = fresh();
      const node = target(s, id, 1);
      tutorialNews(s, id, node.eventSectorId, dice(0, success ? 0 : 99));
      const chain = s.news.chains[0];
      expect(chain.at).toBe(12);
      if (id === 'P01') expect(production(s, node, 'brick', 1)).toBe(2);
      else expect(s.news.coupons[0].kind).toBe('upgrade-discount');
      s = JSON.parse(JSON.stringify(s)) as TerritoryState;
      const before = structuredClone(s.players.a.hand);
      advance(s, chain.at);
      const result = s.news.messages.at(-1)!;
      expect(result).toMatchObject({ stage: success ? 'success' : 'cancelled' });
      expect(s.news.modifiers).toHaveLength(0);
      expect(s.news.chains).toHaveLength(0);
      if (success) {
        expect(result).toMatchObject({ description: s.news.catalog.find(row => row.templateId === id)!.successDescription });
        expect(s.players.a.hand.brick).toBe(before.brick + 1);
        if (id === 'P02') {
          expect(s.players.a.hand.wood).toBe(before.wood + 1);
          expect(s.news.coupons[0].kind).toBe('free-road');
        }
      } else expect(s.players.a.hand).toEqual(before);
      const json = JSON.stringify(s);
      newsBoundary(s);
      expect(JSON.stringify(s)).toBe(json);
    }
  });

  it('keeps both early meteor outcomes private, including in building protection eligibility', () => {
    for (const hit of [true, false]) {
      let s = fresh();
      const node = target(s, 'H04', 2);
      tutorialNews(s, 'H04', node.eventSectorId, dice(99, 1, hit ? 0 : 99));
      assertForecast(s.news.messages[0], 'forecast');
      expect(exposedThreat(s, node.id)).toBeUndefined();
      const { confirmAt, at } = s.news.chains[0];
      s = JSON.parse(JSON.stringify(s)) as TerritoryState;
      advance(s, confirmAt);
      if (hit) {
        assertForecast(s.news.messages[1], 'confirmed', node.eventSectorId);
        expect(exposedThreat(s, node.id)?.chainId).toBe(s.news.chains[0].chainId);
      } else expect(s.news.messages[1]).toMatchObject({ stage: 'cancelled', changes: [] });
      advance(s, at);
      expect(s.buildings[node.id].level).toBe(hit ? 1 : 2);
      expect(s.news.messages.map(m => m.stage)).toEqual(hit ? ['forecast','confirmed','applied'] : ['forecast','cancelled']);
    }
  });

  it('applies an announced city meteor to the whole board once, even with a full stock of small houses', () => {
    const s = fresh('very-hard');
    const targetNode = target(s, 'H04', 2);
    const outside = s.map.nodes.find(node => node.eventSectorId !== targetNode.eventSectorId)!;
    s.buildings[outside.id] = { level: 2, ownerId: 'b' };
    for (const node of s.map.nodes.filter(node => !s.buildings[node.id]).slice(0, s.rules.limits.level1)) {
      s.buildings[node.id] = { level: 1, ownerId: 'a' };
    }
    tutorialNews(s, 'H04', targetNode.eventSectorId, dice(40, 0));
    assertForecast(s.news.messages[0], 'confirmed', null);
    advance(s, 12);
    expect(s.buildings[targetNode.id].level).toBe(1);
    expect(s.buildings[outside.id].level).toBe(1);
    expect(s.news.cityMeteor).toBe(true);
    s.buildings[targetNode.id].level = 2;
    tutorialNews(s, 'H04', targetNode.eventSectorId, dice(0));
    expect(s.news.messages.at(-1)?.zone).toBe(targetNode.eventSectorId);
  });

  it('protects manually after a single warning and publishes zero actual damage', () => {
    let s = fresh();
    const node = target(s, 'H04', 2);
    s.players.a.hand.brick = 1;
    s.players.a.hand.ore = 1;
    tutorialNews(s, 'H04', node.eventSectorId, dice(25));
    assertForecast(s.news.messages[0], 'confirmed', node.eventSectorId);
    s = applyTerritory(s, 'a', { type: 'protect', nodeId: node.id }, 1);
    expect(s.players.a.hand).toMatchObject({ brick: 0, ore: 0 });
    expect(() => applyTerritory(s, 'a', { type: 'protect', nodeId: node.id }, 1)).toThrow();
    advance(s, 12);
    expect(s.news.messages.at(-1)).toMatchObject({ stage: 'applied', changes: [{ kind: 'protected', ownerId: 'a', nodeId: node.id }] });
    expect(s.buildings[node.id].level).toBe(2);
    expect(s.news.damage[node.id]).toBeUndefined();
  });

  it.each([0,1,2])('E01 with %i warnings keeps the city forecast and its actual effect distinct across reloads', warnings => {
    const published: PublicNews[][] = [];
    for (const spread of [true, false]) {
      let s = fresh();
      const local = target(s, 'E01', 1);
      const away = s.map.nodes.find(node => node.eventSectorId !== local.eventSectorId && node.tileIds.length)!;
      s.buildings[away.id] = { ownerId: 'b', level: 1 };
      tutorialNews(s, 'E01', local.eventSectorId, dice([0, 25, 99][warnings], 1, spread ? 0 : 99));
      expect(s.news.messages[0]).toMatchObject({ stage: 'applied', zone: local.eventSectorId, endsAfterRound: 11 });
      if (warnings === 2) assertForecast(s.news.messages[1], 'forecast', null);
      expect(production(s, local, 'wood', 1)).toBe(0);
      expect(production(s, away, 'wood', 1, 'b')).toBe(1);
      advance(s, 11);
      expect(s.news.modifiers).toHaveLength(0);
      if (warnings) assertForecast(s.news.messages.at(-1)!, warnings === 2 ? 'update' : 'forecast', null);
      expect(s.news.messages.filter(m => ['forecast','update'].includes(m.stage))).toHaveLength(warnings);
      published.push(structuredClone(s.news.messages));
      s = JSON.parse(JSON.stringify(s)) as TerritoryState;
      advance(s, 13);
      const result = s.news.messages.at(-1)!;
      expect(result.stage).toBe(spread ? 'success' : 'cancelled');
      if (spread) {
        expect(result).toMatchObject({ zone: null, endsAfterRound: 14, description: s.news.catalog.find(t => t.templateId === 'E01')!.successDescription });
        expect(s.news.modifiers).toHaveLength(1);
      } else expect(s.news.modifiers).toHaveLength(0);
      expect(production(s, away, 'wood', 1, 'b')).toBe(spread ? 0 : 1);
      const snapshot = JSON.stringify(s);
      newsBoundary(s);
      expect(JSON.stringify(s)).toBe(snapshot);
      advance(s, 17);
      expect(s.news.modifiers).toHaveLength(0);
      expect(s.news.chains).toHaveLength(0);
      expect(production(s, away, 'wood', 1, 'b')).toBe(1);
      expect(s.news.messages.filter(m => ['success','cancelled'].includes(m.stage))).toHaveLength(1);
    }
    expect(published[0]).toEqual(published[1]);
  });
});

describe('District news interactions across completed rounds', () => {
  it('pays the bank proportionally and records actual receipts even when funds run short', () => {
    const s = fresh();
    const a = target(s, 'G01', 2);
    const others = s.map.nodes.filter(node => node.id !== a.id && node.eventSectorId === a.eventSectorId);
    s.buildings[others[0].id] = { ownerId: 'a', level: 2 };
    s.buildings[others[1].id] = { ownerId: 'b', level: 1 };
    s.bank.ore = 3;
    const before = Object.fromEntries(participants.map(p => [p.participantId, s.players[p.participantId].hand.ore]));
    tutorialNews(s, 'G01', a.eventSectorId, dice());
    expect(s.bank.ore).toBe(0);
    expect(s.players.a.hand.ore - before.a).toBe(2);
    expect(s.players.b.hand.ore - before.b).toBe(1);
    const msg = s.news.messages[0];
    if (!('changes' in msg)) throw new Error('Missing applied receipts');
    expect(msg.changes).toEqual(expect.arrayContaining([
      { kind: 'resources', ownerId: 'a', resources: { ore: 2 } },
      { kind: 'resources', ownerId: 'b', resources: { ore: 1 } },
    ]));
  });

  it('caps bonuses per building and owner across events, transfers and deficits, with base production paid first', () => {
    const s = fresh();
    const first = target(s, 'G03', 1);
    const rest = s.map.nodes.filter(node => node.eventSectorId === first.eventSectorId && node.id !== first.id).slice(0, 5);
    expect(rest).toHaveLength(5);
    tutorialNews(s, 'G03', first.eventSectorId, dice());
    s.bank.grain = 1;
    expect(production(s, first, 'grain', 1)).toBe(1);
    expect(s.news.bonusNodes[first.id]).toBeUndefined();
    s.bank.grain = 19;
    expect(production(s, first, 'grain', 1)).toBe(2);
    s.buildings[first.id].ownerId = 'b';
    tutorialNews(s, 'G03', first.eventSectorId, dice());
    expect(production(s, first, 'grain', 1, 'b')).toBe(1);
    for (const node of rest) {
      s.buildings[node.id] = { ownerId: 'a', level: 1 };
      production(s, node, 'grain', 1);
    }
    expect(s.news.bonusOwners.a).toBe(4);
    expect(s.news.messages.map(m => m.eventInstanceId)).toEqual(['n1','n2']);
    expect(new Set(s.news.messages.map(m => m.messageId)).size).toBe(2);
    advance(s);
    expect(s.news.bonusNodes).toEqual({});
    expect(s.news.bonusOwners).toEqual({});
  });

  it('blocks the bonus with regular production and journals actual reductions only after a matching roll', () => {
    const s = fresh();
    const node = target(s, 'G03', 1);
    tutorialNews(s, 'G03', node.eventSectorId, dice());
    tutorialNews(s, 'B03', node.eventSectorId, dice());
    const setback = s.news.messages.at(-1)!;
    if (!('changes' in setback)) throw new Error('Missing applied status');
    expect(setback.changes.every(change => change.kind === 'modifier')).toBe(true);
    expect(production(s, node, 'grain', 1)).toBe(0);
    expect(s.news.bonusNodes[node.id]).toBeUndefined();
    expect(setback.changes).toContainEqual({ kind: 'production', ownerId: 'a', resources: { grain: -1 } });
  });

  it('limits renovation to affordable figure stock for the entire sector and restoration to outstanding damage', () => {
    const s = fresh();
    const node = target(s, 'G04', 1);
    const outside = s.map.nodes.filter(n => n.eventSectorId !== node.eventSectorId).slice(0, s.rules.limits.level2);
    for (const other of outside) s.buildings[other.id] = { ownerId: 'a', level: 2 };
    const renovation = s.news.catalog.find(t => t.templateId === 'G04')!;
    const restore = s.news.catalog.find(t => t.templateId === 'G10')!;
    expect(availableZones(s, renovation)).not.toContain(node.eventSectorId);
    expect(availableZones(s, restore)).not.toContain(node.eventSectorId);
    tutorialNews(s, 'G04', node.eventSectorId, dice());
    expect(s.buildings[node.id].level).toBe(1);
    delete s.buildings[outside[0].id];
    s.news.damage[node.id] = { round: 9, level: 2 };
    tutorialNews(s, 'G07', node.eventSectorId, dice());
    tutorialNews(s, 'G10', node.eventSectorId, dice());
    const best = price(s, 'a', 'upgrade', node.eventSectorId, node.id);
    expect(best.cost).toMatchObject({ ore: 0, grain: 0 });
    expect(best.coupon?.kind).toBe('restore');
  });

  it('keeps a road surcharge payable on a free road, consumes the voucher and surcharge once on commit', () => {
    let s = fresh();
    const node = target(s, 'G06', 1);
    const edge = s.map.edges.find(e => e.kind === 'land' && e.eventSectorId === node.eventSectorId && (e.a === node.id || e.b === node.id))!;
    tutorialNews(s, 'G06', node.eventSectorId, dice());
    tutorialNews(s, 'B06', node.eventSectorId, dice());
    expect(price(s, 'a', 'land', node.eventSectorId).cost).toMatchObject({ wood: 1, brick: 0 });
    s.players.a.hand.wood = 0;
    expect(() => applyTerritory(s, 'a', { type: 'route', edgeId: edge.id }, 1)).toThrow();
    expect(s.news.coupons).toHaveLength(1);
    expect(s.news.modifiers[0].spent).toEqual([]);
    s.players.a.hand.wood = 1;
    s = applyTerritory(s, 'a', { type: 'route', edgeId: edge.id }, 1);
    expect(s.routes[edge.id]).toBe('a');
    expect(s.players.a.hand.wood).toBe(0);
    expect(s.news.coupons).toHaveLength(0);
    expect(s.news.modifiers[0].spent).toEqual(['a']);
    expect(price(s, 'a', 'land', node.eventSectorId).cost).toMatchObject({ wood: 1, brick: 1 });
  });

  it('combines an exploration result and a simultaneous new aid grant before allocating the bank', () => {
    // Vary only the news draw to cover two distinct destination sectors.
    let covered = false;
    for (let draw = 0; draw < 32 && !covered; draw++) {
      const s = fresh();
      s.seed = 'two-source-allocation:' + draw;
      const first = target(s, 'P01', 2);
      const other = s.map.nodes.find(n => n.eventSectorId !== first.eventSectorId)!;
      s.buildings[other.id] = { ownerId: 'b', level: 1 };
      s.news.catalog = s.news.catalog.filter(t => ['P01','G02'].includes(t.templateId));
      tutorialNews(s, 'P01', first.eventSectorId, dice(0, 0));
      s.news.nextRound = 12;
      s.bank.brick = 2;
      const before = [s.players.a.hand.brick, s.players.b.hand.brick];
      advance(s, 12);
      const aid = s.news.messages.find(m => m.templateId === 'G02');
      if (aid?.zone !== other.eventSectorId) continue;
      covered = true;
      // Bank stock 2, demands 2 and 1; largest remainders allocate one unit to each.
      expect(s.players.a.hand.brick - before[0]).toBe(1);
      expect(s.players.b.hand.brick - before[1]).toBe(1);
      expect(s.bank.brick).toBe(0);
    }
    expect(covered).toBe(true);
  });

  it('selects a data-only grant via the real scheduler, using its pinned resource and text', () => {
    const s = fresh();
    const node = target(s, 'G02', 1);
    const newTemplate = structuredClone(s.news.catalog.find(t => t.templateId === 'G02')!);
    newTemplate.templateId = 'G11';
    newTemplate.headlines.applied = { ru: 'В порту открыли склад', en: 'A port warehouse reopens' };
    newTemplate.effects = [{ op: 'grant', basis: 'owner', resources: { wool: 1 }, cap: 1 }];
    s.news.catalog = [newTemplate];
    s.news.nextRound = 11;
    const before = structuredClone(s.players.a.hand);
    advance(s);
    expect(s.news.messages[0]).toMatchObject({ templateId: 'G11', zone: node.eventSectorId, headline: newTemplate.headlines.applied });
    expect(s.players.a.hand).toEqual({ ...before, wool: before.wool + 1 });
    expect(newsCatalog).toHaveLength(25);
  });
});

describe('Territory player views and turn order at news boundaries', () => {
  it('weather allows early protection once its sector is public, with no refund after cancellation', () => {
    let s = fresh();
    const node = target(s, 'H01', 2);
    s.players.a.hand.brick = 1;
    s.players.a.hand.ore = 1;
    tutorialNews(s, 'H01', node.eventSectorId, dice(99,0,99));
    assertForecast(s.news.messages[0], 'forecast', node.eventSectorId);
    expect(viewTerritory(s, 'a', 0).legal.protect).toBe(true);
    s = applyTerritory(s, 'a', { type: 'protect', nodeId: node.id }, 1);
    advance(s, 12);
    expect(s.news.messages.at(-1)).toMatchObject({ stage: 'cancelled', changes: [] });
    expect(s.news.chains).toHaveLength(0);
    expect(s.players.a.hand).toMatchObject({ brick: 0, ore: 0 });
    expect(s.buildings[node.id].level).toBe(2);
  });

  it('returns the same participant and policy input for different hidden meteor targets and outcomes', () => {
    const s = fresh();
    const first = target(s, 'H04', 2);
    const second = s.map.nodes.find(node => node.eventSectorId !== first.eventSectorId)!;
    s.buildings[second.id] = { ownerId: 'b', level: 2 };
    s.players.b.cards.push({ kind: 'patrol', id: 'private-card', bought: 0 });
    const alternate = structuredClone(s);
    tutorialNews(s, 'H04', first.eventSectorId, dice(99,0,0));
    tutorialNews(alternate, 'H04', second.eventSectorId, dice(99,0,99));
    for (const participant of participants) {
      const view = viewTerritory(s, participant.participantId, 0);
      const otherView = viewTerritory(alternate, participant.participantId, 0);
      expect(view).toEqual(otherView);
      for (const level of ['easy', 'normal', 'hard'] as const) {
        expect(chooseTerritoryBot(view, level, 'policy-stream')).toEqual(chooseTerritoryBot(otherView, level, 'policy-stream'));
      }
      expect(view.threats).toHaveLength(1);
      assertForecast(view.threats[0], 'forecast');
      expect(view.legal.protect).toBe(false);
      const wire = JSON.stringify(view);
      expect(wire.match(/"(seed|nextRound|outcomeChance|affectedIds|counterfactualDelta|recipients|confirmAt)"\s*:/g)).toBeNull();
      if (participant.participantId === 'a') expect(wire).not.toContain('private-card');
    }
    expect(viewTerritory(s,'a',0).news).toEqual(viewTerritory(s,'b',0).news);
  });

  it.each([2,3,4])('counts one boundary after all %i seats complete a turn, excluding setup and relogin', count => {
    const roster: Participant[] = Array.from({ length: count }, (_, i) => ({
      participantId: 'p' + i, displayName: 'Seat ' + i, seatIndex: i,
      playerId: 'u' + i, controller: { kind: 'human', playerId: 'u' + i },
    }));
    let s = createTerritory({ map: territoryMaps[0], participants: roster, preset: 'very-hard', seed: 'round-check', matchId: 'round', roomId: 'room', now: 0 });
    while (s.phase === 'setup-home' || s.phase === 'setup-route') {
      const id = currentId(s);
      const action = fallbackTerritory(viewTerritory(s, id, 0));
      if (!action) throw new Error('No setup fallback');
      s = applyTerritory(s, id, action, 0);
      expect(s.round).toBe(0);
      expect(s.news.processedRound).toBe(0);
    }
    // A late server wakeup supplies one lawful step per deadline, including the roll or block before end.
    const until = 3;
    let now = 0;
    for (let step = 0; step < 200 && s.round < until; step++) {
      const old = s;
      const personal = viewTerritory(old, currentId(old), now);
      expect(viewTerritory(JSON.parse(JSON.stringify(old)), currentId(old), now)).toEqual(personal);
      now = old.deadlineAt!;
      s = advanceTerritory(old, now);
      expect(s.round - old.round).toBe(Number(old.phase === 'play' && old.activeIndex === count - 1));
      expect(s.news.processedRound).toBe(s.round);
      if (s.round < 3) expect(s.news.messages).toHaveLength(0);
      expect(advanceTerritory(s, now)).toBe(s);
    }
    expect(s.round).toBe(until);
    expect(s.news.launches).toBe(1);
  });

  it('records shared victory at a simultaneous renovation boundary independently of building insertion order', () => {
    const s = fresh();
    const first = target(s, 'G04', 1);
    const second = s.map.nodes.find(other => other.id !== first.id && other.eventSectorId === first.eventSectorId)!;
    s.buildings[second.id] = { level: 1, ownerId: 'b' };
    s.rules.limits.target = 2;
    s.activeIndex = 1;
    s.news.catalog = s.news.catalog.filter(t => t.templateId === 'G04');
    s.news.nextRound = 11;
    const reversed = structuredClone(s);
    reversed.buildings = Object.fromEntries(Object.entries(s.buildings).reverse());
    for (const board of [s, reversed]) {
      const done = applyTerritory(board, 'b', { type: 'end' }, 1);
      expect(done.phase).toBe('finished');
      expect(done.outcome?.winnerParticipantIds.sort()).toEqual(['a','b']);
      expect(done.news.messages).toHaveLength(1);
      expect(done.news.messages[0]).toMatchObject({ templateId: 'G04', stage: 'applied' });
      expect(advanceTerritory(done, 1_000_000)).toBe(done);
    }
  });

  it('preserves an ordinary win at the end of the last seat before scheduled news', () => {
    const s = fresh();
    const node = target(s, 'G04', 1);
    s.buildings[node.id].ownerId = 'b';
    s.rules.limits.target = 1;
    s.activeIndex = 1;
    s.news.nextRound = 11;
    const done = applyTerritory(s, 'b', { type: 'end' }, 1);
    expect(done.outcome?.winnerParticipantIds).toEqual(['b']);
    expect(done.news.messages).toHaveLength(0);
    expect(done.round).toBe(10);
  });
});

describe('Territorial news geography and eligibility', () => {
  it.each(['azure-bay','two-shores','four-islands'])('%s supplies eligible sector targets for a full news catalog', mapId => {
    const s = fresh();
    s.map = territoryMaps.find(map => map.id === mapId)!;
    for (const template of s.news.catalog) {
      s.buildings = {};
      s.news.damage = {};
      const needsUpgraded = template.chain === 'hazard' || template.templateId === 'B02';
      // An ordinary road-only island can legitimately have no sea routes or related weather surcharge.
      if (template.templateId === 'B08' && s.map.edges.every(edge => edge.kind === 'land')) continue;
      const node = target(s, template.templateId, needsUpgraded ? 2 : 1);
      expect(availableZones(s, template)).toContain(node.eventSectorId);
      if (template.exposure) expect(node.exposureTags).toContain(template.exposure);
    }
  });

  it('keeps a fully occupied network out of road and sea construction news', () => {
    const s = fresh();
    const node = target(s, 'B08', 1);
    for (const edge of s.map.edges) s.routes[edge.id] = 'a';
    for (const id of ['G06','B06','B08']) {
      const template = s.news.catalog.find(t => t.templateId === id)!;
      expect(availableZones(s, template), id).not.toContain(node.eventSectorId);
    }
  });

  it('applies damage only where an exposure actually matches and leaves the preannounced zone unchanged', () => {
    const s = fresh();
    const node = target(s, 'H01', 2);
    const safe = s.map.nodes.find(n => n.eventSectorId === node.eventSectorId && !n.exposureTags.includes('woodland'));
    if (!safe) throw new Error('Expected a safe site in the same sector');
    s.buildings[safe.id] = { ownerId: 'b', level: 2 };
    tutorialNews(s, 'H01', node.eventSectorId, dice(25));
    const during = s.map.nodes.find(n => n.eventSectorId === node.eventSectorId && n.id !== node.id && n.exposureTags.includes('woodland'))!;
    s.buildings[during.id] = { ownerId: 'b', level: 2 };
    const resultRound = s.news.chains[0].at;
    advance(s, resultRound);
    expect(s.buildings[safe.id].level).toBe(2);
    expect(s.buildings[during.id].level).toBe(1);
    expect(s.news.messages.at(-1)?.zone).toBe(node.eventSectorId);
  });
});
