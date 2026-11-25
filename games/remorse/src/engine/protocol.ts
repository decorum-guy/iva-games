import type { Command, GameState } from '../core/types'
import type { EngineSearchRequest, EngineSearchResponse } from '@chess-2/engine-sdk'
export type { SearchIdentity, SearchDiagnostics, StopReason } from '@chess-2/engine-sdk'
export type SearchRequest = EngineSearchRequest<GameState>
export type SearchResponse = EngineSearchResponse<Command>
