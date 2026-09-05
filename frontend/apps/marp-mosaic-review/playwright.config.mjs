import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * A port belonging to this checkout, and to no other.
 *
 * A fixed port cost most of a day. A dev server left running in a different checkout
 * still held 8199, Playwright reused it because `reuseExistingServer` was on, and every
 * browser test silently graded *that* checkout's code instead of this one's. Six tests
 * failed against changes they never saw, and the same six passed the moment the stale
 * process was killed, with nothing else altered.
 *
 * Deriving the port from this file's own path means two working copies of this
 * repository cannot land on the same one, and no coordination is needed to arrange it.
 * `MARP_TEST_PORT` overrides, for when something outside has to know the number.
 */
const PORT = Number(process.env.MARP_TEST_PORT)
  || 8100 + (parseInt(createHash('sha1')
       .update(fileURLToPath(import.meta.url)).digest('hex').slice(0, 6), 16) % 700);

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
    /* Never adopt a server this run did not start. Reusing one is how the tests came
       to grade a different checkout without saying so; a busy port must be a loud
       failure, not a quiet substitution. */
    reuseExistingServer: false,
    stdout: 'ignore'
  }
});
