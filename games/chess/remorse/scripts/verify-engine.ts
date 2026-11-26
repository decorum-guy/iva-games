import { applyResolvedCommand, createInitialState, createPosition, enumerateOutcomes, legalCommands } from '../src/core'
import type { Command, GameState } from '../src/core/types'
import { getPreset, PRESETS } from '../src/engine/presets'
import { search } from '../src/engine/search'
import { nextDie } from '../src/session/random'

function format(command: Command | null): string {
  if (!command) return '—'
  return command.type === 'move' ? `${command.from}${command.to}${command.promotion ?? ''}` : command.type
}

function testRandom(seed: number): () => number {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function mixed() {
  return createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'h1' },
    { side: 'white', type: 'rook', square: 'c3' },
    { side: 'white', type: 'bishop', square: 'e2' },
    { side: 'white', type: 'knight', square: 'f2', affliction: 'guilt' },
    { side: 'white', type: 'pawn', square: 'g2' },
    { side: 'black', type: 'king', square: 'a8' },
    { side: 'black', type: 'queen', square: 'c5' },
    { side: 'black', type: 'pawn', square: 'c7' },
    { side: 'black', type: 'pawn', square: 'g7' },
    { side: 'black', type: 'bishop', square: 'b6' },
  ] })
}

function mateInOne() {
  return createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'c6' },
    { side: 'white', type: 'queen', square: 'b6' },
    { side: 'black', type: 'king', square: 'a8' },
  ] })
}

function assertLegal(state: GameState, command: Command | null): asserts command is Command {
  if (!command || !legalCommands(state).some(legal => format(legal) === format(command))) {
    throw new Error('Engine returned an illegal command: ' + format(command))
  }
}

const opening = createInitialState()
const tactical = mixed()
const mate = mateInOne()

console.log('Default wall-clock budgets on the initial position; fixed node budgets on mixed and mate roots.')
console.table(PRESETS.map(preset => {
  const openingSample = search(opening, preset, { random: testRandom(5424) })
  const mixedSample = search(tactical, preset, { timeLimitMs: Infinity, random: testRandom(9316) })
  const mateSample = search(mate, preset, { timeLimitMs: Infinity, random: testRandom(1802) })
  assertLegal(opening, openingSample.command)
  assertLegal(tactical, mixedSample.command)
  assertLegal(mate, mateSample.command)
  if (applyResolvedCommand(mate, mateSample.command).state.outcome?.reason !== 'checkmate') {
    throw new Error('Preset missed mate in one: ' + preset.id)
  }
  return {
    level: preset.id,
    opening: format(openingSample.command),
    'opening depth': openingSample.diagnostics.depth,
    'opening nodes': openingSample.diagnostics.nodes,
    'opening ms': Math.round(openingSample.diagnostics.elapsedMs),
    'opening stop': openingSample.diagnostics.stopReason,
    mixed: format(mixedSample.command),
    'mixed depth': mixedSample.diagnostics.depth,
    'mixed nodes': mixedSample.diagnostics.nodes,
    'mixed ms': Math.round(mixedSample.diagnostics.elapsedMs),
    mate: format(mateSample.command),
  }
}))

function play(white: number, black: number, game: 'opening' | 'mixed', seed: number) {
  const CAP = 48
  const options = { timeLimitMs: Infinity, random: testRandom(seed ^ 0x43a52c99) }
  const presets = { white: getPreset(white)!, black: getPreset(black)! }
  let state = game === 'opening' ? createInitialState() : mixed()
  let commandCount = 0
  let rolls = 0
  let elapsedMs = 0
  while (!state.outcome && state.turnSerial < CAP) {
    const preset = presets[state.side]
    const result = search(state, preset, { ...options, nodeLimit: Math.min(preset.maxNodes, 2400) })
    assertLegal(state, result.command)
    elapsedMs += result.diagnostics.elapsedMs
    const needsFace = enumerateOutcomes(state, result.command).length > 1
    const roll = needsFace ? nextDie(seed) : undefined
    if (roll) {
      rolls++
      seed = roll.seed
    }
    state = applyResolvedCommand(state, result.command, roll?.face).state
    commandCount++
  }
  return {
    game, white, black, turns: state.turnSerial, actions: commandCount, rolls,
    result: state.outcome?.reason ?? 'cap', winner: state.outcome?.winner ?? '—',
    'search ms': Math.round(elapsedMs),
  }
}

console.log('Color swaps with independent seeded engine choices and dice; 48 completed turns and at most 2,400 nodes/decision.')
console.table([
  play(1, 4, 'opening', 17), play(4, 1, 'opening', 17),
  play(4, 10, 'mixed', 52), play(10, 4, 'mixed', 52),
  play(1, 10, 'mixed', 21), play(10, 1, 'mixed', 21),
])
