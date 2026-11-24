import type { GameEvent } from '../core/types'

let context: AudioContext | undefined
let volume: GainNode | undefined
let enabled = false

/** Call from an explicit user gesture, typically the sound toggle or the next board tap after reload. */
export async function unlockAudio() {
  enabled = true
  try {
    context ??= new AudioContext()
    if (!volume) {
      volume = context.createGain()
      volume.gain.value = .115
      volume.connect(context.destination)
    }
    if (context.state === 'suspended') await context.resume()
    if (enabled) volume.gain.setTargetAtTime(.115, context.currentTime, .02)
  } catch {
    // Browsers may suppress sound. Board decisions never depend on the audio device.
  }
}

export function muteAudio() {
  enabled = false
  if (context && volume) volume.gain.setTargetAtTime(0, context.currentTime, .02)
}

function strike(audio: AudioContext, output: GainNode, when: number, note: number, length: number, strength: number, shape: OscillatorType = 'sine') {
  const voice = audio.createOscillator()
  const decay = audio.createGain()
  voice.type = shape
  voice.frequency.setValueAtTime(note, when)
  voice.frequency.exponentialRampToValueAtTime(note * .79, when + length)
  decay.gain.setValueAtTime(.0001, when)
  decay.gain.exponentialRampToValueAtTime(strength, when + .006)
  decay.gain.exponentialRampToValueAtTime(.0001, when + length)
  voice.connect(decay).connect(output)
  voice.start(when)
  voice.stop(when + length + .014)
  voice.onended = () => { voice.disconnect(); decay.disconnect() }
}

/** Consumes committed events supplied by the controller. Nothing plays before explicit unlock. */
export function playSceneCue(events: readonly GameEvent[]) {
  const audio = context
  const output = volume
  if (!enabled || !audio || !output || audio.state !== 'running') return
  const now = audio.currentTime + .008
  const moved = events.some(event => event.type === 'move')
  if (events.some(event => event.type === 'capture')) {
    strike(audio, output, now + .13, 146, .13, .38, 'triangle')
    strike(audio, output, now + .15, 360, .071, .15)
  } else if (moved) {
    strike(audio, output, now + .19, 215, .09, .30, 'triangle')
    strike(audio, output, now + .20, 490, .047, .11)
  }

  if (events.some(event => event.type === 'reaction' && event.face)) {
    for (const [delay, note] of [[.24, 475], [.31, 366], [.405, 290], [.51, 243]]) {
      strike(audio, output, now + delay, note, .054, .16, 'triangle')
    }
  }

  if (events.some(event => event.type === 'cure' || event.type === 'convert')) {
    strike(audio, output, now + .29, 340, .29, .18)
    strike(audio, output, now + .36, 510, .32, .095)
  } else if (!moved && events.some(event => event.type === 'turn' || event.type === 'outcome')) {
    strike(audio, output, now, 252, .16, .18)
  }
}
