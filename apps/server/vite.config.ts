import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  root: repositoryRoot,
  publicDir: false,
  build: {
    ssr: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
    outDir: fileURLToPath(new URL('../../dist-server', import.meta.url)),
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'main.js' } },
  },
  ssr: {
    external: ['ws', 'better-sqlite3'],
    noExternal: ['@chess-2/remorse', '@chess-2/overdrive', '@chess-2/colossus', '@chess-2/engine-sdk', '@iva-games/session-kit'],
  },
})
