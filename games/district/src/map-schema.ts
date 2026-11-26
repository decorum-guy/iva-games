export const DISTRICT_CONTENT_VERSION = 'district-maps@0.1' as const;
export const DISTRICT_ISLAND_CONTENT_VERSION = 'district-maps@0.2' as const;

/** Map data contains layout and presentation only. Rules remain in the versioned core. */
export interface LegacyDistrictMap {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  version: string;
  name: { ru: string; en: string };
  description: { ru: string; en: string };
  width: number;
  height: number;
  rows: string[];
  supportedPlayers: number[];
}

export type DistrictCellKind = 'lot' | 'neutral-house' | 'park' | 'square';
export interface DistrictPoint { x: number; y: number }
interface AxialCell { id: string; q: number; r: number; kind: DistrictCellKind }
interface DistrictZone { id: string; name: { ru: string; en: string }; cells: string[] }
interface IslandDefinition extends Omit<LegacyDistrictMap, 'schemaVersion' | 'width' | 'height' | 'rows'> {
  schemaVersion: 2; profile: 'district@0.3'; theme: 'adriatic'; landmasses: number;
  cells: AxialCell[]; zones: DistrictZone[];
}
export interface DistrictHex extends AxialCell, DistrictPoint {
  neighborIds: string[]; zoneId: string; polygon: DistrictPoint[];
}
export interface IslandDistrictMap extends IslandDefinition {
  geometry: { hexes: DistrictHex[]; coastlines: DistrictPoint[][]; bounds: { x: number; y: number; width: number; height: number } };
}
export type DistrictMap = LegacyDistrictMap | IslandDistrictMap;

const hexKinds: ReadonlyArray<[DistrictCellKind, number]> = [['lot', 16], ['neutral-house', 4], ['park', 4], ['square', 1]];
const offsets = [[0, -42], [44, -21], [44, 21], [0, 42], [-44, 21], [-44, -21]] as const;
const directions = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]] as const;
const keys = ['$schema', 'schemaVersion', 'id', 'version', 'name', 'description', 'width', 'height', 'rows', 'supportedPlayers'];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function localized(value: unknown, max: number): boolean {
  return record(value) && Object.keys(value).length === 2 && ['ru', 'en'].every(language =>
    typeof value[language] === 'string' && (value[language] as string).trim().length > 0 &&
    (value[language] as string).length <= max && ![...(value[language] as string)].some(character => character.charCodeAt(0) < 32));
}

/** Returns human-readable authoring errors, never executes map-supplied code. */
export function districtMapErrors(value: unknown): string[] {
  if (!record(value)) return ['Map must be a JSON object.'];
  if (value.schemaVersion === 2) return checkIsland(value);
  const errors: string[] = [];
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`Unknown map field: ${key}.`);
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{1,47}$/.test(value.id)) errors.push('id must use 2–48 lowercase letters, digits and hyphens.');
  if (typeof value.version !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value.version)) errors.push('version must be a positive integer encoded as a string.');
  if (value.$schema !== undefined && value.$schema !== '../map.schema.json') errors.push('$schema must be ../map.schema.json when present.');
  if (!localized(value.name, 60)) errors.push('name needs nonempty ru/en strings, at most 60 characters each.');
  if (!localized(value.description, 240)) errors.push('description needs nonempty ru/en strings, at most 240 characters each.');
  if (value.width !== 5 || value.height !== 5) errors.push('The district@0.2 map profile requires a 5 × 5 board.');
  if (!Array.isArray(value.supportedPlayers) || JSON.stringify(value.supportedPlayers) !== '[2,3,4]') errors.push('The supported total seat counts must be [2,3,4].');
  if (!Array.isArray(value.rows) || value.rows.length !== 5 || value.rows.some(row => typeof row !== 'string' || !/^[.HPS]{5}$/.test(row))) {
    errors.push('rows must contain five rows of five symbols: . (lot), H (neutral house), P (park site), S (square).');
    return errors;
  }
  const rows = value.rows as string[];
  const cells = rows.join('');
  for (const [symbol, count] of [['.', 16], ['H', 4], ['P', 4], ['S', 1]] as const) {
    if ([...cells].filter(cell => cell === symbol).length !== count) errors.push(`The map needs exactly ${count} '${symbol}' cells.`);
  }
  const neighbors = (i: number): number[] => [i - 5, i + 5, ...(i % 5 ? [i - 1] : []), ...(i % 5 < 4 ? [i + 1] : [])].filter(j => j >= 0 && j < 25);
  const lots = [...cells].flatMap((cell, i) => cell === '.' ? [i] : []);
  // Necessary geometric conditions only: they do not establish competitive balance.
  if (lots.filter(i => neighbors(i).some(j => cells[j] === 'P')).length < 2) errors.push('Green goal needs two private lots next to park sites.');
  if (lots.filter(i => neighbors(i).every(j => cells[j] !== 'H')).length < 2) errors.push('Industry goal needs two private lots without adjacent neutral houses.');
  if (!lots.some(i => neighbors(i).some(j => cells[j] === '.')) || lots.length < 3) errors.push('Network goal needs adjacent private lots and room for another cafe.');
  return errors;
}

function connectedGroups(ids: ReadonlySet<string>, graph: ReadonlyMap<string, string[]>): Set<string>[] {
  const unseen = new Set(ids);
  const groups: Set<string>[] = [];
  for (const first of unseen) {
    const group = new Set([first]);
    groups.push(group);
    for (const id of group) {
      unseen.delete(id);
      for (const next of graph.get(id) ?? []) if (unseen.has(next)) group.add(next);
    }
  }
  return groups;
}

const coordKey = (q: number, r: number) => `${q},${r}`;
function hexGraph(cells: AxialCell[]): Map<string, string[]> {
  const byCoord = new Map(cells.map(cell => [coordKey(cell.q, cell.r), cell.id]));
  return new Map(cells.map(cell => [cell.id, directions.flatMap(([dq, dr]) => {
    const id = byCoord.get(coordKey(cell.q + dq, cell.r + dr));
    return id ? [id] : [];
  })]));
}

function checkIsland(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const allowed = ['$schema', 'schemaVersion', 'profile', 'theme', 'id', 'version', 'name', 'description', 'supportedPlayers', 'landmasses', 'cells', 'zones'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`Unknown map field: ${key}.`);
  if (value.$schema !== undefined && value.$schema !== '../map-islands.schema.json') errors.push('Invalid island schema reference.');
  if (value.profile !== 'district@0.3' || value.theme !== 'adriatic') errors.push('The island profile requires district@0.3 and the adriatic theme.');
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{1,47}$/.test(value.id)) errors.push('Invalid map id.');
  if (typeof value.version !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value.version)) errors.push('Invalid map version.');
  if (!localized(value.name, 60) || !localized(value.description, 240)) errors.push('Map names and descriptions require Russian and English.');
  if (JSON.stringify(value.supportedPlayers) !== '[2,3,4]') errors.push('The supported total seat counts must be [2,3,4].');
  if (!Number.isInteger(value.landmasses) || Number(value.landmasses) < 1 || Number(value.landmasses) > 5) errors.push('Specify one to five landmasses.');
  const axis = (coordinate: unknown) => typeof coordinate === 'number' && Number.isInteger(coordinate) && Math.abs(coordinate) <= 12;
  if (!Array.isArray(value.cells) || value.cells.length !== 25 || value.cells.some(cell => !record(cell) ||
    Object.keys(cell).length !== 4 || typeof cell.id !== 'string' || !/^[A-Z][A-Z0-9-]{0,7}$/.test(cell.id) ||
    !axis(cell.q) || !axis(cell.r) || !hexKinds.some(([kind]) => kind === cell.kind))) {
    return [...errors, 'Provide 25 valid cells with stable IDs, known kinds and integer q/r in [-12,12].'];
  }
  const cells = value.cells as AxialCell[];
  const ids = new Set(cells.map(cell => cell.id));
  if (ids.size !== cells.length || new Set(cells.map(cell => coordKey(cell.q, cell.r))).size !== cells.length) return [...errors, 'Each cell needs a unique id and axial coordinate.'];
  for (const [kind, count] of hexKinds) {
    if (cells.filter(cell => cell.kind === kind).length !== count) errors.push(`The map needs exactly ${count} ${kind} cells.`);
  }
  const graph = hexGraph(cells);
  if (connectedGroups(ids, graph).length !== value.landmasses) errors.push('The declared landmass count must match shared edges.');
  const byId = new Map(cells.map(cell => [cell.id, cell]));
  const neighbors = (cell: AxialCell) => graph.get(cell.id)!.map(id => byId.get(id)!);
  const lots = cells.filter(cell => cell.kind === 'lot');
  if (lots.filter(cell => neighbors(cell).some(next => next.kind === 'park')).length < 2) errors.push('Green goal needs two lots adjacent to parks.');
  if (lots.filter(cell => neighbors(cell).every(next => next.kind !== 'neutral-house')).length < 2) errors.push('Industry goal needs two lots without adjacent neutral houses.');
  if (lots.length < 3 || !lots.some(cell => neighbors(cell).some(next => next.kind === 'lot'))) errors.push('Network goal needs an adjacent lot pair and a third lot.');
  if (!Array.isArray(value.zones) || value.zones.length !== 5 || value.zones.some(zone => !record(zone) ||
    Object.keys(zone).length !== 3 || typeof zone.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(zone.id) ||
    !localized(zone.name, 60) || !Array.isArray(zone.cells) || !zone.cells.length ||
    zone.cells.some(id => !ids.has(id)))) return [...errors, 'Provide five named, nonempty zones made of known cells.'];
  const zones = value.zones as DistrictZone[];
  const zoneCells = zones.flatMap(zone => zone.cells);
  if (new Set(zones.map(zone => zone.id)).size !== 5 || zoneCells.length !== cells.length || new Set(zoneCells).size !== cells.length) {
    errors.push('Zones need unique IDs and must partition all cells.');
  }
  for (const zone of zones) if (connectedGroups(new Set(zone.cells), graph).length !== 1) errors.push(`Zone ${zone.id} must be connected.`);
  return errors;
}

/** Exposed edges run clockwise around land. Internal sides never acquire a shoreline. */
function normalizeIsland(map: IslandDefinition): IslandDistrictMap {
  const graph = hexGraph(map.cells);
  const zones = new Map(map.zones.flatMap(zone => zone.cells.map(id => [id, zone.id] as const)));
  const coordinates = new Set(map.cells.map(cell => coordKey(cell.q, cell.r)));
  const boundary = new Map<string, DistrictPoint>();
  const hexes = map.cells.map(cell => {
    const x = 44 * (2 * cell.q + cell.r), y = 63 * cell.r;
    const polygon = offsets.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
    directions.forEach(([dq, dr], side) => {
      if (coordinates.has(coordKey(cell.q + dq, cell.r + dr))) return;
      const first = polygon[side], next = polygon[(side + 1) % 6];
      boundary.set(coordKey(first.x, first.y), next);
    });
    return { ...cell, x, y, polygon, neighborIds: graph.get(cell.id)!, zoneId: zones.get(cell.id)! };
  });
  const coastlines: DistrictPoint[][] = [];
  for (const [start] of boundary) {
    const [x, y] = start.split(',').map(Number);
    const outline = [{ x, y }];
    coastlines.push(outline);
    let key = start;
    do {
      const next = boundary.get(key);
      if (!next) throw new Error('Invalid District coastline.');
      boundary.delete(key);
      key = coordKey(next.x, next.y);
      if (key !== start) outline.push(next);
    } while (key !== start);
  }
  const points = hexes.flatMap(hex => hex.polygon);
  const x = Math.min(...points.map(point => point.x)) - 55;
  const y = Math.min(...points.map(point => point.y)) - 55;
  const width = Math.max(...points.map(point => point.x)) + 55 - x;
  const height = Math.max(...points.map(point => point.y)) + 65 - y;
  return { ...map, geometry: { hexes, coastlines, bounds: { x, y, width, height } } };
}

export function parseDistrictMap(value: unknown): DistrictMap {
  const errors = districtMapErrors(value);
  if (errors.length) throw new Error(`Invalid District map: ${errors.join(' ')}`);
  const map = structuredClone(value) as LegacyDistrictMap | IslandDefinition;
  return map.schemaVersion === 2 ? normalizeIsland(map) : map;
}

export function validateDistrictMapCatalog(values: unknown[]): DistrictMap[] {
  if (!values.length) throw new Error('District needs at least one map.');
  const identities = new Set<string>();
  const profiles = new Map<string, number>();
  return values.map(value => {
    const map = parseDistrictMap(value);
    const key = `${map.id}@${map.version}`;
    if (identities.has(key)) throw new Error(`Duplicate District map: ${key}.`);
    if (profiles.has(map.id) && profiles.get(map.id) !== map.schemaVersion) throw new Error(`Map id spans incompatible profiles: ${map.id}.`);
    identities.add(key);
    profiles.set(map.id, map.schemaVersion);
    return map;
  });
}
