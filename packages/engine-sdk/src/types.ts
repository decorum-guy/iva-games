/**
 * Chess 2 Engine SDK: synchronous search for two-player, zero-sum games with
 * public information. Hidden hands/decks require a different search model;
 * passing an omniscient state here does not make a fair hidden-information bot.
 */
export interface SearchBudget {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxTimeMs: number
  readonly temperature: number
}

export type StopReason =
  | 'max-depth' | 'node-limit' | 'deadline' | 'cancelled' | 'no-legal-move'
  | 'transition-limit'

export interface SearchDiagnostics {
  /** Last completely evaluated root iteration; zero means a static fallback. */
  readonly depth: number
  readonly nodes: number
  readonly elapsedMs: number
  readonly stopReason: StopReason
  readonly score: number | null
}

export interface SearchOptions {
  readonly timeLimitMs?: number
  readonly nodeLimit?: number
  readonly cancelled?: () => boolean
  readonly random?: () => number
  readonly now?: () => number
  /** Protects against a variant accidentally permitting an endless zero-turn loop. */
  readonly maxTransitionsPerLine?: number
}

export interface WeightedOutcome<Chance> {
  readonly chance: Chance
  readonly weight: number
}

export interface RankedAction<Action> {
  readonly action: Action
  readonly priority: number
}

export interface CacheIdentity {
  /** Full current position: include resources, rights, active effects, and actor. */
  readonly position: string
  /** All path-dependent rules, or an immutable history object (identity equality). */
  readonly history: unknown
}

export interface GameAdapter<State, Action, Player extends string, Chance = undefined> {
  /** Stable game ID plus a version changed whenever rules/evaluation semantics change. */
  readonly id: string
  readonly version: string
  readonly information: 'perfect'
  player(state: State): Player
  legalActions(state: State, probe?: () => void): readonly Action[]
  outcomes(state: State, action: Action): readonly WeightedOutcome<Chance>[]
  /** Apply an already legal action, without mutating the supplied state. */
  apply(state: State, action: Action, chance: Chance, probe?: () => void): State
  terminal(state: State): { readonly winner: Player | null } | null
  /** Nonterminal score from perspective; must be finite and strictly within ±500,000. */
  evaluate(state: State, perspective: Player): number
  /** Stable, unique key for a complete action, including every chosen target. */
  actionKey(action: Action): string
  orderActions?(state: State, actions: readonly Action[]): readonly RankedAction<Action>[]
  /** Completed turn units; zero allows an additional decision by the same player. */
  turnsElapsed(before: State, after: State): number
  /** Whether a depth frontier may be evaluated here, e.g. after a bonus phase ends. */
  canEvaluate(state: State): boolean
  cacheIdentity(state: State): CacheIdentity
  /** Optional special handling of root fallback actions such as a draw claim. */
  fallbackScore?(state: State, action: Action, perspective: Player, priority: number): number
}

export interface SearchLineStep<Action, Chance> {
  readonly action: Action
  /** Most likely outcome, deterministic ties resolved in adapter outcome order. */
  readonly chance: Chance
  readonly probability: number
}

export interface SearchResult<Action, Chance = undefined> {
  readonly action: Action | null
  readonly diagnostics: SearchDiagnostics
  /** A representative continuation, not a prediction of random outcomes. Empty for static fallback. */
  readonly principalVariation: readonly SearchLineStep<Action, Chance>[]
}
