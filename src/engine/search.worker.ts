import { validateState } from '../core'
import { RULES_VERSION } from '../core/types'
import { ENGINE_VERSION, getPreset, PRESET_VERSION } from './presets'
import type { SearchRequest, SearchResponse } from './protocol'
import { search } from './search'

function reply(response: SearchResponse) {
  self.postMessage(response)
}

self.addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  const request = event.data
  if (!request || request.type !== 'search') return

  const { requestId, gameId, gameRevision, sessionGeneration, rulesVersion, engineVersion,
    presetId, presetVersion } = request
  const identity = { requestId, gameId, gameRevision, sessionGeneration, rulesVersion, engineVersion,
    presetId, presetVersion }
  const preset = getPreset(presetId)
  if (!preset || rulesVersion !== RULES_VERSION || engineVersion !== ENGINE_VERSION ||
    presetVersion !== PRESET_VERSION || !Number.isSafeInteger(gameRevision) || gameRevision < 0 ||
    !Number.isSafeInteger(sessionGeneration) || sessionGeneration < 0 ||
    typeof requestId !== 'string' || typeof gameId !== 'string') {
    reply({ type: 'error', ...identity, code: 'invalid-request' })
    return
  }

  let state
  try {
    state = validateState(request.publicState)
  } catch {
    reply({ type: 'error', ...identity, code: 'invalid-request' })
    return
  }

  try {
    const { command, diagnostics } = search(state, preset)
    reply({ type: 'result', ...identity, command, diagnostics })
  } catch {
    reply({ type: 'error', ...identity, code: 'search-failed' })
  }
})
