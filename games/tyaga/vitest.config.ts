import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'tyaga', environment: 'node', include: ['games/tyaga/tests/**/*.test.ts'], testTimeout: 30000 } });
