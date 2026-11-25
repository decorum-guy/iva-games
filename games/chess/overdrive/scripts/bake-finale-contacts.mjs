// Offline narrow phase for the six shipped GLBs. The live board only looks up
// a first contact for its actual neighbour types, squares and knight facings.
import { readFile, writeFile } from 'node:fs/promises'
import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBVH } from 'three-mesh-bvh'

const models = {}
for (const type of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']) {
  const bytes = await readFile(new URL('../public/assets/overdrive/models/' + type + '.glb', import.meta.url))
  const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')
  scene.updateMatrixWorld(true)
  const parts = []
  scene.traverse(node => {
    if (!node.isMesh) return
    const original = node.geometry
    const positions = original.index ? original.toNonIndexed().attributes.position : original.attributes.position
    parts.push(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions.array, 3)).applyMatrix4(node.matrixWorld))
  })
  models[type] = mergeGeometries(parts)
  models[type].boundsTree = new MeshBVH(models[type])
}
const king = models.king
const vertices = []
const known = new Set()
for (let i = 0; i < king.attributes.position.count; i++) {
  const p = new Vector3().fromBufferAttribute(king.attributes.position, i)
  const key = p.toArray().join(',')
  if (!known.has(key)) { known.add(key); vertices.push(p) }
}
const round = x => Number(x.toFixed(6))
const directions = []
// Diagonal first gives an open corner an inward three-quarter silhouette.
for (const degrees of [45, 135, 315, 225, 0, 180, 90, 270]) {
  const yaw = degrees * Math.PI / 180
  const dx = Math.cos(yaw), dz = Math.sin(yaw)
  const axis = new Vector3(dz, 0, -dx)
  const rim = Math.max(...vertices.filter(p => Math.abs(p.y) < 1e-6).map(p => p.x*dx + p.z*dz))
  // Angle where a second part of the king meets the ceramic, sharing the
  // load with the rim of the mounting foot. Works for the asymmetric cross.
  const floor = Math.min(...vertices.filter(p => p.y > .001).map(p => Math.PI/2 + Math.atan2(rim-p.x*dx-p.z*dz, p.y)))
  function transform(angle) {
    const travel = rim * (1 - Math.cos(angle))
    const drop = .02 * Math.min(1, angle / .08)
    return new Matrix4().makeRotationAxis(axis, angle).setPosition(dx*travel, rim*Math.sin(angle)-drop, dz*travel)
  }
  const bounds = new Box3()
  const scratch = new Vector3()
  for (let i = 0; i <= 100; i++) {
    const matrix = transform(floor * i / 100)
    for (const p of vertices) bounds.expandByPoint(scratch.copy(p).applyMatrix4(matrix))
  }
  const contacts = {}
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (!x && !z) continue
    if (x < bounds.min.x-.32 || x > bounds.max.x+.32 || z < bounds.min.z-.32 || z > bounds.max.z+.32) continue
    const cell = {}
    for (const [type, geometry] of Object.entries(models)) {
      for (const facing of type === 'knight' ? ['white', 'black'] : ['']) {
        const rotation = facing === 'white' ? Math.PI/4 : facing === 'black' ? -3*Math.PI/4 : 0
        const inverse = new Matrix4().makeRotationY(rotation).setPosition(x, 0, z).invert()
        const touches = angle => geometry.boundsTree.intersectsGeometry(king, new Matrix4().multiplyMatrices(inverse, transform(angle)))
        for (let i = 1; i <= 190; i++) {
          if (!touches(floor*i/190)) continue
          let lo = floor*(i-1)/190, hi = floor*i/190
          for (let n = 0; n < 16; n++) {
            const mid = (lo+hi)/2
            if (touches(mid)) hi = mid
            else lo = mid
          }
          cell[facing ? type+'-'+facing : type] = round(lo)
          break
        }
      }
    }
    if (Object.keys(cell).length) contacts[[x,z].join(',')] = cell
  }
  directions.push({dx:round(dx),dz:round(dz),rim:round(rim),floor:round(floor),
    bounds:[bounds.min.x,bounds.max.x,bounds.min.z,bounds.max.z].map(round),contacts})
}
await writeFile(new URL('../src/ui/finale-contacts.json', import.meta.url), JSON.stringify(directions, null, 2)+'\n')
