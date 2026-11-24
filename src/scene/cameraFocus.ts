import { Vector3 } from 'three'

export const CAMERA_TRAVEL_MS = 850
export const CAMERA_OVERSCAN = 1.68
// Keep the new state prominent when the camera has actually arrived, not only
// during its approach. One restrained fade then leaves the resting material.
export const FOCUS_EMPHASIS_MS = CAMERA_TRAVEL_MS + 950
export const COUNTER_FOCUS_DELAY_MS = CAMERA_TRAVEL_MS + 180
export const COUNTER_FOCUS_MS = 240
export const MAX_FOCUS_ZOOM = 2.6

export type Point3 = readonly [number, number, number]
export type GroundPoint = readonly [number, number]

export interface CameraRig {
  readonly elevation: number
  readonly yaw: number
  readonly fov: number
  readonly focusAmount: number
  readonly focusPoint: GroundPoint
}

export interface CameraFrame {
  readonly position: Vector3
  readonly target: Vector3
  readonly distance: number
}

const up = new Vector3(0, 1, 0)
const overviewOrigin = new Vector3(0, .30, 0)
const radians = Math.PI / 180
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t) }

// Covers the actual 9.55-cell slab and the tallest supplied king (1.642 cells).
export const BOARD_FRAMING_POINTS: readonly Point3[] = [-4.8, 4.8].flatMap(x => [-4.8, 4.8].flatMap(z => [
  [x, -.38, z] as const,
  [x, .01, z] as const,
  [x * .81, 1.70, z * .81] as const,
]))

/** The whole model, base and enlarged camera-facing counter fit in this envelope. */
export function pieceFocusBounds([x, z]: GroundPoint): readonly Point3[] {
  return [-1, 1].flatMap(dx => [-.30, 1.85].flatMap(y => [-1, 1].map(dz => [x + dx, y, z + dz] as const)))
}

export const COUNTER_OFFSET = .79;

export function overscanFov(fov: number) {
  return 2 * Math.atan(Math.tan(fov * radians / 2) * CAMERA_OVERSCAN) / radians;
}

function viewDirection(rig: CameraRig) {
  return new Vector3(Math.cos(rig.elevation) * Math.sin(rig.yaw), Math.sin(rig.elevation), Math.cos(rig.elevation) * Math.cos(rig.yaw));
}

function travelProgress(elapsedMs: number) {
  return (1 - Math.cos(Math.PI * clamp(elapsedMs / CAMERA_TRAVEL_MS))) / 2;
}

/** Fit the two endpoints once per viewport, then orbit without fitting to diagonal corners. */
export function frameCameraOrbit(rig: CameraRig, from: CameraFrame, to: CameraFrame, elapsedMs: number): CameraFrame {
  const progress = travelProgress(elapsedMs);
  const target = from.target.clone().lerp(to.target, progress);
  const distance = from.distance + (to.distance - from.distance) * progress;
  return { position: target.clone().addScaledVector(viewDirection(rig), distance), target, distance };
}

function fitFrame(points: readonly Point3[], origin: Vector3, view: Vector3, fov: number, aspect: number, room: number): CameraFrame {
  const horizontal = up.clone().cross(view).normalize()
  const vertical = view.clone().cross(horizontal)
  const tanHeight = Math.tan(fov * radians / 2) * room
  function fit(axis: Vector3, aperture: number) {
    let upper = -Infinity
    let lower = -Infinity
    for (const value of points) {
      const point = new Vector3(...value).sub(origin)
      const depth = point.dot(view)
      const offset = point.dot(axis) / aperture
      upper = Math.max(upper, depth + offset)
      lower = Math.max(lower, depth - offset)
    }
    return { distance: (upper + lower) / 2, center: (upper - lower) * aperture / 2 }
  }
  const x = fit(horizontal, tanHeight * Math.max(.05, aspect))
  const y = fit(vertical, tanHeight)
  const target = origin.clone().addScaledVector(horizontal, x.center).addScaledVector(vertical, y.center)
  const distance = Math.max(x.distance, y.distance)
  return { position: target.clone().addScaledVector(view, distance), target, distance }
}

/** Framing follows the existing orientation: teaching focus never adds a turn. */
export function frameCamera(rig: CameraRig, aspect: number, compact: boolean): CameraFrame {
  const view = viewDirection(rig)
  const overview = fitFrame(BOARD_FRAMING_POINTS, overviewOrigin, view, rig.fov, aspect, compact ? .986 : .968)
  const amount = clamp(rig.focusAmount)
  if (amount === 0) return overview
  const [x, z] = rig.focusPoint
  const closeup = fitFrame(pieceFocusBounds(rig.focusPoint), new Vector3(x, .76, z), view, rig.fov, aspect, .78)
  // A constrained push-in keeps context and avoids a giant face-filling pawn.
  const focusedDistance = Math.max(closeup.distance, overview.distance / MAX_FOCUS_ZOOM)
  const distance = overview.distance + (focusedDistance - overview.distance) * amount
  const target = overview.target.clone().lerp(closeup.target, amount)
  return { position: target.clone().addScaledVector(view, distance), target, distance }
}

export function frameRoyalCamera(
  rig: CameraRig, aspect: number, compact: boolean, [x, z]: GroundPoint,
  mate: boolean, amount: number, recoil: number, overview = frameCamera(rig, aspect, compact),
): CameraFrame {
  if (amount === 0) return overview
  // Move inward on either side of the table. The corner of the board can leave
  // the shot, while the crown and the ground contact remain inside the frame.
  const viewSide = (x * Math.cos(rig.yaw) - z * Math.sin(rig.yaw)) >= 0 ? -1 : 1
  const angle = mate ? 10 : 2.5
  const cinematic = {
    ...rig, yaw: rig.yaw + viewSide * angle * radians * amount,
    elevation: rig.elevation - (mate ? 11 : 2.5) * radians * amount,
  }
  const view = viewDirection(cinematic)
  const extent = mate ? 1.27 : .89
  const bounds = [-extent, extent].flatMap(dx => [-.14, mate ? 2.22 : 1.86].flatMap(y =>
    [-extent, extent].map(dz => [x + dx, y, z + dz] as const)))
  const portrait = fitFrame(bounds, new Vector3(x, .93, z), view, rig.fov, aspect, mate ? .84 : .94)
  const distanceLimit = overview.distance * (mate ? .47 : .71)
  const closest = Math.min(overview.distance, Math.max(portrait.distance, distanceLimit))
  const distance = overview.distance + (closest - overview.distance) * amount + recoil * .15
  const target = overview.target.clone().lerp(portrait.target, amount * (mate ? .99 : .63))
  // Keep some board context under the crown at a corner of the table.
  if (mate) {
    target.x *= 1 - amount * .12
    target.z *= 1 - amount * .12
  }
  target.y -= .034 * recoil
  return { target, distance, position: target.clone().addScaledVector(view, distance) }
}

/** Preserve the board, rising silhouette and the start of the lightning stroke. */
export function framePromotionCamera(
  rig: CameraRig, aspect: number, compact: boolean, [x, z]: GroundPoint,
  motion: { approach: number; recoil: number; height: number; reveal: number; arc: number; depthView: number },
  intoRoyal: boolean, overview = frameCamera(rig, aspect, compact),
): CameraFrame {
  const { approach, recoil, height, reveal, arc, depthView } = motion
  if (approach === 0 && height === 0 && depthView === 0) return overview
  const direction = overview.position.clone().sub(overview.target)
  const elevation = Math.atan2(direction.y, Math.hypot(direction.x, direction.z))
  const yaw = Math.atan2(direction.x, direction.z)
  const view = viewDirection({ ...rig, yaw, elevation: elevation - (compact ? 8 : 9.5) * radians * depthView })
  const top = Math.max(1.70, height + Math.min(1.70, .22 + 1.98 * reveal), 1.70 + Math.sqrt(arc) * 1.06)
  const bounds = [...BOARD_FRAMING_POINTS, ...[-.46, .46].flatMap(dx => [-.46, .46].map(dz =>
    [x + dx, top, z + dz] as const))]
  const emphasis = Math.max(approach, recoil, clamp((top - 1.70) / .72))
  const room = compact ? .986 - emphasis * .021 : .968 - emphasis * .016
  const fit = fitFrame(bounds, overviewOrigin, view, rig.fov, aspect, room)
  const zoom = approach * (compact ? .025 : intoRoyal ? .040 : .055)
  const desired = overview.target.clone().add(new Vector3(x * zoom * .73, -.025 * recoil, z * zoom * .73))
  const target = desired.lerp(fit.target, .62 * emphasis)
  const across = up.clone().cross(view).normalize()
  const vertical = view.clone().cross(across)
  const aperture = Math.tan(rig.fov * radians / 2) * room
  let distance = overview.distance * (1 - zoom)
  for (const point of bounds) {
    const delta = new Vector3(...point).sub(target)
    const extent = Math.max(Math.abs(delta.dot(across)) / (aperture * Math.max(.05, aspect)), Math.abs(delta.dot(vertical)) / aperture)
    distance = Math.max(distance, delta.dot(view) + extent)
  }
  distance += .12 * recoil
  return { target, distance, position: target.clone().addScaledVector(view, distance) }
}

export function sameCameraRig(a: CameraRig, b: CameraRig): boolean {
  return a.elevation === b.elevation && a.yaw === b.yaw && a.fov === b.fov && a.focusAmount === b.focusAmount
    && a.focusPoint[0] === b.focusPoint[0] && a.focusPoint[1] === b.focusPoint[1]
}

/** Interpolate an orbit, not a chord through the board, with zero end velocity. */
export function sampleCameraTravel(from: CameraRig, to: CameraRig, elapsedMs: number): CameraRig {
  const t = clamp(elapsedMs / CAMERA_TRAVEL_MS)
  if (t === 1) return to
  const p = travelProgress(elapsedMs)
  const yaw = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw))
  return {
    elevation: from.elevation + (to.elevation - from.elevation) * p,
    yaw: from.yaw + yaw * p,
    fov: from.fov + (to.fov - from.fov) * p,
    focusAmount: from.focusAmount + (to.focusAmount - from.focusAmount) * p,
    focusPoint: [
      from.focusPoint[0] + (to.focusPoint[0] - from.focusPoint[0]) * p,
      from.focusPoint[1] + (to.focusPoint[1] - from.focusPoint[1]) * p,
    ],
  }
}

/** One deliberate on-surface emphasis, then the ordinary material remains. */
export function sampleFigureEmphasis(elapsedMs: number, reduced: boolean): number {
  if (reduced) return .48
  if (elapsedMs < 0 || elapsedMs >= FOCUS_EMPHASIS_MS) return 0
  const holdUntil = CAMERA_TRAVEL_MS + 300
  return smooth(elapsedMs / 180) * (1 - smooth((elapsedMs - holdUntil) / (FOCUS_EMPHASIS_MS - holdUntil)))
}

/** Wait for the camera and the material cue before framing the counter. */
export function sampleCounterEmphasis(elapsedMs: number, reduced: boolean): number {
  return reduced ? 1 : smooth((elapsedMs - COUNTER_FOCUS_DELAY_MS) / COUNTER_FOCUS_MS)
}
