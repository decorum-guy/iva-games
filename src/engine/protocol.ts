import type { Command, GameState } from '../core/types'
import type { EngineSearchRequest, EngineSearchResponse } from '../sdk'
export type { SearchIdentity, SearchDiagnostics, StopReason } from '../sdk'
export type SearchRequest = EngineSearchRequest<GameState>
export type SearchResponse = EngineSearchResponse<Command>
