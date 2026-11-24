import type { Affliction, GameEvent } from '../core/types'
import { easeRange } from './royalMotion'

export type FireKind = 'ignite' | 'capture'

export interface FireBurst {
  readonly id: string
  readonly kind: FireKind
  readonly startedAt: number
  readonly duration: number
}

export function fireEvent(events: readonly GameEvent[], before: Affliction, after: Affliction) {
  const capture = events.find(event => event.type === 'capture' && event.capturer.affliction === 'berserk')
  if (capture) return { id: capture.id, kind: 'capture' as const }
  if (before === 'berserk' || after !== 'berserk') return
  const reaction = events.find(event => (event.type === 'reaction' || event.type === 'affliction') && event.affliction === 'berserk')
  if (reaction) return { id: reaction.id, kind: 'ignite' as const }
}

export function fireDuration(kind: FireKind, reduced: boolean) {
  if (reduced) return kind === 'ignite' ? 360 : 295
  return kind === 'ignite' ? 1120 : 540
}

export function fireOpacity(burst: FireBurst, elapsed: number) {
  const ignition = burst.kind === 'ignite'
  return easeRange(0, ignition ? burst.duration * .20 : 46, elapsed) *
    (1 - easeRange(burst.duration * (ignition ? .43 : .31), burst.duration - 21, elapsed))
}
