import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { name: 'overdrive', include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'] },
})
