import { randomStream, shuffled } from '../random';
import { mapGraph, canRoute, hasRoom } from './graph';
import type { Resource } from './maps';
import { COSTS, RESOURCES, emptyStock } from './types';
import type { Stock, TerritoryState, Zone } from './types';

export const sumStock = (stock: Stock) => RESOURCES.reduce((total, resource) => total + stock[resource], 0);
export const covers = (stock: Stock, cost: Partial<Stock>) => RESOURCES.every(resource => stock[resource] >= (cost[resource] ?? 0));
export const inZone = (sector: string, zone: Zone) => zone === null || sector === zone;
export const countLevel = (s: TerritoryState, id: string, level: number) =>
  Object.values(s.buildings).filter(building => building.ownerId === id && building.level === level).length;

export function alloc(s: TerritoryState, resource: Resource, demand: Record<string, number>, domain: string): Record<string, number> {
  const total = Object.values(demand).reduce((sum, units) => sum + units, 0);
  const stock = Math.min(s.bank[resource], total);
  if (!stock) return {};
  if (total === stock) return { ...demand };
  const order = shuffled(Object.keys(demand).sort(), randomStream(s.seed, 'allocation:' + domain + ':' + resource));
  const result = Object.fromEntries(order.map(id => [id, Math.floor(stock * demand[id] / total)]));
  const missing = stock - Object.values(result).reduce((sum, units) => sum + units, 0);
  order.sort((a, b) => (stock * demand[b]) % total - (stock * demand[a]) % total);
  for (const id of order.slice(0, missing)) result[id]++;
  return result;
}

export function grant(s: TerritoryState, resource: Resource, id: string, amount: number) {
  s.bank[resource] -= amount;
  s.players[id].hand[resource] += amount;
}

export function pay(s: TerritoryState, id: string, cost: Partial<Stock>) {
  for (const resource of RESOURCES) grant(s, resource, id, -(cost[resource] ?? 0));
}

type Purchase = 'land' | 'sea' | 'build' | 'upgrade' | 'card';

export function price(s: TerritoryState, id: string, purchase: Purchase, sector?: string, nodeId?: string) {
  const original: Partial<Stock> = s.rules.costs[purchase] ?? COSTS[purchase];
  const cost = { ...emptyStock(), ...original };
  const available = s.news.coupons.filter(item => item.ownerId === id && (purchase === 'card' || sector && inZone(sector, item.zone)));
  const restoration = purchase === 'upgrade' && nodeId && s.news.damage[nodeId]
    ? available.find(item => item.kind === 'restore') : undefined;
  const coupon = restoration ?? available.find(item =>
    purchase === 'land' && item.kind === 'free-road' ||
    purchase === 'upgrade' && item.kind === 'upgrade-discount' ||
    purchase === 'card' && item.kind === 'card-discount',
  );
  const freePermission = (purchase === 'land' || purchase === 'sea') && s.freeRoutes > 0;
  const free = freePermission || coupon?.kind === 'free-road' || coupon?.kind === 'restore';
  for (const resource of RESOURCES) {
    if (free) cost[resource] = 0;
  }
  if (coupon && !free) cost.ore = Math.max(0, cost.ore - 1);
  const penalties = s.news.modifiers.filter(item => {
    const effect = item.effect;
    if (!sector || !inZone(sector, item.zone) || effect.op !== 'surcharge' || item.spent.includes(id)) return false;
    return effect.action === 'build-or-upgrade' && (purchase === 'build' || purchase === 'upgrade') ||
      effect.action === 'road' && purchase === 'land' || effect.action === purchase;
  });
  for (const resource of RESOURCES) {
    cost[resource] += Math.max(0, ...penalties.map(item => item.effect.op === 'surcharge' && item.effect.resource === resource ? item.effect.amount : 0));
  }
  return { cost, coupon: freePermission ? undefined : coupon, freePermission, penalties };
}

export function portRate(s: TerritoryState, id: string, give: Resource, ignoredSector?: string): number {
  let rate = s.rules.bankRate;
  for (const port of s.map.ports) {
    if (port.eventSectorId === ignoredSector || s.buildings[port.nodeId]?.ownerId !== id || port.resource && port.resource !== give) continue;
    const effects = s.news.modifiers.filter(m => m.effect.op === 'port' && inZone(port.eventSectorId, m.zone)).map(m => m.effect);
    if (effects.some(effect => effect.op === 'port' && effect.mode === 'suspend')) continue;
    const discount = Math.max(0, ...effects.map(effect => effect.op === 'port' && effect.mode === 'discount' ? effect.amount : 0));
    rate = Math.min(rate, Math.max(2, (port.resource ? s.rules.specialisedPortRate : s.rules.portRate) - discount));
  }
  return rate;
}

export function tradeRate(s: TerritoryState, id: string, give: Resource): number {
  return s.news.coupons.some(coupon => coupon.ownerId === id && coupon.kind === 'bank-exchange') ? 2 : portRate(s, id, give);
}

export function canSettle(s: TerritoryState, id: string, nodeId: string): boolean {
  return hasRoom(s, nodeId) && mapGraph(s.map).adjacent.get(nodeId)!.some(edge => s.routes[edge.id] === id);
}

export function canAddRoute(s: TerritoryState, id: string, edge: TerritoryState['map']['edges'][number]) {
  const limit = s.rules.limits[edge.kind];
  return s.map.edges.filter(link => link.kind === edge.kind && s.routes[link.id] === id).length < limit && canRoute(s, id, edge);
}
