import { enumerateOutcomes, legalCommands, positionKey, transitionKnownLegal } from '../core'
import type { Command, DieFace, GameState, Side } from '../core/types'
import type { GameAdapter } from '@chess-2/engine-sdk'
import { evaluate, orderCommands } from './evaluate'

/** Remorse rules are a plugin of the search SDK, including bonus turns and dice. */
export const remorseAdapter: GameAdapter<GameState, Command, Side, DieFace | undefined> = {
  id: 'remorse',
  version: 'remorse-digital-v1/engine-v1',
  information: 'perfect',
  player: state => state.side,
  legalActions: legalCommands,
  outcomes: (state, command) => enumerateOutcomes(state, command).map(({ face, weight }) => ({ chance: face, weight })),
  apply: (state, command, face, probe) => transitionKnownLegal(state, command, face, probe).state,
  terminal: state => state.outcome,
  evaluate: (state, perspective) => {
    const score = evaluate(state, perspective)
    // A guaranteed draw claim is available at a completed-turn frontier. This
    // is a Remorse rule, not an assumption embedded in the generic search.
    if ((state.side === perspective ? score < 0 : score > 0) &&
      (state.repetition[positionKey(state)] ?? 0) >= 3) return 0
    return score
  },
  actionKey: command => command.type === 'move'
    ? `${command.from}${command.to}${command.promotion ?? ''}` : command.type,
  orderActions: (state, commands) => orderCommands(state, commands).map(({ command, priority }) => ({ action: command, priority })),
  turnsElapsed: (before, after) => after.turnSerial - before.turnSerial,
  canEvaluate: state => state.phase === 'primary',
  cacheIdentity: state => ({ position: positionKey(state), history: state.repetition }),
  fallbackScore: (state, command, perspective, priority) => command.type === 'claimRepetitionDraw'
    ? 0 : evaluate(state, perspective) + priority,
}
