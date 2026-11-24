import { defineConfig, devices } from '@playwright/test';

const port = process.env.REMORSE_TEST_PORT ?? '4173';
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  workers: 3,
  timeout: 75_000,
  retries: 0,
  outputDir: '.qa/playwright',
  use: { baseURL: url, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url, reuseExistingServer: true, timeout: 60_000,
  },
});
