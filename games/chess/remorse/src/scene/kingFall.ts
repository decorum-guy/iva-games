import type { BufferGeometry } from 'three'
import type { ChessAssets } from './assets'
import { easeRange } from './royalMotion'
import { squarePoint } from './types'
import type { ScenePiece } from './types'

type Contact = { height: number; radial: number }
export interface KingFall {
  dx: number
  dz: number
  tuck: number
  height: number
  angle: number
  hull: Contact[]
}

function rimSupport(geometry: BufferGeometry, dx: number, dz: number) {
  const vertices = geometry.getAttribute('position')
  const points = Array.from({ length: vertices.count }, (_, i) => ({
    height: vertices.getY(i), radial: vertices.getX(i) * dx + vertices.getZ(i) * dz,
  })).sort((a, b) => a.height - b.height || b.radial - a.radial)
  // Only the outward convex hull can touch the marble at any tilt.
  const hull: Contact[] = []
  for (const p of points) {
    if (hull.at(-1)?.height === p.height) continue
    while (hull.length >= 2) {
      const a = hull[hull.length - 2], b = hull[hull.length - 1]
      if ((b.height - a.height) * (p.radial - a.radial) < (b.radial - a.radial) * (p.height - a.height)) break
      hull.pop()
    }
    hull.push(p)
  }
  return hull
}

function support(hull: Contact[], tilt: number) {
  const sin = Math.sin(tilt), cos = Math.cos(tilt)
  let floor = -Infinity
  for (const point of hull) floor = Math.max(floor, point.radial * sin - point.height * cos)
  return floor
}

export function planKingFall(king: ScenePiece, pieces: readonly ScenePiece[], assets: ChessAssets): KingFall {
  const [x, z] = squarePoint(king.square)
  const model = assets.pieces[king.side].king.geometry
  const height = model.boundingBox!.max.y
  const neighbors = pieces.filter(piece => piece.id !== king.id).map(piece => {
    const [nx, nz] = squarePoint(piece.square)
    const box = assets.pieces[piece.side][piece.kind].geometry.boundingBox!
    return { x: nx, z: nz, radius: Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z) }
  }).filter(p => Math.hypot(p.x - x, p.z - z) < 2.6)
  let best = -Infinity
  let direction = { dx: 1, dz: 0, tuck: .1 }
  // Sample the full resting footprint. A crowded corner may require the base to
  // slide back towards its square while the crown falls between adjacent pieces.
  for (let i = 0; i < 32; i++) {
    const a = i / 32 * 2 * Math.PI
    const dx = Math.cos(a), dz = Math.sin(a)
    for (const tuck of [.08, .32, .57, .80]) {
      let clearance = .72
      for (let j = 0; j <= 12; j++) {
        const h = j / 12
        const radius = h < .20 ? .37 : h > .62 ? .24 : .18
        const reach = height * h - tuck
        const px = x + dx * reach, pz = z + dz * reach
        clearance = Math.min(clearance, 3.99 - Math.abs(px) - radius, 3.99 - Math.abs(pz) - radius)
        for (const n of neighbors) clearance = Math.min(clearance, Math.hypot(px - n.x, pz - n.z) - radius - n.radius)
      }
      // Once safely clear, prefer a readable sideways diagonal with a short base slide.
      const score = Math.min(.27, clearance) + .083 * Math.abs(dx) + .026 * Math.abs(dz)
        - .042 * tuck - .011 * (x * dx + z * dz)
      if (score > best) { best = score; direction = { dx, dz, tuck } }
    }
  }
  const hull = rimSupport(model, direction.dx, direction.dz)
  const foot = hull.filter(p => p.height < .5 * height)
  const crown = hull.filter(p => p.height >= .5 * height)
  let lo = Math.PI / 2, hi = 1.98
  // A real king rests on both its base rim and crown instead of hovering at 90°.
  for (let i = 0; i < 17; i++) {
    const mid = (lo + hi) * .5
    if (support(foot, mid) > support(crown, mid)) lo = mid
    else hi = mid
  }
  return { ...direction, height, angle: (lo + hi) * .5, hull }
}

export function kingFallPose(plan: KingFall, fraction: number) {
  const angle = fraction * plan.angle
  const slide = easeRange(.14, 1, fraction)
  const offset = .31 * (1 - Math.cos(angle)) * (1 - slide) - plan.tuck * slide
  return { angle, offset, lift: support(plan.hull, angle) }
}
