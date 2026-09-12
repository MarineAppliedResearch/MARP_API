import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SESSION_FILE } from './tools/api-session.mjs';

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
 * Run against a real MARP API instead of the static file server.
 *
 * `tools/serve.mjs` serves files and nothing else — it does not proxy `/api` — so a run
 * against it can only ever exercise the fixture. The API, on the other hand, already serves
 * this app at `/apps/marp-mosaic-review/`, so pointing `baseURL` at the API needs no proxy
 * at all: set `MARP_API_BASE` to wherever it is listening.
 *
 * **Opt-in, and `MARP_API_BASE` is the whole of the opt-in.** This used to be
 * `&& WALKTHROUGH`, so the only thing that could ever talk to a real server was a recording
 * — and #132 is what that cost: the take-back defect is invisible to the fixture by
 * construction, because `src/data.js` writes the row's status column in place and the
 * endpoint never does. So the `api` project below joins the walkthrough on this flag.
 *
 * **Setting it is a statement about the whole invocation**, because `webServer` is not a
 * per-project setting: with it set, no static server is started, so name `--project=api` or
 * `--project=walkthrough`. `desktop` and `phone` are untouched and unaffected — they are the
 * fast loop, they stay on the fixture, and nothing about them changes while this is unset,
 * which is every ordinary run. In particular `reuseExistingServer: false` below stays
 * exactly as it is — that flag exists because the tests once graded a different checkout
 * without saying so. This does not weaken it; it declines to start a server at all, and says
 * which API it is talking to instead.
 */
const API_BASE = String(process.env.MARP_API_BASE || '').replace(/\/+$/, '');
const ON_API = Boolean(API_BASE);

/* Asking for the API tier without saying where the API is should say so, rather than
   arriving as *Project "api" not found*. Parent-process argv only, which is all that is
   needed: a worker inherits `MARP_API_BASE`, so if the parent got past this the project
   exists in the worker too. */
if (!ON_API && process.argv.some((a) => a === 'api' || a.endsWith('=api'))) {
  throw new Error('The `api` project needs MARP_API_BASE, plus MARP_REVIEW_USERNAME and '
    + 'MARP_REVIEW_PASSWORD. It runs against a real server; there is no fixture in it.');
}

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
        video: { mode: 'on', size: { width: 1600, height: 900 } },
        /* On the API the app is session-gated, so the context arrives already signed in.
           `globalSetup` below is what puts that file there. */
        ...(!ON_API ? {} : {
          baseURL: `${API_BASE}/apps/marp-mosaic-review/`,
          storageState: SESSION_FILE
        })
      }
    }]),
    /**
     * The one tier that talks to a real API, and the only one that can see a defect the
     * fixture masks (#132, R14).
     *
     * No `?backing=fixture` is injected here — that is done in a `beforeEach` in
     * `tests/e2e/render.spec.mjs`, which this project's `testDir` does not include — and
     * every test in it asserts `data-backing` so a run cannot grade the fixture while
     * claiming to be the API. Desktop viewport only: what it proves is about what gets
     * written and read back, not about layout, and it writes to a real database.
     */
    ...(!ON_API ? [] : [{
      name: 'api',
      testDir: './tests/api',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
        baseURL: `${API_BASE}/apps/marp-mosaic-review/`,
        /* The app is session-gated in `app.js`, so the context arrives already signed in.
           `globalSetup` below is what puts that file there. */
        storageState: SESSION_FILE
      }
    }]),
    { name: 'desktop', testDir: './tests/e2e', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    /* The narrow layout has never been verified at real phone width — headless
       Chrome clamps its viewport, but Playwright honours this one. */
    { name: 'phone', testDir: './tests/e2e', use: { ...devices['Pixel 7'] } }
  ],

  /* Signing in is only needed when there is an API to sign in to. */
  ...(ON_API ? { globalSetup: './tools/api-session.mjs' } : {}),

  /* Nothing to start when the API is already serving the app. */
  webServer: ON_API ? undefined : {
    command: `node tools/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/apps/marp-mosaic-review/`,
    /* Never adopt a server this run did not start. Reusing one is how the tests came
       to grade a different checkout without saying so; a busy port must be a loud
       failure, not a quiet substitution. */
    reuseExistingServer: false,
    stdout: 'ignore'
  }
});
