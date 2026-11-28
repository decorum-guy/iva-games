import { randomStream } from '../../src/random';
import { applyTerritory, createTerritory, currentId, viewTerritory } from '../../src/territorial/core';
import { hasRoom, mapGraph } from '../../src/territorial/graph';
import type { TerritoryMap } from '../../src/territorial/maps';
import type { TerritoryState } from '../../src/territorial/types';

const seats = Array.from({ length: 4 }, (_, seatIndex) => {
  const id = 'seat-' + seatIndex;
  return { participantId: id, playerId: id, displayName: id, seatIndex, controller: { kind: 'human' as const, playerId: id } };
});

function locations(map: TerritoryMap) {
  const { tiles } = mapGraph(map);
  return new Map(map.nodes.map(node => {
    const terrain = node.tileIds.map(id => tiles.get(id)!).filter(t => t.resource && t.number);
    return [node.id, {
      count: terrain.length, types: new Set(terrain.map(t => t.resource!)),
      yield: terrain.reduce((sum, t) => sum + 6 - Math.abs(7 - t.number!), 0),
    }];
  }));
}

/** Reachable sites after the real eight-home snake setup. Rivals stay in place
 * while a player explores land-only routes. No starting resource budget is assumed. */
function expansion(state: TerritoryState, owner: string, quality: ReturnType<typeof locations>) {
  const { adjacent } = mapGraph(state.map);
  const network = new Set(Object.keys(state.buildings).filter(id => state.buildings[id].ownerId === owner));
  for (const road of state.map.edges) if (state.routes[road.id] === owner) {
    network.add(road.a); network.add(road.b);
  }
  const options = new Map<string, Map<string, number>>();
  const visit = (node: string, first: string, length: number, path: Set<string>) => {
    if (state.buildings[node] && state.buildings[node].ownerId !== owner) return;
    const location = quality.get(node)!;
    if (hasRoom(state, node) && location.count >= 2 && location.types.size >= 2 && location.yield >= 5) {
      const choices = options.get(node) ?? new Map<string, number>();
      choices.set(first, Math.min(choices.get(first) ?? Infinity, length));
      options.set(node, choices);
    }
    if (length === 3) return;
    for (const edge of adjacent.get(node)!) {
      const to = node === edge.a ? edge.b : edge.a;
      if (edge.kind === 'land' && !state.routes[edge.id] && !network.has(to) && !path.has(to)) {
        visit(to, first, length + 1, new Set([...path, to]));
      }
    }
  };
  for (const node of network) for (const edge of adjacent.get(node)!) {
    const to = node === edge.a ? edge.b : edge.a;
    if (edge.kind === 'land' && !state.routes[edge.id] && !network.has(to)) visit(to, edge.id, 1, new Set([node, to]));
  }
  return options;
}

const summary = (numbers: number[]) => {
  const ordered = [...numbers].sort((a, b) => a - b);
  return { min: ordered[0], median: ordered[Math.floor((ordered.length - 1) / 2)], max: ordered.at(-1) };
};

export function auditFourSeatOpenings(map: TerritoryMap, trials = 48) {
  const quality = locations(map);
  const ports = new Set(map.ports.map(port => port.nodeId));
  const closeSites: number[] = [], sharedSites: number[] = [], seatPips: number[] = [];
  let independentSeats = 0;
  for (let n = 0; n < trials; n++) {
    const seed = 'district-four-seats-' + n;
    const random = randomStream(seed, 'opening');
    let s = createTerritory({ matchId: seed, roomId: seed, map, participants: seats, seed, preset: 'medium', now: 0 });
    for (let turn = 0; turn < 16; turn++) {
      const id = currentId(s);
      const options = viewTerritory(s, id, turn, false).legal.options;
      if (s.phase === 'setup-home') {
        const owned = Object.entries(s.buildings).filter(([, b]) => b.ownerId === id).map(([site]) => quality.get(site)!);
        const resources = new Set(owned.flatMap(site => [...site.types]));
        const preference = (n + s.activeIndex) % 3;
        const ranked = options.map(option => {
          const site = quality.get(option.id)!;
          const missing = [...site.types].filter(r => !resources.has(r)).length;
          const score = site.yield + missing * (preference === 1 ? 2 : .6)
            + Number(ports.has(option.id)) * (preference === 2 ? 3 : 0);
          return { id: option.id, score: score + random(1000) / 1000 };
        }).sort((a, b) => b.score - a.score);
        const pick = ranked[random(Math.min(4, ranked.length))];
        s = applyTerritory(s, id, { type: 'place', nodeId: pick.id }, turn + 1);
      } else {
        s = applyTerritory(s, id, { type: 'route', edgeId: options[random(options.length)].id }, turn + 1);
      }
    }
    if (Object.keys(s.buildings).length !== 8 || Object.keys(s.routes).length !== 8) throw new Error('Incomplete opening');
    const options = seats.map(p => expansion(s, p.participantId, quality));
    for (const [i, player] of seats.entries()) {
      const withinTwo = [...options[i]].map(([site, choices]) => ({
        site, first: [...choices].filter(([, cost]) => cost <= 2).map(([edge]) => edge),
      })).filter(item => item.first.length);
      closeSites.push(withinTwo.length);
      if (withinTwo.some((a, j) => withinTwo.slice(j + 1).some(b => a.first.some(x => b.first.some(y => y !== x))))) independentSeats++;
      sharedSites.push([...options[i].keys()].filter(site => options.some((rival, j) => j !== i && rival.has(site))).length);
      seatPips.push(Object.entries(s.buildings).filter(([, b]) => b.ownerId === player.participantId)
        .reduce((total, [node]) => total + quality.get(node)!.yield, 0));
    }
  }
  const strongSites = map.nodes.filter(node => {
    const site = quality.get(node.id)!;
    return site.count === 3 && site.types.size === 3 && site.yield >= 8;
  });
  return { map: map.id, trials, seats: trials * 4, tripleProductive: [...quality.values()].filter(site => site.count === 3).length,
    strongSites: strongSites.length, strongSitesByQuadrant: [0, 1, 2, 3].map(i => strongSites.filter(node =>
      Number(node.x >= map.width / 2) + 2 * Number(node.y >= map.height / 2) === i).length),
    startingYield: summary(seatPips), twoRoadSites: summary(closeSites), independentSeats,
    sharedWithinThree: summary(sharedSites), seatsWithCompetition: sharedSites.filter(n => n > 0).length };
}
