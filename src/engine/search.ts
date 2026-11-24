import { enumerateOutcomes, legalCommands, positionKey, transitionKnownLegal } from '../core'
import type { Command, GameState, Side } from '../core/types'
import { compareCommands, evaluate, orderCommands } from './evaluate'
import type { EnginePreset } from './presets'
import type { SearchDiagnostics, StopReason } from './protocol'

const MATE = 1_000_000
const TABLE_LIMIT = 8192
const BAND_EPSILON = 1e-7

interface Candidate {
  readonly command: Command
  readonly score: number
}

interface CacheEntry extends Candidate {
  readonly depth: number
  readonly elapsedTurns: number
  readonly repetition: GameState['repetition']
}

interface SearchOptions {
  readonly timeLimitMs?: number
  readonly nodeLimit?: number
  readonly cancelled?: () => boolean
  readonly random?: () => number
  readonly now?: () => number
}

export interface SearchResult {
  readonly command: Command | null
  readonly diagnostics: SearchDiagnostics
}

type Interruption = 'deadline' | 'node-limit' | 'cancelled'
class SearchInterrupted extends Error {
  constructor(readonly reason: Interruption) {
    super(reason)
  }
}

function terminalValue(state: GameState, perspective: Side, elapsedTurns: number): number | undefined {
  if (!state.outcome) return undefined
  if (!state.outcome.winner) return 0
  return (MATE - elapsedTurns) * (state.outcome.winner === perspective ? 1 : -1)
}

function sample(ordered: readonly Candidate[], temperature: number, random: () => number): Candidate {
  const best = ordered[0]
  if (temperature === 0 || Math.abs(best.score) >= MATE - 20) return best

  const window = 3 * temperature
  const candidates = ordered.filter(candidate => best.score - candidate.score <= window)
  const weights = candidates.map(candidate => Math.exp((candidate.score - best.score) / temperature))
  let cursor = random() * weights.reduce((sum, weight) => sum + weight, 0)
  for (const [index, weight] of weights.entries()) {
    cursor -= weight
    if (cursor < 0) return candidates[index]
  }
  return candidates[candidates.length - 1]
}

export function search(state: GameState, preset: EnginePreset, options: SearchOptions = {}): SearchResult {
  const now = options.now ?? (() => performance.now())
  const started = now()
  const deadline = started + (options.timeLimitMs ?? preset.maxTimeMs)
  const nodeLimit = options.nodeLimit ?? preset.maxNodes
  const perspective = state.side
  const table = new Map<string, CacheEntry>()
  let nodes = 0
  let depth = 0

  function probe() {
    if (options.cancelled?.()) throw new SearchInterrupted('cancelled')
    if (now() >= deadline) throw new SearchInterrupted('deadline')
  }

  function visit() {
    if (nodes >= nodeLimit) throw new SearchInterrupted('node-limit')
    probe()
    nodes++
  }

  function commandValue(
    board: GameState, command: Command, turnsLeft: number, elapsedTurns: number,
    alpha: number, beta: number,
  ): number {
    const chance = enumerateOutcomes(board, command)
    const stochastic = chance.length > 1
    let expected = 0
    for (const { face, weight } of chance) {
      visit()
      const { state: child } = transitionKnownLegal(board, command, face, probe)
      const completed = child.turnSerial - board.turnSerial
      // A partial chance average is no bound. Every face group gets a full search window.
      expected += weight * nodeValue(child, turnsLeft - completed, elapsedTurns + completed,
        stochastic ? -Infinity : alpha, stochastic ? Infinity : beta)
    }
    return expected
  }

  function nodeValue(
    board: GameState, turnsLeft: number, elapsedTurns: number, alpha: number, beta: number,
  ): number {
    const terminal = terminalValue(board, perspective, elapsedTurns)
    if (terminal !== undefined) return terminal

    if (turnsLeft <= 0 && board.phase === 'primary') {
      const staticScore = evaluate(board, perspective)
      // At the frontier a guaranteed draw is already an alternative to a losing position.
      if ((board.side === perspective ? staticScore < 0 : staticScore > 0) &&
        Object.values(board.repetition).some(count => count >= 3) &&
        (board.repetition[positionKey(board)] ?? 0) >= 3) return 0
      return staticScore
    }

    const key = positionKey(board)
    const cached = table.get(key)
    if (cached && cached.depth === turnsLeft && cached.elapsedTurns === elapsedTurns &&
      cached.repetition === board.repetition) return cached.score

    const ranked = orderCommands(board, legalCommands(board, probe))
    const preferred = cached && ranked.findIndex(item => compareCommands(item.command, cached.command) === 0)
    if (preferred !== undefined && preferred > 0) ranked.unshift(ranked.splice(preferred, 1)[0])

    const maximizing = board.side === perspective
    const originalAlpha = alpha
    const originalBeta = beta
    let best: Candidate | undefined
    for (const { command } of ranked) {
      const score = commandValue(board, command, turnsLeft, elapsedTurns, alpha, beta)
      if (!best || (maximizing ? score > best.score : score < best.score)) best = { score, command }

      if (maximizing) alpha = Math.max(alpha, score)
      else beta = Math.min(beta, score)
      if (alpha >= beta) break
    }
    if (!best) return evaluate(board, perspective)

    // Bounds are only used locally. Exact values are reusable only on the same history;
    // a different history can still use the command as an ordering hint.
    if (best.score > originalAlpha && best.score < originalBeta && (cached || table.size < TABLE_LIMIT)) {
      table.set(key, { ...best, depth: turnsLeft, elapsedTurns, repetition: board.repetition })
    }
    return best.score
  }

  function finish(command: Command | null, score: number | null, stopReason: StopReason): SearchResult {
    return { command, diagnostics: { depth, score, nodes, elapsedMs: now() - started, stopReason } }
  }

  // Generate the root list once and keep a fully scored static fallback. Deeper passes
  // can be interrupted anywhere without mixing incomplete results or discarding it.
  const root = orderCommands(state, legalCommands(state))
  if (!root.length) return finish(null, null, 'no-legal-move')
  const staticScore = evaluate(state, perspective)
  let completed: readonly Candidate[] = root.map(({ command, priority }) => ({
    command,
    score: command.type === 'claimRepetitionDraw' ? 0 : staticScore + priority,
  }))
  let order = root.map(({ command }) => command)
  let stopReason: StopReason = 'max-depth'

  try {
    for (let iteration = 1; iteration <= preset.maxDepth; iteration++) {
      const scores: Candidate[] = []
      let bestScore = -Infinity
      for (const command of order) {
        const alpha = bestScore - 3 * preset.temperature - BAND_EPSILON
        const score = commandValue(state, command, iteration, 0, alpha, Infinity)
        // A deterministic fail-low cannot enter the same-depth choice window.
        if (score > alpha) {
          scores.push({ command, score })
          bestScore = Math.max(bestScore, score)
        }
      }
      scores.sort((a, b) => b.score - a.score || compareCommands(a.command, b.command))
      const kept = new Set(scores.map(item => item.command))
      order = [...scores.map(item => item.command), ...order.filter(command => !kept.has(command))]
      completed = scores
      depth = iteration
    }
  } catch (error) {
    if (!(error instanceof SearchInterrupted)) throw error
    stopReason = error.reason
  }

  const chosen = sample(completed, preset.temperature, options.random ?? Math.random)
  return finish(chosen.command, chosen.score, stopReason)
}
