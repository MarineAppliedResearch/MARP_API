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

/** Did the caller actually ask for the narrated walkthroughs? See the projects list. */
const WALKTHROUGH = process.argv.some((a) => a === 'walkthrough' || a.endsWith('=walkthrough'))
  || process.env.MARP_WALKTHROUGH === '1';

export default defineConfig({
  testDir: './tests',
  /**
   * The tests do not share the fixture, so they do not have to queue.
   *
   * This was `fullyParallel: false, workers: 1`, guarding a fixture "mutated in place".
   * It is mutated in place — but in the *browser*: `src/data.js` holds it in memory, and
   * every test gets its own context and its own page load, so no test can see another's
   * commits or corrections. Serialising them bought nothing and cost three minutes of
   * every run, which is three minutes of every change.
   *
   * A run is 56 seconds instead of 4 minutes 12. Verified green twice at this setting
   * before it was made the default. **If a test ever starts failing only under
   * parallelism, it is sharing something it should not** — find what, rather than turning
   * this back off.
   */
  fullyParallel: true,
  workers: 6,
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
       replacement for driving a browser by hand to make a recording.
     *
     * It is opt-in, and this line is why. A bare `playwright test` used to pick it up
     * along with everything else, which turned a ninety-second feedback loop into four
     * and a half minutes and produced videos nobody had asked for. The walkthroughs are
     * a review surface, recorded on request -- so the project only exists when something
     * names it. `npm run demo` and `--project=walkthrough` both do. */
    ...(!WALKTHROUGH ? [] : [{
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
    }]),
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
