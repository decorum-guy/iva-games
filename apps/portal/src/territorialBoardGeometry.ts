import type { TerritoryMap } from '@iva-games/district/territorial';

type Point = { x: number; y: number };
export type RoadHitLine = { x1: number; y1: number; x2: number; y2: number };

const houseVertices = (level: number): [number, number][] => level === 2
  ? [[-12,-12],[-9,-18],[-2,-21],[2,-18],[3,-20],[11,-9],[9,-7],[9,1],[1,5],[-8,1],[-8,-2],[-11,-3],[-11,-11]]
  : [[-10,-8],[-5,-17],[3,-20],[11,-9],[9,-7],[9,1],[1,5],[-8,1],[-8,-8]];

export const houseOutline = (level: number) => 'M' + houseVertices(level).map(point => point.join(',')).join(' L') + ' Z';

/** Keep a road's selectable centre outside the actual homes and node markers. */
export function roadHitLine(a: Point, b: Point, unit: number, aLevel?: number, bLevel?: number): RoadHitLine {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const clearance = (toward: Point, level?: number) => {
    let distance = 7 * unit;
    if (level) {
      const points = houseVertices(level);
      for (let index = 0; index < points.length; index++) {
        const [px, py] = points[index].map(value => value * unit);
        const next = points[(index + 1) % points.length];
        const ex = next[0] * unit - px, ey = next[1] * unit - py;
        const cross = toward.x * ey - toward.y * ex;
        if (Math.abs(cross) < 1e-8) continue;
        const along = (px * ey - py * ex) / cross;
        const side = (px * toward.y - py * toward.x) / cross;
        if (along > distance && side >= 0 && side <= 1) distance = along;
      }
    }
    return distance + 1.5 * unit;
  };
  const start = clearance(direction, aLevel);
  const end = clearance({ x: -direction.x, y: -direction.y }, bLevel);
  return { x1: a.x + direction.x * start, y1: a.y + direction.y * start,
    x2: b.x - direction.x * end, y2: b.y - direction.y * end };
}

export function distanceToRoad(point: Point, line: RoadHitLine): number {
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
  const squaredLength = dx * dx + dy * dy;
  const along = squaredLength ? Math.max(0, Math.min(1, ((point.x - line.x1) * dx + (point.y - line.y1) * dy) / squaredLength)) : 0;
  return Math.hypot(point.x - line.x1 - along * dx, point.y - line.y1 - along * dy);
}

/** Coastlines from published geometry, including separate islands and inland holes. */
export function territoryCoastLoops(map: Pick<TerritoryMap, 'nodes' | 'tiles'>): Point[][] {
  const nodes = new Map(map.nodes.map(node => [node.id, node]));
  const sides = new Map<string, { a: string; b: string }>();
  for (const tile of map.tiles) {
    tile.nodeIds.forEach((a, index) => {
      const b = tile.nodeIds[(index + 1) % tile.nodeIds.length];
      const key = [a, b].sort().join('~');
      if (!sides.delete(key)) sides.set(key, { a, b });
    });
  }
  const outgoing = new Map<string, string[]>();
  for (const { a, b } of sides.values()) outgoing.set(a, [...(outgoing.get(a) ?? []), b]);
  const paths: Point[][] = [];
  while (outgoing.size) {
    const start = outgoing.keys().next().value!;
    let current = start;
    const points: Point[] = [];
    do {
      const point = nodes.get(current)!;
      points.push(point);
      const destinations = outgoing.get(current)!;
      const next = destinations.shift()!;
      if (!destinations.length) outgoing.delete(current);
      current = next;
    } while (current !== start && outgoing.has(current));
    paths.push(points);
  }
  return paths;
}

export function coastPath(loop: Point[]) {
  return 'M' + loop.map(point => point.x + ',' + point.y).join(' L') + ' Z';
}

export function territoryCoastlines(map: Pick<TerritoryMap, 'nodes' | 'tiles'>) {
  return territoryCoastLoops(map).map(coastPath);
}
