import { describe, expect, it } from 'vitest';
import { DISTRICT_MAPS, districtMapErrors, getDistrictMap, resolveDistrictMapSettings, validateDistrictMapCatalog } from '../src/maps';

describe('District map catalog', () => {
  it('discovers every shipped map, including the unmodified normative layout', () => {
    expect(DISTRICT_MAPS.length).toBeGreaterThanOrEqual(3);
    expect(getDistrictMap('crossroads', '1').rows).toEqual(['..P..', '..H..', 'PHSHP', '..H..', '..P..']);
    for (const map of DISTRICT_MAPS) expect(districtMapErrors(map)).toEqual([]);
    expect(new Set(DISTRICT_MAPS.map(map => map.rows.join(''))).size).toBe(DISTRICT_MAPS.length);
  });
  it('pins both identity and version and never shares mutable map state', () => {
    expect(resolveDistrictMapSettings({})).toEqual({ mapId: 'crossroads', mapVersion: '1' });
    expect(resolveDistrictMapSettings({ mapId: 'gardens' })).toEqual({ mapId: 'gardens', mapVersion: '1' });
    const map = getDistrictMap('crossroads', '1'); map.rows[0] = '.....';
    expect(getDistrictMap('crossroads', '1').rows[0]).toBe('..P..');
    expect(() => getDistrictMap('crossroads', '999')).toThrow();
    expect(() => resolveDistrictMapSettings({ timer: 1 })).toThrow();
    expect(() => resolveDistrictMapSettings({ mapVersion: '1' })).toThrow();
  });
  it('rejects unsupported mechanics, malformed layouts and duplicate versions', () => {
    const map = getDistrictMap('crossroads');
    expect(districtMapErrors({ ...map, script: 'any code' })).not.toEqual([]);
    expect(districtMapErrors({ ...map, rows: ['.....'] })).not.toEqual([]);
    expect(districtMapErrors({ ...map, supportedPlayers: [2, 3, 4, 5, 6] })).not.toEqual([]);
    expect(districtMapErrors({ ...map, rows: ['.....', '.....', '..S..', '.....', '.....'] })).not.toEqual([]);
    expect(() => validateDistrictMapCatalog([map, map])).toThrow(/Duplicate/);
    expect(() => validateDistrictMapCatalog([])).toThrow();
  });
});
