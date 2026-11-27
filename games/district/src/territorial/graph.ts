import type { TerritoryMap } from './maps';
import type { TerritoryState } from './types';

export function mapGraph(map: TerritoryMap) {
  // These indexes reference the pinned map. They contain no mutable match data.
  let graph = graphs.get(map);
  if (!graph) {
    const edges = new Map(map.edges.map(edge => [edge.id, edge]));
    const nodes = new Map(map.nodes.map(node => [node.id, node]));
    const tiles = new Map(map.tiles.map(tile => [tile.id, tile]));
    const adjacent = new Map(map.nodes.map(node => [node.id, [] as typeof map.edges]));
    for (const edge of map.edges) {
      adjacent.get(edge.a)!.push(edge);
      adjacent.get(edge.b)!.push(edge);
    }
    graph = { edges, nodes, tiles, adjacent };
    graphs.set(map, graph);
  }
  return graph;
}
type MapGraph = {
  edges: Map<string, TerritoryMap['edges'][number]>;
  nodes: Map<string, TerritoryMap['nodes'][number]>;
  tiles: Map<string, TerritoryMap['tiles'][number]>;
  adjacent: Map<string, TerritoryMap['edges']>;
};
const graphs = new WeakMap<TerritoryMap, MapGraph>();

export function hasRoom(s: TerritoryState, nodeId: string): boolean {
  return !s.buildings[nodeId] && (mapGraph(s.map).adjacent.get(nodeId) ?? []).every(edge =>
    edge.kind === 'sea' || !s.buildings[edge.a === nodeId ? edge.b : edge.a]);
}

export function canRoute(s: TerritoryState, id: string, edge: TerritoryMap['edges'][number]): boolean {
  if (s.routes[edge.id]) return false;
  const { adjacent } = mapGraph(s.map);
  return [edge.a, edge.b].some(nodeId => {
    const building = s.buildings[nodeId];
    if (building) return building.ownerId === id;
    return adjacent.get(nodeId)!.some(link => link.kind === edge.kind && s.routes[link.id] === id);
  });
}

export function longestRoute(s: TerritoryState, ownerId: string): number {
  const { adjacent } = mapGraph(s.map);
  const owned = s.map.edges.filter(edge => s.routes[edge.id] === ownerId);
  if (!owned.length) return 0;
  const used = new Set<string>();
  const walk = (nodeId: string, from: TerritoryMap['edges'][number]['kind'] | null): number => {
    const building = s.buildings[nodeId];
    if (from && building && building.ownerId !== ownerId) return 0;
    let best = 0;
    for (const edge of adjacent.get(nodeId)!) {
      if (s.routes[edge.id] !== ownerId || used.has(edge.id) || (from && from !== edge.kind && building?.ownerId !== ownerId)) continue;
      used.add(edge.id);
      best = Math.max(best, 1 + walk(edge.a === nodeId ? edge.b : edge.a, edge.kind));
      used.delete(edge.id);
    }
    return best;
  };
  return Math.max(...owned.map(edge => Math.max(walk(edge.a, null), walk(edge.b, null))));
}
