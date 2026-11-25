import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'server/main.ts',
    outDir: 'dist-server',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'main.js' } },
  },
  ssr: { external: ['ws', 'better-sqlite3'] },
});
