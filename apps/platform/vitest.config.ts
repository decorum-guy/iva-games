import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { name: 'platform', include: ['tests/**/*.test.ts'], testTimeout: 15_000, hookTimeout: 15_000 },
});
