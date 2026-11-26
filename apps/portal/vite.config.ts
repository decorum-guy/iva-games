import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      "/api/platform": {
        target: process.env.IVA_PLATFORM_TARGET || "http://127.0.0.1:4310",
        changeOrigin: false,
      },
    },
  },
  preview: { port: 5175, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
