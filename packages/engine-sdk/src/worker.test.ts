import { describe, expect, it, vi } from 'vitest'
import { createSearchHandler, matchesSearchIdentity } from './worker'
import type { EngineSearchRequest, SearchIdentity } from './worker'
import type { SearchBudget, SearchDiagnostics } from './types'

const preset = { maxDepth: 1, maxNodes: 50, maxTimeMs: 20, temperature: 0 } satisfies SearchBudget
const diagnostics: SearchDiagnostics = { depth: 1, nodes: 3, elapsedMs: 1, score: 2, stopReason: 'max-depth' }
const request: EngineSearchRequest<number> = {
  type: 'search', requestId: 'request-3', gameId: 'game-2', gameRevision: 7, sessionGeneration: 4,
  rulesVersion: 'test-rules-1', engineVersion: 'test-engine-1', presetId: 1,
  presetVersion: 'test-presets-1', publicState: 42,
}

function setup() {
  const search = vi.fn(() => ({ command: 'take-two', diagnostics }))
  const handler = createSearchHandler({
    rulesVersion: request.rulesVersion, engineVersion: request.engineVersion, presetVersion: request.presetVersion,
    getPreset: (id: number) => id === 1 ? preset : undefined,
    decodeState: (value: unknown) => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('invalid number')
      return value
    },
    search,
  })
  return { handler, search }
}

describe('SDK worker protocol', () => {
  it('validates state and all versions, then returns the same request identity and real diagnostics', () => {
    const { handler, search } = setup()
    const response = handler(request)
    expect(search).toHaveBeenCalledExactlyOnceWith(42, preset)
    expect(response).toMatchObject({ type: 'result', command: 'take-two', diagnostics })
    expect(matchesSearchIdentity(response!, request)).toBe(true)
  })

  it.each([
    { rulesVersion: 'other-game' }, { engineVersion: 'old' }, { presetVersion: 'old' },
    { presetId: 2 }, { presetId: 1.5 }, { gameRevision: -1 }, { gameRevision: Infinity },
    { sessionGeneration: -1 }, { sessionGeneration: .5 }, { requestId: null }, { requestId: '' },
    { gameId: {} }, { publicState: '42' },
  ])('does not run search for invalid input %j', changes => {
    const { handler, search } = setup()
    expect(handler({ ...request, ...changes })).toMatchObject({ type: 'error', code: 'invalid-request' })
    expect(search).not.toHaveBeenCalled()
  })

  it('ignores messages unrelated to search', () => {
    const { handler, search } = setup()
    for (const value of [null, 3, 'search', {}, { type: 'other' }]) expect(handler(value)).toBeNull()
    expect(search).not.toHaveBeenCalled()
  })

  it('does not echo unbounded identifiers or nonfinite revision numbers in an invalid reply', () => {
    const { handler, search } = setup()
    const response = handler({ ...request, requestId: 'x'.repeat(257), gameRevision: Infinity })
    expect(response).toMatchObject({ type: 'error', requestId: '', gameRevision: -1, code: 'invalid-request' })
    expect(search).not.toHaveBeenCalled()
  })

  it('reports search failure without disclosing exception details or serialized game data', () => {
    const { handler, search } = setup()
    search.mockImplementationOnce(() => { throw new Error('untrusted private detail') })
    const response = handler(request)
    expect(response).toMatchObject({ type: 'error', code: 'search-failed' })
    expect(JSON.stringify(response)).not.toContain('untrusted private detail')
    expect(response).not.toHaveProperty('publicState')
  })

  it('requires every identity field to match when a front end receives a delayed reply', () => {
    const keys = ['requestId', 'gameId', 'gameRevision', 'sessionGeneration', 'rulesVersion',
      'engineVersion', 'presetId', 'presetVersion'] as const
    expect(matchesSearchIdentity(request, { ...request })).toBe(true)
    for (const key of keys) {
      const changed: SearchIdentity = { ...request, [key]: typeof request[key] === 'number' ? 99 : 'changed' }
      expect(matchesSearchIdentity(request, changed)).toBe(false)
    }
  })
})
