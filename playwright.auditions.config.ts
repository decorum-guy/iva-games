import { defineConfig, devices } from '@playwright/test';

const port = process.env.REMORSE_AUDITION_PORT ?? '4174';
const url = `http://127.0.0.1:${port}/auditions.html`;

export default defineConfig({
  testDir: 'tests/auditions', workers: 1, timeout: 75000, retries: 0,
  outputDir: '.qa/sfx-audition/playwright',
  use: { baseURL: url, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 },
      launchOptions: { args: ['--mute-audio', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] } } },
    { name: 'webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: `npm run auditions:build && vite preview --config vite.auditions.config.ts --host 127.0.0.1 --port ${port} --strictPort`, url,
    reuseExistingServer: true, timeout: 60000 },
});
