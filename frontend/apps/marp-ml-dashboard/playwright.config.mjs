import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * A port belonging to this checkout, and to no other.
 *
 * Same arrangement as the Mosaic Reviewer's config, for the same reason: a dev
 * server left running in a *different* checkout was adopted by these tests,
 * which then graded that checkout's code for an hour without saying so.
 * Deriving the port from this file's own path means two working copies cannot
 * land on the same one and no coordination is needed to arrange it.
 */
const PORT = Number(process.env.MARP_TEST_PORT)
  || 8800 + (parseInt(createHash('sha1')
    .update(fileURLToPath(import.meta.url)).digest('hex').slice(0, 6), 16) % 700);

/**
 * Did the caller actually ask for the narrated walkthroughs?
 *
 * The environment variable is not an alternative to the argv check, it is how
 * the argv check survives: Playwright loads this config again inside each
 * worker, and a worker's argv does not carry `--project=walkthrough`. Setting
 * the variable here, in the parent, means the worker inherits the same answer.
 */
const WALKTHROUGH = process.env.MARP_WALKTHROUGH === '1'
  || process.argv.some((a) => a === 'walkthrough' || a.endsWith('=walkthrough'));
if (WALKTHROUGH) process.env.MARP_WALKTHROUGH = '1';

export default defineConfig({
  testDir: './tests',
  /* Nothing is shared between these tests -- the fixture is held in the
     browser, per context, per page load -- so they do not have to queue. */
  fullyParallel: true,
  workers: 6,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? 'line' : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}/apps/marp-ml-dashboard/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    /* Opt-in, and this is why: a bare `playwright test` used to pick the
       walkthroughs up along with everything else in the Mosaic Reviewer, which
       turned a ninety-second loop into four and a half minutes and produced
       videos nobody had asked for. They are a review surface, recorded on
       request. `npm run demo` and `--project=walkthrough` both name it. */
    ...(!WALKTHROUGH ? [] : [{
      name: 'walkthrough',
      testDir: './tests/walkthrough',
      timeout: 300_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
        video: { mode: 'on', size: { width: 1600, height: 900 } },
      },
    }]),
    {
      name: 'desktop',
      testDir: './tests/e2e',
      /* The width the reference mockups were drawn at, so a layout comparison
         is against the same geometry the design was judged at. */
      use: { ...devices['Desktop Chrome'], viewport: { width: 1672, height: 941 } },
    },
    {
      name: 'phone',
      testDir: './tests/e2e',
      /* Headless Chrome clamps its own viewport; Playwright honours this one,
         which is the only way the narrow layout gets verified at real width. */
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    command: `node tools/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/apps/marp-ml-dashboard/`,
    /* Never adopt a server this run did not start. A busy port must be a loud
       failure, not a quiet substitution. */
    reuseExistingServer: false,
    stdout: 'ignore',
  },
});
