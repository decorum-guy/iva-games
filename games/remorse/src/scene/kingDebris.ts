import { Euler, Quaternion, Vector3, type BufferGeometry } from 'three'
import { kingFallPose, type KingFall } from './kingFall'

type Chip = { geometry: BufferGeometry; center: Vector3; direction: Vector3 }
export type DebrisField = { x: number; z: number; neighbors: { x: number; z: number; radius: number }[] }

const step = 1 / 60
const ticks = 84
const stride = 7

function verticesOf(geometry: BufferGeometry) {
  const data = geometry.getAttribute('position')
  const unique = new Map<string, Vector3>()
  for (let i = 0; i < data.count; i++) {
    const point = new Vector3().fromBufferAttribute(data, i)
    const key = [point.x, point.y, point.z].map(v => Math.round(v * 1e4)).join('/')
    if (!unique.has(key)) unique.set(key, point)
  }
  return [...unique.values()]
}

function height(points: Vector3[], orientation: Quaternion, scratch: Vector3) {
  const { x, y, z, w } = orientation
  scratch.set(2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w))
  let bottom = Infinity
  for (const p of points) bottom = Math.min(bottom, p.dot(scratch))
  return -bottom
}

/** Bake a short, deterministic rigid-fragment trajectory in the board frame.
 * The original transformed mesh is frame zero and the final supported pose is
 * shared by live, restored and reduced-motion boards. */
export function planKingDebris(chips: Chip[], fall: KingFall, field: DebrisField) {
  const pose = kingFallPose(fall, 1)
  const initial = new Quaternion().setFromAxisAngle(new Vector3(fall.dz, 0, -fall.dx), pose.angle)
  const shift = new Vector3(fall.dx * pose.offset, pose.lift, fall.dz * pose.offset)
  const normal = new Vector3(), turn = new Quaternion(), euler = new Euler(), scratch = new Vector3()
  const states = chips.map((chip, i) => {
    const points = verticesOf(chip.geometry)
    const position = chip.center.clone().applyQuaternion(initial).add(shift)
    const radial = chip.direction.clone().applyQuaternion(initial)
    // Keep an inward component at edge squares and a side impulse away from the remaining shaft.
    const lateral = (chip.center.x * fall.dz - chip.center.z * fall.dx) >= 0 ? 1 : -1
    const velocity = new Vector3(radial.x + .78 * fall.dz * lateral - .085 * field.x,
      0, radial.z - .78 * fall.dx * lateral - .085 * field.z).normalize().multiplyScalar(1.58 + .13 * (i % 5))
    velocity.y = 1.09 + .18 * ((i * 7) % 5)
    const orientation = initial.clone()
    const rest = initial.clone()
    let lowest = Infinity
    // A broad low face is energetically preferable to balancing the shard on its end.
    for (let j = 0; j < 32; j++) {
      turn.setFromEuler(euler.set(j * 1.613 + i, j * 2.399, j * .749))
      const h = height(points, turn, scratch)
      if (h < lowest) { lowest = h; rest.copy(turn) }
    }
    const radius = Math.max(...points.map(p => p.length()))
    return { points, position, velocity, orientation, rest, radius, touched: false,
      frames: new Float32Array((ticks + 1) * stride) }
  })

  for (let tick = 0; tick <= ticks; tick++) {
    for (const [i, s] of states.entries()) {
      const p = s.position, v = s.velocity, q = s.orientation
      if (tick > 0) {
        if (s.touched) q.slerp(s.rest, tick > 68 ? .34 : .105)
        else {
          turn.setFromEuler(euler.set(step * (i % 2 ? 4.4 : -4.1), step * (1.2 + i * .2), step * 3.5))
          q.premultiply(turn)
        }
        v.y -= 9.81 * step
        p.addScaledVector(v, step)
        const floor = height(s.points, q, scratch)
        if (p.y <= floor) {
          p.y = floor
          s.touched = true
          v.y = v.y < -.5 ? -v.y * .31 : 0
          const speed = Math.hypot(v.x, v.z)
          const drag = Math.max(0, 1 - (speed ? 2.85 * step / speed : 1))
          v.x *= drag; v.z *= drag
        }
        // Resolve horizontal contacts against the bounding sphere. Roots are local to the king's square.
        for (const other of field.neighbors) {
          const dx = p.x - other.x, dz = p.z - other.z
          const distance = Math.hypot(dx, dz), limit = other.radius + s.radius
          if (distance >= limit || distance < 1e-8) continue
          normal.set(dx / distance, 0, dz / distance)
          p.addScaledVector(normal, limit - distance)
          const speed = v.dot(normal)
          if (speed < 0) v.addScaledVector(normal, -1.34 * speed)
        }
        for (const axis of ['x', 'z'] as const) {
          const edge = 3.98 - s.radius
          const board = p[axis] + field[axis]
          if (Math.abs(board) <= edge) continue
          const sign = Math.sign(board)
          p[axis] = sign * edge - field[axis]
          if (sign * v[axis] > 0) v[axis] *= -.38
        }
        if (tick === ticks) { q.copy(s.rest); p.y = height(s.points, q, scratch) }
      }
      const offset = tick * stride
      p.toArray(s.frames, offset)
      q.toArray(s.frames, offset + 3)
    }
  }
  return states.map(s => s.frames)
}

export function sampleKingDebris(frames: Float32Array, seconds: number, position: Vector3, orientation: Quaternion, scratch: Quaternion) {
  const tick = Math.max(0, Math.min(ticks, seconds / step)), a = Math.floor(tick) * stride
  const b = Math.min(a + stride, ticks * stride), t = tick - Math.floor(tick)
  position.set(frames[a] + (frames[b] - frames[a]) * t, frames[a + 1] + (frames[b + 1] - frames[a + 1]) * t,
    frames[a + 2] + (frames[b + 2] - frames[a + 2]) * t)
  orientation.fromArray(frames, a + 3).slerp(scratch.fromArray(frames, b + 3), t).normalize()
}
