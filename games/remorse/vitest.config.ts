import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { name: 'remorse', include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'] },
})
