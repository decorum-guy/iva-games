import { readFileSync } from 'node:fs'
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { fractureShard, fractureSource } from './fractureGeometry'

function shippedBoard() {
  const directory = new URL('../../public/assets/chess/', import.meta.url)
  const gltf = JSON.parse(readFileSync(new URL('chess_set_1k.gltf', directory), 'utf8')) as {
    nodes: { name: string; mesh: number }[]
    meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[]
    accessors: { bufferView: number; count: number; type: string }[]
    bufferViews: { byteOffset: number }[]
    buffers: { uri: string }[]
  }
  const primitive = gltf.meshes[gltf.nodes.find(n => n.name === 'board')!.mesh].primitives[0]
  const file = readFileSync(new URL(gltf.buffers[0].uri, directory))
  const geometry = new BufferGeometry()
  for (const [name, accessor] of Object.entries({
    position: primitive.attributes.POSITION, normal: primitive.attributes.NORMAL, uv: primitive.attributes.TEXCOORD_0, index: primitive.indices,
  })) {
    const a = gltf.accessors[accessor], offset = file.byteOffset + gltf.bufferViews[a.bufferView].byteOffset
    if (name === 'index') geometry.setIndex(new BufferAttribute(new Uint16Array(file.buffer, offset, a.count), 1))
    else {
      const size = a.type === 'VEC2' ? 2 : 3
      geometry.setAttribute(name, new BufferAttribute(new Float32Array(file.buffer, offset, a.count * size), size))
    }
  }
  const scale = 1 / .05788808
  return geometry.translate(0, -.017392585, 0).scale(scale, scale, scale)
}

const board = shippedBoard(), source = fractureSource(board)

// Only upward-facing marble belongs in this projected area. Count downward and degenerate triangles separately.
function areaOfTop(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  let area = 0
  for (let i = 0; i < position.count; i += 3) {
    const a = new Vector3().fromBufferAttribute(position, i), b = new Vector3().fromBufferAttribute(position, i + 1)
    const c = new Vector3().fromBufferAttribute(position, i + 2)
    const signed = b.sub(a).cross(c.sub(a)).y / 2
    expect(signed).toBeGreaterThan(0)
    area += signed
  }
  return area
}

describe('the shipped marble playfield as rigid pieces of stone', () => {
  it('replaces exactly the two textured triangles of every square, retaining every other source triangle', () => {
    expect(source.faces).toHaveLength(128)
    expect(source.frame.index!.count).toBe(board.index!.count - 128 * 3)
    const all = fractureShard(source, [[-4, -4], [4, -4], [4, 4], [-4, 4]], .24, 7)
    expect(areaOfTop(all.top)).toBeCloseTo(64, 5)
    expect(all.center).toEqual([0, 0])
    const generatedUV = all.top.getAttribute('uv'), originalUV = board.getAttribute('uv')
    const topUVs = new Set(Array.from({ length: generatedUV.count }, (_, id) =>
      [generatedUV.getX(id), generatedUV.getY(id)].join(',')))
    for (const face of source.faces) for (const id of face.ids) {
      expect(topUVs.has([originalUV.getX(id), originalUV.getY(id)].join(','))).toBe(true)
    }
  })

  it('partitions a concave cross-tile shard without sealing its notch or adding internal walls', () => {
    const outline = [[-.7, -.8], [1.3, -.8], [1.3, .2], [.3, .2], [.3, 1.2], [-.7, 1.2]] as const
    for (const loop of [outline, [...outline].reverse()]) {
      const shard = fractureShard(source, loop, .24, 12)
      expect(areaOfTop(shard.top)).toBeCloseTo(3, 6)
      const p = shard.top.getAttribute('position'), uv = shard.top.getAttribute('uv')
      // An interior sample determines the actual atlas island for each output triangle.
      for (let i = 0; i < p.count; i += 3) {
        const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 + shard.center[0]
        const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 + shard.center[1]
        expect(x > .3 && z > .2).toBe(false)
        const locate = (a: readonly number[], b: readonly number[]) =>
          (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])
        const face = source.faces.find(f => f.points.every((point, j) => locate(point, f.points[(j + 1) % 3]) <= 1e-7))!
        const weights = [locate(face.points[1], face.points[2]), locate(face.points[2], face.points[0]),
          locate(face.points[0], face.points[1])].map(n => n / face.signedArea)
        const expectedUV = (axis: 'getX' | 'getY') => weights.reduce((total, weight, j) =>
          total + weight * source.uv[axis](face.ids[j]), 0)
        expect((uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3).toBeCloseTo(expectedUV('getX'), 6)
        expect((uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3).toBeCloseTo(expectedUV('getY'), 6)
      }
      const sides = shard.sides.getAttribute('position'), normals = shard.sides.getAttribute('normal')
      for (let i = 0; i < sides.count; i += 3) {
        const x = (sides.getX(i) + sides.getX(i + 1) + sides.getX(i + 2)) / 3 + shard.center[0]
        const z = (sides.getZ(i) + sides.getZ(i + 1) + sides.getZ(i + 2)) / 3 + shard.center[1]
        if (normals.getY(i) < -.999) expect(sides.getY(i)).toBeCloseTo(-.24, 6)
        else expect(outline.some((a, j) => {
          const b = outline[(j + 1) % outline.length]
          const t = (x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])
          return t >= -1e-6 && t <= (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + 1e-6 &&
            Math.abs((x - a[0]) * (b[1] - a[1]) - (z - a[1]) * (b[0] - a[0])) < 1e-6
        })).toBe(true)
      }
    }
  })
})
