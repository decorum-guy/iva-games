import { RULES_VERSION, validateState } from '../core'
import { createSearchHandler } from '@chess-2/engine-sdk'
import { ENGINE_VERSION, getPreset, PRESET_VERSION } from './presets'
import { search } from './search'

const handleSearch = createSearchHandler({
  rulesVersion: RULES_VERSION, engineVersion: ENGINE_VERSION, presetVersion: PRESET_VERSION,
  getPreset, search,
  decodeState: (value: unknown) => {
    if (!validateState(value)) throw new TypeError('Invalid Overdrive state')
    return value
  },
})

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const response = handleSearch(event.data)
  if (response) self.postMessage(response)
})
