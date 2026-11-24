import { clampUnit, easeRange } from './royalMotion'
import { sceneRandom } from './promotionMotion'
import type { FloorPoint } from './promotionMotion'

type BoltPoint = readonly [x: number, y: number, z: number]
interface Bolt {
  readonly points: readonly BoltPoint[]
  readonly leader: boolean
  readonly starts: number
  readonly grows: number
}

const inBoard = (value: number) => Math.max(-3.92, Math.min(3.92, value))

/** Each fork starts on an existing leader. The last points skim the stone. */
export function queenLightning([x, z]: FloorPoint, id: string, low = false): readonly Bolt[] {
  const random = sceneRandom(`${id}/queen-lightning`)
  const inward = z < 0 ? 1 : -1
  const center = -Math.sign(x) * easeRange(2.2, 3.9, Math.abs(x)) * .82
  function channel(start: BoltPoint, end: BoltPoint, detail: number, roughness: number): readonly BoltPoint[] {
    return [start, ...Array.from({ length: detail - 1 }, (_, index): BoltPoint => {
      const t = (index + 1) / detail
      const jitter = Math.sin(Math.PI * t) * roughness
      return [inBoard(start[0] + (end[0] - start[0]) * t + (random() - .5) * jitter),
        Math.max(.041, start[1] + (end[1] - start[1]) * t + (random() - .5) * jitter * .73),
        inBoard(start[2] + (end[2] - start[2]) * t + (random() - .5) * jitter * .87)]
    }), end]
  }
  const paths: Bolt[] = []
  for (let index = 0; index < 2; index++) {
    const side = index === 0 ? -1 : 1
    const start: BoltPoint = [inBoard(x - side * .21), 2.56 - index * .21, inBoard(z + inward * (.19 + index * .18))]
    const contact: BoltPoint = [inBoard(x + center + side * (1.02 + random() * .39)), .044,
      inBoard(z + inward * (.93 + random() * .66))]
    const leader = channel(start, contact, 11, .59)
    paths.push({ points: leader, leader: true, starts: -74 + index * 20, grows: 67 })
    for (const branch of low ? [0, 1] : [0, 1, 2]) {
      const origin = leader[4 + branch * 2]
      const across = (branch === 1 ? -side : side) * (.57 + random() * .36)
      const end: BoltPoint = [inBoard(origin[0] + across + center * .57), .044 + .04 * (branch === 1 ? 1 : 0),
        inBoard(origin[2] + inward * (.51 + random() * .83))]
      paths.push({ points: channel(origin, end, 5 + branch, .36), leader: false, starts: -39 + index * 19 + branch * 17, grows: 43 })
    }
  }
  return paths
}

export function boltReach(bolt: Bolt, afterImpact: number) {
  return clampUnit((afterImpact - bolt.starts) / bolt.grows)
}
