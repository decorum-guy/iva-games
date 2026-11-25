import { useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import {
  BufferGeometry, FrontSide, Mesh, MeshStandardMaterial, Object3D, Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { PieceType, Side } from '../core/types'

const assetBase = `${import.meta.env.BASE_URL}assets/chess/`
export const studioHDR = `${assetBase}studio_small_09_1k.hdr`
export const marbleModel = `${assetBase}chess_set_1k.gltf`
const WORLD_SCALE = 1 / 0.05788808
const BOARD_Y = 0.017392585
const boardCache = new WeakMap<object, ChessAssets>()

export interface MarbleModel {
  geometry: BufferGeometry
  material: MeshStandardMaterial
}

export interface ChessAssets {
  board: MarbleModel
  pieces: Record<Side, Record<PieceType, MarbleModel>>
}

function loadCatalog(root: object, get: (name: string) => Object3D | undefined): ChessAssets {
  const cached = boardCache.get(root)
  if (cached) return cached

  function extract(name: string): MarbleModel {
    const node = get(name)
    const parts: Mesh[] = []
    node?.traverse(part => { if (part instanceof Mesh) parts.push(part) })
    const material = parts[0]?.material
    if (!(material instanceof MeshStandardMaterial)) throw new Error(`Incomplete chess catalog: ${name}`)
    if (parts.length === 1) return { geometry: parts[0].geometry.clone(), material }
    // The mitre's carved detail is a separate glTF primitive with the same PBR material.
    const shapes = parts.map(part => part.geometry.clone().applyMatrix4(part.matrix))
    const geometry = mergeGeometries(shapes)
    for (const shape of shapes) shape.dispose()
    if (!geometry) throw new Error(`Invalid glTF primitives: ${name}`)
    return { geometry, material }
  }

  function army(side: Side) {
    const result = {} as Record<PieceType, MarbleModel>
    for (const kind of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const) {
      const suffix = kind === 'king' || kind === 'queen' ? '' : '_01'
      const model = extract(`piece_${kind}_${side}${suffix}`)
      const geometry = model.geometry
      geometry.computeBoundingBox()
      const box = geometry.boundingBox!
      const center = box.getCenter(new Vector3())
      // The bases are axisymmetric and centered in the supplied file. The knight's head
      // overhangs its base, so centering on its bounding box would offset its footprint.
      geometry.translate(kind === 'knight' ? 0 : -center.x, -box.min.y, kind === 'knight' ? 0 : -center.z)
      geometry.rotateY(Math.PI)
      geometry.scale(WORLD_SCALE, WORLD_SCALE, WORLD_SCALE)
      result[kind] = model
    }
    return result
  }

  const board = extract('board')
  board.geometry.translate(0, -BOARD_Y, 0)
  board.geometry.scale(WORLD_SCALE, WORLD_SCALE, WORLD_SCALE)
  board.material = board.material.clone()
  board.material.side = FrontSide
  board.material.color.set('#d2c9b8')
  board.material.roughness = 1
  board.material.normalScale.set(0.54, 0.54)
  board.material.envMapIntensity = 0.63
  const catalog = { board, pieces: { white: army('white'), black: army('black') } }
  boardCache.set(root, catalog)
  return catalog
}

export function useChessAssets() {
  const gltf = useLoader(GLTFLoader, marbleModel)
  return useMemo(() => loadCatalog(gltf.scene, name => gltf.scene.getObjectByName(name)), [gltf])
}

export function clearChessAssetLoad() {
  useLoader.clear(GLTFLoader, marbleModel)
}
