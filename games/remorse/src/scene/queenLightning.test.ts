import { expect, it } from 'vitest'
import { promotionTiming, samplePromotion } from './promotionMotion'
import { boltReach, queenLightning } from './queenLightning'

it('keeps the early tilt through the longer physical fracture and returns to overview', () => {
  const cue = { id: 'queen-showcase', pieceId: 'pawn', square: 'e8', side: 'white', kind: 'queen',
    startedAt: 0, reduced: false, intoRoyal: false } as const
  const { duration, impact } = promotionTiming(cue.kind, false)
  const scene = (time: number) => samplePromotion(cue, time)
  expect(duration).toBe(2760)
  expect(scene(110).depthView).toBeGreaterThan(.35)
  expect(scene(245).depthView).toBe(1)
  expect(scene(impact + 1180).crackAlpha).toBe(1)
  expect(scene(impact + 1270).crackAlpha).toBeLessThan(1)
  expect(scene(duration)).toMatchObject({ depthView: 0, crackAlpha: 0, lampLight: 0, arc: 0 })
  expect(samplePromotion({ ...cue, reduced: true }, 400)).toMatchObject({ depthView: 0, arc: 0 })
})

it('creates independent leaders with attached forks and grounded endpoints at both corners', () => {
  for (const origin of [[-3.5, -3.5], [3.5, 3.5]] as const) {
    const full = queenLightning(origin, 'seed')
    const leaders = full.filter(bolt => bolt.leader)
    expect(full).toEqual(queenLightning(origin, 'seed'))
    expect(leaders).toHaveLength(2)
    expect(full).toHaveLength(8)
    expect(queenLightning(origin, 'seed', true)).toHaveLength(6)
    for (const bolt of full) {
      if (!bolt.leader) expect(leaders.some(leader => leader.points.includes(bolt.points[0]))).toBe(true)
      expect(bolt.points.at(-1)![1]).toBeLessThan(.10)
      expect(bolt.points.every(([x, , z]) => Math.abs(x) < 4 && Math.abs(z) < 4)).toBe(true)
      expect(boltReach(bolt, bolt.starts - 1)).toBe(0)
      expect(boltReach(bolt, bolt.starts + bolt.grows)).toBe(1)
    }
  }
})
