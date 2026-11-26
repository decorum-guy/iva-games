import { describe, expect, it } from 'vitest';
import type { Participant } from '@iva-games/session-kit';
import azure from '../maps/azure-bay.1.json';
import cormorant from './fixtures/cormorant-cove.1.json';
import { adjacentCells, advanceDistrictTime, createDistrictState, incomeForCell, isDistrictRoadworksCell } from '../src/core';
import { DISTRICT_ISLAND_MAPS, districtMapErrors, parseDistrictMap, validateDistrictMapCatalog } from '../src/maps';
import type { DistrictPoint } from '../src/maps';

function edges(polygon: DistrictPoint[]) {
  return polygon.map((point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return [point, next].map(p => [p.x, p.y].join(',')).sort().join('/');
  });
}

describe('District island geometry', () => {
  it('normalizes a fourth compatible geography from authored data', () => {
    const [map] = validateDistrictMapCatalog([cormorant]);
    expect(map.schemaVersion).toBe(2);
    if (map.schemaVersion !== 2) throw new Error('Island map expected');
    expect(map.id).toBe('cormorant-cove');
    expect(map.geometry.hexes).toHaveLength(25);
    expect(map.geometry.coastlines).toHaveLength(1);
    expect(map.geometry.hexes.map(hex => [hex.q, hex.r])).not.toEqual(DISTRICT_ISLAND_MAPS[0].geometry.hexes.map(hex => [hex.q, hex.r]));
  });
  it.each(DISTRICT_ISLAND_MAPS)('$id uses shared sides for adjacency and outlines only exposed sides', map => {
    const sides = map.geometry.hexes.map(hex => ({ hex, sides: edges(hex.polygon) }));
    const coast: string[] = [];
    for (const { hex, sides: own } of sides) {
      const neighbors = sides.filter(other => other.hex.id !== hex.id && other.sides.some(side => own.includes(side)));
      expect(hex.neighborIds.toSorted()).toEqual(neighbors.map(n => n.hex.id).sort());
      coast.push(...own.filter(side => neighbors.every(n => !n.sides.includes(side))));
      expect(map.zones.filter(zone => zone.cells.includes(hex.id)).map(zone => zone.id)).toEqual([hex.zoneId]);
    }
    expect(map.geometry.coastlines.flatMap(edges).sort()).toEqual(coast.sort());
  });

  it('uses land cells for play, hex neighbors for cafe income and a complete named zone for roadworks', () => {
    const participants: Participant[] = [0, 1].map(seatIndex => {
      const id = 'player-' + seatIndex;
      return { participantId: id, playerId: id, displayName: id, seatIndex, controller: { kind: 'human', playerId: id } };
    });
    const initial = createDistrictState({ matchId: 'match', roomId: 'room', participants, map: parseDistrictMap(azure), now: 0, seed: 'geometry' });
    initial.eventDeck[0] = 'roadworks';
    const state = advanceDistrictTime(initial, initial.deadlineAt!);
    expect(state.cells.map(cell => cell.id).sort()).toEqual(azure.cells.map(cell => cell.id).sort());
    expect(state.event).toMatchObject({ kind: 'roadworks', row: null });
    const zone = azure.zones.find(item => item.id === state.event?.zoneId)!;
    expect(state.cells.filter(cell => isDistrictRoadworksCell(cell, state.event)).map(cell => cell.id).sort()).toEqual(zone.cells.toSorted());
    const cell = state.cells.find(item => item.id === 'A2')!;
    expect(adjacentCells(state.cells, cell).map(item => item.id).sort()).toEqual(['A1', 'A3', 'B2', 'B3']);
    cell.ownerId = participants[0].participantId;
    cell.building = { kind: 'cafe', level: 1 };
    expect(incomeForCell(state.cells, cell, null)).toMatchObject({ coins: 3, neighbors: { houses: 2 } });
    expect(incomeForCell(state.cells, cell, { kind: 'roadworks', row: null, zoneId: cell.zoneId })).toMatchObject({ coins: 2 });
  });

  it('rejects duplicate axial coordinates, wrong landmass counts, incomplete zone partitions and unknown water cells', () => {
    const duplicate = structuredClone(azure);
    Object.assign(duplicate.cells[1], { q: duplicate.cells[0].q, r: duplicate.cells[0].r });
    expect(districtMapErrors(duplicate).join(' ')).toContain('unique id and axial coordinate');
    expect(districtMapErrors({ ...azure, landmasses: 2 }).join(' ')).toContain('landmass count');
    const partial = structuredClone(azure);
    partial.zones[0].cells.pop();
    expect(districtMapErrors(partial).join(' ')).toContain('partition');
    const water = structuredClone(azure);
    water.cells[0].kind = 'water';
    expect(() => parseDistrictMap(water)).toThrow(/known kinds/);
  });
});
