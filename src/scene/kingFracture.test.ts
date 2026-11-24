import { readFileSync } from 'node:fs'
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { kingFracture } from './kingFracture'

function shippedKing(side: string) {
  const directory = new URL('../../public/assets/chess/', import.meta.url)
  const gltf = JSON.parse(readFileSync(new URL('chess_set_1k.gltf', directory), 'utf8')) as {
    nodes: { name: string; mesh: number }[]
    meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[]
    accessors: { bufferView: number; count: number; type: string }[]
    bufferViews: { byteOffset: number }[]
    buffers: { uri: string }[]
  }
  const primitive = gltf.meshes[gltf.nodes.find(n => n.name === 'piece_king_' + side)!.mesh].primitives[0]
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
  geometry.computeBoundingBox()
  const center = geometry.boundingBox!.getCenter(new Vector3())
  return geometry.translate(-center.x, -geometry.boundingBox!.min.y, -center.z).rotateY(Math.PI).scale(scale, scale, scale)
}


function meshStats(geometry: BufferGeometry) {
  const p = geometry.getAttribute('position')
  const edges = new Map<string, number>()
  let volume = 0
  const triangle = Array.from({ length: 3 }, () => new Vector3())
  for (let i = 0; i < (geometry.index?.count ?? p.count); i += 3) {
    triangle.forEach((point, k) => point.fromBufferAttribute(p, geometry.index?.getX(i + k) ?? i + k))
    const keys = triangle.map(point => point.toArray().map(value => Math.round(value * 1e5)).join('/'))
    for (let k = 0; k < 3; k++) {
      const edge = [keys[k], keys[(k + 1) % 3]].sort().join(':')
      edges.set(edge, 1 + (edges.get(edge) ?? 0))
    }
    volume += triangle[0].dot(new Vector3().crossVectors(triangle[1], triangle[2])) / 6
  }
  return { volume, open: [...edges.values()].filter(n => n === 1).length }
}
it.each(['white', 'black'])('cuts closed complementary chips from the shipped %s king', side => {
  const source = shippedKing(side), { body, chips } = kingFracture(source)
  const original = meshStats(source), remnant = meshStats(body)
  const parts = chips.map(chip => meshStats(chip.geometry))
  expect(parts).toHaveLength(11)
  expect(parts.every(part => part.volume > .0001)).toBe(true)
  expect(remnant.volume).toBeLessThan(original.volume * .6)
  expect(remnant.volume + parts.reduce((sum, p) => sum + p.volume, 0)).toBeCloseTo(original.volume, 5)
  expect(remnant.open).toBe(original.open)
  expect(parts.every(part => part.open === 0)).toBe(true)
})

it.each(['white', 'black'])('preserves the %s king’s two support contacts and loses at least 40% in every fall direction', side => {
  const source = shippedKing(side)
  const original = meshStats(source)
  for (let direction = 0; direction < 32; direction++) {
    const bearing = direction * Math.PI / 16
    const fall = { dx: Math.cos(bearing), dz: Math.sin(bearing), angle: 1.694 }
    const { body, chips } = kingFracture(source, fall)
    const contacts = (geometry: BufferGeometry) => {
      const p = geometry.getAttribute('position'), heights = [Infinity, Infinity]
      for (let i = 0; i < p.count; i++) {
        const zone = Number(p.getY(i) > .8)
        const height = p.getY(i) * Math.cos(fall.angle) -
          (p.getX(i) * fall.dx + p.getZ(i) * fall.dz) * Math.sin(fall.angle)
        heights[zone] = Math.min(heights[zone], height)
      }
      return heights
    }
    const old = contacts(source), chipped = contacts(body)
    expect(chipped[0]).toBeCloseTo(old[0], 5)
    expect(chipped[1]).toBeCloseTo(old[1], 5)
    const remnant = meshStats(body)
    expect(remnant.volume).toBeLessThanOrEqual(original.volume * .6)
    expect(remnant.open).toBe(0)
    const parts = chips.map(({ geometry }) => meshStats(geometry))
    expect(parts.every(part => part.open === 0)).toBe(true)
    expect(remnant.volume + parts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(original.volume, 5)
  }
})
