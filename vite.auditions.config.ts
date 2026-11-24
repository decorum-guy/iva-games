import { defineConfig, mergeConfig } from 'vite';
import game from './vite.config.js';

export default mergeConfig(game, defineConfig({
  appType: 'mpa',
  build: {
    outDir: '.qa/sfx-audition/production',
    emptyOutDir: true,
    rolldownOptions: { input: ['auditions.html', 'dice.html'] },
  },
}));
