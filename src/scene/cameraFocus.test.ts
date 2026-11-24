import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three'
import type { PieceType, Side } from '../core/types'
import {
  BOARD_FRAMING_POINTS, CAMERA_OVERSCAN, CAMERA_TRAVEL_MS, COUNTER_FOCUS_DELAY_MS, COUNTER_FOCUS_MS, COUNTER_OFFSET,
  FOCUS_EMPHASIS_MS, MAX_FOCUS_ZOOM, frameCamera, frameCameraOrbit, overscanFov, sampleCameraTravel,
  sampleCounterEmphasis, sampleFigureEmphasis,
} from './cameraFocus'
import type { CameraFrame, CameraRig, GroundPoint, Point3 } from './cameraFocus'
import { stoneMaterial } from './stone'

interface Gltf {
  nodes: { name: string; mesh?: number }[]
  meshes: { primitives: { attributes: { POSITION: number } }[] }[]
  accessors: { min: number[]; max: number[] }[]
}
const gltf = JSON.parse(readFileSync(new URL('../../public/assets/chess/chess_set_1k.gltf', import.meta.url), 'utf8')) as Gltf
const kinds: readonly PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']
const corners: readonly GroundPoint[] = [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]
const radians = Math.PI / 180

// Normalize bounding corners from the shipped asset, including the knight's
// deliberately off-centre head, rather than testing only an invented unit cube.
function modelBounds(side: Side, kind: PieceType, [x, z]: GroundPoint): Point3[] {
  const suffix = kind === 'king' || kind === 'queen' ? '' : '_01'
  const node = gltf.nodes.find(item => item.name === `piece_${kind}_${side}${suffix}`)!
  const accessors = gltf.meshes[node.mesh!].primitives.map(item => gltf.accessors[item.attributes.POSITION])
  const min = [0, 1, 2].map(axis => Math.min(...accessors.map(item => item.min[axis])))
  const max = [0, 1, 2].map(axis => Math.max(...accessors.map(item => item.max[axis])))
  const centerX = kind === 'knight' ? 0 : (min[0] + max[0]) / 2
  const centerZ = kind === 'knight' ? 0 : (min[2] + max[2]) / 2
  return [min[0], max[0]].flatMap(px => [min[1], max[1]].flatMap(py => [min[2], max[2]].map(pz => [
    x - (px - centerX) / .05788808, .005 + (py - min[1]) / .05788808, z - (pz - centerZ) / .05788808,
  ] as const)))
}

function cameraFor(rig: CameraRig, aspect: number, frame: CameraFrame) {
  const camera = new PerspectiveCamera(rig.fov, aspect, .18, 60)
  camera.position.copy(frame.position)
  camera.lookAt(frame.target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return camera
}

function screenExtent(points: readonly Point3[], camera: PerspectiveCamera) {
  let edge = 0
  for (const value of points) {
    const point = new Vector3(...value).project(camera)
    expect(point.z).toBeGreaterThan(-1)
    expect(point.z).toBeLessThan(1)
    edge = Math.max(edge, Math.abs(point.x), Math.abs(point.y))
  }
  return edge
}

const layouts = [
  { name: 'laptop studio', aspect: 780 / 580, elevation: 58, yaw: 3.5, fov: 35, compact: false },
  { name: 'phone portrait studio', aspect: 342 / 430, elevation: 67, yaw: .6, fov: 35, compact: true },
  { name: 'phone short landscape', aspect: 260 / 190, elevation: 67, yaw: .6, fov: 35, compact: true },
  { name: 'phone tactical', aspect: 342 / 430, elevation: 75, yaw: 0, fov: 35, compact: true },
  { name: 'phone top', aspect: 342 / 430, elevation: 89.98, yaw: 0, fov: 26, compact: true },
]

describe('teaching camera framing', () => {
  it.each(layouts)('keeps every real piece and its enlarged counter in frame at all four corners: $name', layout => {
    for (const flipped of [false, true]) for (const point of corners) {
      const rig: CameraRig = {
        elevation: layout.elevation * radians, yaw: layout.yaw * radians + (flipped ? Math.PI : 0),
        fov: layout.fov, focusAmount: 1, focusPoint: point,
      }
      const frame = frameCamera(rig, layout.aspect, layout.compact)
      const camera = cameraFor(rig, layout.aspect, frame)
      const overview = frameCamera({ ...rig, focusAmount: 0 }, layout.aspect, layout.compact)
      expect(overview.distance / frame.distance).toBeGreaterThan(1.5)
      expect(overview.distance / frame.distance).toBeLessThanOrEqual(MAX_FOCUS_ZOOM + 1e-12)
      const expectedDirection = new Vector3(Math.cos(rig.elevation) * Math.sin(rig.yaw), Math.sin(rig.elevation), Math.cos(rig.elevation) * Math.cos(rig.yaw))
      expect(frame.position.clone().sub(frame.target).normalize().distanceTo(expectedDirection)).toBeLessThan(1e-12)
      for (const side of ['white', 'black'] as const) for (const kind of kinds) {
        expect(screenExtent(modelBounds(side, kind, point), camera)).toBeLessThan(.85)
      }
      // A sprite stays camera-facing; check its actual expanded corners, not
      // a plane left flat on the board. This covers both near-side directions.
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
      const anchor = new Vector3(point[0], .209, point[1]).addScaledVector(right, -COUNTER_OFFSET)
      const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const half = (layout.compact ? .42 : .35) * 1.60 * 1.2 / 2
      const badge = [-1, 1].flatMap(dx => [-1, 1].map(dy => {
        const value = anchor.clone().addScaledVector(right, dx * half).addScaledVector(up, dy * half)
        return [value.x, value.y, value.z] as const
      }))
      expect(screenExtent(badge, camera)).toBeLessThan(.85)
    }
  })

  it.each(layouts)('does not crop the corner king while approaching or returning: $name', layout => {
    for (const point of corners) for (const flipped of [false, true]) {
      const overview: CameraRig = {
        elevation: layout.elevation * radians, yaw: layout.yaw * radians + (flipped ? Math.PI : 0),
        fov: layout.fov, focusAmount: 0, focusPoint: point,
      }
      const focused = { ...overview, focusAmount: 1 }
      for (const [from, to] of [[overview, focused], [focused, overview]]) {
        for (const time of [0, 170, 425, 680, 850]) {
          const rig = sampleCameraTravel(from, to, time)
          const frame = frameCamera(rig, layout.aspect, layout.compact)
          expect(screenExtent(modelBounds('white', 'king', point), cameraFor(rig, layout.aspect, frame))).toBeLessThan(1)
        }
      }
      const returned = frameCamera(sampleCameraTravel(focused, overview, CAMERA_TRAVEL_MS), layout.aspect, layout.compact)
      const ordinary = frameCamera(overview, layout.aspect, layout.compact)
      expect(returned.position.distanceTo(ordinary.position)).toBeLessThan(1e-12)
      expect(returned.target.distanceTo(ordinary.target)).toBeLessThan(1e-12)
    }
  })

  it.each(layouts)('takes one uninterrupted 850ms orbit at a fixed radius: $name', layout => {
    const from: CameraRig = { elevation: layout.elevation * radians, yaw: layout.yaw * radians,
      fov: layout.fov, focusAmount: 0, focusPoint: [0, 0] }
    const to = { ...from, yaw: from.yaw + Math.PI }
    const start = frameCamera(from, layout.aspect, layout.compact)
    const finish = frameCamera(to, layout.aspect, layout.compact)
    expect(CAMERA_TRAVEL_MS).toBe(850)
    expect(sampleCameraTravel(from, to, 0)).toEqual(from)
    expect(sampleCameraTravel(from, to, 850)).toEqual(to)
    const firstStep = sampleCameraTravel(from, to, 10).yaw - from.yaw
    const middleStep = sampleCameraTravel(from, to, 425).yaw - sampleCameraTravel(from, to, 415).yaw
    expect(Math.abs(firstStep)).toBeLessThan(Math.abs(middleStep) / 10)
    let previous = from.yaw
    let largest = 0
    for (let elapsed = 0; elapsed <= CAMERA_TRAVEL_MS; elapsed += 10) {
      const rig = sampleCameraTravel(from, to, elapsed)
      expect(Math.abs(Math.atan2(Math.sin(rig.yaw - previous), Math.cos(rig.yaw - previous)))).toBeLessThan(.061)
      previous = rig.yaw
      const frame = frameCameraOrbit(rig, start, finish, elapsed)
      expect(frame.distance).toBeCloseTo(start.distance, 10)
      largest = Math.max(largest, screenExtent(BOARD_FRAMING_POINTS,
        cameraFor(rig, layout.aspect, frame)))
      expect(screenExtent(BOARD_FRAMING_POINTS, cameraFor({ ...rig, fov: overscanFov(rig.fov) },
        layout.aspect, frame))).toBeLessThan(1)
    }
    expect(CAMERA_OVERSCAN).toBeGreaterThan(1)
    expect(largest).toBeGreaterThan(1)
    const landed = frameCameraOrbit(to, start, finish, CAMERA_TRAVEL_MS)
    expect(landed.position.distanceTo(finish.position)).toBeLessThan(1e-12)
  })

  it('uses the short orbit across angle zero instead of an unnecessary full turn', () => {
    const from: CameraRig = { elevation: 1, yaw: 359 * radians, fov: 35, focusAmount: 0, focusPoint: [0, 0] }
    const to = { ...from, yaw: radians }
    expect(sampleCameraTravel(from, to, 425).yaw).toBeCloseTo(Math.PI * 2, 12)
  })
})

describe('ordered figure and counter emphasis', () => {
  it('emphasizes the material once, returns to its ordinary intensity, then frames the counter', () => {
    expect(sampleFigureEmphasis(0, false)).toBe(0)
    expect(sampleFigureEmphasis(180, false)).toBe(1)
    expect(sampleFigureEmphasis(360, false)).toBe(1)
    expect(sampleFigureEmphasis(CAMERA_TRAVEL_MS, false)).toBeLessThan(.15)
    expect(sampleFigureEmphasis(FOCUS_EMPHASIS_MS, false)).toBe(0)
    expect(sampleFigureEmphasis(20_000, false)).toBe(0)
    expect(sampleCounterEmphasis(CAMERA_TRAVEL_MS, false)).toBe(0)
    expect(sampleCounterEmphasis(COUNTER_FOCUS_DELAY_MS, false)).toBe(0)
    expect(sampleCounterEmphasis(COUNTER_FOCUS_DELAY_MS + COUNTER_FOCUS_MS / 2, false)).toBeCloseTo(.5)
    expect(sampleCounterEmphasis(COUNTER_FOCUS_DELAY_MS + COUNTER_FOCUS_MS, false)).toBe(1)
    expect(sampleCounterEmphasis(20_000, false)).toBe(1)
  })

  it('keeps reduced-motion emphasis static at every sampled time', () => {
    for (const time of [0, 100, 850, 1030, 1270, 100_000]) {
      expect(sampleFigureEmphasis(time, true)).toBe(.48)
      expect(sampleCounterEmphasis(time, true)).toBe(1)
    }
  })

  it('does not share focused material state with another same-army figure or overwrite capture impulse', () => {
    const source = new MeshStandardMaterial()
    const first = stoneMaterial(source, 'white', 1)
    const second = stoneMaterial(source, 'white', 2)
    first.values.uEmber.value = .7
    first.values.uFocus.value = 1
    expect(second.values.uFocus.value).toBe(0)
    expect(second.values.uEmber.value).toBe(0)
    expect(first.values.uEmber.value).toBe(.7)
    first.material.dispose()
    second.material.dispose()
    source.dispose()
  })
})
