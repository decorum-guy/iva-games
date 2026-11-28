import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = process.env.CHESS_HOME_TEST_PORT ?? '5216';
const origin = `http://127.0.0.1:${port}`;
const portalPort = process.env.CHESS_HOME_PORTAL_TEST_PORT ?? '5217';
const portalOrigin = `http://127.0.0.1:${portalPort}`;

export default defineConfig({
  testDir: fileURLToPath(new URL('./tests', import.meta.url)),
  outputDir: `${root}/.qa/chess-home-playwright`,
  timeout: 45_000,
  use: { baseURL: origin, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { args: ['--mute-audio'] } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [{
    cwd: root,
    command: 'node dist-server/main.js',
    env: { HOST: '127.0.0.1', PORT: port, PUBLIC_ORIGIN: origin,
      DATABASE_PATH: `.qa/chess-home-${port}-${process.pid}.sqlite`,
      OVERDRIVE_DATABASE_PATH: `.qa/chess-home-overdrive-${port}-${process.pid}.sqlite`,
      COLOSSUS_DATABASE_PATH: `.qa/chess-home-colossus-${port}-${process.pid}.sqlite` },
    url: `${origin}/api/health`, reuseExistingServer: false, timeout: 30_000,
  }, {
    cwd: root,
    command: `npm --prefix apps/portal run preview -- --port ${portalPort} --strictPort`,
    url: portalOrigin, reuseExistingServer: false, timeout: 30_000,
  }],
});
