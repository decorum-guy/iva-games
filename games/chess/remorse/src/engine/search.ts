import type { Command, GameState } from '../core/types'
import { searchGame } from '@chess-2/engine-sdk'
import type { SearchDiagnostics, SearchOptions } from '@chess-2/engine-sdk'
import { remorseAdapter } from './adapter'
import type { EnginePreset } from './presets'

export interface SearchResult {
  readonly command: Command | null
  readonly diagnostics: SearchDiagnostics
}

/** Existing Remorse/worker API; all tree traversal is supplied by the shared SDK. */
export function search(state: GameState, preset: EnginePreset, options: SearchOptions = {}): SearchResult {
  const result = searchGame(remorseAdapter, state, preset, options)
  return { command: result.action, diagnostics: result.diagnostics }
}
