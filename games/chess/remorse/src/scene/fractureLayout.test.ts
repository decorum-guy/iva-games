import { expect, it } from 'vitest'
import { fractureLayout } from './fractureLayout'
import type { FloorPoint } from './promotionMotion'

function area(outline: readonly FloorPoint[]) {
  return outline.reduce((sum, [x, z], i) => {
    const [nx, nz] = outline[(i + 1) % outline.length]
    return sum + x * nz - z * nx
  }, 0) / 2
}

it('fits irregular playable slab outlines without gaps at rest for every promotion file', () => {
  for (const z of [-3.5, 3.5]) for (let x = -3.5; x <= 3.5; x++) for (let seed = 0; seed < 8; seed++) {
    const { slabs } = fractureLayout([x, z], 'board/' + seed)
    const sizes = slabs.map(slab => area(slab.outline))
    expect(sizes.every(size => size > 0)).toBe(true)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(64, 8)
    expect(slabs.every(slab => slab.outline.every(([x, z]) => Math.abs(x) <= 4 && Math.abs(z) <= 4))).toBe(true)
  }
})

it('opens in multiple directions and reaches deep into the field even from each corner', () => {
  const anchors: FloorPoint[] = [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5], [-.5, -3.5]]
  for (const [x, z] of anchors) {
    const { seams } = fractureLayout([x, z], 'impact')
    const spread = seams.map(path => {
      const [px, pz] = path.at(-1)!.position
      return { dx: px - x, dz: pz - z, length: Math.hypot(px - x, pz - z) }
    })
    const distant = spread.filter(ray => ray.length > 2.3)
    expect(distant.length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...spread.map(ray => ray.length))).toBeGreaterThan(4.2)
    expect(distant.some(ray => Math.abs(ray.dx) > Math.abs(ray.dz) * 1.5)).toBe(true)
    expect(distant.some(ray => Math.abs(ray.dz) > Math.abs(ray.dx) * 1.5)).toBe(true)
  }
})
