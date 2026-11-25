import type { SearchBudget, SearchDiagnostics } from './types'

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

export interface EngineSearchRequest<State> extends SearchIdentity {
  readonly type: 'search'
  readonly publicState: State
}

export type EngineSearchResponse<Action> = SearchIdentity & (
  | { readonly type: 'result'; readonly command: Action | null; readonly diagnostics: SearchDiagnostics }
  | { readonly type: 'error'; readonly code: 'invalid-request' | 'search-failed' }
)

export interface WorkerConfiguration<State, Action, Preset extends SearchBudget> {
  readonly rulesVersion: string
  readonly engineVersion: string
  readonly presetVersion: string
  getPreset(id: number): Preset | undefined
  /** Decode and validate public state, throwing on malformed/private-version data. */
  decodeState(value: unknown): State
  search(state: State, preset: Preset): { readonly command: Action | null; readonly diagnostics: SearchDiagnostics }
}

/**
 * Shared, testable worker boundary. A worker handles one synchronous request at
 * a time; terminate it to cancel an in-flight browser search. The caller must
 * reject responses from an old game, revision, request or session generation.
 */
export function createSearchHandler<State, Action, Preset extends SearchBudget>(
  configuration: WorkerConfiguration<State, Action, Preset>,
): (request: unknown) => EngineSearchResponse<Action> | null {
  return raw => {
    if (!raw || typeof raw !== 'object' || !('type' in raw) || raw.type !== 'search') return null
    const request = raw as Record<string, unknown>
    const boundedString = (value: unknown) => typeof value === 'string' && value.length <= 256 ? value : ''
    const safeInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : -1
    // An invalid request still receives a bounded scalar identity. Do not echo
    // arbitrary objects or expose a caught exception/serialized game in errors.
    const identity: SearchIdentity = {
      requestId: boundedString(request.requestId),
      gameId: boundedString(request.gameId),
      gameRevision: safeInteger(request.gameRevision),
      sessionGeneration: safeInteger(request.sessionGeneration),
      rulesVersion: boundedString(request.rulesVersion),
      engineVersion: boundedString(request.engineVersion),
      presetId: safeInteger(request.presetId),
      presetVersion: boundedString(request.presetVersion),
    }
    const invalid = (): EngineSearchResponse<Action> => ({ ...identity, type: 'error', code: 'invalid-request' })
    if (!identity.requestId || !identity.gameId ||
      !Number.isSafeInteger(identity.gameRevision) || identity.gameRevision < 0 ||
      !Number.isSafeInteger(identity.sessionGeneration) || identity.sessionGeneration < 0 ||
      !Number.isSafeInteger(identity.presetId) ||
      identity.rulesVersion !== configuration.rulesVersion ||
      identity.engineVersion !== configuration.engineVersion ||
      identity.presetVersion !== configuration.presetVersion) return invalid()

    let state: State
    let preset: Preset | undefined
    try {
      preset = configuration.getPreset(identity.presetId)
      if (!preset) return invalid()
      state = configuration.decodeState(request.publicState)
    } catch { return invalid() }

    try {
      const result = configuration.search(state, preset)
      return { ...identity, type: 'result', command: result.command, diagnostics: result.diagnostics }
    } catch {
      return { ...identity, type: 'error', code: 'search-failed' }
    }
  }
}

/** Complete identity comparison for front ends discarding late worker replies. */
export function matchesSearchIdentity(left: SearchIdentity, right: SearchIdentity): boolean {
  return left.requestId === right.requestId && left.gameId === right.gameId &&
    left.gameRevision === right.gameRevision && left.sessionGeneration === right.sessionGeneration &&
    left.rulesVersion === right.rulesVersion && left.engineVersion === right.engineVersion &&
    left.presetId === right.presetId && left.presetVersion === right.presetVersion
}
