/** Reproducible self-play runner. This is an engineering sample, not human Elo calibration. */
import { commandKey, createInitialState, legalCommands, opposite, transition, validateState } from '../core'
import type { Command, GameEvent, GameState, Side } from '../core'
import { getPreset } from './presets'
import { search } from './search'
export interface BalanceOptions { readonly whiteLevel: number; readonly blackLevel: number; readonly seed: number; readonly maxPly?: number; readonly openingPly?: number; readonly nodeCap?: number; readonly timeCapMs?: number }
export interface BalancePly { readonly side: Side; readonly command: Command; readonly events: readonly GameEvent[]; readonly depth: number; readonly nodes: number; readonly milliseconds: number }
export function playBalanceGame(options: BalanceOptions, progress?: (ply: number) => void) {
  let randomState = options.seed >>> 0
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296 }
  let state: GameState = createInitialState()
  const log: BalancePly[] = []
  const abilities: Record<string, number> = {}, activations: Record<Side, number> = { white: 0, black: 0 }, energyEarned: Record<Side, number> = { white: 0, black: 0 }
  let firstEnergyPly: number | null = null
  for (let ply = 0; ply < (options.maxPly ?? 180) && !state.outcome; ply++) {
    const side = state.side
    let command: Command, depth = 0, nodes = 0, milliseconds = 0
    if (ply < (options.openingPly ?? 4)) {
      const choices = legalCommands(state)
      command = choices[Math.floor(random() * choices.length)]
    } else {
      const preset = getPreset(side === 'white' ? options.whiteLevel : options.blackLevel)
      if (!preset) throw new Error('Invalid level')
      const result = search(state, preset, {
        random,
        ...(options.nodeCap !== undefined ? { nodeLimit: Math.min(options.nodeCap, preset.maxNodes) } : {}),
        ...(options.timeCapMs !== undefined ? { timeLimitMs: Math.min(options.timeCapMs, preset.maxTimeMs) } : {}),
      })
      if (!result.command) throw new Error(`No command at ply ${ply}`)
      command = result.command; depth = result.diagnostics.depth; nodes = result.diagnostics.nodes; milliseconds = result.diagnostics.elapsedMs
    }
    const snapshot = JSON.stringify(state)
    const resolved = transition(state, command)
    if (JSON.stringify(state) !== snapshot) throw new Error(`Input mutated at ply ${ply}`)
    if (!validateState(resolved.state)) throw new Error(`Invalid state at ply ${ply}`)
    log.push({ side, command, events: resolved.events, depth, nodes, milliseconds })
    for (const event of resolved.events) {
      if (event.type === 'ability') abilities[event.ability] = (abilities[event.ability] ?? 0) + 1
      if (event.type === 'form' && event.cause === 'activate') activations[event.side]++
      if (event.type === 'energy') {
        energyEarned[event.side] += event.captureEarned + event.checkEarned
        if (firstEnergyPly === null && event.after > 0) firstEnergyPly = ply + 1
      }
    }
    state = resolved.state
    progress?.(ply + 1)
  }
  // Replaying the stored action stream independently must reconstruct all resources and rights.
  let replay = createInitialState()
  for (const entry of log) replay = transition(replay, entry.command).state
  if (JSON.stringify(replay) !== JSON.stringify(state)) throw new Error('Replay mismatch')
  const bySide = (side: Side) => log.filter((p, index) => p.side === side && index >= (options.openingPly ?? 4))
  const meanDepth = (side: Side) => bySide(side).reduce((sum, p) => sum + p.depth, 0) / Math.max(1, bySide(side).length)
  return {
    options, outcome: state.outcome, unfinished: !state.outcome, plies: log.length,
    abilities, activations, energyEarned, firstEnergyPly,
    meanDepth: { white: meanDepth('white'), black: meanDepth('black') },
    scores: state.outcome ? { winner: state.outcome.winner, loser: state.outcome.winner ? opposite(state.outcome.winner) : null } : null,
    actionKeys: log.map(p => commandKey(p.command)), finalState: state, log,
  }
}

export function replayBalanceActions(actions: readonly Command[]): GameState {
  let state = createInitialState()
  for (const command of actions) state = transition(state, command).state
  if (!validateState(state)) throw new Error('Invalid replay result')
  return state
}
