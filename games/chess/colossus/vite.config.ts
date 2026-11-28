import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  server: { proxy: {
    '/api': { target: process.env.COLOSSUS_API_ORIGIN ?? 'http://127.0.0.1:4195', changeOrigin: false },
  } },
  build: {
    outDir: 'dist', emptyOutDir: true,
    license: { fileName: 'assets/colossus-LICENSES.md' },
  },
})
