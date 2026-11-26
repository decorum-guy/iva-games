import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({ root: fileURLToPath(new URL('../../', import.meta.url)), test: { name: 'district', include: ['games/district/**/*.test.ts'], testTimeout: 15_000 } });
