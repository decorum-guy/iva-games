import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import game from './vite.config.js';

export default mergeConfig(game, defineConfig({
  appType: 'mpa',
  build: {
    outDir: fileURLToPath(new URL('../../../.qa/colossus-audio-review/dist/', import.meta.url)),
    rolldownOptions: { input: ['audio-review.html', 'audio-variants.html'].map(file => fileURLToPath(new URL(file, import.meta.url))) },
  },
}));
