import type { Command, GameState } from '../core'
import type { EngineSearchRequest, EngineSearchResponse } from '../../sdk'
export type { SearchIdentity } from '../../sdk'
export type SearchRequest = EngineSearchRequest<GameState>
export type SearchResponse = EngineSearchResponse<Command>
