import { describe, expect, it } from 'vitest'
import { promotionTiming, samplePromotion } from './promotionMotion'

describe.each(['bishop', 'knight', 'rook', 'queen'] as const)('%s promotion light', kind => {
  for (const reduced of [false, true]) it('settles on the committed clock, reduced=' + reduced, () => {
    const cue = { id: 'light', pieceId: 'pawn', square: 'e8', side: 'white', kind,
      startedAt: 400, reduced, intoRoyal: false } as const
    const { impact, duration } = promotionTiming(kind, reduced)
    // Also sample an ordinary cue whose motion was limited after launch.
    for (const limit of reduced ? [true] : [false, true]) {
      const sample = (t: number) => samplePromotion(cue, t, limit)
      const flash = (t: number) => {
        const s = sample(t)
        return [s.lampLight, s.surfaceLight, s.contact, s.waveLight, s.arc, s.airLight]
      }
      expect(flash(0)).toEqual([0, 0, 0, 0, 0, 0])
      expect(sample(impact - 50).lampLight).toBeGreaterThan(0)
      const peak = sample(impact + 65)
      expect(Math.min(peak.lampLight, peak.surfaceLight, peak.contact, peak.waveLight)).toBeGreaterThan(.1)
      let previous = flash(impact + 90)
      for (let t = impact + 91; t <= duration; t += 7) {
        const next = flash(t)
        next.forEach((v, i) => expect(v).toBeLessThanOrEqual(previous[i] + 1e-9))
        previous = next
      }
      for (const t of [duration - 42, duration - 15, duration, duration + 80]) {
        expect(flash(t)).toEqual([0, 0, 0, 0, 0, 0])
        expect(sample(t).reveal).toBe(1)
      }
    }
  })
})
