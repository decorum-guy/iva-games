import type { BufferGeometry } from 'three'
import type { FloorPoint } from './promotionMotion'

const radii = new WeakMap<BufferGeometry, number>()

/** Enclose the full projection of the rendered asset, including a knight's overhanging head. */
export function modelFootprint(geometry: BufferGeometry) {
  const cached = radii.get(geometry)
  if (cached !== undefined) return cached
  const vertices = geometry.getAttribute('position')
  let radiusSquared = 0
  for (let i = 0; i < vertices.count; i++) {
    radiusSquared = Math.max(radiusSquared, vertices.getX(i) ** 2 + vertices.getZ(i) ** 2)
  }
  const radius = Math.sqrt(radiusSquared)
  radii.set(geometry, radius)
  return radius
}

export interface StoneSupport {
  center: FloorPoint
  radius: number
}

/** True distance to a filled, possibly concave outline. A base may straddle several slabs. */
function distanceToSlab([x, z]: FloorPoint, outline: readonly FloorPoint[]) {
  let inside = false, nearestSquared = Infinity
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, az] = outline[j], [bx, bz] = outline[i]
    const dx = bx - ax, dz = bz - az, lengthSquared = dx * dx + dz * dz
    if ((az > z) !== (bz > z) && x < ax + dx * (z - az) / dz) inside = !inside
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0
    nearestSquared = Math.min(nearestSquared, (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2)
  }
  return inside ? 0 : Math.sqrt(nearestSquared)
}

/** Limit the complete swept prism. Stone already touching the footprint stays level and supports the base. */
export function supportedMotion(outline: readonly FloorPoint[], center: FloorPoint, depth: number,
  supports: readonly StoneSupport[], shrink: number, tilt: number, translation: number) {
  const clearance = supports.reduce((gap, support) =>
    Math.min(gap, distanceToSlab(support.center, outline) - support.radius - .003), Infinity)
  if (clearance <= 0) return 0
  const radius = Math.max(...outline.map(([x, z]) => Math.hypot(x - center[0], z - center[1])))
  // All three terms bound horizontal deformation linearly for an amplitude in [0, 1].
  // Clamping at the frame can add up to this deformation independently on each axis.
  const deformation = radius * (shrink + tilt * tilt / 2) + depth * Math.abs(tilt)
  const sweep = translation + (1 + Math.SQRT2) * deformation
  return sweep ? Math.min(1, clearance / sweep) : 1
}
