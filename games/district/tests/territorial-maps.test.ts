import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { applyTerritory, createTerritory, currentId, viewTerritory } from '../src/territorial/core';
import { COSTS, emptyStock } from '../src/territorial/types';
import azure from '../maps/territorial/azure-bay.2.json';
import four from '../maps/territorial/four-islands.2.json';
import { getTerritoryMap, territoryMaps, validateTerritoryMap } from '../src/territorial/maps';

describe('district@0.4 territorial geography', () => {
  it('pins separate room-compatible IDs and map versions', () => {
    expect(territoryMaps.map(map => [map.id, map.version, map.landmasses, map.tiles.length])).toEqual([
      ['azure-bay', '2', 1, 20], ['longwater', '1', 1, 48], ['lantern-strait', '1', 2, 49],
      ['two-shores', '2', 2, 22], ['kite-isles', '1', 3, 48], ['four-islands', '2', 4, 20],
    ]);
    expect(() => getTerritoryMap('azure-bay', '1')).toThrow();
    const snapshot = getTerritoryMap('azure-bay', '2');
    snapshot.sectors[0].name.en = 'Changed';
    expect(getTerritoryMap('azure-bay').sectors[0].name.en).toBe('Pine Cape');
  });
  it('keeps the full shipped v0.4 map snapshots, including reader coordinates', () => {
    const shipped = {
      'azure-bay': '23adeff8d8e9657eaf1198f1b84d54fe471f5ca98e90f1d69ab24ff14db049c7',
      'two-shores': '8d6a95fda48792b321f4749b8e5455fce2b67d50092e08a736ae60a7a6e270e8',
      'four-islands': '85d5c4c43ad2ed096a0fc15e289f00fd38f4c4eaf704ec085605b5488838dc3b',
    };
    for (const [id, digest] of Object.entries(shipped)) {
      expect(createHash('sha256').update(JSON.stringify(getTerritoryMap(id, '2'))).digest('hex')).toBe(digest);
    }
  });
  it.each(territoryMaps)('$id pins one sector per target and all resources, exposures, ports and sea routes', map => {
    const sectors = map.sectors.map(sector => sector.id);
    for (const item of [...map.nodes, ...map.edges, ...map.ports]) {
      expect(sectors.filter(id => id === item.eventSectorId)).toHaveLength(1);
    }
    expect(new Set(map.tiles.map(tile => tile.resource).filter(Boolean)).size).toBe(5);
    expect(new Set(map.nodes.flatMap(node => node.exposureTags))).toEqual(new Set(['woodland', 'coastal', 'floodplain']));
    expect(map.edges.some(edge => edge.kind === 'sea')).toBe(true);
    expect(map.ports.some(port => port.resource === null)).toBe(true);
    for (const tile of map.tiles) {
      expect(new Set(tile.nodeIds).size).toBe(6);
      for (const id of tile.nodeIds) expect(map.nodes.find(node => node.id === id)?.tileIds).toContain(tile.id);
    }
    for (const sector of map.sectors) expect(sector.polygon.length).toBeGreaterThanOrEqual(6);
  });
  it.each(['longwater', 'lantern-strait', 'kite-isles'])('%s supports each maritime crossing and each port rate', mapId => {
    const map = getTerritoryMap(mapId);
    const bare = map.tiles.filter(tile => tile.resource === null);
    expect(bare).toHaveLength(mapId === 'longwater' ? 1 : 2);
    expect(bare.every(tile => tile.number === null)).toBe(true);
    const nodes = new Map(map.nodes.map(node => [node.id, node]));
    for (const edge of map.edges.filter(item => item.kind === 'land')) {
      const a = nodes.get(edge.a)!, b = nodes.get(edge.b)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(42);
    }
    const yieldByResource = new Map<string, number>();
    const countByResource = new Map<string, number>();
    const hotNodes = new Set<string>();
    for (const tile of map.tiles) {
      if (tile.resource === null || tile.number === null) continue;
      yieldByResource.set(tile.resource, (yieldByResource.get(tile.resource) ?? 0) + 6 - Math.abs(7 - tile.number));
      countByResource.set(tile.resource, (countByResource.get(tile.resource) ?? 0) + 1);
      if (tile.number === 6 || tile.number === 8) {
        expect(tile.nodeIds.every(node => !hotNodes.has(node))).toBe(true);
        tile.nodeIds.forEach(node => hotNodes.add(node));
      }
    }
    const spread = (totals: Map<string, number>) => Math.max(...totals.values()) - Math.min(...totals.values());
    expect(spread(yieldByResource)).toBeLessThanOrEqual(2);
    expect(spread(countByResource)).toBeLessThanOrEqual(1);
    const participants = ['a', 'b'].map((id, seatIndex) => ({
      participantId: id, seatIndex, displayName: id, playerId: id, controller: { kind: 'human' as const, playerId: id },
    }));
    const start = () => createTerritory({ matchId: 'coast', roomId: 'coast', participants, map, seed: mapId, now: 0, preset: 'medium' });
    for (const edge of map.edges.filter(item => item.kind === 'sea')) {
      const state = start();
      const id = currentId(state);
      const opening = applyTerritory(state, id, { type: 'place', nodeId: edge.a }, 1);
      opening.phase = 'play';
      opening.players[id].hand = { ...emptyStock(), ...COSTS.sea };
      const built = applyTerritory(opening, id, { type: 'route', edgeId: edge.id }, 2);
      expect(built.routes[edge.id]).toBe(id);
      expect(built.players[id].hand).toEqual(emptyStock());
    }
    for (const port of map.ports) {
      const state = start();
      const id = currentId(state);
      const opening = applyTerritory(state, id, { type: 'place', nodeId: port.nodeId }, 1);
      opening.phase = 'play';
      expect(viewTerritory(opening, id, 2).legal.bank[port.resource ?? 'wood']).toBe(port.resource ? 2 : 3);
    }
  });
  it('accepts a further geography from map data alone', () => {
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
