import { defineConfig, devices } from '@playwright/test';
import { SESSION_FILE } from './tools/api-session.mjs';

/**
 * Did the caller actually ask for the narrated walkthroughs? See the projects list.
 *
 * The environment variable is not an alternative to the argv check, it is how the argv
 * check survives. Playwright loads this config again inside each worker process, and a
 * worker's argv does not carry `--project=walkthrough` -- so an argv-only test defined the
 * project in the parent and not in the worker, and every run died with *Project
 * "walkthrough" not found in the worker process*. Setting the variable here, in the
 * parent, before any worker is spawned means the worker inherits the same answer.
 */
const WALKTHROUGH = process.env.MARP_WALKTHROUGH === '1'
  || process.argv.some((a) => a === 'walkthrough' || a.endsWith('=walkthrough'));
if (WALKTHROUGH) process.env.MARP_WALKTHROUGH = '1';

/**
 * Where the real MARP API is. **There is nothing else left to run against.**
 *
 * This used to be an opt-in beside a static file server that served the application with
 * `src/data.js` behind it. #157 retired that: the fixture is gone, the flag that selected
 * it is gone, and the reason is that a browser tier which cannot see a defect the endpoint
 * has is not worth the minutes it costs. So the base URL is required rather than optional,
 * and its absence is a refusal naming the command that supplies it.
 */
const API_BASE = String(process.env.MARP_API_BASE || '').replace(/\/+$/, '');

if (!API_BASE) {
  throw new Error(
    'This tier runs against a real MARP API on a testing database, and MARP_API_BASE is '
    + 'not set. There is no fixture to fall back to -- #157 removed it, deliberately. '
    + 'Run `npm run test:app:mosaic-review:api` from the MARP_API repository root, or '
    + '`npm run test:app:mosaic-review:api -- -g take-back` for one of them. '
    + 'It provisions the testing database if it is not there, serves the application from '
    + 'it on a port nothing else holds, and stops the server when the run finishes.'
  );
}

export default defineConfig({
  testDir: './tests',

  /**
   * One worker, because there is one database and every test writes to it.
   *
   * This was six workers and `fullyParallel`, which was right while the tier under it was
   * a fixture held in each browser's own memory: no test could see another's commits. It
   * is wrong now. There is exactly one testing database, and two tests that each isolate
   * "the species with exactly one observation" isolate the **same** observation -- the
   * first time the API project held more than one test, a commit was aborted, the row was
   * re-read to prove nothing had been written, and the row was gone, because another
   * worker had corrected it a moment earlier (#157).
   *
   * The fixture's parallelism is what paid for its speed, and #157 spent that
   * deliberately: a run is minutes rather than a minute, and what it buys is a tier that
   * can see what the endpoint actually did.
   */
  fullyParallel: false,
  workers: 1,
  retries: 0,

  /* A real server, a real query over a real corpus, and a page that settles by polling.
     The fixture answered from memory; these budgets are what that difference costs. */
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'line' : [['list']],

  use: {
    baseURL: `${API_BASE}/apps/marp-mosaic-review/`,
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
     * names it. `npm run demo` and `--project=walkthrough` both do.
     *
     * **It records against the testing database now**, which is the only thing left to
     * record against and is the right one anyway: a recording signs in as a real reviewer
     * and commits real decisions, so it belongs on a disposable copy of the corpus rather
     * than on the corpus. */
    ...(!WALKTHROUGH ? [] : [{
      name: 'walkthrough',
      testDir: './tests/walkthrough',
      /* Narrated runs hold each caption long enough to be spoken over, so this
         project needs far longer than a normal test. */
      timeout: 240_000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
        video: { mode: 'on', size: { width: 1600, height: 900 } },
        storageState: SESSION_FILE
      }
    }]),

    /**
     * The tier. All of it, since #157.
     *
     * A real API on a testing database, with a real session. There is no
     * `?backing=fixture` left to inject and no `src/data.js` left to reach for -- and
     * every test still asserts `data-backing`, because a tier that cannot grade the wrong
     * thing is worth keeping unable to even once the wrong thing has been deleted.
     *
     * **Two viewports, exactly as the fixture tier had.** The narrow layout is its own set
     * of defects -- the rail overlays the mosaic, the sort control has to survive a phone,
     * the top chrome hides itself -- and the checks that see them moved without dropping
     * the width that makes them visible.
     */
    {
      name: 'api',
      testDir: './tests/api',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
        storageState: SESSION_FILE
      }
    },
    {
      name: 'api-phone',
      testDir: './tests/api',
      use: {
        ...devices['Pixel 7'],
        storageState: SESSION_FILE
      }
    }
  ],

  /* Signing in comes first: `/apps/marp-mosaic-review` is session-gated in `app.js`, so
     without one the application is not even served. */
  globalSetup: './tools/api-session.mjs'
});
