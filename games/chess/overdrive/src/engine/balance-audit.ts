/** Paired rules audit using the real core and SDK. Not a human skill calibration. */
import { commandKey, createInitialState, createPosition, energyBankSize, legalCommands, opposite, transition, validateState } from '../core'
import type { Command, GameState, RulesVersion, Side } from '../core'
import { MATERIAL } from './evaluate'
import type { OverdrivePreset } from './presets'
import { search } from './search'

// Concrete normal-move tapes are shared by both rules versions. No orthodox-chess
// engine is used: every move is looked up in this variant's legal command list.
export const AUDIT_OPENINGS = [
  ['italian', 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5'],
  ['queens-gambit', 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7'],
  ['sicilian', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6'],
  ['french', 'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7'],
  ['english', 'c2c4 e7e5 b1c3 g8f6 g2g3 f8b4 f1g2 b8c6'],
  ['kings-indian', 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6'],
  ['caro-kann', 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 b8d7'],
  ['scandinavian', 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6'],
  ['scotch', 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 f8c5'],
  ['reti', 'g1f3 d7d5 c2c4 d5d4 e2e3 b8c6 e3d4 c6d4'],
  ['larsen', 'b2b3 e7e5 c1b2 b8c6 e2e3 g8f6 g1f3 f8d6'],
  ['bird', 'f2f4 d7d5 g1f3 g8f6 e2e3 c7c5 f1b5 b8c6'],
] as const

export interface AuditOptions {
  readonly id: string
  readonly rulesVersion: RulesVersion
  readonly opening: number
  readonly seed: number
  readonly swap: boolean
  readonly nodeCap: number
  readonly maxDepth: number
  readonly temperature: number
  readonly maxPly: number
}
const sides: readonly Side[] = ['white', 'black']
const both = <T>(factory: () => T): Record<Side, T> => ({ white: factory(), black: factory() })
const increment = (counts: Record<string, number>, key: string, count = 1) => { counts[key] = (counts[key] ?? 0) + count }
const rng = (seed: number) => {
  let value = seed >>> 0
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
}
const material = (state: GameState, side: Side) => state.pieces.reduce((sum, p) => sum + (p.side === side ? 1 : -1) * MATERIAL[p.type], 0)
const initialState = (rulesVersion: RulesVersion) => createPosition({ pieces: createInitialState().pieces, rulesVersion })

export function runAuditGame(options: AuditOptions, progress?: (ply: number) => void) {
  const opening = AUDIT_OPENINGS[options.opening]
  if (!opening) throw new Error(`Unknown opening ${options.opening}`)
  const tape = opening[1].split(' ')
  const playerSeeds = [options.seed >>> 0, (options.seed ^ 0x9e3779b9) >>> 0]
  const random = { white: rng(playerSeeds[options.swap ? 1 : 0]), black: rng(playerSeeds[options.swap ? 0 : 1]) }
  const preset: OverdrivePreset = { id: 0, anchor: 0, maxDepth: options.maxDepth, maxNodes: options.nodeCap, maxTimeMs: Infinity, temperature: options.temperature }
  let state = initialState(options.rulesVersion)
  const commands: Command[] = []
  const log: Array<Record<string, unknown>> = []
  const capacity = energyBankSize(options.rulesVersion) * 2
  const stats = {
    moves: both(() => 0), energyEarned: both(() => 0), energySpent: both(() => 0), energyWasted: both(() => 0),
    nominalCaptureEnergy: both(() => 0), nominalCheckEnergy: both(() => 0), atCapacityStarts: both(() => 0),
    captures: both(() => 0), checks: both(() => 0), impulses: both(() => 0), activations: both(() => 0), formUses: both(() => 0),
    fullRefundActivations: both(() => 0), forcedPromotions: both(() => 0),
    firstEnergy: both<number | null>(() => null), firstImpulse: both<number | null>(() => null), firstActivation: both<number | null>(() => null),
    firstActivationMaterialLead: both<number | null>(() => null),
    abilities: {} as Record<string, number>, modes: {} as Record<string, number>, depth: {} as Record<string, number>, stopReasons: {} as Record<string, number>,
    nodes: 0, searchMs: 0, searchMoves: 0,
  }
  for (let ply = 0; ply < options.maxPly && !state.outcome; ply++) {
    const side = state.side
    const before = state
    let command: Command
    let diagnostics: Record<string, unknown> | null = null
    if (ply < tape.length) {
      const move = tape[ply]
      const piece = state.pieces.find(p => p.side === side && p.square === move.slice(0, 2))
      const found = legalCommands(state).find(c => c.type === 'move' && c.mode === 'normal' && c.pieceId === piece?.id && c.to === move.slice(2, 4))
      if (!found) throw new Error(`Illegal opening ${opening[0]} ${move}, ${options.rulesVersion}`)
      command = found
    } else {
      const started = performance.now()
      const result = search(state, preset, { random: random[side], nodeLimit: options.nodeCap, timeLimitMs: Infinity })
      const elapsed = performance.now() - started
      if (!result.command) throw new Error(`Missing command: ${options.id} ply ${ply}`)
      command = result.command
      diagnostics = { ...result.diagnostics, actualWallMs: elapsed }
      increment(stats.depth, String(result.diagnostics.depth))
      increment(stats.stopReasons, result.diagnostics.stopReason)
      stats.searchMoves++
      stats.nodes += result.diagnostics.nodes
      stats.searchMs += elapsed
    }
    const unchanged = JSON.stringify(state)
    const resolved = transition(state, command)
    if (JSON.stringify(state) !== unchanged) throw new Error(`Input mutated: ${options.id} ply ${ply}`)
    if (!validateState(resolved.state)) throw new Error(`Invalid state: ${options.id} ply ${ply}`)
    state = resolved.state
    stats.moves[side]++
    if (before.energy[side] === capacity) stats.atCapacityStarts[side]++
    const captureEvents = resolved.events.filter(e => e.type === 'capture')
    const captureNominal = captureEvents.reduce((sum, e) => sum + (options.rulesVersion === 'overdrive-v1' ? 1 : ({ pawn: 1, knight: 2, bishop: 2, rook: 3, queen: 4, king: 0 }[e.victim.type])), 0)
    const newChecks = state.rewardedCheckLayouts[side].length - before.rewardedCheckLayouts[side].length
    const checkNominal = newChecks * 2
    const energyEvent = resolved.events.find(e => e.type === 'energy')
    const earned = energyEvent ? energyEvent.captureEarned + energyEvent.checkEarned : 0
    stats.energyEarned[side] += earned
    stats.energySpent[side] += energyEvent?.spent ?? 0
    stats.energyWasted[side] += captureNominal + checkNominal - earned
    stats.nominalCaptureEnergy[side] += captureNominal
    stats.nominalCheckEnergy[side] += checkNominal
    stats.captures[side] += captureEvents.length
    stats.checks[side] += newChecks
    if (state.energy[side] > 0 && stats.firstEnergy[side] === null) stats.firstEnergy[side] = ply + 1
    if ('mode' in command) {
      increment(stats.modes, command.mode)
      if (command.mode === 'impulse') { stats.impulses[side]++; stats.firstImpulse[side] ??= ply + 1 }
      if (command.mode === 'form') stats.formUses[side]++
      if (command.mode === 'activate') {
        stats.activations[side]++
        if (stats.firstActivation[side] === null) {
          stats.firstActivation[side] = ply + 1
          stats.firstActivationMaterialLead[side] = material(before, side)
        }
        if (state.energy[side] === capacity) stats.fullRefundActivations[side]++
      }
    }
    for (const event of resolved.events) {
      if (event.type === 'ability') increment(stats.abilities, event.ability)
      if (event.type === 'promotion' && event.forced) stats.forcedPromotions[event.side]++
    }
    commands.push(command)
    log.push({ ply: ply + 1, side, command: commandKey(command), energyBefore: before.energy, energyAfter: state.energy, materialAfter: material(state, 'white'), captureNominal, checkNominal, earned, wasted: captureNominal + checkNominal - earned, events: resolved.events, diagnostics })
    progress?.(ply + 1)
  }
  let replay = initialState(options.rulesVersion)
  for (const command of commands) replay = transition(replay, command).state
  if (JSON.stringify(replay) !== JSON.stringify(state)) throw new Error(`Replay mismatch: ${options.id}`)
  const activatedSides = sides.filter(side => stats.firstActivation[side] !== null)
  const firstActivator = activatedSides.sort((a, b) => stats.firstActivation[a]! - stats.firstActivation[b]!)[0] ?? null
  const summary = {
    options, openingName: opening[0], plies: commands.length, outcome: state.outcome,
    unfinished: !state.outcome, finalMaterialWhite: material(state, 'white'),
    firstActivator, firstActivatorWon: firstActivator && state.outcome?.winner ? firstActivator === state.outcome.winner : null,
    firstActivatorLost: firstActivator && state.outcome?.winner ? opposite(firstActivator) === state.outcome.winner : null,
    replayVerified: true, stats,
  }
  return { summary, commands, finalState: state, log }
}
