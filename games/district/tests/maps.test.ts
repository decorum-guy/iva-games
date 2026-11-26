import type { LegacyDistrictMap } from '../src/maps';
import { describe, expect, it } from 'vitest';
import { DISTRICT_MAPS, districtMapErrors, getDistrictMap, resolveDistrictMapSettings, validateDistrictMapCatalog } from '../src/maps';

describe('District map catalog', () => {
  it('discovers every shipped map, including the unmodified normative layout', () => {
    expect(DISTRICT_MAPS.length).toBeGreaterThanOrEqual(3);
    expect((getDistrictMap('crossroads', '1') as LegacyDistrictMap).rows).toEqual(['..P..', '..H..', 'PHSHP', '..H..', '..P..']);
    for (const map of DISTRICT_MAPS) expect(districtMapErrors(map)).toEqual([]);
    const launchMaps = ['crossroads', 'boulevard', 'gardens'].map(id => getDistrictMap(id, '1') as LegacyDistrictMap);
    expect(new Set(launchMaps.map(map => map.rows.join(''))).size).toBe(3);
  });
  it('pins both identity and version and never shares mutable map state', () => {
    expect(resolveDistrictMapSettings({})).toEqual({ mapId: 'crossroads', mapVersion: '1' });
    expect(resolveDistrictMapSettings({ mapId: 'gardens' })).toEqual({ mapId: 'gardens', mapVersion: '1' });
    const map = getDistrictMap('crossroads', '1') as LegacyDistrictMap; map.rows[0] = '.....';
    expect((getDistrictMap('crossroads', '1') as LegacyDistrictMap).rows[0]).toBe('..P..');
    expect(() => getDistrictMap('crossroads', '999')).toThrow();
    expect(() => resolveDistrictMapSettings({ timer: 1 })).toThrow();
    expect(() => resolveDistrictMapSettings({ mapVersion: '1' })).toThrow();
  });
  it('rejects unsupported mechanics, malformed layouts and duplicate versions', () => {
    const map = (getDistrictMap('crossroads') as LegacyDistrictMap);
    expect(districtMapErrors({ ...map, script: 'any code' })).not.toEqual([]);
    expect(districtMapErrors({ ...map, rows: ['.....'] })).not.toEqual([]);
    expect(districtMapErrors({ ...map, supportedPlayers: [2, 3, 4, 5, 6] })).not.toEqual([]);
    expect(districtMapErrors({ ...map, rows: ['.....', '.....', '..S..', '.....', '.....'] })).not.toEqual([]);
    expect(() => validateDistrictMapCatalog([map, map])).toThrow(/Duplicate/);
    // A metadata correction is a new version, even when its geometry stays the same.
    expect(validateDistrictMapCatalog([map, { ...map, version: '2' }])).toHaveLength(2);
    expect(() => validateDistrictMapCatalog([])).toThrow();
  });
});
