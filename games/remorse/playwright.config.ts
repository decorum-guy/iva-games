import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test';

const repository = fileURLToPath(new URL('../../', import.meta.url))
const gameRoot = fileURLToPath(new URL('.', import.meta.url))

const port = process.env.REMORSE_TEST_PORT ?? '5199';
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: `${gameRoot}/tests/e2e`,
  fullyParallel: true,
  workers: 3,
  timeout: 75_000,
  retries: 0,
  outputDir: `${repository}/.qa/playwright`,
  use: { baseURL: url, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--mute-audio'] } } },
    { name: 'webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    cwd: repository,
    command: `npm run build && node dist-server/main.js`,
    env: { PORT: port, HOST: '127.0.0.1', DATABASE_PATH: `.qa/e2e-${port}-${process.pid}.sqlite`, OVERDRIVE_DATABASE_PATH: `.qa/e2e-overdrive-${port}-${process.pid}.sqlite`, PUBLIC_ORIGIN: url },
    url, reuseExistingServer: process.env.REMORSE_REUSE_TEST_SERVER === '1', timeout: 90_000,
  },
});
