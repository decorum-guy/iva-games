import { defineConfig, devices } from '@playwright/test'

// Dedicated acceptance server: never reuse the owner's active 4173 session.
const port = process.env.OVERDRIVE_TEST_PORT ?? '5198'
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: 'tests/e2e', testMatch: 'overdrive.spec.ts',
  fullyParallel: true, workers: 2, timeout: 90_000, retries: 0,
  outputDir: '.qa/overdrive-playwright',
  use: { baseURL: origin, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 },
      launchOptions: { args: ['--mute-audio'] } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'landscape-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 844, height: 390 },
      hasTouch: true, launchOptions: { args: ['--mute-audio'] } } },
  ],
  webServer: {
    command: 'npm run build && node dist-server/main.js',
    env: { PORT: port, HOST: '127.0.0.1', PUBLIC_ORIGIN: origin,
      DATABASE_PATH: `.qa/overdrive-e2e-remorse-${port}-${process.pid}.sqlite`,
      OVERDRIVE_DATABASE_PATH: `.qa/overdrive-e2e-${port}-${process.pid}.sqlite` },
    url: `${origin}/overdrive/`, reuseExistingServer: false, timeout: 120_000,
  },
})
