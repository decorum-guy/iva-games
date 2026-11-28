import { describe, expect, it } from 'vitest';
import azure from '../maps/territorial/azure-bay.2.json';
import four from '../maps/territorial/four-islands.2.json';
import { getTerritoryMap, territoryMaps, validateTerritoryMap } from '../src/territorial/maps';

describe('district@0.4 territorial geography', () => {
  it('pins separate room-compatible IDs and map versions', () => {
    expect(territoryMaps.map(map => [map.id, map.version, map.landmasses, map.tiles.length])).toEqual([
      ['azure-bay', '2', 1, 20], ['longwater', '1', 1, 51], ['two-shores', '2', 2, 22], ['four-islands', '2', 4, 20],
    ]);
    expect(() => getTerritoryMap('azure-bay', '1')).toThrow();
    const snapshot = getTerritoryMap('azure-bay', '2');
    snapshot.sectors[0].name.en = 'Changed';
    expect(getTerritoryMap('azure-bay').sectors[0].name.en).toBe('Pine Cape');
  });
  it.each(territoryMaps)('$id pins one sector per target and all resources, exposures, ports and sea routes', map => {
    const sectors = map.sectors.map(sector => sector.id);
    for (const item of [...map.nodes, ...map.edges, ...map.ports]) {
      expect(sectors.filter(id => id === item.eventSectorId)).toHaveLength(1);
    }
    expect(new Set(map.tiles.map(tile => tile.resource)).size).toBe(5);
    expect(new Set(map.nodes.flatMap(node => node.exposureTags))).toEqual(new Set(['woodland', 'coastal', 'floodplain']));
    expect(map.edges.some(edge => edge.kind === 'sea')).toBe(true);
    expect(map.ports.some(port => port.resource === null)).toBe(true);
    for (const tile of map.tiles) {
      expect(new Set(tile.nodeIds).size).toBe(6);
      for (const id of tile.nodeIds) expect(map.nodes.find(node => node.id === id)?.tileIds).toContain(tile.id);
    }
    for (const sector of map.sectors) expect(sector.polygon.length).toBeGreaterThanOrEqual(6);
  });
  it('accepts a fourth geography from map data alone', () => {
    const cove = structuredClone(azure);
    cove.id = 'heron-cove';
    cove.name = { ru: 'Бухта цапли', en: 'Heron Cove' };
    cove.sectors[0].tiles.push([4, -1, 'grain', 4, []]);
    const result = validateTerritoryMap(cove);
    expect(result.tiles).toHaveLength(21);
    expect(result.height).toBeGreaterThan(getTerritoryMap('azure-bay').height);
    expect(territoryMaps.some(map => map.id === result.id)).toBe(false);
  });
  it('rejects unreachable islands, duplicate corners and inland or crossing sea routes', () => {
    const isolated = structuredClone(four);
    isolated.ferries = isolated.ferries.filter(f => f.a[1] !== 4 && f.b[0] !== -2);
    expect(() => validateTerritoryMap(isolated)).toThrow(/unreachable/);
    const duplicate = structuredClone(azure);
    duplicate.sectors[0].tiles.push(duplicate.sectors[0].tiles[0]);
    expect(() => validateTerritoryMap(duplicate)).toThrow(/duplicate terrain/);
    const inland = structuredClone(azure);
    inland.ferries[0].a = [1, 1, 5];
    expect(() => validateTerritoryMap(inland)).toThrow(/coastal/);
    const crossing = structuredClone(four);
    crossing.ferries.push({ a: [-1, 4, 0], b: [4, 1, 3], eventSectorId: 'cinder' });
    expect(() => validateTerritoryMap(crossing)).toThrow(/crosses/);
  });
});
