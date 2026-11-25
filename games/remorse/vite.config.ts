import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Public resources keep the same origin-relative paths in standalone and combined builds.
  base: '/',
  plugins: [react()],
  server: { proxy: {
    '/api': { target: 'http://127.0.0.1:4173', changeOrigin: false },
    '/ws': { target: 'ws://127.0.0.1:4173', ws: true, changeOrigin: false },
    '/overdrive-online': { target: 'ws://127.0.0.1:4173', ws: true, changeOrigin: false },
  } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    license: { fileName: 'assets/remorse-LICENSES.md' },
  },
})
