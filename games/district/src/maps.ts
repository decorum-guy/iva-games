import { validateDistrictMapCatalog } from './map-schema';
export type { DistrictMap } from './map-schema';
export { districtMapErrors, parseDistrictMap, validateDistrictMapCatalog } from './map-schema';

export { DISTRICT_CONTENT_VERSION } from './map-schema';
export const DEFAULT_DISTRICT_MAP_ID = 'crossroads';

// Vite includes every JSON map in both the server and the client build. No hand-edited registry.
const files = import.meta.glob('../maps/*.json', { eager: true, import: 'default' });
export const DISTRICT_MAPS = validateDistrictMapCatalog(Object.values(files)).sort((a, b) =>
  Number(b.id === DEFAULT_DISTRICT_MAP_ID) - Number(a.id === DEFAULT_DISTRICT_MAP_ID) ||
  a.id.localeCompare(b.id) || Number(b.version) - Number(a.version));

/** Return a copy: a room or game must never mutate the shared catalog. */
export function getDistrictMap(mapId: string, mapVersion?: string) {
  const map = DISTRICT_MAPS.find(item => item.id === mapId && (mapVersion === undefined || item.version === mapVersion));
  if (!map) throw new Error('DISTRICT_MAP_UNAVAILABLE');
  return structuredClone(map);
}

export function resolveDistrictMapSettings(input: unknown): { mapId: string; mapVersion: string } {
  if (input === undefined) input = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_DISTRICT_SETTINGS');
  const settings = input as Record<string, unknown>;
  if (Object.keys(settings).some(key => !['mapId', 'mapVersion'].includes(key)) ||
    (settings.mapId !== undefined && typeof settings.mapId !== 'string') ||
    (settings.mapVersion !== undefined && typeof settings.mapVersion !== 'string') ||
    (settings.mapVersion !== undefined && settings.mapId === undefined)) throw new Error('INVALID_DISTRICT_SETTINGS');
  const map = getDistrictMap((settings.mapId as string | undefined) ?? DEFAULT_DISTRICT_MAP_ID, settings.mapVersion as string | undefined);
  return { mapId: map.id, mapVersion: map.version };
}
