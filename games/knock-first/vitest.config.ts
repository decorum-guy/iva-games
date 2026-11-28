import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('../../', import.meta.url)), test: { name: 'knock-first', include: ['games/knock-first/tests/**/*.test.ts'], exclude: ['games/knock-first/tests/network-load.test.ts'] } });
