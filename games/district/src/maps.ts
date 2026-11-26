import { validateDistrictMapCatalog } from './map-schema';
import type { IslandDistrictMap, LegacyDistrictMap } from './map-schema';
export type { DistrictMap, IslandDistrictMap, LegacyDistrictMap, DistrictPoint } from './map-schema';
export { districtMapErrors, parseDistrictMap, validateDistrictMapCatalog } from './map-schema';

export { DISTRICT_CONTENT_VERSION, DISTRICT_ISLAND_CONTENT_VERSION } from './map-schema';
export const DEFAULT_DISTRICT_MAP_ID = 'crossroads';
export const DEFAULT_ISLAND_MAP_ID = 'azure-bay';

// Vite includes every JSON map in both the server and the client build.
const files = import.meta.glob('../maps/*.json', { eager: true, import: 'default' });
const catalog = validateDistrictMapCatalog(Object.values(files));
export const DISTRICT_MAPS = catalog.filter((map): map is LegacyDistrictMap => map.schemaVersion === 1).sort((a, b) =>
  Number(b.id === DEFAULT_DISTRICT_MAP_ID) - Number(a.id === DEFAULT_DISTRICT_MAP_ID) ||
  a.id.localeCompare(b.id) || Number(b.version) - Number(a.version));
export const DISTRICT_ISLAND_MAPS = catalog.filter((map): map is IslandDistrictMap => map.schemaVersion === 2).sort((a, b) =>
  a.landmasses - b.landmasses || a.id.localeCompare(b.id) || Number(b.version) - Number(a.version));
export const DISTRICT_MAP_CATALOG = [...DISTRICT_MAPS, ...DISTRICT_ISLAND_MAPS];

/** Return a copy: a room or game must never mutate the shared catalog. */
export function getDistrictMap(mapId: string, mapVersion?: string) {
  const map = DISTRICT_MAP_CATALOG.find(item => item.id === mapId && (mapVersion === undefined || item.version === mapVersion));
  if (!map) throw new Error('DISTRICT_MAP_UNAVAILABLE');
  return structuredClone(map);
}

export function resolveDistrictMapSettings(input: unknown, schemaVersion: 1 | 2 = 1): { mapId: string; mapVersion: string } {
  if (input === undefined) input = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_DISTRICT_SETTINGS');
  const settings = input as Record<string, unknown>;
  if (Object.keys(settings).some(key => !['mapId', 'mapVersion'].includes(key)) ||
    (settings.mapId !== undefined && typeof settings.mapId !== 'string') ||
    (settings.mapVersion !== undefined && typeof settings.mapVersion !== 'string') ||
    (settings.mapVersion !== undefined && settings.mapId === undefined)) throw new Error('INVALID_DISTRICT_SETTINGS');
  const defaultId = schemaVersion === 1 ? DEFAULT_DISTRICT_MAP_ID : DEFAULT_ISLAND_MAP_ID;
  const map = getDistrictMap((settings.mapId as string | undefined) ?? defaultId, settings.mapVersion as string | undefined);
  if (map.schemaVersion !== schemaVersion) throw new Error('DISTRICT_MAP_UNAVAILABLE');
  return { mapId: map.id, mapVersion: map.version };
}
