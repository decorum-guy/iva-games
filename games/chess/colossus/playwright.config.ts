import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const port = process.env.COLOSSUS_TEST_PORT ?? '5209';
const origin = `http://127.0.0.1:${port}`;
const prebuilt = process.env.COLOSSUS_E2E_PREBUILT === '1';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `${repository}/.qa/colossus-playwright`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: 'list',
  use: {
    baseURL: `${origin}/colossus/`,
    actionTimeout: 12_000,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    launchOptions: {
      // The real Chromium WebGL renderer runs through ANGLE/SwiftShader in CI.
      // A successful 2D fallback does not satisfy the separate 3D assertions.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'mobile-chromium', testIgnore: '**/colossus3d.spec.ts', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'short-mobile-chromium', testIgnore: '**/colossus3d.spec.ts', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 600 } } },
  ],
  webServer: {
    // One shared server for the full project matrix. CI builds all packages once.
    command: prebuilt ? 'node dist-server/main.js' : 'npm run build && node dist-server/main.js',
    cwd: repository,
    env: {
      HOST: '127.0.0.1', PORT: port, NODE_ENV: 'test', PUBLIC_ORIGIN: origin,
      DATABASE_PATH: `.qa/colossus-e2e-${port}-${process.pid}/remorse.sqlite`,
      OVERDRIVE_DATABASE_PATH: `.qa/colossus-e2e-${port}-${process.pid}/overdrive.sqlite`,
      COLOSSUS_DATABASE_PATH: `.qa/colossus-e2e-${port}-${process.pid}/colossus.sqlite`,
    },
    url: `${origin}/api/colossus/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
