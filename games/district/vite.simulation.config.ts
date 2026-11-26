import { defineConfig } from 'vite';
export default defineConfig({
  build: { ssr: 'games/district/scripts/simulate.ts', outDir: '.qa/district-simulation-runner', emptyOutDir: true,
    target: 'node22', rollupOptions: { output: { entryFileNames: 'simulate.mjs' } } },
});
