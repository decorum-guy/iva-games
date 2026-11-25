import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import game from './vite.config.js'

export default mergeConfig(game, defineConfig({
  appType: 'mpa',
  build: {
    outDir: fileURLToPath(new URL('../../.qa/sfx-audition/production/', import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: { input: ['auditions.html', 'dice.html'].map(file => fileURLToPath(new URL(file, import.meta.url))) },
  },
}))
