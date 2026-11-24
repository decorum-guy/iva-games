import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DynamicDrawUsage, Quaternion, Vector3 } from 'three'
import type { BufferAttribute, MeshStandardMaterial } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { fractureShard, fractureSource } from './fractureGeometry'
import { fractureLayout } from './fractureLayout'
import { modelFootprint, supportedMotion } from './fractureSupport'
import type { StoneSupport } from './fractureSupport'
import type { ChessAssets } from './assets'
import { samplePromotion, sceneRandom } from './promotionMotion'
import type { FloorPoint, PromotionCue } from './promotionMotion'
import { easeRange } from './royalMotion'
import { squarePoint } from './types'
import type { ScenePiece } from './types'

type Source = ReturnType<typeof fractureSource>
type Shard = ReturnType<typeof fractureShard>

function combine(shards: readonly Shard[], kind: 'top' | 'sides') {
  const parts = shards.map(shard => shard[kind])
  const geometry = mergeGeometries(parts)!
  const positions = (geometry.getAttribute('position') as BufferAttribute).setUsage(DynamicDrawUsage)
  const normals = (geometry.getAttribute('normal') as BufferAttribute).setUsage(DynamicDrawUsage)
  let offset = 0
  const segments = parts.map(part => {
    const start = offset
    offset += part.getAttribute('position').count
    part.dispose()
    return { start, end: offset }
  })
  return { geometry, positions, normals, segments, point: positions.clone(), normal: normals.clone() }
}

export function breakMarble(source: Source, origin: FloorPoint, id: string, supports: readonly StoneSupport[]) {
  const { slabs } = fractureLayout(origin, id)
  const random = sceneRandom(id + '/shard-motion')
  const ax = new Vector3(), p = new Vector3(), n = new Vector3(), rotation = new Quaternion()
  const fragments = slabs.map(slab => fractureShard(source, slab.outline, slab.depth, slab.seed * 173))
  const motion = fragments.map(({ center: [x, z] }, i) => {
    const slab = slabs[i]
    const distance = Math.hypot(x - origin[0], z - origin[1])
    const dx = distance > .01 ? (x - origin[0]) / distance : 0
    const dz = distance > .01 ? (z - origin[1]) / distance : 0
    const power = slab.core ? .1 : 1 - easeRange(1.06, slab.reach + .28, distance)
    const close = 1 - easeRange(.48, 2.2, distance)
    const signed = random() > .41 ? 1 : -1
    const lean = signed * ((.13 + random() * .16) * close + .038)
    const lift = signed * ((.094 + random() * .119) * close + .029)
    let sideX = 0, sideZ = 0
    for (const { normal, reach } of slab.longEdges) {
      const breadth = .068 * easeRange(.70, 1.89, distance) * (1 - easeRange(reach - 1.34, reach + .12, distance))
      sideX += normal[0] * breadth
      sideZ += normal[1] * breadth
    }
    const scale = slab.core ? .021 : .030 + .115 * close
    const push = slab.core ? 0 : .026 + .108 * close
    const freedom = supportedMotion(slab.outline, [x, z], slab.depth, supports,
      scale * power, lean * power, push * power + Math.hypot(sideX, sideZ))
    return { x, z, dx, dz, outline: slab.outline, depth: slab.depth, delay: Math.max(0, distance - .34) * 57,
      power, lift, lean, scale, push, sideX, sideZ, freedom }
  })
  // The tight, deeper veins get little sky light. Fresh exposed pieces at
  // the impact retain a brighter relief so their thickness remains readable.
  for (const { center: [x, z], sides } of fragments) {
    const vertex = sides.getAttribute('position'), color = sides.getAttribute('color')
    for (let i = 0; i < vertex.count; i++) {
      const distance = Math.hypot(vertex.getX(i) + x - origin[0], vertex.getZ(i) + z - origin[1])
      const shade = 1 - .56 * easeRange(1.08, 3.48, distance)
      color.setXYZ(i, color.getX(i) * shade, color.getY(i) * shade, color.getZ(i) * shade)
    }
  }
  const top = combine(fragments, 'top'), sides = combine(fragments, 'sides')
  const surfaces = [top, sides]
  let preceding = -1
  function draw(progress: number, flight: number, reduced: boolean) {
    if (progress === 0 && preceding === 0) return
    preceding = progress
    for (const [i, part] of motion.entries()) {
      const arrival = reduced ? 1 : easeRange(part.delay, part.delay + 128, flight * 1000)
      const rebound = reduced ? 0 : easeRange(part.delay + 34, part.delay + 114, flight * 1000) *
        (1 - easeRange(part.delay + 114, part.delay + 365, flight * 1000))
      const amount = progress * part.freedom * part.power * arrival * (reduced ? .58 : 1)
      const scale = 1 - part.scale * amount
      const push = part.push * amount
      const side = progress * part.freedom * arrival * (reduced ? .54 : 1)
      let x = part.x + part.dx * push + part.sideX * side
      let z = part.z + part.dz * push + part.sideZ * side
      const raise = part.lift * amount * (1 + rebound * .36)
      ax.set(-part.dz, 0, part.dx).normalize()
      rotation.setFromAxisAngle(ax, part.lean * amount)
      if (amount > 0 || side > 0) {
        // Keep both the top and the swept underside of the prism inside the brass frame.
        let left = Infinity, right = -Infinity, back = Infinity, front = -Infinity
        for (const [px, pz] of part.outline) for (const y of [0, -part.depth]) {
          p.set((px - part.x) * scale, y, (pz - part.z) * scale).applyQuaternion(rotation)
          left = Math.min(left, p.x)
          right = Math.max(right, p.x)
          back = Math.min(back, p.z)
          front = Math.max(front, p.z)
        }
        x = Math.max(-4 - left, Math.min(4 - right, x))
        z = Math.max(-4 - back, Math.min(4 - front, z))
      }
      for (const surface of surfaces) {
        const { start, end } = surface.segments[i]
        for (let vertex = start; vertex < end; vertex++) {
          p.fromBufferAttribute(surface.point, vertex)
          p.x *= scale
          p.z *= scale
          p.applyQuaternion(rotation)
          surface.positions.setXYZ(vertex, p.x + x, p.y + raise, p.z + z)
          n.fromBufferAttribute(surface.normal, vertex).applyQuaternion(rotation)
          surface.normals.setXYZ(vertex, n.x, n.y, n.z)
        }
      }
    }
    top.positions.needsUpdate = top.normals.needsUpdate = true
    sides.positions.needsUpdate = sides.normals.needsUpdate = true
  }
  draw(0, -1, false)
  return { top: top.geometry, sides: sides.geometry, draw }
}

/** Play the break on the actual textured top. Each closed slab moves as a volume. */
export function MarbleFracture({ assets, material, cue, reduced, pieces }: {
  assets: ChessAssets
  material: MeshStandardMaterial
  cue: PromotionCue
  reduced: boolean
  pieces: readonly ScenePiece[]
}) {
  const source = useMemo(() => fractureSource(assets.board.geometry), [assets])
  const shards = useMemo(() => {
    const supports = pieces.map(piece => ({
      center: squarePoint(piece.square),
      // Landing recoil expands the promoted body horizontally by up to 2.4%.
      radius: modelFootprint(assets.pieces[piece.side][piece.kind].geometry) * (piece.id === cue.pieceId ? 1.024 : 1),
    }))
    return breakMarble(source, squarePoint(cue.square), cue.id, supports)
  }, [source, assets, cue.square, cue.id, cue.pieceId, pieces])
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => () => source.frame.dispose(), [source])
  useEffect(() => () => { shards.top.dispose(); shards.sides.dispose() }, [shards])
  useLayoutEffect(() => { invalidate() }, [invalidate, shards])
  useFrame(() => {
    const less = reduced || cue.reduced
    const elapsed = performance.now() - cue.startedAt
    const sample = samplePromotion(cue, elapsed, less)
    // Geometry advances on the same committed clock as the queen. At rest the
    // clipped UVs join exactly, so swapping back to the intact mesh is invisible.
    shards.draw(sample.crackAlpha, sample.flight, less)
  })
  return <>
    <mesh geometry={source.frame} material={material} receiveShadow dispose={null} />
    <mesh position-y={-.283} receiveShadow>
      <boxGeometry args={[7.997, .026, 7.997]} />
      <meshStandardMaterial color="#333033" roughness={.96} />
    </mesh>
    <mesh geometry={shards.sides} frustumCulled={false} receiveShadow>
      <meshStandardMaterial vertexColors roughness={.88} metalness={.025} />
    </mesh>
    <mesh geometry={shards.top} material={material} frustumCulled={false} receiveShadow dispose={null} />
  </>
}
