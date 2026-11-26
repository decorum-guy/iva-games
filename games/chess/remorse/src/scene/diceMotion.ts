import { Quaternion, Vector3 } from 'three'
import type { DieFace } from '../core/types'

export const DIE_MOTION_MS = 1500
export const DIE_REDUCED_MOTION_MS = 180
export const DIE_SETTLED_HOLD_MS = 350
export const DIE_EDGE_RADIUS = .105
export const DIE_HALF_SIZE = .5

export interface DieMotionTiming {
  readonly motionMs: number
  readonly totalMs: number
  readonly holdMs: number
  readonly impactsMs: readonly number[]
}

const timing: DieMotionTiming = Object.freeze({
  motionMs: DIE_MOTION_MS,
  totalMs: DIE_MOTION_MS + DIE_SETTLED_HOLD_MS,
  holdMs: DIE_SETTLED_HOLD_MS,
  impactsMs: Object.freeze([360, 760, 1080, 1320, DIE_MOTION_MS]),
})
const reducedTiming: DieMotionTiming = Object.freeze({
  motionMs: DIE_REDUCED_MOTION_MS,
  totalMs: DIE_REDUCED_MOTION_MS + DIE_SETTLED_HOLD_MS,
  holdMs: DIE_SETTLED_HOLD_MS,
  impactsMs: Object.freeze([DIE_REDUCED_MOTION_MS]),
})

/** Shared by presentation, its outside hold/gate and sound; never by game RNG. */
export function getDieMotionTiming(reduced: boolean): DieMotionTiming {
  return reduced ? reducedTiming : timing
}

export function getDieThrowDuration(reduced: boolean): number {
  return getDieMotionTiming(reduced).totalMs
}

/** A late-mounted view catches up to the committed presentation clock. */
export function getDiePresentationClock(reduced: boolean, startedAt: number, now: number) {
  const elapsedMs = Number.isFinite(startedAt) && Number.isFinite(now) ? Math.max(0, now - startedAt) : 0
  const remainingMs = Math.max(0, getDieMotionTiming(reduced).motionMs - elapsedMs)
  return { elapsedMs, remainingMs, phase: remainingMs > 0 ? 'throwing' as const : 'settled' as const }
}

type Point3 = readonly [number, number, number]
type Rotation4 = readonly [number, number, number, number]

export const DIE_CAMERA_POSITION: Point3 = [3.4, 15, 5.2]
export const DIE_CAMERA_TARGET: Point3 = [0, .85, 0]

// The mesh and orientation tests use this same physical die convention.
// Opposite faces are 1/6, 2/5 and 3/4.
export const DIE_FACE_NORMALS: Readonly<Record<DieFace, Point3>> = {
  1: [0, 1, 0], 2: [0, 0, 1], 3: [1, 0, 0],
  4: [-1, 0, 0], 5: [0, 0, -1], 6: [0, -1, 0],
}

export const DIE_PIPS: Readonly<Record<DieFace, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [[-.22, .22], [.22, -.22]],
  3: [[-.22, .22], [0, 0], [.22, -.22]],
  4: [[-.22, .22], [.22, .22], [-.22, -.22], [.22, -.22]],
  5: [[-.22, .22], [.22, .22], [0, 0], [-.22, -.22], [.22, -.22]],
  6: [[-.22, .22], [.22, .22], [-.22, 0], [.22, 0], [-.22, -.22], [.22, -.22]],
}

export interface DieMotionPlan {
  readonly face: DieFace
  readonly reduced: boolean
  readonly timing: DieMotionTiming
  readonly finalQuaternion: Rotation4
  readonly spinAxis: Point3
  readonly spinAngle: number
  readonly startX: number
  readonly sideways: number
}

export interface DieMotionSample {
  readonly position: Point3
  readonly quaternion: Rotation4
  readonly clearance: number
  readonly shadowScale: number
  readonly shadowOpacity: number
  readonly phase: 'throwing' | 'settled'
}

function cosmeticHash(key: string): number {
  let value = 2166136261
  for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619)
  return value >>> 0
}

/** The authoritative face is an input. Key hashing varies only the visible throw. */
export function createDieMotion(face: DieFace, rollKey: string, reduced = false): DieMotionPlan {
  if (!Number.isInteger(face) || face < 1 || face > 6) throw new RangeError('Invalid die face')
  const variation = cosmeticHash(rollKey)
  const unit = (variation & 0xffff) / 0xffff
  const other = (variation >>> 16) / 0xffff
  const up = new Vector3(0, 1, 0)
  const final = new Quaternion().setFromUnitVectors(new Vector3(...DIE_FACE_NORMALS[face]), up)
  final.premultiply(new Quaternion().setFromAxisAngle(up, (unit - .5) * .56))
  const axis = new Vector3(.82 + unit * .22, .32, .55 + other * .30).normalize()
  return {
    face, reduced, timing: getDieMotionTiming(reduced),
    finalQuaternion: [final.x, final.y, final.z, final.w],
    spinAxis: [axis.x, axis.y, axis.z],
    spinAngle: (1.85 + other * .40) * Math.PI * 2 * (variation & 1 ? 1 : -1),
    startX: -.78 - unit * .18,
    sideways: (other - .5) * .44,
  }
}

/** Vertical support of a rounded cube: core box plus a spherical edge radius. */
export function dieSupportHeight(q: Rotation4): number {
  const [x, y, z, w] = q
  const projectedAxes = Math.abs(2 * (x * y + w * z))
    + Math.abs(1 - 2 * (x * x + z * z))
    + Math.abs(2 * (y * z - w * x))
  return (DIE_HALF_SIZE - DIE_EDGE_RADIUS) * projectedAxes + DIE_EDGE_RADIUS
}

function bounceClearance(elapsed: number): number {
  const contacts = timing.impactsMs
  if (elapsed < contacts[0]) {
    const t = elapsed / contacts[0]
    return 1.48 * (1 - t * t)
  }
  const heights = [.66, .32, .13, .042]
  for (let i = 0; i < heights.length; i++) {
    if (elapsed <= contacts[i + 1]) {
      const t = (elapsed - contacts[i]) / (contacts[i + 1] - contacts[i])
      return 4 * heights[i] * t * (1 - t)
    }
  }
  return 0
}

/** Pure sampling: finite, deterministic cosmetics with an exact settled pose. */
export function sampleDieMotion(plan: DieMotionPlan, elapsedMs: number): DieMotionSample {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs)
    : elapsedMs === Infinity ? plan.timing.motionMs : 0
  const t = Math.min(1, elapsed / plan.timing.motionMs)
  const remaining = 1 - t
  const final = new Quaternion(...plan.finalQuaternion)
  const rotation = plan.reduced || t === 1 ? final
    : new Quaternion().setFromAxisAngle(new Vector3(...plan.spinAxis), plan.spinAngle * remaining ** 1.45).multiply(final)
  const quaternion: Rotation4 = [rotation.x, rotation.y, rotation.z, rotation.w]
  const clearance = plan.reduced ? .10 * remaining ** 2 : bounceClearance(elapsed)
  const x = plan.reduced ? 0 : plan.startX * remaining ** 1.8
  const z = plan.reduced ? 0 : plan.sideways * Math.sin(Math.PI * t) * remaining
  return {
    position: [x, dieSupportHeight(quaternion) + clearance, z],
    quaternion,
    clearance,
    shadowScale: 1 + clearance * .32,
    shadowOpacity: .38 / (1 + clearance * 1.9),
    phase: t === 1 ? 'settled' : 'throwing',
  }
}

/** Fit the whole throw, not just its final pose, into a compact dock. The
 * camera stays fixed during the throw so the falling cube retains its weight. */
export function frameDieThrow(plan: DieMotionPlan, aspect: number) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const position = new Vector3(...DIE_CAMERA_POSITION);
  const target = new Vector3(...DIE_CAMERA_TARGET);
  const forward = target.clone().sub(position).normalize();
  const right = forward.clone().cross(new Vector3(0, 1, 0)).normalize();
  const up = right.clone().cross(forward).normalize();
  const point = new Vector3();
  let left = Infinity, rightEdge = -Infinity, bottom = Infinity, top = -Infinity;
  const include = (world: Vector3) => {
    point.copy(world).sub(target);
    const x = point.dot(right), y = point.dot(up);
    left = Math.min(left, x); rightEdge = Math.max(rightEdge, x);
    bottom = Math.min(bottom, y); top = Math.max(top, y);
  };
  const corner = new Vector3();
  // Bounding corners conservatively contain the actual rounded mesh. The
  // margin also covers extrema between samples and the soft contact shadow.
  for (let frame = 0; frame <= 96; frame++) {
    const pose = sampleDieMotion(plan, frame * plan.timing.motionMs / 96);
    const rotation = new Quaternion(...pose.quaternion);
    const translation = new Vector3(...pose.position);
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      include(corner.set(x, y, z).applyQuaternion(rotation).add(translation));
    }
    if (pose.clearance < .05) {
      for (const x of [-.72, .72]) for (const z of [-.58, .58]) {
        include(corner.set(pose.position[0] + x, 0, pose.position[2] + z));
      }
    }
  }
  const offset = right.multiplyScalar((left + rightEdge) / 2).add(up.multiplyScalar((bottom + top) / 2));
  const height = Math.max(top - bottom, (rightEdge - left) / ratio) * 1.12;
  return {
    position: position.add(offset), target: target.add(offset),
    width: height * ratio, height,
  };
}
