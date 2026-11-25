import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy: {
    '/api': { target: 'http://127.0.0.1:4173', changeOrigin: false },
    '/ws': { target: 'ws://127.0.0.1:4173', ws: true, changeOrigin: false },
    '/overdrive-online': { target: 'ws://127.0.0.1:4173', ws: true, changeOrigin: false },
  } },
  build: { license: { fileName: "THIRD_PARTY_LICENSES.md" },
    rollupOptions: { input: { remorse: resolve('index.html'), overdrive: resolve('overdrive/index.html') } },
  },
});
