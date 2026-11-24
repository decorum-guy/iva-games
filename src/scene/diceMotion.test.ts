import { describe, expect, it, vi } from 'vitest'
import { OrthographicCamera, Quaternion, Vector3 } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { DieFace } from '../core/types'
import {
  createDieMotion, DIE_CAMERA_POSITION, DIE_CAMERA_TARGET, DIE_EDGE_RADIUS,
  DIE_FACE_NORMALS, DIE_PIPS, dieSupportHeight, getDieMotionTiming, getDiePresentationClock,
  getDieThrowDuration, sampleDieMotion,
} from './diceMotion'

const faces = [1, 2, 3, 4, 5, 6] as const
const keys = ['human/capture/12', 'AI/capture/13', 'tutorial/fixed/berserk']

describe('authoritative die result', () => {
  it.each(faces)('settles with face %s exactly up, its opposite down and its pips visible to the camera', face => {
    for (const key of keys) {
      const plan = createDieMotion(face, key)
      const settled = sampleDieMotion(plan, plan.timing.motionMs)
      const rotation = new Quaternion(...settled.quaternion)
      const top = new Vector3(...DIE_FACE_NORMALS[face]).applyQuaternion(rotation)
      const opposite = new Vector3(...DIE_FACE_NORMALS[(7 - face) as DieFace]).applyQuaternion(rotation)
      const towardCamera = new Vector3(...DIE_CAMERA_POSITION).sub(new Vector3(...settled.position)).normalize()
      expect(rotation.length()).toBeCloseTo(1, 12)
      expect(top.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-12)
      expect(opposite.distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-12)
      expect(top.dot(towardCamera)).toBeGreaterThan(.70)
      for (const side of faces.filter(value => value !== face && value !== 7 - face)) {
        expect(new Vector3(...DIE_FACE_NORMALS[side]).applyQuaternion(rotation).y).toBeCloseTo(0, 12)
      }
      expect(DIE_PIPS[face]).toHaveLength(face)
      expect(new Set(DIE_PIPS[face].map(point => point.join(','))).size).toBe(face)
      expect(settled.phase).toBe('settled')
      expect(settled.position[0]).toBeCloseTo(0, 12)
      expect(settled.position[1]).toBeCloseTo(.5, 12)
      expect(settled.position[2]).toBeCloseTo(0, 12)
      expect(settled.clearance).toBe(0)
      expect(sampleDieMotion(plan, plan.timing.totalMs)).toEqual(settled)
      expect(sampleDieMotion(plan, 60_000)).toEqual(settled)
    }
  })

  it('varies cosmetics deterministically without consulting random or changing its input face', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Cosmetics must not roll') })
    try {
      const first = createDieMotion(4, keys[0])
      const again = createDieMotion(4, keys[0])
      const another = createDieMotion(4, keys[1])
      expect(first).toEqual(again)
      expect(sampleDieMotion(first, 650)).toEqual(sampleDieMotion(again, 650))
      expect(sampleDieMotion(first, 650).quaternion).not.toEqual(sampleDieMotion(another, 650).quaternion)
      expect(first.face).toBe(4)
      expect(another.face).toBe(4)
      expect(random).not.toHaveBeenCalled()
    } finally { random.mockRestore() }
  })

  it.each([0, 7, -1, 2.5, NaN])('rejects an invalid committed face %s', face => {
    expect(() => createDieMotion(face as DieFace, 'invalid')).toThrow(RangeError)
  })
})

describe('throw trajectory and shared timing', () => {
  it.each([false, true])('catches a late view up to the shared presentation epoch (reduced=%s)', reduced => {
    const timing = getDieMotionTiming(reduced)
    const startedAt = 5000
    const late = getDiePresentationClock(reduced, startedAt, startedAt + timing.motionMs + 100)
    expect(late.phase).toBe('settled')
    expect(late.remainingMs).toBe(0)
    expect(late.elapsedMs).toBe(timing.motionMs + 100)
    expect(sampleDieMotion(createDieMotion(5, 'late-mount', reduced), late.elapsedMs).phase).toBe('settled')
    expect(getDiePresentationClock(reduced, startedAt, startedAt + timing.motionMs / 2)).toEqual({
      phase: 'throwing', remainingMs: timing.motionMs / 2, elapsedMs: timing.motionMs / 2,
    })
  })

  it('uses a diminishing bounce at every shared impact and keeps a separate settled hold', () => {
    const timing = getDieMotionTiming(false)
    expect(timing).toEqual({ motionMs: 1500, totalMs: 1850, holdMs: 350, impactsMs: [360, 760, 1080, 1320, 1500] })
    expect(getDieThrowDuration(false)).toBe(timing.totalMs)
    const plan = createDieMotion(2, keys[0])
    expect(sampleDieMotion(plan, 0).clearance).toBeGreaterThan(1)
    let previousPeak = Infinity
    timing.impactsMs.forEach((at, index) => {
      const contact = sampleDieMotion(plan, at)
      expect(contact.clearance).toBeCloseTo(0, 12)
      expect(contact.position[1]).toBeCloseTo(dieSupportHeight(contact.quaternion), 12)
      if (index > 0) {
        const peak = sampleDieMotion(plan, (timing.impactsMs[index - 1] + at) / 2).clearance
        expect(peak).toBeGreaterThan(0)
        expect(peak).toBeLessThan(previousPeak)
        previousPeak = peak
      }
    })
    expect(sampleDieMotion(plan, timing.motionMs - 1).phase).toBe('throwing')
    expect(sampleDieMotion(plan, timing.motionMs).phase).toBe('settled')
  })

  it('produces finite normalized poses and nonnegative clearance throughout either motion mode', () => {
    for (const reduced of [false, true]) for (const face of faces) for (const key of keys) {
      const plan = createDieMotion(face, key, reduced)
      const times = [-10, NaN, -Infinity, Infinity, ...Array.from({ length: 41 }, (_, i) => i * plan.timing.motionMs / 40)]
      for (const time of times) {
        const pose = sampleDieMotion(plan, time)
        expect([...pose.position, ...pose.quaternion, pose.clearance, pose.shadowScale, pose.shadowOpacity].every(Number.isFinite)).toBe(true)
        expect(new Quaternion(...pose.quaternion).length()).toBeCloseTo(1, 11)
        expect(pose.clearance).toBeGreaterThanOrEqual(0)
        expect(pose.position[1]).toBeGreaterThanOrEqual(dieSupportHeight(pose.quaternion))
        expect(pose.shadowOpacity).toBeGreaterThan(0)
        expect(pose.shadowOpacity).toBeLessThanOrEqual(.38)
      }
    }
  })

  it.each(faces)('keeps the real rounded mesh above the floor and inside the portrait overlay for face %s', face => {
    const geometry = new RoundedBoxGeometry(1, 1, 1, 5, DIE_EDGE_RADIUS)
    const positions = geometry.getAttribute('position')
    // Match the component's 1.08 aspect and min(width,height)/4 camera zoom.
    const camera = new OrthographicCamera(-2.16, 2.16, 2, -2, .1, 24)
    camera.position.set(...DIE_CAMERA_POSITION)
    camera.lookAt(...DIE_CAMERA_TARGET)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    const point = new Vector3()
    const plan = createDieMotion(face, keys[face % keys.length])
    try {
      for (const time of [0, 180, 360, 560, 760, 920, 1080, 1200, 1320, 1410, 1500]) {
        const pose = sampleDieMotion(plan, time)
        const rotation = new Quaternion(...pose.quaternion)
        const translation = new Vector3(...pose.position)
        let lowest = Infinity
        let largestScreenCoordinate = 0
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyQuaternion(rotation).add(translation)
          lowest = Math.min(lowest, point.y)
          point.project(camera)
          largestScreenCoordinate = Math.max(largestScreenCoordinate, Math.abs(point.x), Math.abs(point.y))
        }
        expect(lowest).toBeGreaterThanOrEqual(-1e-6)
        expect(largestScreenCoordinate).toBeLessThan(1)
      }
    } finally { geometry.dispose() }
  })

  it.each(faces)('uses only a short vertical settle without spinning in reduced motion for face %s', face => {
    const timing = getDieMotionTiming(true)
    expect(timing).toEqual({ motionMs: 180, totalMs: 530, holdMs: 350, impactsMs: [180] })
    expect(getDieThrowDuration(true)).toBe(530)
    const plan = createDieMotion(face, keys[0], true)
    let lastHeight = Infinity
    for (const time of [0, 45, 90, 135, 179, 180, 530]) {
      const pose = sampleDieMotion(plan, time)
      expect(pose.quaternion).toEqual(plan.finalQuaternion)
      expect(pose.position[0]).toBe(0)
      expect(pose.position[2]).toBe(0)
      expect(pose.position[1]).toBeLessThanOrEqual(lastHeight)
      expect(pose.phase).toBe(time < 180 ? 'throwing' : 'settled')
      lastHeight = pose.position[1]
    }
  })
})
