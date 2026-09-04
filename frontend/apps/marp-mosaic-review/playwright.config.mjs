import { defineConfig, devices } from '@playwright/test';

const PORT = 8199;

export default defineConfig({
  testDir: './tests',
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
    /* The walkthrough exists to be watched: it records video always, and is the
       replacement for driving a browser by hand to make a recording. */
    {
      name: 'walkthrough',
      testDir: './tests/walkthrough',
      /* Narrated runs hold each caption long enough to be spoken over, so this
         project needs far longer than a normal test. */
      timeout: 240_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
        video: { mode: 'on', size: { width: 1600, height: 900 } }
      }
    },
    { name: 'desktop', testDir: './tests/e2e', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    /* The narrow layout has never been verified at real phone width — headless
       Chrome clamps its viewport, but Playwright honours this one. */
    { name: 'phone', testDir: './tests/e2e', use: { ...devices['Pixel 7'] } }
  ],

  webServer: {
    command: `node tools/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/apps/marp-mosaic-review/`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore'
  }
});
