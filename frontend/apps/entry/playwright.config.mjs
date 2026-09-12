import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * A port belonging to this checkout, and to no other.
 *
 * The same arrangement `marp-mosaic-review` arrived at, and for the same reason: a
 * fixed port let a dev server left running in a *different* checkout answer these
 * tests, which then graded that checkout's code without saying so. Deriving the
 * port from this file's own path means two working copies cannot collide, and no
 * coordination is needed to arrange it. `MARP_ENTRY_TEST_PORT` overrides.
 */
const PORT = Number(process.env.MARP_ENTRY_TEST_PORT)
  || 8800 + (parseInt(createHash('sha1')
       .update(fileURLToPath(import.meta.url)).digest('hex').slice(0, 6), 16) % 400);

/**
 * Run against a real MARP API instead of the static server.
 *
 * `tools/serve.mjs` reproduces the two routes `app.js` gives these pages, so a
 * default run proves what the pages do and not that the API still serves them.
 * Setting `MARP_API_BASE` to wherever an API is listening removes that gap: the
 * pages are public, so unlike the mosaic app there is nothing to sign in to and
 * no session to set up first.
 *
 * Setting it is a statement about the whole invocation, because `webServer` is
 * not a per-project setting: with it set, no static server is started at all.
 */
const API_BASE = String(process.env.MARP_API_BASE || '').replace(/\/+$/, '');
const BASE = API_BASE || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? 'line' : [['list']],

  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    { name: 'desktop', testDir: './tests/e2e', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    /* 390px is the narrowest width worth holding: it is the iPhone 12/13/14 and
       the floor most of the remaining phones sit at. Pixel 7's own 412 would let
       a layout that breaks at 390 through, and headless Chrome clamps a viewport
       set any other way -- Playwright honours this one. */
    { name: 'phone', testDir: './tests/e2e', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    /* A phone held sideways. Worth its own project because the failure it
       catches is keyed on HEIGHT, which neither of the other two can see: the
       hero carried a 760px floor, so on a 340px-tall screen the whole first
       screen was the header and an empty photograph, with the headline, the
       copy and both buttons below the fold.

       Built the same way the `phone` project is, and for the same two reasons.
       The descriptor is a Chromium one because only Chromium is installed here
       and `devices['iPhone 14 landscape']` asks for WebKit, which fails the
       whole project at launch rather than at an assertion. The viewport is then
       overridden to iPhone 14 landscape's own 750x340: Pixel 7 sideways is
       360px tall and would let a layout that breaks at 340 through. */
    {
      name: 'phone-landscape',
      testDir: './tests/e2e',
      use: { ...devices['Pixel 7 landscape'], viewport: { width: 750, height: 340 } }
    }
  ],

  /* Nothing to start when a real API is already serving the pages. */
  webServer: API_BASE ? undefined : {
    command: `node tools/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    /* Never adopt a server this run did not start. A busy port must be a loud
       failure rather than a quiet substitution. */
    reuseExistingServer: false,
    stdout: 'ignore'
  }
});
