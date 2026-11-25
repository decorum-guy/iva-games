import { readFileSync } from 'node:fs'
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { describe, expect, it } from 'vitest'
import type { PieceType, Side } from '../core/types'
import { breakMarble } from './MarbleFracture'
import { fractureSource } from './fractureGeometry'
import { modelFootprint } from './fractureSupport'
import type { StoneSupport } from './fractureSupport'
import { promotionTiming, samplePromotion } from './promotionMotion'
import { squarePoint } from './types'

const directory = new URL('../../public/assets/chess/', import.meta.url)
const gltf = JSON.parse(readFileSync(new URL('chess_set_1k.gltf', directory), 'utf8')) as {
  nodes: { name: string; mesh: number }[]
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[]
  accessors: { bufferView: number; count: number; type: string }[]
  bufferViews: { byteOffset: number }[]
  buffers: { uri: string }[]
}
const binary = readFileSync(new URL(gltf.buffers[0].uri, directory))
const scale = 1 / .05788808

function shippedMesh(name: string) {
  const primitives = gltf.meshes[gltf.nodes.find(node => node.name === name)!.mesh].primitives
  const geometries = primitives.map(primitive => {
    const geometry = new BufferGeometry()
    for (const [key, id] of Object.entries({ position: primitive.attributes.POSITION, normal: primitive.attributes.NORMAL,
      uv: primitive.attributes.TEXCOORD_0, index: primitive.indices })) {
      const a = gltf.accessors[id], offset = binary.byteOffset + gltf.bufferViews[a.bufferView].byteOffset
      const size = a.type === 'VEC2' ? 2 : 3
      if (key === 'index') geometry.setIndex(new BufferAttribute(new Uint16Array(binary.buffer, offset, a.count), 1))
      else geometry.setAttribute(key, new BufferAttribute(new Float32Array(binary.buffer, offset, a.count * size).slice(), size))
    }
    return geometry
  })
  return mergeGeometries(geometries)!
}
const source = fractureSource(shippedMesh('board').translate(0, -.017392585, 0).scale(scale, scale, scale))
const kinds = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const
function support(kind: PieceType, side: Side, square: string, recoil = false): StoneSupport {
  const mesh = shippedMesh('piece_' + kind + '_' + side + (kind === 'king' || kind === 'queen' ? '' : '_01'))
  mesh.computeBoundingBox()
  const c = mesh.boundingBox!.getCenter(new Vector3())
  mesh.translate(kind === 'knight' ? 0 : -c.x, -mesh.boundingBox!.min.y, kind === 'knight' ? 0 : -c.z)
  mesh.rotateY(Math.PI).scale(scale, scale, scale)
  const radius = modelFootprint(mesh)
  expect(radius).toBeGreaterThan(.2)
  expect(radius).toBeLessThan(.50)
  return { center: squarePoint(square), radius: radius * (recoil ? 1.024 : 1) }
}

// Independently intersect each rendered triangle with the complete footprint disc in XZ.
// This also catches a side or a broad face whose vertices all miss the base.
function overlaps(vertices: Float32Array, i: number, { center: [x, z], radius }: StoneSupport) {
  const ax = vertices[i] - x, az = vertices[i + 2] - z
  const bx = vertices[i + 3] - x, bz = vertices[i + 5] - z
  const cx = vertices[i + 6] - x, cz = vertices[i + 8] - z
  if (Math.min(ax, bx, cx) > radius || Math.max(ax, bx, cx) < -radius ||
      Math.min(az, bz, cz) > radius || Math.max(az, bz, cz) < -radius) return false
  const ab = ax * bz - az * bx, bc = bx * cz - bz * cx, ca = cx * az - cz * ax
  if (Math.abs(ab + bc + ca) > 1e-10 && (Math.min(ab, bc, ca) >= 0 || Math.max(ab, bc, ca) <= 0)) return true
  function edge(u: number, v: number, dx: number, dz: number) {
    const t = Math.max(0, Math.min(1, -(u * dx + v * dz) / (dx * dx + dz * dz || 1)))
    return (u + t * dx) ** 2 + (v + t * dz) ** 2 <= radius * radius
  }
  return edge(ax, az, bx - ax, bz - az) || edge(bx, bz, cx - bx, cz - bz) || edge(cx, cz, ax - cx, az - cz)
}

const layouts = [
  { target: 'e8', side: 'white', neighbors: ['a1', 'h7', 'd8'], families: ['king', 'king', 'rook'] },
  { target: 'e1', side: 'black', neighbors: ['a8', 'h2', 'd1'], families: ['king', 'king', 'rook'] },
  { target: 'a8', side: 'white', neighbors: ['b8', 'a7', 'b7', 'c8', 'a6', 'c7'], families: kinds },
  { target: 'h1', side: 'black', neighbors: ['g1', 'h2', 'g2', 'f1', 'h3', 'f2'], families: kinds },
] as const

describe('swept, cut marble against shipped piece geometry', () => {
  for (const { target, side, neighbors, families } of layouts) it('keeps every footprint supported at ' + target, () => {
    const opposite = side === 'white' ? 'black' : 'white'
    const supports = [support('queen', side, target, true), ...neighbors.map((square, i) =>
      support(families[i], i === 0 ? side : opposite, square))]
    const origin = squarePoint(target)
    for (const seed of ['showcase/1', 'showcase/8', 'rook/420']) {
      const cut = breakMarble(source, origin, seed, supports)
      const surfaces = [cut.top, cut.sides].map(geometry => {
        const live = geometry.getAttribute('position').array as Float32Array
        return { live, rest: live.slice() }
      })
      for (const reduced of [false, true]) {
        const cue = { kind: 'queen', id: seed, pieceId: 'promotion', square: target, side, startedAt: 0, intoRoyal: false, reduced } as const
        const { impact, duration } = promotionTiming('queen', reduced)
        let highest = 0, furthest = 0
        for (const after of [12, 66, 155, 285, 420, 680, duration - impact - 120, duration - impact]) {
          const s = samplePromotion(cue, impact + after)
          cut.draw(s.crackAlpha, s.flight, reduced)
          for (const { live, rest } of surfaces) for (let i = 0; i < live.length; i += 9) {
            let moved = false
            for (let j = i; j < i + 9; j += 3) {
              const x = live[j], y = live[j + 1], z = live[j + 2]
              if (Math.max(Math.abs(x), Math.abs(z)) > 4.00001) throw new Error('fragment crossed the frame')
              if (Math.abs(x - rest[j]) + Math.abs(y - rest[j + 1]) + Math.abs(z - rest[j + 2]) > .00001) {
                moved = true
                highest = Math.max(highest, y)
                if (Math.abs(x - rest[j]) + Math.abs(z - rest[j + 2]) > .012)
                  furthest = Math.max(furthest, Math.hypot(x - origin[0], z - origin[1]))
              }
            }
            if (moved && supports.some(foot => overlaps(rest, i, foot) || overlaps(live, i, foot)))
              throw new Error('stone left the support or entered the footprint at ' + after + 'ms, ' + seed)
          }
        }
        expect(highest).toBeGreaterThan(.025)
        expect(furthest).toBeGreaterThan(4)
        for (const { live, rest } of surfaces) expect(live.every((v, i) => v === rest[i])).toBe(true)
      }
      cut.top.dispose()
      cut.sides.dispose()
    }
  })
})
