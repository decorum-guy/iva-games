import type { SearchBudget } from '@chess-2/engine-sdk'
export const ENGINE_VERSION = 'overdrive-sdk-engine-v2' as const
export const PRESET_VERSION = 'overdrive-presets-v1' as const
export interface OverdrivePreset extends SearchBudget { readonly id: number; readonly anchor: number }
const parameters = [
  [1, 180, 110, 1.2], [1, 360, 170, .9], [2, 720, 250, .65], [2, 1400, 360, .45],
  [2, 2800, 550, .3], [3, 5600, 800, .18], [3, 11200, 1200, .1], [4, 22400, 1800, .05],
  [4, 44800, 2600, .02], [5, 89600, 4000, 0],
] as const
/** Provisional internal OVERDRIVE anchors; not external human Elo measurements. */
export const PRESETS: readonly OverdrivePreset[] = parameters.map(([maxDepth, maxNodes, maxTimeMs, temperature], index) => ({ id: index + 1, anchor: 400 + index * 200, maxDepth, maxNodes, maxTimeMs, temperature }))
export const DEFAULT_PRESET_ID = 4
export const getPreset = (id: number): OverdrivePreset | undefined => PRESETS.find(p => p.id === id)
