import { defineConfig } from 'vite';
export default defineConfig({
  build: { ssr: 'games/district/scripts/simulate-territorial.ts', outDir: '.qa/territorial-runner', emptyOutDir: true,
    target: 'node22', rollupOptions: { output: { entryFileNames: 'simulate.mjs' } } },
});
