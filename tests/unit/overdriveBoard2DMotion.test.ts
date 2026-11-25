import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createPosition, transition } from '../../src/overdrive/core'
import { TEACHING_FIXTURES } from '../../src/overdrive/core/teaching'
import { Board2D, boardPercent, boardSpritesAt, runBoardFrames } from '../../src/overdrive/ui/Board2D'
import type { BoardFrameClock } from '../../src/overdrive/ui/Board2D'
import { sceneTiming, squarePoint } from '../../src/overdrive/ui/motion'
import type { BoardMotion } from '../../src/overdrive/ui/motion'

function fixtureMotion(id: string, reduced = false): BoardMotion {
  const fixture = TEACHING_FIXTURES.find(item => item.id === id)!
  const resolved = transition(fixture.state, fixture.expected)
  return { id: 1, before: fixture.state, after: resolved.state, events: resolved.events,
    startedAt: 1000, duration: sceneTiming(resolved.events, reduced).duration }
}
const sprite = (motion: BoardMotion, id: string, ms: number, flipped = false, reduced = false) =>
  boardSpritesAt(motion, ms, flipped, reduced).find(item => item.id === id)

describe('Overdrive 2D committed-motion projection', () => {
  it('maps both orientations onto the exact centers of the same 64 cells', () => {
    expect(boardPercent(-3.5, 3.5, false)).toEqual({ left: 6.25, top: 93.75 })
    expect(boardPercent(3.5, -3.5, false)).toEqual({ left: 93.75, top: 6.25 })
    expect(boardPercent(-3.5, 3.5, true)).toEqual({ left: 93.75, top: 6.25 })
    const motion = fixtureMotion('ram')
    const elapsed = sceneTiming(motion.events).contact + 50
    for (const original of boardSpritesAt(motion, elapsed, false)) {
      const flipped = sprite(motion, original.id, elapsed, true)!
      expect(original.left + flipped.left).toBeCloseTo(100, 10)
      expect(original.top + flipped.top).toBeCloseTo(100, 10)
      expect(original.type).toBe(flipped.type)
      expect(original.opacity).toBe(flipped.opacity)
    }
  })

  it.each(['capture', 'raid', 'battery'])('%s keeps the actual victim until contact and removes it after capture fade', id => {
    const motion = fixtureMotion(id), timing = sceneTiming(motion.events)
    const capture = motion.events.find(event => event.type === 'capture')!
    const victim = sprite(motion, capture.victim.id, timing.contact - 1)
    expect(victim).toBeDefined()
    expect(victim!.opacity).toBe(1)
    expect(victim!.type).toBe(capture.victim.type)
    expect(sprite(motion, capture.victim.id, timing.captureEnd + 1)).toBeUndefined()
    expect(motion.after.pieces.some(piece => piece.id === capture.victim.id)).toBe(false)
  })

  it('shows the pawn during arrival and the promoted type only after the promotion phase', () => {
    const before = createPosition({ pieces: [
      { id: 'wk', side: 'white', type: 'king', square: 'h1' },
      { id: 'bk', side: 'black', type: 'king', square: 'h8' },
      { id: 'wp', side: 'white', type: 'pawn', square: 'a7' },
    ] })
    const resolved = transition(before, { type: 'move', mode: 'normal', pieceId: 'wp', to: 'a8', promotion: 'queen' })
    const timing = sceneTiming(resolved.events)
    const motion: BoardMotion = { id: 2, before, after: resolved.state, events: resolved.events, startedAt: 1000, duration: timing.duration }
    expect(sprite(motion, 'wp', timing.contact - 1)?.type).toBe('pawn')
    expect(sprite(motion, 'wp', timing.promotionStart)?.type).toBe('pawn')
    expect(sprite(motion, 'wp', timing.promotionEnd + 1)?.type).toBe('queen')
    expect(sprite(motion, 'wp', timing.promotionEnd + 1)).toMatchObject({ left: 6.25, top: 6.25 })
  })

  it('ram reaches the target before pushing it and never makes a forced knight jump', () => {
    const motion = fixtureMotion('ram'), timing = sceneTiming(motion.events)
    const start = squarePoint('c6'), expected = boardPercent(start.x, start.z, false)
    expect(sprite(motion, 'bn', timing.contact - 1)).toMatchObject(expected)
    for (const ms of [timing.moveStart, timing.contact - 1, timing.contact + 1, (timing.contact + timing.land) / 2, timing.land]) {
      const rook = sprite(motion, 'wr', ms)!, target = sprite(motion, 'bn', ms)!
      expect(target.lift).toBe(0)
      // The shared scene uses 0.64-cell center distance at mechanical contact;
      // the SVG silhouettes are narrower than that, just like the 3D bodies.
      expect(Math.abs(rook.top - target.top)).toBeGreaterThanOrEqual(8 - 1e-6)
    }
    expect(sprite(motion, 'bn', timing.land + 1)).toMatchObject({ left: 31.25, top: 18.75 })
    expect(sprite(motion, 'wr', timing.land + 1)).toMatchObject({ left: 31.25, top: 31.25 })
  })

  it('rotation uses separate simultaneous paths rather than passing both SVGs through one center', () => {
    const motion = fixtureMotion('rotation'), timing = sceneTiming(motion.events)
    const middle = (timing.moveStart + timing.land) / 2
    const queen = sprite(motion, 'wq', middle)!, knight = sprite(motion, 'wn', middle)!
    expect(Math.hypot(queen.left - knight.left, queen.top - knight.top)).toBeGreaterThan(1)
    expect(knight.lift).toBe(0)
    expect(sprite(motion, 'wq', timing.land + 1)).toMatchObject({ left: 68.75, top: 31.25 })
    expect(sprite(motion, 'wn', timing.land + 1)).toMatchObject({ left: 31.25, top: 68.75 })
  })

  it('reduced motion uses endpoint fades, with no translated intermediate square or artificial lift', () => {
    const motion = fixtureMotion('raid', true), timing = sceneTiming(motion.events, true)
    for (const ms of [0, timing.contact - 1, timing.contact + 1, timing.duration - 1]) {
      for (const current of boardSpritesAt(motion, ms, false, true)) {
        const endpoints = [motion.before, motion.after].flatMap(state => {
          const piece = state.pieces.find(item => item.id === current.id)
          if (!piece) return []
          const point = squarePoint(piece.square)
          return [boardPercent(point.x, point.z, false)]
        })
        expect(endpoints.some(point => point.left === current.left && point.top === current.top)).toBe(true)
        expect(current.lift).toBe(0)
      }
    }
  })

  it('keeps the final 64-cell accessible grid while the decorative overlay shows the earlier visual state', () => {
    const base = fixtureMotion('capture')
    const motion = { ...base, startedAt: performance.now() }
    const html = renderToStaticMarkup(createElement(Board2D, { state: motion.after, selected: null,
      targets: [], focusSquares: [], onSquare() {}, flipped: false, language: 'en', motion }))
    expect(html.match(/role="gridcell"/g)).toHaveLength(64)
    expect(html).toContain('data-animating="true"')
    expect(html).toContain('class="od-motion-layer" aria-hidden="true"')
    expect(html).toContain('data-piece-id="bn"')
    // The underlying accessible board describes committed d6 rook, never the victim.
    expect(html).toContain('aria-label="d6, White, Rook"')
  })

  it('returns to static SVG rendering after the scene ends, without waiting through the reading pause', () => {
    const base = fixtureMotion('capture')
    const motion = { ...base, startedAt: performance.now() - base.duration - 10 }
    const html = renderToStaticMarkup(createElement(Board2D, { state: motion.after, selected: null,
      targets: [], focusSquares: [], onSquare() {}, flipped: false, language: 'en', motion }))
    expect(html.match(/role="gridcell"/g)).toHaveLength(64)
    expect(html).toContain('data-animating="false"')
    expect(html).not.toContain('od-motion-layer')
  })
})

describe('Overdrive 2D RAF lifecycle', () => {
  function clock(start: number) {
    let now = start, serial = 0
    const pending = new Map<number, () => void>()
    const environment: BoardFrameClock = {
      now: () => now, request: callback => { pending.set(++serial, callback); return serial },
      cancel: handle => { pending.delete(handle) },
    }
    return { environment, pending, advance(value: number) {
      now = value
      const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback())
    } }
  }

  it('advances by elapsed time and stops requesting frames exactly at scene duration', () => {
    const motion = fixtureMotion('ram'), timer = clock(motion.startedAt), samples: number[] = []
    const dispose = runBoardFrames(motion, false, elapsed => samples.push(elapsed), timer.environment)
    const timing = sceneTiming(motion.events)
    timer.advance(motion.startedAt + timing.contact)
    timer.advance(motion.startedAt + timing.duration + 10)
    expect(samples).toEqual([0, timing.contact, timing.duration])
    expect(timer.pending.size).toBe(0)
    timer.advance(motion.startedAt + timing.duration + 1000)
    expect(samples).toHaveLength(3)
    dispose()
  })

  it('cancels queued and already-delivered callbacks when a motion is replaced or unmounted', () => {
    const motion = fixtureMotion('raid'), timer = clock(motion.startedAt), samples: number[] = []
    const dispose = runBoardFrames(motion, false, elapsed => samples.push(elapsed), timer.environment)
    const stale = [...timer.pending.values()][0]
    dispose()
    expect(timer.pending.size).toBe(0)
    stale()
    timer.advance(motion.startedAt + 500)
    expect(samples).toEqual([0])
  })
})
