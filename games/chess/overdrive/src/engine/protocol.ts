import type { Command, GameState } from '../core'
import type { EngineSearchRequest, EngineSearchResponse } from '@chess-2/engine-sdk'
export type { SearchIdentity } from '@chess-2/engine-sdk'
export type SearchRequest = EngineSearchRequest<GameState>
export type SearchResponse = EngineSearchResponse<Command>
