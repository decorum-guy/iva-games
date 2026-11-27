import type { Participant } from '@iva-games/session-kit';
import { randomStream, shuffled } from '../random';
import { DistrictError } from '../types';
import { canAddRoute, canSettle, countLevel, covers, grant, inZone, pay, portRate, price, sumStock, tradeRate } from './economy';
import { hasRoom, longestRoute, mapGraph } from './graph';
import { exposedThreat, initNews, newsBoundary, produce } from './news';
import type { TerritoryMap, Resource } from './maps';
import type { NewsPreset } from './news-catalog';
import { CARD_KINDS, COSTS, LIMITS, RESOURCES, TERRITORY_BOT, TERRITORY_CONTENT, TERRITORY_RULES, TERRITORY_SAVE, emptyStock } from './types';
import type { Stock, StoredTerritoryHistoryEntry, TerritoryAction, TerritoryHistoryEntry, TerritoryOfferStatus, TerritoryOption, TerritoryPricing, TerritoryState, TerritoryView } from './types';

const DEFAULT_RULES = {
  costs: COSTS, limits: LIMITS, stockPerResource: 24,
  deck: { patrol: 12, survey: 4, supply: 5, charter: 5 },
  bankRate: 4, portRate: 3, specialisedPortRate: 2, routeAward: 5, patrolAward: 3,
};

function requireAction(ok: unknown): asserts ok {
  if (!ok) throw new DistrictError('INVALID_ACTION', 'Это действие сейчас недоступно.');
}
export function createTerritory(input: {
  matchId: string; roomId: string; map: TerritoryMap; participants: Participant[]; preset: NewsPreset; seed: string; now: number;
}): TerritoryState {
  const { matchId, roomId, map, participants, preset, now, seed } = input;
  requireAction(map.supportedPlayers.includes(participants.length));
  const rules = structuredClone(DEFAULT_RULES);
  return {
    schemaVersion: TERRITORY_SAVE, rulesVersion: TERRITORY_RULES, contentVersion: TERRITORY_CONTENT, botVersion: TERRITORY_BOT,
    matchId, roomId, map, participants: [...participants].sort((a, b) => a.seatIndex - b.seatIndex),
    rules, revision: 0, deadlineAt: now + rules.limits.turnMs, round: 0, turn: 0, activeIndex: 0,
    phase: 'setup-home', setupIndex: 0, setupNode: null,
    players: Object.fromEntries(participants.map(player => [player.participantId, { hand: emptyStock(), cards: [], patrols: 0 }])),
    buildings: {}, routes: {}, bank: Object.fromEntries(RESOURCES.map(resource => [resource, rules.stockPerResource])) as Stock,
    deck: shuffled(CARD_KINDS.flatMap(kind => Array<typeof kind>(rules.deck[kind]).fill(kind)), randomStream(seed, 'deck')),
    seed, blockedTileId: null, discard: {}, lastRoll: null, playedCard: false, protectedThisTurn: false,
    freeRoutes: 0, routeHolder: null, patrolHolder: null, offerNumber: 0, offers: [], left: [], outcome: null,
    history: [], latestRoll: null, blockade: null, pendingBlockade: null, offerHistory: [], news: initNews(seed, preset),
  };
}

export const phaseIdOf = (s: TerritoryState) => `${s.turn}:${s.setupIndex}:${s.phase}`;
export const currentId = (s: TerritoryState) => s.participants[s.activeIndex].participantId;
export const inTurn = (s: TerritoryState, id: string) => currentId(s) === id && s.phase === 'play';

function remember(s: TerritoryState, entry: Omit<StoredTerritoryHistoryEntry, 'id' | 'revision' | 'round' | 'turn'>,
  context: Pick<TerritoryState, 'round' | 'turn'> = s) {
  const history = s.history ??= [];
  const item: StoredTerritoryHistoryEntry = { ...entry, id: `${s.matchId}:table:${s.revision + 1}:${history.length}`,
    revision: s.revision + 1, round: context.round, turn: context.turn };
  history.push(item);
  return item;
}

function closeOffers(s: TerritoryState, predicate: (offer: TerritoryState['offers'][number]) => boolean,
  status: TerritoryOfferStatus, actorId: string) {
  const closing = s.offers.filter(predicate);
  for (const offer of closing) {
    (s.offerHistory ??= []).push({ ...offer, status, closedRevision: s.revision + 1, closedTurn: s.turn, closedRound: s.round });
    // Manual answers already have an action entry; automatic closure needs its own explanation.
    if (status !== 'accepted' && status !== 'declined' && status !== 'withdrawn') remember(s, {
      kind: 'offer-closed', actorId, offerId: offer.id, targetId: offer.targetId, offerStatus: status,
      reason: status, audienceIds: [offer.authorId, offer.targetId],
    });
  }
  s.offers = s.offers.filter(offer => !predicate(offer));
}

/** Break down the same authoritative price used by buy(); never infer a price in the client. */
function purchasePricing(s: TerritoryState, id: string, purchase: Parameters<typeof price>[2], sector?: string, nodeId?: string): TerritoryPricing {
  const actual = price(s, id, purchase, sector, nodeId);
  const base = { ...emptyStock(), ...s.rules.costs[purchase] };
  const surcharge = Object.fromEntries(RESOURCES.map(resource => [resource,
    Math.max(0, ...actual.penalties.map(item => item.effect.op === 'surcharge' && item.effect.resource === resource ? item.effect.amount : 0)),
  ])) as Stock;
  const discount = Object.fromEntries(RESOURCES.map(resource => [resource, base[resource] + surcharge[resource] - actual.cost[resource]])) as Stock;
  const couponDecisions: TerritoryPricing['couponDecisions'] = s.news.coupons.filter(coupon => coupon.ownerId === id).map(coupon => {
    let reason: TerritoryPricing['couponDecisions'][number]['reason'];
    if (actual.coupon?.id === coupon.id) reason = 'eligible';
    else if (coupon.endsAfterRound <= s.round) reason = 'expired';
    else if (coupon.kind === 'free-road' && purchase === 'sea') reason = 'sea';
    else if (purchase !== 'card' && (!sector || !inZone(sector, coupon.zone))) reason = 'sector';
    else if (!(purchase === 'land' && coupon.kind === 'free-road' || purchase === 'upgrade' &&
      (coupon.kind === 'upgrade-discount' || coupon.kind === 'restore' && nodeId && s.news.damage[nodeId]) || purchase === 'card' && coupon.kind === 'card-discount')) reason = 'purchase';
    else reason = actual.freePermission ? 'tactic-first' : 'other-coupon';
    return { couponId: coupon.id, applies: actual.coupon?.id === coupon.id, reason };
  });
  return { base, discount, surcharge, total: actual.cost, freeRoutes: actual.freePermission,
    reason: actual.freePermission ? 'tactic' : actual.coupon ? 'coupon' : 'normal',
    ...(actual.coupon ? { couponId: actual.coupon.id } : {}), couponDecisions };
}

function setupPricing(): TerritoryPricing {
  return { base: emptyStock(), discount: emptyStock(), surcharge: emptyStock(), total: emptyStock(),
    freeRoutes: false, reason: 'setup', couponDecisions: [] };
}

function positiveDifference(after: Stock, before: Stock): Stock {
  return Object.fromEntries(RESOURCES.map(resource => [resource, Math.max(0, after[resource] - before[resource])])) as Stock;
}

function award(values: Record<string, number>, threshold: number, current: string | null): string | null {
  const max = Math.max(...Object.values(values));
  if (max < threshold) return null;
  const candidates = Object.keys(values).filter(id => values[id] === max);
  return candidates.length === 1 ? candidates[0] : current && candidates.includes(current) ? current : null;
}
const routesByPlayer = (s: TerritoryState) => Object.fromEntries(s.participants.map(p => [p.participantId, longestRoute(s, p.participantId)]));
function updateAwards(s: TerritoryState) {
  s.routeHolder = award(routesByPlayer(s), s.rules.routeAward, s.routeHolder);
  s.patrolHolder = award(Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, p.patrols])), s.rules.patrolAward, s.patrolHolder);
}

export function points(s: TerritoryState, id: string, reveal: boolean) {
  const houses = Object.values(s.buildings).reduce((score, item) => score + (item.ownerId === id ? item.level : 0), 0);
  return houses + (s.routeHolder === id ? 2 : 0) + (s.patrolHolder === id ? 2 : 0) +
    (reveal ? s.players[id].cards.filter(card => card.kind === 'charter').length : 0);
}
function scoreWinners(s: TerritoryState, ids: string[]): boolean {
  const max = Math.max(...ids.map(id => points(s, id, true)));
  if (max < s.rules.limits.target) return false;
  finish(s, ids.filter(id => points(s, id, true) === max), 'points');
  return true;
}
function finish(s: TerritoryState, winnerParticipantIds: string[], reason: 'points' | 'abandoned') {
  s.outcome = { winnerParticipantIds, reason };
  s.phase = 'finished';
  closeOffers(s, () => true, 'match-finished', currentId(s));
  s.deadlineAt = null;
}
function roll(s: TerritoryState) {
  const rand = randomStream(s.seed, `roll:${s.turn}`);
  s.lastRoll = [rand(6) + 1, rand(6) + 1];
  const number = s.lastRoll[0] + s.lastRoll[1];
  const latest = s.latestRoll = { eventId: '', revision: s.revision + 1, actorId: currentId(s), round: s.round,
    turn: s.turn, dice: s.lastRoll, sum: number,
    triggeredTileIds: s.map.tiles.filter(tile => tile.resource && tile.number === number).map(tile => tile.id),
    production: [] as NonNullable<TerritoryState['latestRoll']>['production'], blocked: [] as NonNullable<TerritoryState['latestRoll']>['blocked'] };
  if (number === 7) {
    s.pendingBlockade = { actorId: currentId(s), reason: 'seven' };
    s.discard = Object.fromEntries(s.participants.map(({ participantId }) => {
      const size = sumStock(s.players[participantId].hand);
      return [participantId, size > s.rules.limits.handLimit ? Math.floor(size / 2) : 0];
    }));
    s.phase = Object.values(s.discard).some(Boolean) ? 'discard' : 'block';
    return;
  }
  const before = Object.fromEntries(Object.entries(s.players).map(([id, player]) => [id, { ...player.hand }]));
  const operations = Object.entries(s.buildings).flatMap(([nodeId, building]) => {
    const { nodes, tiles } = mapGraph(s.map);
    const { eventSectorId, tileIds } = nodes.get(nodeId)!;
    for (const tileId of tileIds) if (tileId === s.blockedTileId && tiles.get(tileId)?.number === number) {
      latest.blocked.push({ tileId, nodeId, reason: 'blockade',
        blockade: s.blockade ? { ...s.blockade } : { tileId, reason: 'unknown' } });
    }
    const sources = tileIds.map(id => tiles.get(id)!).filter(tile => tile.id !== s.blockedTileId && tile.number === number);
    return RESOURCES.flatMap(resource => {
      const count = sources.filter(tile => tile.resource === resource).length;
      return count ? [{ nodeId, ownerId: building.ownerId, sector: eventSectorId, level: building.level, resource, base: building.level * count }] : [];
    });
  });
  for (const op of operations) {
    const effects = s.news.modifiers.filter(item => item.effect.op === 'production' && inZone(op.sector, item.zone) &&
      (item.effect.resource === 'all' || item.effect.resource === op.resource));
    const stopped = effects.find(item => item.effect.op === 'production' && item.effect.mode === 'stop');
    const reduction = effects.flatMap(item => item.effect.op === 'production' && item.effect.mode === 'reduce'
      ? [{ item, units: Math.min(item.effect.amount, Math.max(0, op.base - item.effect.floor)) }] : []).sort((a, b) => b.units - a.units)[0];
    const suppression = stopped ?? (reduction?.units ? reduction.item : undefined);
    if (suppression) for (const tileId of mapGraph(s.map).nodes.get(op.nodeId)!.tileIds) {
      const tile = mapGraph(s.map).tiles.get(tileId)!;
      if (tile.id !== s.blockedTileId && tile.number === number && tile.resource === op.resource) latest.blocked.push({
        tileId, nodeId: op.nodeId, reason: 'news', eventInstanceId: suppression.eventInstanceId,
      });
    }
  }
  produce(s, operations);
  latest.production = Object.entries(s.players).map(([ownerId, player]) => ({ ownerId, resources: positiveDifference(player.hand, before[ownerId]) }))
    .filter(item => sumStock(item.resources) > 0);
  s.phase = 'play';
}

function blockOptions(s: TerritoryState) {
  return s.map.tiles.filter(tile => tile.resource && tile.id !== s.blockedTileId).map(tile => ({
    tileId: tile.id, targets: [...new Set(tile.nodeIds.map(id => s.buildings[id]?.ownerId)
      .filter(id => id && id !== currentId(s) && sumStock(s.players[id].hand) > 0))],
  }));
}

function placeOptions(s: TerritoryState, id: string): TerritoryOption[] {
  const { adjacent } = mapGraph(s.map);
  if (id !== currentId(s)) return [];
  if (s.phase === 'setup-home') return s.map.nodes
    .filter(node => hasRoom(s, node.id) && adjacent.get(node.id)!.some(edge => edge.kind === 'land' && !s.routes[edge.id]))
    .map(node => ({ kind: 'place', id: node.id, cost: emptyStock(), pricing: setupPricing() }));
  if (s.phase === 'setup-route') return adjacent.get(s.setupNode!)!.filter(edge => edge.kind === 'land' && !s.routes[edge.id])
    .map(edge => ({ kind: 'route', id: edge.id, cost: emptyStock(), pricing: setupPricing() }));
  if (s.phase !== 'play') return [];
  const upgrades = countLevel(s, id, 2) < s.rules.limits.level2;
  const homes = countLevel(s, id, 1) < s.rules.limits.level1;
  const options: TerritoryOption[] = [];
  const ownedCounts = { land: 0, sea: 0 };
  for (const edge of s.map.edges) if (s.routes[edge.id] === id) ownedCounts[edge.kind]++;
  for (const node of s.map.nodes) {
    if (upgrades && s.buildings[node.id]?.ownerId === id && s.buildings[node.id].level === 1) {
      const pricing = purchasePricing(s, id, 'upgrade', node.eventSectorId, node.id);
      options.push({ kind: 'upgrade', id: node.id, cost: pricing.total, pricing });
    }
    if (homes && canSettle(s, id, node.id)) {
      const pricing = purchasePricing(s, id, 'build', node.eventSectorId);
      options.push({ kind: 'settle', id: node.id, cost: pricing.total, pricing });
    }
  }
  for (const edge of s.map.edges) {
    if (ownedCounts[edge.kind] < s.rules.limits[edge.kind] && canAddRoute(s, id, edge)) {
      const pricing = purchasePricing(s, id, edge.kind, edge.eventSectorId);
      options.push({ kind: 'route', id: edge.id, cost: pricing.total, pricing });
    }
  }
  return options;
}

function buy(s: TerritoryState, id: string, purchase: Parameters<typeof price>[2], sector?: string, node?: string) {
  const { cost, coupon, freePermission, penalties } = price(s, id, purchase, sector, node);
  requireAction(covers(s.players[id].hand, cost));
  pay(s, id, cost);
  if (freePermission) s.freeRoutes--;
  if (coupon) s.news.coupons = s.news.coupons.filter(item => item.id !== coupon.id);
  for (const penalty of penalties) penalty.spent.push(id);
}

const canPlay = (s: TerritoryState, id: string, card: TerritoryState['players'][string]['cards'][number]) =>
  inTurn(s, id) && !s.playedCard && card.bought < s.turn && card.kind !== 'charter';

function end(s: TerritoryState) {
  if (scoreWinners(s, [currentId(s)])) return;
  closeOffers(s, () => true, 'expired', currentId(s));
  s.activeIndex = (s.activeIndex + 1) % s.participants.length;
  s.turn++;
  s.phase = 'roll';
  s.volunteered = [];
  s.lastRoll = null;
  s.pendingBlockade = null;
  s.playedCard = false;
  s.protectedThisTurn = false;
  s.freeRoutes = 0;
  if (!s.activeIndex) {
    s.round++;
    newsBoundary(s);
    updateAwards(s);
    scoreWinners(s, s.participants.map(p => p.participantId));
  }
}

function nextSetup(s: TerritoryState) {
  s.setupIndex++;
  s.setupNode = null;
  const count = s.participants.length;
  if (s.setupIndex === count * 2) {
    s.activeIndex = 0;
    s.turn = 1;
    s.phase = 'roll';
    return;
  }
  s.activeIndex = s.setupIndex < count ? s.setupIndex : count * 2 - 1 - s.setupIndex;
  s.phase = 'setup-home';
}

function deal(s: TerritoryState, id: string, action: Extract<TerritoryAction, { type: 'offer' }> | { type: 'accept' | 'decline' | 'cancel'; offerId: string }, now: number) {
  requireAction(s.phase === 'play' && !s.left.includes(id));
  const player = s.players[id];
  if (action.type === 'offer') {
    const { targetId, give, receive, parentId } = action;
    requireAction(s.players[targetId] && !s.left.includes(targetId) && targetId !== id && (id === currentId(s) || targetId === currentId(s)));
    requireAction(sumStock(give) && sumStock(receive) && covers(player.hand, give) && RESOURCES.every(resource => !(give[resource] && receive[resource])));
    if (parentId) {
      const parent = s.offers.find(offer => offer.id === parentId);
      requireAction(parent?.targetId === id && parent.authorId === targetId);
    }
    closeOffers(s, offer => offer.id === parentId || offer.authorId === id && offer.targetId === targetId, 'replaced', id);
    if (!parentId) (s.volunteered ??= []).push(id);
    s.offers.push({ id: 'offer-' + ++s.offerNumber, authorId: id, targetId, offeredAt: now, give: { ...give }, receive: { ...receive }, ...(parentId ? { parentId } : {}) });
    return;
  }
  const offer = s.offers.find(item => item.id === action.offerId);
  requireAction(offer && (action.type === 'cancel' ? offer.authorId === id : offer.targetId === id));
  if (action.type === 'accept') {
    const author = s.players[offer.authorId];
    requireAction(covers(author.hand, offer.give) && covers(player.hand, offer.receive));
    for (const resource of RESOURCES) {
      const amount = offer.give[resource] - offer.receive[resource];
      author.hand[resource] -= amount;
      player.hand[resource] += amount;
    }
  }
  closeOffers(s, item => item.id === offer.id, action.type === 'accept' ? 'accepted' : action.type === 'decline' ? 'declined' : 'withdrawn', id);
}

function rememberAction(s: TerritoryState, before: TerritoryState, actorId: string, action: TerritoryAction) {
  const entry: Omit<StoredTerritoryHistoryEntry, 'id' | 'revision' | 'round' | 'turn'> = {
    actorId, kind: action.type, phase: before.phase,
  };
  const paid = positiveDifference(before.players[actorId].hand, s.players[actorId].hand);
  const received = positiveDifference(s.players[actorId].hand, before.players[actorId].hand);
  switch (action.type) {
    case 'place': case 'settle': case 'upgrade': case 'protect':
      Object.assign(entry, { nodeId: action.nodeId, paid,
        beforeLevel: before.buildings[action.nodeId]?.level ?? 0, afterLevel: s.buildings[action.nodeId]?.level ?? 0 });
      if (sumStock(received)) entry.received = received;
      break;
    case 'route': Object.assign(entry, { edgeId: action.edgeId, paid }); break;
    case 'roll': {
      const roll = s.latestRoll!;
      Object.assign(entry, { dice: roll.dice, sum: roll.sum, triggeredTileIds: roll.triggeredTileIds,
        production: roll.production, blocked: roll.blocked });
      break;
    }
    case 'discard':
      entry.count = sumStock(action.resources);
      entry.privateByParticipantId = { [actorId]: { resources: paid } };
      break;
    case 'block': {
      Object.assign(entry, { tileId: action.tileId, reason: s.blockade?.reason ?? 'unknown',
        ...(action.targetId ? { targetId: action.targetId, count: 1 } : { count: 0 }) });
      if (action.targetId) entry.privateByParticipantId = {
        [actorId]: { resources: received }, [action.targetId]: { resources: received },
      };
      break;
    }
    case 'bank': Object.assign(entry, { paid, received }); break;
    case 'buy-card':
      entry.paid = paid;
      entry.privateByParticipantId = { [actorId]: { cardKind: s.players[actorId].cards.at(-1)!.kind } };
      break;
    case 'play-card':
      entry.cardKind = before.players[actorId].cards.find(card => card.id === action.cardId)!.kind;
      if (sumStock(received)) entry.received = received;
      break;
    case 'offer': {
      Object.assign(entry, { offerId: 'offer-' + s.offerNumber, targetId: action.targetId, audienceIds: [actorId, action.targetId] });
      break;
    }
    case 'accept': case 'decline': case 'cancel': {
      const offer = before.offers.find(item => item.id === action.offerId)!;
      Object.assign(entry, { offerId: offer.id, targetId: actorId === offer.authorId ? offer.targetId : offer.authorId,
        offerStatus: action.type === 'accept' ? 'accepted' : action.type === 'decline' ? 'declined' : 'withdrawn',
        audienceIds: [offer.authorId, offer.targetId] });
      if (action.type === 'accept') Object.assign(entry, { paid, received });
      break;
    }
  }
  const recorded = remember(s, entry, before);
  if (action.type === 'roll') s.latestRoll!.eventId = recorded.id;
  const production = action.type === 'roll' ? s.latestRoll!.production :
    action.type === 'place' && sumStock(received) ? [{ ownerId: actorId, resources: received }] : [];
  if (production.length) remember(s, { actorId, kind: 'distribution', production,
    reason: action.type === 'place' ? 'setup' : 'roll', phase: before.phase }, before);
  if (s.outcome && !before.outcome) remember(s, { actorId, kind: 'win',
    winnerParticipantIds: s.outcome.winnerParticipantIds, reason: s.outcome.reason }, before);
}

export function applyTerritory(previous: TerritoryState, id: string, action: TerritoryAction, now: number,
  source: NonNullable<TerritoryHistoryEntry['source']> = previous.participants.find(p => p.participantId === id)?.controller.kind === 'bot' || previous.left.includes(id) ? 'bot' : 'player'): TerritoryState {
  requireAction(previous.phase !== 'finished' && Object.hasOwn(previous.players, id));
  // The map and pinned rules are immutable. Reuse them instead of re-indexing the graph every action.
  const { map, rules, news, ...state } = previous;
  const { catalog, profile, ...mutableNews } = news;
  const s: TerritoryState = { ...structuredClone(state), map, rules, news: { ...structuredClone(mutableNews), catalog, profile } };
  delete s.botSchedule;
  const player = s.players[id];
  const active = currentId(s) === id;
  const { nodes, edges, tiles } = mapGraph(s.map);
  switch (action.type) {
    case 'leave':
      requireAction(!s.left.includes(id));
      s.left.push(id);
      closeOffers(s, offer => offer.authorId === id || offer.targetId === id, 'player-left', id);
      if (s.participants.every(p => p.controller.kind === 'bot' || s.left.includes(p.participantId))) finish(s, [], 'abandoned');
      break;
    case 'place': {
      const { nodeId } = action;
      requireAction(active && s.phase === 'setup-home' && placeOptions(s, id).some(option => option.id === nodeId));
      s.buildings[nodeId] = { ownerId: id, level: 1 };
      if (s.setupIndex >= s.participants.length) {
        for (const tileId of nodes.get(nodeId)!.tileIds) {
          const resource = tiles.get(tileId)!.resource;
          if (resource && s.bank[resource]) grant(s, resource, id, 1);
        }
      }
      s.setupNode = nodeId;
      s.phase = 'setup-route';
      break;
    }
    case 'route': {
      const edge = edges.get(action.edgeId);
      requireAction(active && edge);
      if (s.phase === 'setup-route') {
        requireAction(placeOptions(s, id).some(option => option.id === edge.id));
        s.routes[edge.id] = id;
        nextSetup(s);
      } else {
        requireAction(s.phase === 'play' && canAddRoute(s, id, edge));
        buy(s, id, edge.kind, edge.eventSectorId);
        s.routes[edge.id] = id;
        updateAwards(s);
      }
      break;
    }
    case 'roll':
      requireAction(active && s.phase === 'roll');
      roll(s);
      break;
    case 'discard':
      requireAction(s.phase === 'discard' && s.discard[id] > 0 && sumStock(action.resources) === s.discard[id] && covers(player.hand, action.resources));
      pay(s, id, action.resources);
      s.discard[id] = 0;
      if (!Object.values(s.discard).some(Boolean)) s.phase = 'block';
      break;
    case 'block': {
      requireAction(active && s.phase === 'block');
      const option = blockOptions(s).find(item => item.tileId === action.tileId);
      requireAction(option && (option.targets.length ? action.targetId && option.targets.includes(action.targetId) : !action.targetId));
      if (action.targetId) {
        const enemy = s.players[action.targetId];
        const rand = randomStream(s.seed, `steal:${s.turn}:${s.revision}`);
        let ticket = rand(sumStock(enemy.hand));
        const resource = RESOURCES.find(key => (ticket -= enemy.hand[key]) < 0)!;
        enemy.hand[resource]--;
        player.hand[resource]++;
      }
      s.blockedTileId = option.tileId;
      s.blockade = { actorId: id, reason: s.pendingBlockade?.reason ?? 'unknown', tileId: option.tileId,
        round: s.round, turn: s.turn, revision: s.revision + 1 };
      s.pendingBlockade = null;
      s.phase = 'play';
      break;
    }
    case 'settle':
    case 'upgrade': {
      const { nodeId } = action;
      const node = nodes.get(nodeId);
      requireAction(inTurn(s, id) && node);
      if (action.type === 'settle') {
        requireAction(canSettle(s, id, nodeId) && countLevel(s, id, 1) < s.rules.limits.level1);
        buy(s, id, 'build', node.eventSectorId);
        s.buildings[nodeId] = { ownerId: id, level: 1 };
      } else {
        requireAction(s.buildings[nodeId]?.ownerId === id && s.buildings[nodeId]?.level === 1 && countLevel(s, id, 2) < s.rules.limits.level2);
        buy(s, id, 'upgrade', node.eventSectorId, nodeId);
        s.buildings[nodeId].level = 2;
        delete s.news.damage[nodeId];
      }
      updateAwards(s);
      break;
    }
    case 'protect': {
      const cost = s.news.profile.protectionCost;
      requireAction(inTurn(s, id) && !s.protectedThisTurn && s.buildings[action.nodeId]?.ownerId === id && covers(player.hand, cost));
      const threat = exposedThreat(s, action.nodeId);
      requireAction(threat);
      pay(s, id, cost);
      threat.protected.push(action.nodeId);
      s.protectedThisTurn = true;
      break;
    }
    case 'bank': {
      const { give, receive } = action;
      const base = portRate(s, id, give);
      const rate = tradeRate(s, id, give);
      requireAction(inTurn(s, id) && give !== receive && player.hand[give] >= rate && s.bank[receive]);
      if (rate < base) {
        const coupon = s.news.coupons.find(item => item.ownerId === id && item.kind === 'bank-exchange');
        s.news.coupons = s.news.coupons.filter(item => item !== coupon);
      }
      grant(s, give, id, -rate);
      grant(s, receive, id, 1);
      break;
    }
    case 'offer':
    case 'accept':
    case 'decline':
    case 'cancel':
      deal(s, id, action, now);
      break;
    case 'buy-card':
      requireAction(inTurn(s, id) && s.deck.length);
      buy(s, id, 'card');
      player.cards.push({ id: 'card-' + s.revision, kind: s.deck.pop()!, bought: s.turn });
      break;
    case 'play-card': {
      const card = player.cards.find(item => item.id === action.cardId);
      requireAction(card && canPlay(s, id, card));
      if (card.kind === 'supply') {
        const resources = action.resources;
        requireAction(resources?.length === 2 && RESOURCES.every(resource => resources.filter(item => item === resource).length <= s.bank[resource]));
        for (const resource of resources) grant(s, resource, id, 1);
      } else if (card.kind === 'survey') s.freeRoutes += 2;
      else if (card.kind === 'patrol') {
        player.patrols++;
        s.pendingBlockade = { actorId: id, reason: 'patrol' };
        s.phase = 'block';
        updateAwards(s);
      }
      player.cards = player.cards.filter(item => item !== card);
      s.playedCard = true;
      break;
    }
    case 'end':
      requireAction(inTurn(s, id));
      end(s);
      break;
  }
  if (s.phase === 'play' && action.type !== 'end' && active) scoreWinners(s, [id]);
  if (s.phase !== 'finished' && phaseIdOf(s) !== phaseIdOf(previous)) s.deadlineAt = now + s.rules.limits.turnMs;
  rememberAction(s, previous, id, action);
  for (const entry of s.history!.slice(previous.history?.length ?? 0)) entry.source = source;
  if (action.type === 'roll') s.latestRoll!.source = source;
  s.revision++;
  switch (action.type) {
    case 'roll': s.activity = { revision: s.revision, kind: 'roll' }; break;
    case 'place': case 'settle': case 'route': case 'upgrade': s.activity = { revision: s.revision, kind: 'build' }; break;
    case 'bank': case 'accept': s.activity = { revision: s.revision, kind: 'deal' }; break;
    case 'play-card': s.activity = { revision: s.revision, kind: 'tactic' }; break;
  }
  if (s.outcome?.reason === 'points') s.activity = { revision: s.revision, kind: 'win' };
  return s;
}

export function fallbackTerritory(view: TerritoryView): TerritoryAction | null {
  const { you, phase, legal } = view;
  if (you.discard) {
    const resources = emptyStock();
    let remaining = you.discard;
    for (const resource of [...RESOURCES].sort((a, b) => you.hand[b] - you.hand[a])) {
      resources[resource] = Math.min(you.hand[resource], remaining);
      remaining -= resources[resource];
    }
    return { type: 'discard', resources };
  }
  if (view.activeParticipantId !== you.participantId) return null;
  if (legal.roll) return { type: 'roll' };
  if (legal.end) return { type: 'end' };
  if (phase === 'block' && legal.block[0]) return blockAction(legal.block[0]);
  const first = legal.options[0];
  if (phase === 'setup-home' && first) return { type: 'place', nodeId: first.id };
  if (phase === 'setup-route' && first) return { type: 'route', edgeId: first.id };
  return null;
}

export function blockAction(option: TerritoryView['legal']['block'][number], target = option.targets[0]): TerritoryAction {
  return { type: 'block', tileId: option.tileId, ...(target ? { targetId: target } : {}) };
}

export function advanceTerritory(previous: TerritoryState, now: number): TerritoryState {
  if (previous.deadlineAt === null || previous.deadlineAt > now) return previous;
  const ids = previous.phase === 'discard' ? Object.keys(previous.discard).filter(id => previous.discard[id]) : [currentId(previous)];
  let s = previous;
  for (const id of ids) {
    const action = fallbackTerritory(viewTerritory(s, id, now));
    if (action) s = applyTerritory(s, id, action, now, 'timeout');
  }
  return s;
}

export function viewTerritory(s: TerritoryState, id: string, now: number, clone = true): TerritoryView {
  requireAction(Object.hasOwn(s.players, id));
  const { phase, participants, news } = s;
  const player = s.players[id];
  const active = currentId(s) === id;
  const playing = inTurn(s, id);
  const lengths = routesByPlayer(s);
  const threats = news.chains.flatMap(chain => {
    const latest = [...news.messages].reverse().find(message => message.chainId === chain.chainId);
    return latest && 'dueRound' in latest ? [latest] : [];
  });
  const options = placeOptions(s, id);
  const cardPricing = purchasePricing(s, id, 'card');
  const history: TerritoryHistoryEntry[] = (s.history ?? []).flatMap(entry => {
    const { audienceIds, privateByParticipantId, ...visible } = entry;
    if (audienceIds && !audienceIds.includes(id)) return [];
    return [{ ...visible, ...privateByParticipantId?.[id] }];
  });
  const view = {
    gameId: 'district', rulesVersion: s.rulesVersion, contentVersion: s.contentVersion, matchId: s.matchId,
    revision: s.revision, serverNow: now, phaseId: phaseIdOf(s), phase,
    activeParticipantId: currentId(s), round: s.round, turn: s.turn, deadlineAt: s.deadlineAt, rules: s.rules,
    map: s.map, buildings: s.buildings, routes: s.routes,
    players: participants.map(p => ({ participantId: p.participantId, displayName: p.displayName, seatIndex: p.seatIndex, isBot: p.controller.kind === 'bot',
      left: s.left.includes(p.participantId), handCount: sumStock(s.players[p.participantId].hand), cardCount: s.players[p.participantId].cards.length,
      points: points(s, p.participantId, phase === 'finished'), longestRoute: lengths[p.participantId], patrols: s.players[p.participantId].patrols })),
    you: { participantId: id, hand: player.hand, cards: player.cards.map(card => ({ ...card, playable: canPlay(s, id, card) })),
      discard: s.discard[id] ?? 0, points: points(s, id, true), coupons: news.coupons.filter(coupon => coupon.ownerId === id),
      volunteered: s.volunteered?.includes(id) ?? false,
      protected: news.chains.flatMap(chain => chain.protected.filter(nodeId => s.buildings[nodeId]?.ownerId === id)) },
    bank: Object.fromEntries(RESOURCES.map(resource => [resource, Math.min(2, s.bank[resource])])) as Stock, cardsAvailable: s.deck.length, lastRoll: s.lastRoll, blockedTileId: s.blockedTileId,
    routeHolder: s.routeHolder, patrolHolder: s.patrolHolder, goal: s.rules.limits.target,
    offers: s.offers.filter(offer => offer.targetId === id || offer.authorId === id).map(offer => ({
      id: offer.id, authorId: offer.authorId, targetId: offer.targetId, give: offer.give, receive: offer.receive,
      ...(offer.parentId ? { parentId: offer.parentId } : {}),
      ...(offer.offeredAt !== undefined ? { offeredAt: offer.offeredAt } : {}),
      canAccept: offer.targetId === id && phase === 'play' && !s.left.includes(id) &&
        covers(s.players[offer.authorId].hand, offer.give) && covers(s.players[offer.targetId].hand, offer.receive),
      ...(!covers(s.players[offer.authorId].hand, offer.give) ? { unavailableReason: 'author-resources' as const } :
        // Only the recipient can inspect their own shortage. Publishing it to the
        // sender would turn unanswered proposals into probes of a hidden hand.
        offer.targetId === id && !covers(s.players[id].hand, offer.receive) ? { unavailableReason: 'target-resources' as const } : {}),
    })),
    offerHistory: (s.offerHistory ?? []).filter(offer => offer.targetId === id || offer.authorId === id),
    history, historyComplete: s.revision === 0 || s.history?.[0]?.revision === 1, latestRoll: s.latestRoll ?? null,
    blockade: s.blockade ?? (s.blockedTileId ? { reason: 'unknown' as const, tileId: s.blockedTileId } : null),
    pendingBlockade: s.pendingBlockade ?? null,
    ...(s.botSchedule?.revision === s.revision ? { botActionAt: s.botSchedule.at, botParticipantId: s.botSchedule.participantId } : {}),
    ...(s.activity ? { activity: s.activity } : {}),
    news: news.messages, threats, preset: news.preset, outcome: s.outcome,
    legal: { roll: active && phase === 'roll', end: playing, options, block: active && phase === 'block' ? blockOptions(s) : [],
      bank: Object.fromEntries(RESOURCES.map(resource => [resource, tradeRate(s, id, resource)])) as Record<Resource, number>,
      buyCard: playing && s.deck.length ? cardPricing.total : null, buyCardPricing: cardPricing,
      couponRoutes: Object.fromEntries(news.coupons.filter(coupon => coupon.ownerId === id && coupon.kind === 'free-road')
        .map(coupon => [coupon.id, options.filter(option => option.kind === 'route' && option.pricing?.couponId === coupon.id).map(option => option.id)])),
      protect: playing && !s.protectedThisTurn && covers(player.hand, news.profile.protectionCost) && threats.some(item => item.zone !== undefined && news.catalog.some(template => template.templateId === item.templateId && template.chain === 'hazard')),
      protectionCost: news.profile.protectionCost,
      trade: phase === 'play' && !s.left.includes(id) },
  } satisfies TerritoryView;
  return clone ? structuredClone(view) : view;
}

const isResource = (value: unknown): value is Resource => RESOURCES.includes(value as Resource);
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !Object.hasOwn(Object.prototype, value);
function parseStock(value: unknown): Stock {
  requireAction(value && typeof value === 'object' && !Array.isArray(value));
  const data = value as Record<string, unknown>;
  requireAction(Object.entries(data).every(([key, count]) => isResource(key) && Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 100));
  return { ...emptyStock(), ...data };
}
export function parseTerritoryAction(value: unknown): TerritoryAction {
  requireAction(value && typeof value === 'object' && !Array.isArray(value));
  const data = value as Record<string, unknown>;
  const { type } = data;
  const keys = (...allowed: string[]) => requireAction(Object.keys(data).every(key => key === 'type' || allowed.includes(key)));
  switch (type) {
    case 'place': case 'settle': case 'upgrade': case 'protect':
      keys('nodeId'); requireAction(isId(data.nodeId)); return { type, nodeId: data.nodeId };
    case 'route':
      keys('edgeId'); requireAction(isId(data.edgeId)); return { type, edgeId: data.edgeId };
    case 'roll': case 'end': case 'buy-card': case 'leave':
      keys(); return { type };
    case 'discard':
      keys('resources'); return { type, resources: parseStock(data.resources) };
    case 'block':
      keys('tileId', 'targetId'); requireAction(isId(data.tileId) && (data.targetId === undefined || isId(data.targetId)));
      return { type, tileId: data.tileId, ...(data.targetId ? { targetId: data.targetId } : {}) };
    case 'bank':
      keys('give', 'receive'); requireAction(isResource(data.give) && isResource(data.receive)); return { type, give: data.give, receive: data.receive };
    case 'offer':
      keys('targetId', 'give', 'receive', 'parentId');
      requireAction(isId(data.targetId) && (data.parentId === undefined || isId(data.parentId)));
      return { type, targetId: data.targetId, give: parseStock(data.give), receive: parseStock(data.receive), ...(data.parentId ? { parentId: data.parentId } : {}) };
    case 'accept': case 'decline': case 'cancel':
      keys('offerId'); requireAction(isId(data.offerId)); return { type, offerId: data.offerId };
    case 'play-card':
      keys('cardId', 'resources');
      requireAction(isId(data.cardId) && (data.resources === undefined || (Array.isArray(data.resources) && data.resources.length <= 2 && data.resources.every(isResource))));
      return { type, cardId: data.cardId, ...(data.resources ? { resources: data.resources } : {}) };
    default: requireAction(false);
  }
}
