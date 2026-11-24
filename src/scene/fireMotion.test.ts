import { describe, expect, it } from 'vitest'
import { applyResolvedCommand, createPosition } from '../core'
import type { CaptureReaction } from '../core/types'
import { fireDuration, fireEvent, fireOpacity } from './fireMotion'
import type { FireKind } from './fireMotion'

function position(reaction: CaptureReaction = 'unassigned') {
  return createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'g1' },
    { side: 'black', type: 'king', square: 'h7' },
    { side: 'white', type: 'rook', square: 'd3', captureReaction: reaction,
      affliction: reaction === 'berserk' ? 'berserk' : 'neutral' },
    { side: 'black', type: 'pawn', square: 'd5' },
  ] })
}

describe('berserk fire', () => {
  it('waits for the winning face to be revealed on the first capture', () => {
    const { events } = applyResolvedCommand(position(), { type: 'move', from: 'd3', to: 'd5' }, 6)
    const landing = events.filter(event => event.type === 'capture' || event.type === 'move')
    const reveal = events.filter(event => event.type === 'reaction')
    expect(fireEvent(landing, 'neutral', 'neutral')).toBeUndefined()
    expect(fireEvent(reveal, 'neutral', 'berserk')).toEqual({ id: reveal[0].id, kind: 'ignite' })
    expect(fireEvent(reveal, 'berserk', 'berserk')).toBeUndefined()
  })

  it('bursts on a capture by the already berserk figure, then stays off at rest and on quiet moves', () => {
    const root = position('berserk')
    const { events } = applyResolvedCommand(root, { type: 'move', from: 'd3', to: 'd5' })
    expect(fireEvent(events, 'berserk', 'berserk')).toEqual({ id: events.find(event => event.type === 'capture')!.id, kind: 'capture' })
    const quiet = applyResolvedCommand(root, { type: 'move', from: 'd3', to: 'd4' }).events
    expect(fireEvent(quiet, 'berserk', 'berserk')).toBeUndefined()
    expect(fireEvent([], 'berserk', 'berserk')).toBeUndefined()
  })

  it.each<[FireKind, boolean]>([['ignite', false], ['capture', false], ['ignite', true], ['capture', true]])(
    'settles before unmount (%s, reduced=%s)', (kind, reduced) => {
      const duration = fireDuration(kind, reduced)
      const pulse = { id: 'fire', kind, startedAt: 0, duration }
      expect(fireOpacity(pulse, -1)).toBe(0)
      expect(fireOpacity(pulse, 120)).toBeGreaterThan(.65)
      expect(fireOpacity(pulse, duration - 20)).toBe(0)
    },
  )
})
