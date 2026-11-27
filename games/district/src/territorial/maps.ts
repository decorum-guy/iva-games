// Coordinates and vertex identities are integers on the axial lattice. The
// projection into board space happens only after every shared corner is joined.
export type Resource = 'wood' | 'brick' | 'grain' | 'wool' | 'ore';
export type Exposure = 'coastal' | 'floodplain' | 'woodland';
export interface Point { x: number; y: number }
interface LocalName { ru: string; en: string }
export interface TerritoryTile extends Point {
  id: string;
  resource: Resource | null;
  number: number | null;
  nodeIds: string[];
}
export interface TerritoryNode extends Point {
  id: string;
  eventSectorId: string;
  exposureTags: Exposure[];
  tileIds: string[];
}
export interface TerritoryEdge {
  id: string;
  a: string;
  b: string;
  kind: 'land' | 'sea';
  eventSectorId: string;
}
export interface TerritorySector {
  id: string;
  name: LocalName;
  polygon: Point[];
}
export interface TerritoryPort {
  id: string;
  nodeId: string;
  eventSectorId: string;
  resource: Resource | null;
}
export interface TerritoryMap {
  schemaVersion: 3;
  profile: 'district@0.4';
  id: string;
  version: string;
  name: LocalName;
  supportedPlayers: number[];
  landmasses: number;
  nodes: TerritoryNode[];
  edges: TerritoryEdge[];
  tiles: TerritoryTile[];
  sectors: TerritorySector[];
  ports: TerritoryPort[];
  width: number;
  height: number;
}

const corners = [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]] as const;
const resources: Resource[] = ['wood', 'brick', 'grain', 'wool', 'ore'];
const allowedNumbers = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const slug = /^[a-z][a-z0-9-]{1,47}$/;
const key = (q: number, r: number) => `${q}_${r}`;
const segment = (a: string, b: string) => [a, b].sort().join('~');
function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid territory map: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
  need(value && typeof value === 'object' && !Array.isArray(value), 'expected object');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  need(Array.isArray(value), 'expected array');
  return value;
}
function name(value: unknown): LocalName {
  const item = object(value);
  for (const language of ['ru', 'en']) {
    const label = item[language];
    need(typeof label === 'string' && label.trim().length > 0 && label.length <= 80, 'missing localized name');
  }
  return { ru: item.ru as string, en: item.en as string };
}
function identifier(value: unknown): string {
  need(typeof value === 'string' && slug.test(value), 'invalid id');
  return value;
}
function grid(value: unknown): number {
  need(typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 100, 'invalid axial coordinate');
  return value;
}

function direction(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function onSegment(a: Point, b: Point, p: Point) {
  return direction(a, b, p) === 0 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
    && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
  return direction(a, b, c) * direction(a, b, d) < 0 && direction(c, d, a) * direction(c, d, b) < 0;
}

function outline(tiles: TerritoryTile[], nodes: Map<string, TerritoryNode>) {
  const boundary = new Map<string, [string, string]>();
  for (const tile of tiles) {
    tile.nodeIds.forEach((a, index) => {
      const b = tile.nodeIds[(index + 1) % 6];
      const id = segment(a, b);
      if (!boundary.delete(id)) boundary.set(id, [a, b]);
    });
  }
  const next = new Map([...boundary.values()]);
  need(boundary.size && boundary.size === next.size, 'sector sides must form one simple outline');
  const first = next.keys().next().value!;
  let cursor = first;
  const points: Point[] = [];
  do {
    const node = nodes.get(cursor)!;
    points.push({ x: node.x, y: node.y });
    const to = next.get(cursor);
    need(to, 'broken sector outline');
    next.delete(cursor);
    cursor = to;
  } while (cursor !== first);
  need(next.size === 0, 'sector has a hole or disconnected land');
  return points;
}

function componentCount(nodes: TerritoryNode[], edges: TerritoryEdge[]) {
  const neighbors = new Map(nodes.map(node => [node.id, [] as string[]]));
  for (const edge of edges) {
    neighbors.get(edge.a)!.push(edge.b);
    neighbors.get(edge.b)!.push(edge.a);
  }
  const unseen = new Set(neighbors.keys());
  let count = 0;
  for (const root of unseen) {
    const stack = [root];
    count++;
    while (stack.length) {
      const node = stack.pop()!;
      if (unseen.delete(node)) stack.push(...neighbors.get(node)!);
    }
  }
  return count;
}

/** Compile and validate authored geography before adding it to a room. */
export function validateTerritoryMap(input: unknown): TerritoryMap {
  const data = object(input);
  need(data.schemaVersion === 3 && data.profile === 'district@0.4', 'unsupported schema/profile');
  const id = identifier(data.id);
  need(typeof data.version === 'string' && /^[1-9][0-9]{0,5}$/.test(data.version), 'invalid version');
  need(JSON.stringify(data.supportedPlayers) === '[2,3,4]', 'supportedPlayers must be [2,3,4]');
  need(typeof data.landmasses === 'number' && Number.isInteger(data.landmasses) && data.landmasses > 0, 'invalid landmasses');
  const nodeById = new Map<string, TerritoryNode>();
  const tileById = new Map<string, TerritoryTile>();
  const tileSector = new Map<string, string>();
  const edgeByPair = new Map<string, TerritoryEdge>();
  const tileSides = new Map<string, number>();
  const sectorDefinitions = new Map<string, LocalName>();
  for (const entry of array(data.sectors)) {
    const sector = object(entry);
    const sectorId = identifier(sector.id);
    need(!sectorDefinitions.has(sectorId), 'duplicate sector id');
    sectorDefinitions.set(sectorId, name(sector.name));
    for (const item of array(sector.tiles)) {
      const [qValue, rValue, resource, token, tagValues] = array(item);
      const q = grid(qValue), r = grid(rValue);
      const tileId = 't' + key(q, r);
      need(!tileById.has(tileId), 'duplicate terrain coordinates');
      need(resources.includes(resource as Resource) || resource === null, 'invalid terrain');
      need(resource === null ? token === null : allowedNumbers.includes(token as number), 'invalid production number');
      const tags = array(tagValues);
      need(tags.every(tag => tag === 'floodplain' || tag === 'woodland'), 'invalid inland exposure');
      const x = q * 2 + r, y = r * 3;
      const nodeIds = corners.map(([dx, dy]) => {
        const nodeId = 'v' + key(x + dx, y + dy);
        let node = nodeById.get(nodeId);
        if (!node) {
          node = { id: nodeId, x: x + dx, y: y + dy, eventSectorId: sectorId, exposureTags: [], tileIds: [] };
          nodeById.set(nodeId, node);
        }
        node.tileIds.push(tileId);
        const applied = new Set<Exposure>(node.exposureTags);
        for (const tag of tags) applied.add(tag as Exposure);
        if (resource === 'wood') applied.add('woodland');
        node.exposureTags = [...applied];
        return nodeId;
      });
      const tile = { id: tileId, x, y, resource: resource as Resource | null, number: token as number | null, nodeIds };
      tileById.set(tileId, tile);
      tileSector.set(tileId, sectorId);
      nodeIds.forEach((a, index) => {
        const b = nodeIds[(index + 1) % 6];
        const edgeId = segment(a, b);
        tileSides.set(edgeId, (tileSides.get(edgeId) ?? 0) + 1);
        if (!edgeByPair.has(edgeId)) edgeByPair.set(edgeId, { id: 'r' + edgeId, a, b, kind: 'land', eventSectorId: sectorId });
      });
    }
  }
  const tiles = [...tileById.values()];
  const nodes = [...nodeById.values()];
  need(sectorDefinitions.size >= 2, 'at least two sectors required');
  need(resources.every(resource => tiles.some(tile => tile.resource === resource)), 'map lacks a production resource');
  const coastal = new Set<string>();
  for (const [pair, incidence] of tileSides) {
    if (incidence !== 1) continue;
    const edge = edgeByPair.get(pair)!;
    coastal.add(edge.a);
    coastal.add(edge.b);
  }
  for (const node of nodes) if (coastal.has(node.id)) node.exposureTags.push('coastal');
  need(nodes.some(node => node.exposureTags.includes('floodplain')), 'missing floodplain geography');
  const edges = [...edgeByPair.values()];
  need(componentCount(nodes, edges) === data.landmasses, 'wrong number of landmasses');
  function endpoint(value: unknown) {
    const [q, r, i] = array(value);
    const tile = tileById.get('t' + key(grid(q), grid(r)));
    need(tile && typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < 6, 'invalid corner reference');
    const node = nodeById.get(tile.nodeIds[i])!;
    need(coastal.has(node.id), 'port and sea endpoints must be coastal');
    return node;
  }
  for (const entry of array(data.ferries)) {
    const ferry = object(entry);
    const a = endpoint(ferry.a), b = endpoint(ferry.b);
    const pair = segment(a.id, b.id);
    const sectorId = identifier(ferry.eventSectorId);
    need(a.id !== b.id && !edgeByPair.has(pair) && sectorDefinitions.has(sectorId), 'invalid or duplicate ferry');
    need(!nodes.some(n => n !== a && n !== b && onSegment(a, b, n)), 'ferry passes through a node');
    for (const edge of edges) {
      if ([a.id, b.id].includes(edge.a) || [a.id, b.id].includes(edge.b)) continue;
      need(!intersects(a, b, nodeById.get(edge.a)!, nodeById.get(edge.b)!), 'ferry crosses an existing route');
    }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    need(!tiles.some(tile => tile.nodeIds.every((p, i) =>
      direction(nodeById.get(p)!, nodeById.get(tile.nodeIds[(i + 1) % 6])!, mid) > 0)), 'ferry runs over land');
    const edge: TerritoryEdge = { id: 's' + pair, a: a.id, b: b.id, kind: 'sea', eventSectorId: sectorId };
    edges.push(edge);
    edgeByPair.set(pair, edge);
  }
  need(componentCount(nodes, edges) === 1, 'an island is unreachable');
  const ports: TerritoryPort[] = [];
  for (const entry of array(data.ports)) {
    const port = object(entry);
    const node = endpoint(port.at);
    need(!ports.some(other => other.nodeId === node.id), 'duplicate port');
    need(port.resource === null || resources.includes(port.resource as Resource), 'invalid port resource');
    ports.push({ id: 'p' + node.id, nodeId: node.id, eventSectorId: node.eventSectorId, resource: port.resource as Resource | null });
  }
  need(ports.length >= 2 && edges.some(edge => edge.kind === 'sea'), 'news requires ports and a sea route');
  // Build a witness for the eight mutually separated, productive opening plots.
  const occupied = new Set<string>();
  let openSites = 0;
  for (const node of nodes) {
    if (occupied.has(node.id) || !node.tileIds.some(tileId => tileById.get(tileId)!.resource)) continue;
    openSites++;
    occupied.add(node.id);
    for (const edge of edges) {
      if (edge.a === node.id) occupied.add(edge.b);
      if (edge.b === node.id) occupied.add(edge.a);
    }
  }
  need(openSites >= 8, 'insufficient separated opening plots for four seats');
  const minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y));
  for (const item of [...nodes, ...tiles]) {
    item.x = (item.x - minX) * 44 + 36;
    item.y = (item.y - minY) * 20 + 36;
  }
  const sectors = [...sectorDefinitions].map(([sectorId, label]) => ({
    id: sectorId, name: label, polygon: outline(tiles.filter(tile => tileSector.get(tile.id) === sectorId), nodeById),
  }));
  return { schemaVersion: 3, profile: 'district@0.4', id, version: data.version, name: name(data.name), supportedPlayers: [2, 3, 4],
    landmasses: data.landmasses, nodes, edges, tiles, sectors, ports,
    width: Math.max(...nodes.map(node => node.x)) + 36, height: Math.max(...nodes.map(node => node.y)) + 36 };
}

const files = import.meta.glob('../../maps/territorial/*.json', { eager: true, import: 'default' });
export const territoryMaps = Object.values(files).map(validateTerritoryMap)
  .sort((a, b) => a.landmasses - b.landmasses || a.id.localeCompare(b.id) || Number(b.version) - Number(a.version));
need(new Set(territoryMaps.map(map => map.id + '@' + map.version)).size === territoryMaps.length, 'duplicate map version');

export function getTerritoryMap(id: string, version?: string): TerritoryMap {
  const match = territoryMaps.find(map => map.id === id && (version === undefined || map.version === version));
  if (!match) throw new Error('DISTRICT_MAP_UNAVAILABLE');
  return structuredClone(match);
}
