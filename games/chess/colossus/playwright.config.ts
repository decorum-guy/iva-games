import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const port = process.env.COLOSSUS_TEST_PORT ?? '5209'
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `${repository}/.qa/colossus-playwright`,
  fullyParallel: false, workers: 1, retries: 0,
  timeout: 90_000,
  use: { baseURL: `${origin}/colossus/`, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run build && node dist-server/main.js', cwd: repository,
    env: { HOST: '127.0.0.1', PORT: port, NODE_ENV: 'test', PUBLIC_ORIGIN: origin,
      DATABASE_PATH: `.qa/colossus-e2e-${port}-${process.pid}/remorse.sqlite`,
      OVERDRIVE_DATABASE_PATH: `.qa/colossus-e2e-${port}-${process.pid}/overdrive.sqlite`,
      COLOSSUS_DATABASE_PATH: `.qa/colossus-e2e-${port}-${process.pid}/colossus.sqlite` },
    url: `${origin}/colossus/`, reuseExistingServer: false, timeout: 120_000,
  },
})
