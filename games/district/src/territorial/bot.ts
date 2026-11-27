import type { BotDifficulty } from '@iva-games/session-kit';
import { randomStream } from '../random';
import { blockAction, fallbackTerritory } from './core';
import { covers, sumStock } from './economy';
import { mapGraph } from './graph';
import type { Resource } from './maps';
import { RESOURCES, emptyStock } from './types';
import type { Stock, TerritoryAction, TerritoryOption, TerritoryView } from './types';

const dots = (number: number) => 6 - Math.abs(7 - number);
const shortage = (hand: Stock, cost: Partial<Stock>) => RESOURCES.reduce((total, key) => total + Math.max(0, (cost[key] ?? 0) - hand[key]), 0);
const optionAction = (option: TerritoryOption): TerritoryAction =>
  option.kind === 'route' ? { type: 'route', edgeId: option.id } : { type: option.kind, nodeId: option.id };

export function chooseTerritoryBot(view: TerritoryView, difficulty: BotDifficulty, seed: string): TerritoryAction | null {
  const { you, legal, map, players } = view;
  const id = you.participantId;
  const active = view.activeParticipantId === id;
  const rand = randomStream(seed, 'territory-bot');
  const { nodes, tiles, edges, adjacent } = mapGraph(map);
  const owned = Object.entries(view.buildings).filter(([, building]) => building.ownerId === id);
  const income = emptyStock();
  for (const [nodeId, building] of owned) {
    for (const tileId of nodes.get(nodeId)!.tileIds) {
      const tile = tiles.get(tileId)!;
      if (tile.resource) income[tile.resource] += dots(tile.number!) * building.level;
    }
  }
  const value = (resource: Resource) => (9 + (income[resource] < 3 ? 4 : 0)) / (1 + you.hand[resource] * 0.65);
  const handValue = (stock: Stock) => RESOURCES.reduce((p, r) => p + stock[r] * value(r), 0);
  const incoming = view.offers.find(offer => offer.targetId === id);
  if (incoming && legal.trade) {
    if (covers(you.hand, incoming.receive) && handValue(incoming.give) >= handValue(incoming.receive) * (difficulty === 'hard' ? 1.15 : 0.75))
      return { type: 'accept', offerId: incoming.id };
    return { type: 'decline', offerId: incoming.id };
  }
  if (you.discard || !active || legal.roll) return fallbackTerritory(view);
  const nodeValue = (nodeId: string) => {
    const node = nodes.get(nodeId)!;
    const around = node.tileIds.map(tileId => tiles.get(tileId)!);
    const production = around.reduce((score, tile) => score + (tile.resource ? dots(tile.number!) * (1 + (income[tile.resource] < 3 ? 0.28 : 0)) : 0), 0);
    const diversity = new Set(around.filter(tile => tile.resource).map(tile => tile.resource)).size;
    const port = map.ports.find(item => item.nodeId === nodeId);
    const outgoing = adjacent.get(nodeId)!.length;
    const concentration = owned.filter(([id]) => nodes.get(id)!.eventSectorId === node.eventSectorId).length;
    return production + 1.2 * diversity + (port ? 2.5 : 0) + outgoing * 0.3 - (difficulty === 'hard' ? concentration * 1.2 : 0);
  };
  const freeNode = (nodeId: string) => !view.buildings[nodeId] && adjacent.get(nodeId)!.every(edge =>
    edge.kind === 'sea' || !view.buildings[edge.a === nodeId ? edge.b : edge.a]);
  const routeValue = (edgeId: string) => {
    const edge = edges.get(edgeId)!;
    const targets = [edge.a, edge.b].filter(nodeId => !view.buildings[nodeId]);
    return Math.max(0, ...targets.flatMap(id => [
      freeNode(id) ? 3 + nodeValue(id) : 0,
      ...adjacent.get(id)!.filter(link => !view.routes[link.id] && link.kind === edge.kind && link.id !== edgeId)
        .map(link => link.a === id ? link.b : link.a).filter(freeNode).map(id => nodeValue(id) * 0.72),
    ]));
  };
  const ranked = <T,>(options: T[], value: (option: T) => number) => options.map(option => ({
    option, score: value(option) + rand(100) / 100 * (difficulty === 'easy' ? 6 : difficulty === 'normal' ? 2 : 0.4),
  })).sort((a, b) => b.score - a.score).map(item => item.option);
  if (view.phase === 'setup-home') {
    const best = ranked(legal.options, option => nodeValue(option.id))[0];
    return best ? optionAction(best) : null;
  }
  if (view.phase === 'setup-route') {
    const best = ranked(legal.options, option => routeValue(option.id))[0];
    return best ? optionAction(best) : null;
  }
  if (view.phase === 'block') {
    const best = ranked(legal.block, option => {
      const tile = tiles.get(option.tileId)!;
      return (option.targets.length ? 10 : 0) + tile.nodeIds.reduce((score, nodeId) => {
        const building = view.buildings[nodeId];
        return score + (building ? building.level * (building.ownerId === id ? -5 : 2) : 0);
      }, 0) * dots(tile.number!) / 4;
    })[0];
    if (!best) return null;
    const target = [...best.targets].sort((a, b) => players.find(p => p.participantId === b)!.points - players.find(p => p.participantId === a)!.points)[0];
    return blockAction(best, target);
  }
  if (!legal.end) return null;
  const tactic = you.cards.find(card => card.playable && (card.kind !== 'supply' || sumStock(view.bank) >= 2));
  if (tactic) {
    if (tactic.kind !== 'supply') return { type: 'play-card', cardId: tactic.id };
    const available = { ...view.bank };
    const resources: Resource[] = [];
    for (let i = 0; i < 2; i++) {
      const resource = [...RESOURCES].filter(r => available[r]).sort((a, b) => value(b) - value(a))[0];
      available[resource]--;
      resources.push(resource);
    }
    return { type: 'play-card', cardId: tactic.id, resources };
  }
  const candidates = ranked(legal.options, option => {
    const base = option.kind === 'route' ? 8 + routeValue(option.id) * 0.24 + (edges.get(option.id)?.kind === 'sea' && routeValue(option.id) >= 10 ? 5 : 0) : (option.kind === 'settle' ? 21 : 19) + nodeValue(option.id) * 0.3;
    return base - 5 * shortage(you.hand, option.cost);
  });
  const confirmed = view.threats.find(threat => threat.zone !== undefined && threat.templateId.startsWith('H'));
  if (legal.protect && confirmed && 'zone' in confirmed && confirmed.zone !== undefined && (difficulty === 'hard' || rand(100) < 43)) {
    const tag = ({ H01: 'woodland', H02: 'floodplain', H03: 'coastal' } as const)[confirmed.templateId as 'H01' | 'H02' | 'H03'];
    const building = owned.filter(([nodeId, b]) => {
      const node = nodes.get(nodeId)!;
      return b.level === 2 && (confirmed.zone === null || confirmed.zone === node.eventSectorId) &&
        (!tag || node.exposureTags.includes(tag)) && !you.protected.includes(nodeId);
    }).sort(([a], [b]) => nodeValue(b) - nodeValue(a))[0];
    if (building && (you.points < view.goal - 1 || !candidates.some(option => option.kind !== 'route' && covers(you.hand, option.cost))))
      return { type: 'protect', nodeId: building[0] };
  }
  const doable = candidates.find(option => covers(you.hand, option.cost) && (option.kind !== 'route' || routeValue(option.id) > 4 || you.points >= view.goal - 2));
  if (doable && doable.kind !== 'route') return optionAction(doable);
  const desired = candidates.find(option => option.kind !== 'route' && shortage(you.hand, option.cost) === 1) ?? candidates[0];
  const plans = [...(desired ? [desired.cost] : []), ...(legal.buyCard ? [legal.buyCard] : [])];
  if (desired && !you.volunteered && shortage(you.hand, desired.cost) === 1) {
    const receive = RESOURCES.find(resource => you.hand[resource] < desired.cost[resource]);
    const give = [...RESOURCES].filter(resource => you.hand[resource] > desired.cost[resource] + 1)
      .sort((a, b) => value(a) - value(b))[0];
    const partner = players.filter(p => p.participantId !== id && !p.left && p.handCount >= 2 &&
      (p.isBot || difficulty !== 'easy')).sort((a, b) => a.points - b.points || b.handCount - a.handCount)[0];
    if (receive && give && partner) return { type: 'offer', targetId: partner.participantId,
      give: { ...emptyStock(), [give]: 1 }, receive: { ...emptyStock(), [receive]: 1 } };
  }
  for (const plan of plans) {
    for (const receive of RESOURCES.filter(r => view.bank[r] && you.hand[r] < plan[r])) {
      const give = RESOURCES.filter(r => r !== receive && you.hand[r] - plan[r] >= legal.bank[r])
        .sort((a, b) => legal.bank[a] - legal.bank[b] || value(a) - value(b))[0];
      if (give) return { type: 'bank', give, receive };
    }
  }
  if (legal.buyCard && covers(you.hand, legal.buyCard) && (!doable || difficulty === 'hard' || rand(100) < 40)) return { type: 'buy-card' };
  if (doable) return optionAction(doable);
  if (sumStock(you.hand) >= 6) {
    const give = [...RESOURCES].filter(r => you.hand[r] >= legal.bank[r] && you.hand[r] >= 3).sort((a, b) => value(a) - value(b))[0];
    const receive = [...RESOURCES].filter(r => r !== give && you.hand[r] === 0 && view.bank[r]).sort((a, b) => value(b) - value(a))[0];
    if (give && receive) return { type: 'bank', give, receive };
  }
  return { type: 'end' };
}
