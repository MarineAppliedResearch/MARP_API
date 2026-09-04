import { defineConfig, devices } from '@playwright/test';

const PORT = 8199;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,          // the fixture is mutated in place, so runs must not overlap
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? 'line' : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}/apps/marp-mosaic-review/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    /* The narrow layout has never been verified at real phone width — headless
       Chrome clamps its viewport, but Playwright honours this one. */
    { name: 'phone', use: { ...devices['Pixel 7'] } }
  ],

  webServer: {
    command: `node tools/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/apps/marp-mosaic-review/`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore'
  }
});
