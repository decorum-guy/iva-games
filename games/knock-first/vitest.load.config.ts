import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
// The throughput measurement runs on its own, outside unrelated test workers.
export default defineConfig({ root: fileURLToPath(new URL('../../', import.meta.url)), test: { name: 'knock-first-load', include: ['games/knock-first/tests/network-load.test.ts'], fileParallelism: false, maxWorkers: 1 } });
