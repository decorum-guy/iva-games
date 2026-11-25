import { searchGame } from '@chess-2/engine-sdk'
import type { GameAdapter, SearchOptions } from '@chess-2/engine-sdk'
import { commandKey, legalCommands, positionKey, RULES_VERSION, transitionKnownLegal } from '../core'
import type { Command, GameState, Side } from '../core'
import { evaluate, orderActions } from './evaluate'
import { ENGINE_VERSION } from './presets'
import type { OverdrivePreset } from './presets'

export const overdriveAdapter: GameAdapter<GameState, Command, Side> = {
  id: 'overdrive', version: `${RULES_VERSION}:${ENGINE_VERSION}`, information: 'perfect',
  player: state => state.side,
  legalActions: (state, probe) => legalCommands(state, probe),
  outcomes: () => [{ chance: undefined, weight: 1 }],
  apply: (state, action, _chance, probe) => transitionKnownLegal(state, action, probe).state,
  terminal: state => state.outcome,
  evaluate, actionKey: commandKey, orderActions,
  turnsElapsed: (before, after) => after.turnSerial - before.turnSerial,
  canEvaluate: () => true,
  cacheIdentity: state => ({ position: `${positionKey(state)}|quiet:${state.quietPly}`, history: state.repetition }),
  fallbackScore: (state, action, perspective, priority) => action.type === 'claimDraw' ? 0 : evaluate(state, perspective) + priority * .01,
}
export function search(state: GameState, preset: OverdrivePreset, options: SearchOptions = {}) {
  const result = searchGame(overdriveAdapter, state, preset, options)
  return { command: result.action, diagnostics: result.diagnostics, principalVariation: result.principalVariation }
}
