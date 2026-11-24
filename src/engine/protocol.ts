import type { Command, GameState } from '../core/types'

export interface SearchIdentity {
  readonly requestId: string
  readonly gameId: string
  readonly gameRevision: number
  readonly sessionGeneration: number
  readonly rulesVersion: string
  readonly engineVersion: string
  readonly presetId: number
  readonly presetVersion: string
}

export interface SearchRequest extends SearchIdentity {
  readonly type: 'search'
  readonly publicState: GameState
}

export type StopReason = 'max-depth' | 'node-limit' | 'deadline' | 'cancelled' | 'no-legal-move'

export interface SearchDiagnostics {
  readonly depth: number
  readonly nodes: number
  readonly elapsedMs: number
  readonly stopReason: StopReason
  readonly score: number | null
}

export type SearchResponse = SearchIdentity & (
  | { readonly type: 'result'; readonly command: Command | null; readonly diagnostics: SearchDiagnostics }
  | { readonly type: 'error'; readonly code: 'invalid-request' | 'search-failed' }
)
