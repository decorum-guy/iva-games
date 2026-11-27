import { randomStream, shuffled } from '../random';
import { alloc, canAddRoute, canSettle, countLevel, grant, inZone, portRate } from './economy';
import { mapGraph } from './graph';
import { newsCatalog, newsCatalogVersion, newsProfiles } from './news-catalog';
import type { NewsEffect, NewsPreset, NewsStage, NewsTemplate } from './news-catalog';
import type { Resource } from './maps';
import { RESOURCES } from './types';
import type { AppliedChange, NewsChain, PublicNews, Stock, TerritoryNews, TerritoryState, Zone } from './types';

const interval = (range: readonly [number, number], rand: (bound: number) => number) => range[0] + rand(range[1] - range[0] + 1);
const weighted = (weights: number[], rand: (bound: number) => number): number => {
  let ticket = rand(weights.reduce((total, weight) => total + weight, 0));
  return weights.findIndex(weight => (ticket -= weight) < 0);
};

export function initNews(seed: string, preset: NewsPreset): TerritoryNews {
  const profile = structuredClone(newsProfiles[preset]);
  return { version: newsCatalogVersion, preset, profile, catalog: structuredClone(newsCatalog),
    nextRound: interval(profile.firstRound, randomStream(seed, 'news:first')),
    processedRound: 0, counter: 0, launches: 0, lastTemplates: [], lastHazard: -100, lastRenovation: -100,
    cityMeteor: false, chains: [], modifiers: [], coupons: [], messages: [], bonusNodes: {}, bonusOwners: {}, bonusByEvent: {}, damage: {} };
}

type Building = { id: string; ownerId: string; level: 1 | 2 };
type Publication = { source: NewsChain; template: NewsTemplate; stage: NewsStage; zone?: Zone; effects: NewsEffect[]; changes: AppliedChange[] };
const buildingsIn = (s: TerritoryState, zone: Zone, exposure: NewsTemplate['exposure'] = null): Building[] =>
  s.map.nodes.flatMap(node => {
    const building = s.buildings[node.id];
    return building && inZone(node.eventSectorId, zone) && (!exposure || node.exposureTags.includes(exposure))
      ? [{ id: node.id, ...building }] : [];
  });
const ownersOf = (list: Building[]) => [...new Set(list.map(building => building.ownerId))].sort();
const hasProduction = (s: TerritoryState, building: Building, resource: Resource | 'all') => {
  const { nodes, tiles } = mapGraph(s.map);
  return nodes.get(building.id)!.tileIds.some(id => {
    const tile = tiles.get(id)!;
    return tile.resource && (resource === 'all' || tile.resource === resource);
  });
};

function legalRenovation(s: TerritoryState, group: Building[]): boolean {
  const eligible = group.filter(building => building.level === 1);
  return eligible.length > 0 && ownersOf(eligible).every(owner =>
    countLevel(s, owner, 2) + eligible.filter(building => building.ownerId === owner).length <= s.rules.limits.level2,
  );
}

export function availableZones(s: TerritoryState, template: NewsTemplate): string[] {
  const n = s.news;
  if (template.minRound > s.round ||
      template.chain === 'hazard' && s.round - n.lastHazard < n.profile.hazardCooldown ||
      template.cooldown && s.round - n.lastRenovation < template.cooldown) return [];
  return s.map.sectors.filter(sector => {
    const list = buildingsIn(s, sector.id, template.exposure);
    if (!list.length) return false;
    const owners = ownersOf(list);
    if (template.chain === 'hazard') return list.some(building => building.level > 1);
    return template.effects.every(effect => {
      switch (effect.op) {
        case 'grant': return RESOURCES.some(resource => (effect.resources[resource] ?? 0) > 0 && s.bank[resource] > 0);
        case 'production': return list.some(building => building.level >= effect.floor + 1 && hasProduction(s, building, effect.resource));
        case 'renovate': return legalRenovation(s, list);
        case 'port': return s.map.ports.some(port => port.eventSectorId === sector.id && s.buildings[port.nodeId] &&
          (effect.mode === 'discount'
            ? !port.resource && RESOURCES.some(resource => portRate(s, s.buildings[port.nodeId].ownerId, resource) > 2)
            : RESOURCES.some(resource => portRate(s, s.buildings[port.nodeId].ownerId, resource, sector.id) > portRate(s, s.buildings[port.nodeId].ownerId, resource))));
        case 'surcharge':
          if (effect.action === 'build-or-upgrade' || effect.action === 'upgrade') {
            return list.some(building => building.level === 1 && countLevel(s, building.ownerId, 2) < s.rules.limits.level2) ||
              effect.action === 'build-or-upgrade' && s.map.nodes.some(node => node.eventSectorId === sector.id &&
                s.participants.some(player => countLevel(s, player.participantId, 1) < s.rules.limits.level1 && canSettle(s, player.participantId, node.id)));
          }
          return s.map.edges.some(edge => edge.eventSectorId === sector.id && edge.kind === (effect.action === 'sea' ? 'sea' : 'land') &&
            s.participants.some(player => canAddRoute(s, player.participantId, edge)));
        case 'coupon':
          switch (effect.kind) {
            case 'card-discount': return s.deck.length > 0;
            case 'restore': return list.some(building => building.level < 2 && s.news.damage[building.id]);
            case 'upgrade-discount': return list.some(building => building.level < 2 && countLevel(s, building.ownerId, 2) < s.rules.limits.level2);
            case 'free-road': return s.map.edges.some(edge => edge.eventSectorId === sector.id && edge.kind === 'land' && owners.some(owner => canAddRoute(s, owner, edge)));
            case 'bank-exchange': return owners.some(owner => RESOURCES.some(resource => portRate(s, owner, resource) > 2));
          }
          return false;
        default: return true;
      }
    });
  }).map(sector => sector.id);
}

function chooseTemplate(s: TerritoryState, rand: (bound: number) => number) {
  const n = s.news;
  const types = ['good', 'setback', 'hazard'] as const;
  const available = n.catalog.filter(template => !n.chains.some(chain =>
    template.chain === 'positive' ? n.catalog.find(item => item.templateId === chain.templateId)?.chain === 'positive' :
      template.chain !== 'none' && n.catalog.find(item => item.templateId === chain.templateId)?.chain !== 'positive',
  )).map(template => ({ template, sectors: availableZones(s, template) })).filter(item => item.sectors.length);
  const weights = types.map(group => available.some(item => item.template.group === group) ? n.profile.weights[group] : 0);
  if (!weights.some(Boolean)) return null;
  const group = types[weighted(weights, rand)];
  let options = available.filter(item => item.template.group === group);
  const fresh = options.filter(item => !n.lastTemplates.includes(item.template.templateId));
  if (fresh.length) options = fresh;
  if (group === 'good') {
    const chains = options.filter(item => item.template.chain === 'positive');
    const regular = options.filter(item => item.template.chain === 'none');
    if (chains.length && regular.length) options = rand(100) < n.profile.positiveChainWeight ? chains : regular;
  }
  const { template, sectors } = options[rand(options.length)];
  const alternates = group === 'good' ? sectors : sectors.filter(sector => sector !== n.lastBadZone);
  const zones = alternates.length ? alternates : sectors;
  return { template, zone: zones[rand(zones.length)] };
}

function queue(packet: Publication[], source: NewsChain, template: NewsTemplate, stage: NewsStage, zone: Zone | undefined, effects: NewsEffect[] = []) {
  source.stage = stage;
  packet.push({ source, template, stage, zone, effects, changes: [] });
}

function launch(s: TerritoryState, template: NewsTemplate, zone: Zone, rand: (bound: number) => number, packet: Publication[]) {
  const n = s.news;
  const id = `n${++n.launches}`;
  n.lastTemplates = [...n.lastTemplates, template.templateId].slice(-2);
  const chain: NewsChain = { chainId: 'c-' + id, eventInstanceId: id, templateId: template.templateId, zone,
    warnings: 0, started: s.round, at: s.round, confirmAt: s.round, outcome: true, stage: 'applied', protected: [] };
  if (template.chain === 'none') {
    queue(packet, chain, template, 'applied', zone, template.effects);
    if (template.group === 'setback') n.lastBadZone = zone;
    if (template.effects.some(effect => effect.op === 'renovate')) n.lastRenovation = s.round;
    return;
  }
  if (template.chain === 'positive') {
    chain.at += interval(template.outcomeDelay!, rand);
    chain.outcome = rand(100) < template.outcomeChance!;
    n.chains.push(chain);
    queue(packet, chain, template, 'applied', zone, template.effects);
    return;
  }
  chain.warnings = weighted([...n.profile.warningWeights], rand);
  if (template.chain === 'epidemic') {
    chain.at += interval(template.outcomeDelay!, rand);
    chain.outcome = rand(100) < n.profile.spreadChance;
    chain.confirmAt++;
    n.lastBadZone = zone;
    n.chains.push(chain);
    queue(packet, chain, template, 'applied', zone, template.effects);
    if (chain.warnings === 2) queue(packet, chain, template, 'forecast', null);
    return;
  }
  if (template.hideEarlySector && !n.cityMeteor && n.preset === 'very-hard' && s.round >= n.profile.cityMeteorMinRound && rand(100) < n.profile.cityMeteorChance) {
    chain.zone = null;
    n.cityMeteor = true;
  }
  if (!chain.warnings) {
    n.lastBadZone = chain.zone;
    n.lastHazard = s.round;
    queue(packet, chain, template, 'applied', chain.zone, template.effects);
    return;
  }
  n.chains.push(chain);
  if (chain.warnings === 1) {
    chain.at += n.profile.confirmedDelay;
    n.lastBadZone = chain.zone;
    queue(packet, chain, template, 'confirmed', chain.zone);
    return;
  }
  chain.at += interval(template.outcomeDelay!, rand);
  chain.confirmAt = chain.at - n.profile.confirmedDelay;
  chain.outcome = rand(100) < template.outcomeChance!;
  if (!template.hideEarlySector) n.lastBadZone = chain.zone;
  queue(packet, chain, template, 'forecast', template.hideEarlySector ? undefined : chain.zone);
}

function scheduled(s: TerritoryState, packet: Publication[]) {
  const n = s.news;
  n.chains = n.chains.filter(chain => {
    const template = n.catalog.find(item => item.templateId === chain.templateId)!;
    if (template.chain === 'epidemic') {
      if (s.round === chain.confirmAt && chain.warnings) {
        queue(packet, chain, template, chain.warnings === 1 ? 'forecast' : 'update', null);
      }
      if (s.round === chain.at) {
        queue(packet, chain, template, chain.outcome ? 'success' : 'cancelled', chain.outcome ? null : chain.zone,
          chain.outcome ? template.successEffects : []);
        return chain.outcome;
      }
      return s.round <= chain.at;
    }
    if (template.chain === 'hazard' && s.round === chain.confirmAt && chain.warnings === 2) {
      if (!chain.outcome) {
        queue(packet, chain, template, 'cancelled', template.hideEarlySector ? undefined : chain.zone);
        return false;
      }
      n.lastBadZone = chain.zone;
      queue(packet, chain, template, 'confirmed', chain.zone);
    }
    if (s.round !== chain.at) return true;
    if (template.chain === 'hazard') {
      n.lastHazard = s.round;
      queue(packet, chain, template, 'applied', chain.zone, template.effects);
    } else queue(packet, chain, template, chain.outcome ? 'success' : 'cancelled', chain.zone, chain.outcome ? template.successEffects : []);
    return false;
  });
}

function applyPacket(s: TerritoryState, packet: Publication[]) {
  const levels = new Map<string, { building: Building; delta: number; stories: Set<Publication> }>();
  type Demand = { item: Publication; id: string; resource: Resource; units: number; key: string };
  const demands: Demand[] = [];
  for (const item of packet) {
    const { source, effects, changes, zone = source.zone } = item;
    const list = buildingsIn(s, zone, item.template.exposure);
    const owners = ownersOf(list);
    effects.forEach((effect, index) => {
      switch (effect.op) {
        case 'grant':
          for (const id of owners) {
            const basis = effect.basis === 'owner' ? 1 : list.filter(building => building.ownerId === id).reduce((sum, building) => sum + building.level, 0);
            for (const resource of RESOURCES) {
              const units = Math.min(effect.cap, basis * (effect.resources[resource] ?? 0));
              if (units) demands.push({ item, id, resource, units, key: `${source.eventInstanceId}:${item.stage}:${index}:${id}` });
            }
          }
          break;
        case 'production':
        case 'port':
        case 'surcharge':
          s.news.modifiers.push({ eventInstanceId: source.eventInstanceId, zone, effect,
            startsAfterRound: s.round, endsAfterRound: s.round + effect.rounds, spent: [] });
          if (effect.op === 'production') {
            for (const building of list.filter(candidate => hasProduction(s, candidate, effect.resource) && candidate.level > effect.floor)) {
              changes.push({ kind: 'modifier', ownerId: building.ownerId, nodeId: building.id });
            }
          } else if (effect.op === 'port') {
            for (const port of s.map.ports.filter(port => inZone(port.eventSectorId, zone) && s.buildings[port.nodeId])) {
              changes.push({ kind: 'modifier', ownerId: s.buildings[port.nodeId].ownerId, nodeId: port.nodeId });
            }
          }
          break;
        case 'coupon':
          for (const id of owners) {
            if (effect.kind === 'restore' && !list.some(building => building.ownerId === id && building.level < 2 && s.news.damage[building.id])) continue;
            s.news.coupons.push({ id: `${source.eventInstanceId}:${item.stage}:${index}:${id}`, eventInstanceId: source.eventInstanceId,
              ownerId: id, zone, kind: effect.kind, endsAfterRound: s.round + effect.rounds });
            changes.push({ kind: 'coupon', ownerId: id, coupon: effect.kind });
          }
          break;
        case 'renovate':
        case 'damage':
          if (effect.op === 'renovate' && !legalRenovation(s, list)) break;
          for (const building of list) {
            if (effect.op === 'damage' && building.level === 2 && source.protected.includes(building.id)) {
              changes.push({ kind: 'protected', ownerId: building.ownerId, nodeId: building.id });
              continue;
            }
            const delta = effect.op === 'renovate' && building.level === 1 ? effect.levels : effect.op === 'damage' && building.level === 2 ? -effect.levels : 0;
            if (!delta) continue;
            const entry = levels.get(building.id) ?? { building, delta: 0, stories: new Set<Publication>() };
            entry.delta += delta;
            entry.stories.add(item);
            levels.set(building.id, entry);
          }
          break;
      }
    });
  }
  for (const { building, delta, stories } of levels.values()) {
    const after = Math.min(2, Math.max(1, building.level + delta)) as 1 | 2;
    if (after === building.level) continue;
    s.buildings[building.id].level = after;
    if (after < building.level) s.news.damage[building.id] = { round: s.round, level: building.level };
    else delete s.news.damage[building.id];
    for (const story of stories) story.changes.push({ kind: 'level', ownerId: building.ownerId, nodeId: building.id, before: building.level, after });
  }
  for (const resource of RESOURCES) {
    const relevant = demands.filter(demand => demand.resource === resource);
    const byId: Record<string, number> = {};
    for (const { id, units } of relevant) byId[id] = (byId[id] ?? 0) + units;
    const amounts = alloc(s, resource, byId, `boundary:${s.round}`);
    for (const [id, units] of Object.entries(amounts)) {
      if (units) grant(s, resource, id, units);
      const claims = relevant.filter(demand => demand.id === id).sort((a, b) => a.key.localeCompare(b.key));
      const ordered = shuffled(claims, randomStream(s.seed, `claims:${s.round}:${resource}:${id}`));
      ordered.sort((a, b) => (units * b.units) % byId[id] - (units * a.units) % byId[id]);
      const shares = ordered.map(demand => Math.floor(units * demand.units / byId[id]));
      let remaining = units - shares.reduce((total, units) => total + units, 0);
      ordered.forEach((demand, index) => {
        const paid = shares[index] + (remaining-- > 0 ? 1 : 0);
        if (paid) demand.item.changes.push({ kind: 'resources', ownerId: id, resources: { [resource]: paid } });
      });
    }
  }
  for (const { source, template, stage, zone, changes, effects } of packet) {
    const base = { messageId: `${source.eventInstanceId}:${stage}`, templateId: template.templateId, eventInstanceId: source.eventInstanceId,
      ...(template.chain === 'none' ? {} : { chainId: source.chainId }),
      headline: template.headlines[stage] ?? template.headlines.applied!, round: s.round,
      ...(zone === undefined ? {} : { zone }) };
    const message: PublicNews = stage === 'forecast' || stage === 'update' || stage === 'confirmed'
      ? { ...base, stage, dueRound: source.at }
      : { ...base, stage, changes, ...(effects.length ? { description: stage === 'success' ? template.successDescription ?? template.description : template.description } : {}),
        ...(effects.some(effect => 'rounds' in effect) ? { endsAfterRound: s.round + Math.max(...effects.map(effect => 'rounds' in effect ? effect.rounds : 0)) } : {}) };
    s.news.messages.push(message);
  }
}

export function newsBoundary(s: TerritoryState) {
  const n = s.news;
  if (n.processedRound >= s.round) return;
  n.processedRound = s.round;
  n.modifiers = n.modifiers.filter(item => item.endsAfterRound > s.round);
  n.coupons = n.coupons.filter(item => item.endsAfterRound > s.round);
  n.bonusNodes = {};
  n.bonusOwners = {};
  const packet: Publication[] = [];
  scheduled(s, packet);
  if (n.nextRound <= s.round) {
    const rand = randomStream(s.seed, `news:${n.counter++}`);
    n.nextRound = s.round + interval(n.profile.interval, rand);
    const chosen = chooseTemplate(s, rand);
    if (chosen) launch(s, chosen.template, chosen.zone, rand, packet);
  }
  applyPacket(s, packet);
}

// Local tutorial/fixture helper. The runtime action parser never exposes it.
export function tutorialNews(s: TerritoryState, templateId: string, zone: Zone, rand: (bound: number) => number) {
  const packet: Publication[] = [];
  launch(s, s.news.catalog.find(template => template.templateId === templateId)!, zone, rand, packet);
  applyPacket(s, packet);
}

export function exposedThreat(s: TerritoryState, nodeId: string): NewsChain | undefined {
  const node = mapGraph(s.map).nodes.get(nodeId);
  if (!node || s.buildings[nodeId]?.level !== 2) return undefined;
  return s.news.chains.find(chain => {
    const template = s.news.catalog.find(item => item.templateId === chain.templateId)!;
    if (template.chain !== 'hazard' || !(chain.stage === 'confirmed' || chain.stage === 'forecast' && !template.hideEarlySector) ||
      !inZone(node.eventSectorId, chain.zone) || chain.protected.includes(nodeId)) return false;
    return !template.exposure || node.exposureTags.includes(template.exposure);
  });
}

type Operation = { nodeId: string; ownerId: string; sector: string; level: number; resource: Resource; base: number };
export function produce(s: TerritoryState, operations: Operation[]) {
  const bonus: { operation: Operation; eventInstanceId: string }[] = [];
  const byResource: Partial<Record<Resource, Record<string, number>>> = {};
  const changes = new Map<string, Record<string, Partial<Stock>>>();
  const record = (event: string, owner: string, resource: Resource, delta: number) => {
    const rows = changes.get(event) ?? {};
    const row = rows[owner] ?? {};
    row[resource] = (row[resource] ?? 0) + delta;
    rows[owner] = row;
    changes.set(event, rows);
  };
  for (const op of operations) {
    const effects = s.news.modifiers.filter(item => item.effect.op === 'production' && inZone(op.sector, item.zone) &&
      (item.effect.resource === 'all' || item.effect.resource === op.resource));
    const stopped = effects.find(item => item.effect.op === 'production' && item.effect.mode === 'stop');
    const reductions = effects.flatMap(item => item.effect.op === 'production' && item.effect.mode === 'reduce'
      ? [{ item, units: Math.min(item.effect.amount, Math.max(0, op.base - item.effect.floor)) }] : []);
    const reduction = reductions.sort((a, b) => b.units - a.units)[0];
    const reduced = stopped ? 0 : op.base - (reduction?.units ?? 0);
    // A block or reduction suppresses units of this actual production operation.
    // Bank shortfalls are separate from the amount suppressed by the modifier.
    const suppression = stopped ?? reduction?.item;
    if (suppression && reduced < op.base) record(suppression.eventInstanceId, op.ownerId, op.resource, reduced - op.base);
    const demand = byResource[op.resource] ??= {};
    demand[op.ownerId] = (demand[op.ownerId] ?? 0) + reduced;
    const boost = effects.find(item => item.effect.op === 'production' && item.effect.mode === 'bonus');
    if (reduced > 0 && boost) bonus.push({ operation: op, eventInstanceId: boost.eventInstanceId });
  }
  for (const resource of RESOURCES) {
    for (const [id, amount] of Object.entries(alloc(s, resource, byResource[resource] ?? {}, `production:${s.turn}`))) {
      grant(s, resource, id, amount);
    }
  }
  const order = shuffled(bonus.sort((a, b) => a.operation.nodeId.localeCompare(b.operation.nodeId) || a.operation.resource.localeCompare(b.operation.resource)),
    randomStream(s.seed, `bonus:${s.turn}`));
  for (const { operation: op, eventInstanceId } of order) {
    const nodes = s.news.bonusNodes[op.nodeId] ?? 0;
    const owners = s.news.bonusOwners[op.ownerId] ?? 0;
    if (!s.bank[op.resource] || nodes >= op.level || owners >= s.news.profile.bonusOwnerCap) continue;
    grant(s, op.resource, op.ownerId, 1);
    s.news.bonusNodes[op.nodeId] = nodes + 1;
    s.news.bonusOwners[op.ownerId] = owners + 1;
    s.news.bonusByEvent[eventInstanceId] = (s.news.bonusByEvent[eventInstanceId] ?? 0) + 1;
    record(eventInstanceId, op.ownerId, op.resource, 1);
  }
  for (const [event, byOwner] of changes) {
    const message = [...s.news.messages].reverse().find(item => item.eventInstanceId === event && 'changes' in item && item.endsAfterRound && item.endsAfterRound > s.round);
    if (!message || !('changes' in message)) continue;
    for (const [ownerId, resources] of Object.entries(byOwner)) message.changes.push({ kind: 'production', ownerId, resources });
  }
}
