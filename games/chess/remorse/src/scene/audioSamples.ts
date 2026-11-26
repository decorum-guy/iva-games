const rate = 32000
export const sceneAudioPath = 'assets/audio/board.wav'

// Offsets in the locally served PCM recording. Source material is documented in the asset manifest.
const samples = {
  stone: [0, 2208],
  capture: [2464, 3565],
  diceBody: [6285, 2592],
  diceBounce: [9133, 2560],
  diceEdge: [11949, 2560],
  diceSettle: [14765, 2592],
  fracture: [17613, 5562],
  resonance: [23431, 5697],
} as const

export type SampleName = keyof typeof samples

export function sampleWindow(name: SampleName) {
  const [offset, length] = samples[name]
  return { offset: offset / rate, duration: length / rate }
}
