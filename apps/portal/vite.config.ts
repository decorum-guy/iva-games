import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';

const knockPublic = fileURLToPath(new URL('../../games/knock-first/public', import.meta.url));
const knockAssets = () => ({
  name: 'knock-first-local-assets',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/knock-first/')) { next(); return; }
      let path: string;
      try { path = resolve(knockPublic, '.' + decodeURIComponent(req.url.split('?')[0])); } catch { res.statusCode = 400; res.end(); return; }
      if (!path.startsWith(knockPublic + sep) || !existsSync(path) || !statSync(path).isFile()) { res.statusCode = 404; res.end(); return; }
      const mime: Record<string, string> = { '.glb': 'model/gltf-binary', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json' };
      res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
      createReadStream(path).on('error', () => res.destroy()).pipe(res);
    });
  },
  closeBundle() {
    if (existsSync(knockPublic)) cpSync(knockPublic, fileURLToPath(new URL('./dist', import.meta.url)), { recursive: true });
  },
});

export default defineConfig({
  plugins: [react(), knockAssets()],
  resolve: { alias: [{ find: /^\/knock-first\//, replacement: resolve(knockPublic, 'knock-first') + '/' }] },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      "/api/platform": {
        target: process.env.IVA_PLATFORM_TARGET || "http://127.0.0.1:4310",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  preview: { port: 5175, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
