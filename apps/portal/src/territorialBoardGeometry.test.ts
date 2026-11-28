import { describe, expect, it } from 'vitest';
import { territoryMaps } from '../../../games/district/src/territorial/maps';
import { houseOutline, roadHitLine, territoryCoastlines } from './territorialBoardGeometry';

describe('territorial board coastline', () => {
  it.each(territoryMaps)('$id keeps separate island contours and removes internal tile sides', map => {
    const paths = territoryCoastlines(map);
    const lakes: Record<string, number> = { longwater: 2, 'lantern-strait': 3, 'kite-isles': 2 };
    expect(paths).toHaveLength(map.landmasses + (lakes[map.id] ?? 0));
    const sides = new Map<string, number>();
    for (const tile of map.tiles) {
      tile.nodeIds.forEach((a, index) => {
        const b = tile.nodeIds[(index + 1) % tile.nodeIds.length];
        const key = [a, b].sort().join('~');
        sides.set(key, (sides.get(key) ?? 0) + 1);
      });
    }
    const boundary = [...sides].filter(([, count]) => count === 1).map(([key]) => key).sort();
    const nodeAt = new Map(map.nodes.map(node => [`${node.x},${node.y}`, node.id]));
    const drawn: string[] = [];
    for (const path of paths) {
      expect(path.endsWith(' Z')).toBe(true);
      const vertices = path.slice(1, -2).split(' L').map(point => nodeAt.get(point));
      expect(vertices.every(Boolean)).toBe(true);
      vertices.forEach((a, index) => drawn.push([a, vertices[(index + 1) % vertices.length]].sort().join('~')));
    }
    expect(drawn.sort()).toEqual(boundary);
    expect(drawn.length).toBeLessThan(map.tiles.length * 6);
  });
});

describe('territorial board road hit geometry', () => {
  it.each([1, 2])('keeps the vertical Survey road selectable above a level %i home', level => {
    const map = territoryMaps.find(map => map.id === 'two-shores')!;
    const nodes = new Map(map.nodes.map(node => [node.id, node]));
    const a = nodes.get('v1_-1')!, b = nodes.get('v1_1')!;
    const [first, second] = map.tiles[0].nodeIds.map(id => nodes.get(id)!);
    const unit = Math.hypot(first.x - second.x, first.y - second.y) / 42;
    const roof = houseOutline(level).slice(1, -2).split(' L').map(point => point.split(',').map(Number));
    const insideHouse = (x: number, y: number) => {
      const px = (x - b.x) / unit, py = (y - b.y) / unit;
      let inside = false;
      roof.forEach(([ax, ay], index) => {
        const [bx, by] = roof[(index + 1) % roof.length];
        if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) inside = !inside;
      });
      return inside;
    };
    // The old endpoint-to-endpoint midpoint really lands inside the roof, even without touch padding.
    expect(insideHouse((a.x + b.x) / 2, (a.y + b.y) / 2)).toBe(true);
    const line = roadHitLine(a, b, unit, undefined, level);
    const x = (line.x1 + line.x2) / 2, y = (line.y1 + line.y2) / 2;
    expect(insideHouse(x, y)).toBe(false);
    expect(Math.hypot(x - a.x, y - a.y)).toBeGreaterThan(7 * unit);
    expect(Math.hypot(x - b.x, y - b.y)).toBeGreaterThan(7 * unit);
    expect(x).toBe(a.x);
    expect(line.y2).toBeGreaterThan(line.y1);
  });
});
