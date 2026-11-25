import { describe, expect, it } from 'vitest'
import { searchGame, WIN_SCORE } from './search'
import type { GameAdapter, SearchBudget } from './types'

type Player = 'amber' | 'indigo'
const budget: SearchBudget = { maxDepth: 2, maxNodes: 10_000, maxTimeMs: Infinity, temperature: 0 }
const opposite = (player: Player): Player => player === 'amber' ? 'indigo' : 'amber'

interface Heap {
  readonly stones: number
  readonly player: Player
  readonly turns: number
  readonly winner: Player | null
}

// A complete non-chess game: remove one or two stones; taking the last stone wins.
const takeAway: GameAdapter<Heap, number, Player> = {
  id: 'take-away', version: '1', information: 'perfect',
  player: state => state.player,
  legalActions: state => state.winner ? [] : [1, 2].filter(count => count <= state.stones),
  outcomes: () => [{ chance: undefined, weight: 1 }],
  apply: (state, count) => ({ stones: state.stones - count, player: opposite(state.player),
    turns: state.turns + 1, winner: state.stones === count ? state.player : null }),
  terminal: state => state.winner ? { winner: state.winner } : null,
  evaluate: () => 0,
  actionKey: action => String(action),
  turnsElapsed: (before, after) => after.turns - before.turns,
  canEvaluate: () => true,
  cacheIdentity: state => ({ position: `${state.player}:${state.stones}`, history: null }),
}

interface Edge {
  readonly action: string
  readonly outcomes: readonly { readonly target: string; readonly weight: number }[]
  readonly cost?: number
}
interface Node {
  readonly player: Player
  readonly value: number
  readonly edges?: readonly Edge[]
  readonly result?: { readonly winner: Player | null }
  readonly unfinished?: boolean
  readonly position?: string
  readonly history?: string
}
type Graph = Readonly<Record<string, Node>>
interface GraphState { readonly at: string; readonly turns: number }

const edge = (action: string, target: string, cost = 1): Edge => ({ action, cost, outcomes: [{ target, weight: 1 }] })
const state = (at = 'root'): GraphState => ({ at, turns: 0 })

function graphAdapter(graph: Graph, applied?: (from: string, to: string) => void): GameAdapter<GraphState, Edge, Player, string> {
  return {
    id: 'finite-game', version: '1', information: 'perfect',
    player: board => graph[board.at].player,
    legalActions: board => graph[board.at].edges ?? [],
    outcomes: (_board, action) => action.outcomes.map(outcome => ({ chance: outcome.target, weight: outcome.weight })),
    apply: (board, action, target) => {
      applied?.(board.at, target)
      return { at: target, turns: board.turns + (action.cost ?? 1) }
    },
    terminal: board => graph[board.at].result ?? null,
    evaluate: (board, perspective) => graph[board.at].value * (perspective === 'amber' ? 1 : -1),
    actionKey: action => action.action,
    turnsElapsed: (before, after) => after.turns - before.turns,
    canEvaluate: board => !graph[board.at].unfinished,
    cacheIdentity: board => ({ position: graph[board.at].position ?? board.at,
      history: graph[board.at].history ?? '' }),
  }
}

describe('Chess 2 public-information search SDK', () => {
  it('solves a separate take-away game with player labels and actions unrelated to chess', () => {
    for (const player of ['amber', 'indigo'] as const) {
      const board: Heap = { stones: 5, player, turns: 0, winner: null }
      const before = structuredClone(board)
      const result = searchGame(takeAway, board, { ...budget, maxDepth: 5 })
      expect(result.action).toBe(2) // Leave three, then take the complement of the reply.
      expect(result.diagnostics.score).toBe(WIN_SCORE - 3)
      expect(result.diagnostics.depth).toBe(5)
      expect(result.principalVariation.map(step => step.action)).toEqual([2, 1, 2])
      expect(board).toEqual(before)
    }
  })

  it('chooses the best worst-case reply, rather than the most attractive leaf', () => {
    const graph: Graph = {
      root: { player: 'amber', value: 0, edges: [edge('a', 'a'), edge('b', 'b')] },
      a: { player: 'indigo', value: 0, edges: [edge('a3', 'three'), edge('a5', 'five')] },
      b: { player: 'indigo', value: 0, edges: [edge('b2', 'two'), edge('b9', 'nine')] },
      three: { player: 'amber', value: 3 }, five: { player: 'amber', value: 5 },
      two: { player: 'amber', value: 2 }, nine: { player: 'amber', value: 9 },
    }
    const result = searchGame(graphAdapter(graph), state(), budget)
    expect(result.action?.action).toBe('a')
    expect(result.diagnostics.score).toBe(3)
    expect(result.principalVariation.map(step => step.action.action)).toEqual(['a', 'a3'])
  })

  it('integrates random outcomes without pruning a losing branch using a partial average', () => {
    const graph: Graph = {
      root: { player: 'amber', value: 0, edges: [edge('a_safe', 'safe'),
        { action: 'b_risk', outcomes: [{ target: 'high', weight: .25 }, { target: 'low', weight: .75 }] }] },
      safe: { player: 'indigo', value: 2, edges: [edge('stay', 'two')] },
      high: { player: 'indigo', value: 100, edges: [edge('h100', 'hundred'), edge('h4', 'four')] },
      low: { player: 'indigo', value: -5, edges: [edge('l0', 'zero'), edge('ln4', 'minusFour')] },
      two: { player: 'amber', value: 2 }, hundred: { player: 'amber', value: 100 },
      four: { player: 'amber', value: 4 }, zero: { player: 'amber', value: 0 },
      minusFour: { player: 'amber', value: -4 },
    }
    const result = searchGame(graphAdapter(graph), state(), budget)
    expect(result.action?.action).toBe('a_safe')
    expect(result.diagnostics.score).toBe(2)
    const riskOnly = { ...graph, root: { ...graph.root, edges: [graph.root.edges![1]] } }
    const risk = searchGame(graphAdapter(riskOnly), state(), budget)
    expect(risk.diagnostics.score).toBe(-2) // .25 × 4 + .75 × -4
    expect(risk.principalVariation[0]).toMatchObject({ chance: 'low', probability: .75 })
  })

  it('continues a same-player bonus instead of blindly alternating maximizing/minimizing', () => {
    const graph: Graph = {
      root: { player: 'amber', value: 0, edges: [edge('bonus', 'bonus', 0), edge('normal', 'five')] },
      bonus: { player: 'amber', value: -100, unfinished: true,
        edges: [edge('gain', 'ten'), edge('lose', 'minusFive')] },
      ten: { player: 'indigo', value: 10 }, five: { player: 'indigo', value: 5 },
      minusFive: { player: 'indigo', value: -5 },
    }
    const result = searchGame(graphAdapter(graph), state(), { ...budget, maxDepth: 1 })
    expect(result.action?.action).toBe('bonus')
    expect(result.diagnostics.score).toBe(10)
    expect(result.principalVariation).toHaveLength(2)
  })

  it('lets the adapter require resolution of an unfinished depth frontier', () => {
    const graph: Graph = {
      root: { player: 'amber', value: 0, edges: [edge('start', 'unfinished')] },
      unfinished: { player: 'indigo', value: 99, unfinished: true, edges: [edge('finish', 'loss', 0)] },
      loss: { player: 'amber', value: -3 },
    }
    expect(searchGame(graphAdapter(graph), state(), { ...budget, maxDepth: 1 }).diagnostics.score).toBe(-3)
  })

  it('separates identical positions with different path-dependent draw histories', () => {
    const graph: Graph = {
      root: { player: 'amber', value: 0, edges: [edge('a_repeated', 'repeated'), edge('b_fresh', 'fresh')] },
      repeated: { player: 'indigo', value: 10, position: 'same-board', history: 'draw-claim',
        edges: [edge('draw', 'draw'), edge('lose', 'ten')] },
      fresh: { player: 'indigo', value: 10, position: 'same-board', history: 'no-claim', edges: [edge('lose', 'ten')] },
      draw: { player: 'amber', value: 0, result: { winner: null } }, ten: { player: 'amber', value: 10 },
    }
    const result = searchGame(graphAdapter(graph), state(), budget)
    expect(result.action?.action).toBe('b_fresh')
    expect(result.diagnostics.score).toBe(10)
  })

  it('reuses an exact transposition only when position, history, depth and elapsed turns match', () => {
    let leaves = 0
    const graph: Graph = {
      root: { player: 'amber', value: 0, edges: [edge('a', 'same'), edge('b', 'same')] },
      same: { player: 'indigo', value: 0, edges: [edge('three', 'three'), edge('five', 'five')] },
      three: { player: 'amber', value: 3 }, five: { player: 'amber', value: 5 },
    }
    const result = searchGame(graphAdapter(graph, from => { if (from === 'same') leaves++ }), state(), budget)
    expect(leaves).toBe(2)
    expect(result.diagnostics.nodes).toBe(6)
    expect(result.diagnostics.score).toBe(3)
  })

  it('retains the complete shallow decision and line when a deeper pass runs out of nodes', () => {
    const source: Heap = { stones: 5, player: 'amber', turns: 0, winner: null }
    const shallow = searchGame(takeAway, source, { ...budget, maxDepth: 1 })
    const interrupted = searchGame(takeAway, source, budget, { nodeLimit: shallow.diagnostics.nodes + 2 })
    expect(interrupted.action).toBe(shallow.action)
    expect(interrupted.principalVariation).toEqual(shallow.principalVariation)
    expect(interrupted.diagnostics).toMatchObject({ depth: 1, stopReason: 'node-limit', nodes: 4 })
  })

  it.each(['cancelled', 'deadline', 'node-limit'] as const)('returns a legal static fallback at %s with depth zero', reason => {
    const source: Heap = { stones: 5, player: 'amber', turns: 0, winner: null }
    const options = reason === 'cancelled' ? { cancelled: () => true } :
      reason === 'deadline' ? { timeLimitMs: 0 } : { nodeLimit: 0 }
    const result = searchGame(takeAway, source, budget, options)
    expect([1, 2]).toContain(result.action)
    expect(result.diagnostics).toMatchObject({ depth: 0, nodes: 0, stopReason: reason, score: 0 })
    expect(result.principalVariation).toEqual([])
  })

  it('passes cooperative cancellation into variant rule work', () => {
    let stop = false
    const adapter = { ...takeAway, apply: (...args: Parameters<typeof takeAway.apply>) => {
      stop = true
      args[3]?.()
      return takeAway.apply(...args)
    } }
    const result = searchGame(adapter, { stones: 3, player: 'amber', turns: 0, winner: null }, budget,
      { cancelled: () => stop })
    expect(result.diagnostics).toMatchObject({ depth: 0, nodes: 1, stopReason: 'cancelled' })
  })

  it('caps faulty zero-turn cycles before overflowing the JavaScript stack', () => {
    const graph: Graph = { root: { player: 'amber', value: 0, unfinished: true, edges: [edge('repeat', 'root', 0)] } }
    const result = searchGame(graphAdapter(graph), state(), budget, { maxTransitionsPerLine: 20 })
    expect(result.diagnostics).toMatchObject({ depth: 0, nodes: 20, stopReason: 'transition-limit' })
  })

  it('treats terminal states as finished even if a faulty action generator still lists actions', () => {
    const result = searchGame(takeAway, { stones: 0, player: 'indigo', turns: 1, winner: 'amber' }, budget)
    expect(result.action).toBeNull()
    expect(result.diagnostics).toMatchObject({ depth: 0, nodes: 0, stopReason: 'no-legal-move' })
  })

  it('weakens inside a bounded score band while a zero-temperature profile stays deterministic', () => {
    const graph: Graph = {
      root: { player: 'amber', value: 0, edges: [edge('best', 'best'), edge('near', 'near'), edge('blunder', 'blunder')] },
      best: { player: 'indigo', value: 10 }, near: { player: 'indigo', value: 9 },
      blunder: { player: 'indigo', value: -10 },
    }
    const adapter = graphAdapter(graph)
    expect(searchGame(adapter, state(), budget, { random: () => .999 }).action?.action).toBe('best')
    const soft = searchGame(adapter, state(), { ...budget, temperature: 1 }, { random: () => .999 })
    expect(soft.action?.action).toBe('near')
    expect(soft.diagnostics.score).toBe(9)
  })

  it('never randomizes away a discovered forced win', () => {
    const source: Heap = { stones: 2, player: 'amber', turns: 0, winner: null }
    expect(searchGame(takeAway, source, { ...budget, temperature: 100_000 },
      { random: () => .9999 }).action).toBe(2)
  })

  it('rejects malformed chance distributions and nonterminal terminal-band values', () => {
    const source: Heap = { stones: 2, player: 'amber', turns: 0, winner: null }
    expect(() => searchGame({ ...takeAway, outcomes: () => [{ chance: undefined, weight: .4 }] }, source, budget))
      .toThrow('sum to one')
    expect(() => searchGame({ ...takeAway, evaluate: () => Infinity }, source, budget)).toThrow('finite')
    expect(() => searchGame(takeAway, source, { ...budget, temperature: -1 })).toThrow('Invalid search budget')
  })

  it('matches exhaustive expectiminimax on generated mixed decision/chance trees', () => {
    // Independent full-tree oracle: no caching, pruning, ordering or SDK callbacks.
    for (let seed = 1; seed <= 12; seed++) {
      let rng = seed
      const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 2 ** 32 }
      const graph: Record<string, Node> = {}
      let serial = 0
      function grow(depth: number, player: Player): string {
        const id = `n${serial++}`
        const value = Math.floor(random() * 41) - 20
        const edges: Edge[] = depth === 0 ? [] : [0, 1, 2].map(action => ({
          action: String(action), outcomes: [1 / 3, 2 / 3].map(weight => ({
            target: grow(depth - 1, random() < .2 ? player : opposite(player)), weight,
          })),
        }))
        graph[id] = { player, value, edges }
        return id
      }
      const root = grow(3, 'amber')
      function oracle(at: string): number {
        const node = graph[at]
        if (!node.edges?.length) return node.value
        const values = node.edges.map(action => action.outcomes.reduce((sum, outcome) =>
          sum + outcome.weight * oracle(outcome.target), 0))
        return node.player === 'amber' ? Math.max(...values) : Math.min(...values)
      }
      const result = searchGame(graphAdapter(graph), state(root), { ...budget, maxDepth: 3 })
      expect(result.diagnostics.score).toBeCloseTo(oracle(root), 10)
      expect(result.diagnostics.depth).toBe(3)
    }
  })
})
