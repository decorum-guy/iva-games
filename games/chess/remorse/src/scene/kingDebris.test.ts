import { BoxGeometry, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { planKingDebris, sampleKingDebris } from './kingDebris'
import { kingFallPose, type KingFall } from './kingFall'

const fall: KingFall = { dx: 1, dz: 0, tuck: .3, height: 1.6, angle: 1.69,
  hull: [{ height: .08, radial: .36 }, { height: 1.32, radial: .21 }] }
const chips = [
  { geometry: new BoxGeometry(.21, .17, .10), center: new Vector3(.08, 1.3, .04), direction: new Vector3(1, .4, .2).normalize() },
  { geometry: new BoxGeometry(.29, .23, .16), center: new Vector3(-.1, .2, -.04), direction: new Vector3(-1, .1, -.4).normalize() },
]
const field = { x: 2.5, z: 2.5, neighbors: [{ x: .8, z: 1, radius: .32 }] }

describe('physical king fragments', () => {
  it('starts every mesh in the intact king’s exact ground-contact transform', () => {
    const pose = kingFallPose(fall, 1)
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), pose.angle)
    for (const [i, frames] of planKingDebris(chips, fall, field).entries()) {
      const p = new Vector3(), spin = new Quaternion()
      sampleKingDebris(frames, 0, p, spin, new Quaternion())
      const center = chips[i].center.clone().applyQuaternion(q).add(new Vector3(pose.offset, pose.lift, 0))
      expect(center.distanceTo(p)).toBeLessThan(1e-6)
      expect(q.angleTo(spin)).toBeLessThan(1e-6)
    }
  })
  it('keeps shards on the board and restores identical resting transforms', () => {
    const live = planKingDebris(chips, fall, field), restored = planKingDebris(chips, fall, field)
    for (const [i, frames] of live.entries()) {
      expect(frames).toEqual(restored[i])
      const p = new Vector3(), q = new Quaternion(), scratch = new Quaternion()
      const points = chips[i].geometry.getAttribute('position')
      for (let tick = 1; tick <= 84; tick++) {
        sampleKingDebris(frames, tick / 60, p, q, scratch)
        let minY = Infinity
        for (let j = 0; j < points.count; j++) {
          const world = new Vector3().fromBufferAttribute(points, j).applyQuaternion(q).add(p)
          expect(Math.abs(world.x + field.x)).toBeLessThan(4)
          expect(Math.abs(world.z + field.z)).toBeLessThan(4)
          expect(Math.hypot(world.x - field.neighbors[0].x, world.z - field.neighbors[0].z)).toBeGreaterThan(.3199)
          minY = Math.min(minY, world.y)
        }
        expect(minY).toBeGreaterThan(-1e-6)
        if (tick === 84) expect(minY).toBeCloseTo(0, 6)
      }
      const final = p.clone()
      sampleKingDebris(restored[i], Infinity, p, q, scratch)
      expect(p.distanceTo(final)).toBe(0)
    }
  })
})
