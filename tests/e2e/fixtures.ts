import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      const nativeDestination = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination')?.get
      if (!nativeDestination) return
      const connect = AudioNode.prototype.connect
      const outputs = new WeakMap<AudioContext, GainNode>()
      // Keep native Web Audio active for the signal assertions and leave the
      // Mac speakers quiet, even when multiple browser cases run concurrently.
      Object.defineProperty(AudioContext.prototype, 'destination', {
        configurable: true,
        get(this: AudioContext) {
          const existing = outputs.get(this)
          if (existing) return existing
          const output = this.createGain()
          output.gain.value = 0
          outputs.set(this, output)
          Reflect.apply(connect, output, [nativeDestination.call(this)])
          return output
        },
      })
    })
    await use(context)
  },
})
