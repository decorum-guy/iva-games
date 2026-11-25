import type {
  GameAdapter, SearchBudget, SearchDiagnostics, SearchLineStep, SearchOptions,
  SearchResult, StopReason,
} from './types'

export const WIN_SCORE = 1_000_000
const TABLE_LIMIT = 8192
const BAND_EPSILON = 1e-7

interface Value<Action, Chance> {
  readonly score: number
  readonly line: readonly SearchLineStep<Action, Chance>[]
}

interface Candidate<Action, Chance> extends Value<Action, Chance> {
  readonly action: Action
}

interface CacheEntry<Action, Chance> extends Candidate<Action, Chance> {
  readonly depth: number
  readonly elapsedTurns: number
  readonly history: unknown
}

type Interruption = 'deadline' | 'node-limit' | 'cancelled' | 'transition-limit'

class SearchInterrupted extends Error {
  constructor(readonly reason: Interruption) {
    super(reason)
  }
}

function finiteScore(score: number): number {
  if (!Number.isFinite(score) || Math.abs(score) >= WIN_SCORE / 2) {
    throw new RangeError('A nonterminal evaluation must be finite and inside the terminal-score band')
  }
  return score
}

function validateBudget(budget: SearchBudget, options: SearchOptions) {
  const nodeLimit = options.nodeLimit ?? budget.maxNodes
  const timeLimit = options.timeLimitMs ?? budget.maxTimeMs
  const transitions = options.maxTransitionsPerLine ?? 256
  if (!Number.isSafeInteger(budget.maxDepth) || budget.maxDepth < 1 ||
    (nodeLimit !== Infinity && (!Number.isSafeInteger(nodeLimit) || nodeLimit < 0)) ||
    Number.isNaN(timeLimit) || timeLimit < 0 ||
    !Number.isFinite(budget.temperature) || budget.temperature < 0 ||
    !Number.isSafeInteger(transitions) || transitions < 1) {
    throw new RangeError('Invalid search budget')
  }
}

function sample<Action, Chance>(
  ordered: readonly Candidate<Action, Chance>[], temperature: number, random: () => number,
): Candidate<Action, Chance> {
  const best = ordered[0]
  // Keep the established mate-selection rule without treating a merely high
  // expected score (e.g. an 80% win chance) as a proven forced outcome.
  if (temperature === 0 || Math.abs(best.score) >= WIN_SCORE - 20) return best

  const candidates = ordered.filter(candidate => best.score - candidate.score <= 3 * temperature)
  const weights = candidates.map(candidate => Math.exp((candidate.score - best.score) / temperature))
  const draw = random()
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('random() must return a value in [0, 1)')
  let cursor = draw * weights.reduce((sum, weight) => sum + weight, 0)
  for (const [index, weight] of weights.entries()) {
    cursor -= weight
    if (cursor < 0) return candidates[index]
  }
  return candidates[candidates.length - 1]
}

/** Iterative-deepening expectiminimax for adapter-defined completed turns. */
export function searchGame<State, Action, Player extends string, Chance = undefined>(
  adapter: GameAdapter<State, Action, Player, Chance>, state: State,
  budget: SearchBudget, options: SearchOptions = {},
): SearchResult<Action, Chance> {
  if (adapter.information !== 'perfect') throw new TypeError('This search supports public-information games only')
  validateBudget(budget, options)
  const now = options.now ?? (() => performance.now())
  const started = now()
  const deadline = started + (options.timeLimitMs ?? budget.maxTimeMs)
  const nodeLimit = options.nodeLimit ?? budget.maxNodes
  const transitionLimit = options.maxTransitionsPerLine ?? 256
  const perspective = adapter.player(state)
  const namespace = `${adapter.id}@${adapter.version}\0`
  const table = new Map<string, CacheEntry<Action, Chance>>()
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

  function compareActions(a: Action, b: Action): number {
    const first = adapter.actionKey(a)
    const second = adapter.actionKey(b)
    return first === second ? 0 : first < second ? -1 : 1
  }

  function rankedActions(board: State, probing = true) {
    const actions = adapter.legalActions(board, probing ? probe : undefined)
    const ranked = adapter.orderActions?.(board, actions) ?? actions.map(action => ({ action, priority: 0 }))
    return [...ranked].sort((a, b) => b.priority - a.priority || compareActions(a.action, b.action))
  }

  function terminalValue(board: State, elapsedTurns: number): number | undefined {
    const terminal = adapter.terminal(board)
    if (!terminal) return undefined
    if (terminal.winner === null) return 0
    return (WIN_SCORE - Math.min(elapsedTurns, WIN_SCORE / 4)) *
      (terminal.winner === perspective ? 1 : -1)
  }

  function actionValue(
    board: State, action: Action, turnsLeft: number, elapsedTurns: number,
    alpha: number, beta: number, transitions: number,
  ): Value<Action, Chance> {
    if (transitions >= transitionLimit) throw new SearchInterrupted('transition-limit')
    const outcomes = adapter.outcomes(board, action)
    const totalWeight = outcomes.reduce((sum, item) => sum + item.weight, 0)
    if (!outcomes.length || outcomes.some(item => !Number.isFinite(item.weight) || item.weight < 0) ||
      Math.abs(totalWeight - 1) > 1e-9) throw new RangeError('Outcome weights must be nonnegative and sum to one')

    const positive = outcomes.filter(item => item.weight > 0)
    const stochastic = positive.length > 1
    let expected = 0
    let representativeWeight = -1
    let line: readonly SearchLineStep<Action, Chance>[] = []
    for (const { chance, weight } of positive) {
      visit()
      const child = adapter.apply(board, action, chance, probe)
      const completed = adapter.turnsElapsed(board, child)
      if (!Number.isSafeInteger(completed) || completed < 0) throw new RangeError('Turn cost must be a nonnegative integer')
      // A partial chance average is not an alpha-beta bound. Every outcome gets
      // an unbounded window, including a losing branch after a winning branch.
      const value = nodeValue(child, turnsLeft - completed, elapsedTurns + completed,
        stochastic ? -Infinity : alpha, stochastic ? Infinity : beta, transitions + 1)
      expected += weight * value.score
      if (weight > representativeWeight) {
        representativeWeight = weight
        line = [{ action, chance, probability: weight }, ...value.line]
      }
    }
    return { score: expected, line }
  }

  function nodeValue(
    board: State, turnsLeft: number, elapsedTurns: number, alpha: number, beta: number,
    transitions: number,
  ): Value<Action, Chance> {
    const terminal = terminalValue(board, elapsedTurns)
    if (terminal !== undefined) return { score: terminal, line: [] }
    if (turnsLeft <= 0 && adapter.canEvaluate(board)) {
      return { score: finiteScore(adapter.evaluate(board, perspective)), line: [] }
    }

    const identity = adapter.cacheIdentity(board)
    const key = namespace + identity.position
    const cached = table.get(key)
    if (cached && cached.depth === turnsLeft && cached.elapsedTurns === elapsedTurns &&
      Object.is(cached.history, identity.history)) return cached

    const ranked = rankedActions(board)
    const preferred = cached && ranked.findIndex(item => compareActions(item.action, cached.action) === 0)
    if (preferred !== undefined && preferred > 0) ranked.unshift(ranked.splice(preferred, 1)[0])

    const maximizing = adapter.player(board) === perspective
    const originalAlpha = alpha
    const originalBeta = beta
    let best: Candidate<Action, Chance> | undefined
    for (const { action } of ranked) {
      const value = actionValue(board, action, turnsLeft, elapsedTurns, alpha, beta, transitions)
      if (!best || (maximizing ? value.score > best.score : value.score < best.score)) {
        best = { ...value, action }
      }
      if (maximizing) alpha = Math.max(alpha, value.score)
      else beta = Math.min(beta, value.score)
      if (alpha >= beta) break
    }
    if (!best) return { score: finiteScore(adapter.evaluate(board, perspective)), line: [] }

    // Store exact scores only. A different history may reuse ordering, never a
    // score: repetition/resource rewards and other path-dependent rules matter.
    if (best.score > originalAlpha && best.score < originalBeta && (cached || table.size < TABLE_LIMIT)) {
      table.set(key, { ...best, depth: turnsLeft, elapsedTurns, history: identity.history })
    }
    return best
  }

  function finish(chosen: Candidate<Action, Chance> | null, stopReason: StopReason): SearchResult<Action, Chance> {
    const diagnostics: SearchDiagnostics = {
      depth, score: chosen?.score ?? null, nodes, elapsedMs: Math.max(0, now() - started), stopReason,
    }
    return { action: chosen?.action ?? null, diagnostics, principalVariation: chosen?.line ?? [] }
  }

  if (adapter.terminal(state)) return finish(null, 'no-legal-move')
  // Root enumeration is completed once to retain a legal fallback even when a
  // request is already expired. Hard cancellation is worker termination.
  const root = rankedActions(state, false)
  if (!root.length) return finish(null, 'no-legal-move')
  const staticScore = finiteScore(adapter.evaluate(state, perspective))
  let completed: readonly Candidate<Action, Chance>[] = root.map(({ action, priority }) => ({
    action, line: [], score: finiteScore(adapter.fallbackScore?.(state, action, perspective, priority) ??
      staticScore + priority),
  })).sort((a, b) => b.score - a.score || compareActions(a.action, b.action))
  let order = root.map(({ action }) => action)
  let stopReason: StopReason = 'max-depth'

  try {
    for (let iteration = 1; iteration <= budget.maxDepth; iteration++) {
      const scores: Candidate<Action, Chance>[] = []
      let bestScore = -Infinity
      for (const action of order) {
        const alpha = bestScore - 3 * budget.temperature - BAND_EPSILON
        const value = actionValue(state, action, iteration, 0, alpha, Infinity, 0)
        // A deterministic fail-low cannot enter this iteration's choice band.
        if (value.score > alpha) {
          scores.push({ ...value, action })
          bestScore = Math.max(bestScore, value.score)
        }
      }
      scores.sort((a, b) => b.score - a.score || compareActions(a.action, b.action))
      const kept = new Set(scores.map(item => adapter.actionKey(item.action)))
      order = [...scores.map(item => item.action), ...order.filter(action => !kept.has(adapter.actionKey(action)))]
      completed = scores
      depth = iteration
    }
  } catch (error) {
    if (!(error instanceof SearchInterrupted)) throw error
    stopReason = error.reason
  }

  return finish(sample(completed, budget.temperature, options.random ?? Math.random), stopReason)
}
