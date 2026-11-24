import { sceneRandom } from './promotionMotion'
import type { FloorPoint, Fracture, FracturePoint } from './promotionMotion'

const gridEdge = 4
const fullTurn = Math.PI * 2
const clamp = (value: number) => Math.max(-gridEdge, Math.min(gridEdge, value))
const turn = (angle: number) => (angle + fullTurn) % fullTurn

export interface SlabLayout {
  readonly outline: readonly FloorPoint[]
  readonly core: boolean
  readonly depth: number
  readonly reach: number
  readonly seed: number
  readonly longEdges: readonly { normal: FloorPoint; reach: number }[]
}

function toEdge([x, z]: FloorPoint, dx: number, dz: number) {
  return Math.min(
    Math.abs(dx) < 1e-8 ? Infinity : (dx > 0 ? gridEdge - x : -gridEdge - x) / dx,
    Math.abs(dz) < 1e-8 ? Infinity : (dz > 0 ? gridEdge - z : -gridEdge - z) / dz,
  )
}

/** Split the playable square into fitted slabs, with a fan clipped by its real perimeter. */
export function fractureLayout(origin: FloorPoint, id: string): { slabs: readonly SlabLayout[]; seams: Fracture } {
  const random = sceneRandom(id + '/stone')
  const [x, z] = origin
  const unit = fullTurn / 20
  const corner = [-gridEdge, gridEdge].flatMap(px => [-gridEdge, gridEdge].map(pz => turn(Math.atan2(pz - z, px - x))))
  const angles = [...corner, ...Array.from({ length: 20 }, (_, i) => turn((i + .24 + (random() - .5) * .43) * unit))
    .filter(angle => corner.every(point => Math.abs(Math.atan2(Math.sin(angle - point), Math.cos(angle - point))) > .075))]
    .sort((a, b) => a - b)
  const phase = random() * fullTurn
  const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
  const directions = angles.map(angle => {
    const dx = Math.cos(angle), dz = Math.sin(angle)
    const edge = toEdge(origin, dx, dz)
    return { angle, dx, dz, edge, priority: Math.cos(angle * 5 + phase) + random() * .36 }
  })
  const primary: number[] = []
  for (const ray of directions.filter(ray => ray.edge > 4.44).sort((a, b) => b.priority - a.priority)) {
    if (primary.every(angle => angleBetween(ray.angle, angle) >= .61)) primary.push(ray.angle)
    if (primary.length === 3) break
  }
  const rays = directions.map(({ angle, dx, dz, edge }, index) => {
    const long = primary.includes(angle)
    const reach = long ? 4.87 + random() * .62 : 2.92 + random() * .91
    const angularRoom = Math.min(angleBetween(angle, angles.at(index - 1)!),
      angleBetween(angle, angles[(index + 1) % angles.length]))
    const outer = Math.min(reach, .965 * edge)
    const inner = Math.min(1.87 + random() * .73, .89 * edge)
    const span = outer - inner
    // The long veins have smaller end fragments, leaving room for the opening
    // to taper over actual broken edges while the rest of a slab stays rigid.
    const distances = [Math.min(.43 + random() * .12, .67 * edge),
      Math.min(1.05 + random() * .39, .79 * edge), inner,
      inner + span * (.40 + random() * .13), inner + span * (.72 + random() * .10), outer, edge]
    const nodes = distances.map(r => [clamp(x + dx * r), clamp(z + dz * r)] as FloorPoint)
    const steps = nodes.slice(1).map((end, i): FloorPoint[] => {
      const start = nodes[i]
      const span = distances[i + 1] - distances[i]
      if (span < .28) return [start, end]
      const kink = Math.min(.33, span * .27, distances[i] * angularRoom * .36)
      const offset = (random() < .5 ? -1 : 1) * (.52 + random() * .48) * kink
      const zig = (at: number, bend: number): FloorPoint => [
        clamp(start[0] + (end[0] - start[0]) * at - dz * bend),
        clamp(start[1] + (end[1] - start[1]) * at + dx * bend),
      ]
      const point = zig(.27 + random() * .19, offset)
      return span > .82 ? [start, point, zig(.62 + random() * .22, -offset * .74), end] : [start, point, end]
    })
    return { nodes, steps, distances, reach, long, dx, dz }
  })

  const center = rays.map(ray => ray.nodes[0])
  const slabs: SlabLayout[] = [{ outline: center, core: true, depth: .22, reach: 0, seed: random(), longEdges: [] }]
  const seams: FracturePoint[][] = []
  for (const [index, ray] of rays.entries()) {
    const next = rays[(index + 1) % rays.length]
    const longEdges = [
      ...(ray.long ? [{ normal: [-ray.dz, ray.dx] as FloorPoint, reach: ray.reach }] : []),
      ...(next.long ? [{ normal: [next.dz, -next.dx] as FloorPoint, reach: next.reach }] : []),
    ]
    for (let i = 0; i < ray.steps.length; i++) {
      const near = ray.steps[i], far = next.steps[i]
      slabs.push({ outline: [...near, ...far.toReversed()], core: false,
        depth: .215 + .055 * random(), reach: (ray.reach + next.reach) * .5, seed: random(), longEdges })
    }
    const extent = Math.min(ray.reach, ray.distances.at(-1)!)
    const points = ray.steps.flatMap((edge, i) => i === 0 ? edge : edge.slice(1))
    const seam = points.filter(([px, pz]) => Math.hypot(px - x, pz - z) <= extent + .12)
    if (seam.length > 1) seams.push(seam.map((position, i) => {
      const distance = Math.hypot(position[0] - x, position[1] - z)
      return { position, at: distance / 6.2,
        width: (.065 - (ray.long ? .023 : .046) * Math.min(1, distance / 5.8)) * (i === seam.length - 1 ? .24 : 1) }
    }))
    const a = ray.nodes[1], b = next.nodes[2]
    if (index % 2 === 1 && Math.hypot(b[0] - a[0], b[1] - a[1]) > .42) {
      seams.push([
        { position: a, at: ray.distances[1] / 6.2, width: .037 },
        { position: b, at: (next.distances[2] + .42) / 6.2, width: .010 },
      ])
    }
  }
  return { slabs, seams }
}
