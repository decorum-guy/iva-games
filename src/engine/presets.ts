export const ENGINE_VERSION = 'remorse-engine-v1'
export const PRESET_VERSION = 'remorse-presets-v1'
export const DEFAULT_LEVEL = 4

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface EnginePreset {
  readonly id: Level
  readonly anchor: number
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxTimeMs: number
  readonly temperature: number
}

const catalogue = [
  { id: 1, anchor: 400, maxDepth: 1, maxNodes: 200, maxTimeMs: 100, temperature: 1.2 },
  { id: 2, anchor: 600, maxDepth: 1, maxNodes: 400, maxTimeMs: 150, temperature: 0.9 },
  { id: 3, anchor: 800, maxDepth: 2, maxNodes: 800, maxTimeMs: 220, temperature: 0.65 },
  { id: 4, anchor: 1000, maxDepth: 2, maxNodes: 1600, maxTimeMs: 350, temperature: 0.45 },
  { id: 5, anchor: 1200, maxDepth: 2, maxNodes: 3200, maxTimeMs: 550, temperature: 0.3 },
  { id: 6, anchor: 1400, maxDepth: 3, maxNodes: 6400, maxTimeMs: 850, temperature: 0.18 },
  { id: 7, anchor: 1600, maxDepth: 3, maxNodes: 12800, maxTimeMs: 1200, temperature: 0.1 },
  { id: 8, anchor: 1800, maxDepth: 4, maxNodes: 25600, maxTimeMs: 1800, temperature: 0.05 },
  { id: 9, anchor: 2000, maxDepth: 4, maxNodes: 51200, maxTimeMs: 2600, temperature: 0.02 },
  { id: 10, anchor: 2200, maxDepth: 5, maxNodes: 102400, maxTimeMs: 4000, temperature: 0 },
] satisfies readonly EnginePreset[]

export const PRESETS: readonly EnginePreset[] = Object.freeze(catalogue.map(preset => Object.freeze(preset)))

export function getPreset(id: number): EnginePreset | undefined {
  return Number.isInteger(id) ? PRESETS[id - 1] : undefined
}
