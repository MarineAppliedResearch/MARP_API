/**
 * What the dashboard does when the session has expired.
 *
 * **It used to sit there looking populated.** Signed out, `training.html` showed
 * "31 training jobs" against a database holding one, a drawn activity chart and plausible
 * panels, with nothing saying the page was unauthenticated — twenty-nine 401s in the
 * console and a convincing screen.
 *
 * The mechanism is worth stating because it is not the obvious one: `serve` never falls
 * back to the corpus on an error, so nothing *invented* that number. It is hardcoded in
 * `training.html:75`, left from the mockup, and the renderers bailing on the 401 leave it
 * standing. Fixing a fixture fallback would have fixed nothing; stopping on a 401 is what
 * fixes it.
 *
 * `window.location` and its methods cannot be reassigned or redefined in jsdom, so the
 * seam is jsdom's own report of an attempted navigation — which has the advantage of
 * watching the real `location.replace` rather than a stand-in. It does not carry the URL;
 * that was read off the live page instead.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** A fetch that refuses everything the way an expired session does. */
const unauthenticated = (counter) => async () => {
  counter.calls += 1;

  return {
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: async () => ({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.', status: 401 },
    }),
  };
};

test('a 401 leaves for sign-in once, however many calls failed', async (t) => {
  const screen = await drawScreen('training.html', {}, { realApi: true });

  t.after(screen.close);

  /* Whatever the page did while loading is not what this is about. */
  screen.navigations.length = 0;

  const counter = { calls: 0 };

  screen.window.fetch = unauthenticated(counter);

  /* Ten at once, which is the order of magnitude a screen really makes -- the Training
     screen produced twenty-nine. */
  await Promise.allSettled(
    Array.from({ length: 10 }, () => screen.window.MarpApi.listJobs({ limit: 1 })));

  assert.equal(counter.calls, 10, 'every call should still have been made');
  assert.equal(screen.navigations.length, 1,
    'exactly one navigation: an expired session fails every request a screen makes at '
    + `once, and one redirect each is a stampede (got ${screen.navigations.length})`);
});

test('fixture mode is never redirected away from', async (t) => {
  /* `?mock=all` is a deliberate choice to draw without a database, and a few routes have
     no corpus answer and ask MARP anyway. One of those 401ing must not throw a design
     review off the corpus it asked for. */
  const screen = await drawScreen('models.html', {}, { search: '?mock=all', realApi: true });

  t.after(screen.close);

  screen.navigations.length = 0;
  screen.window.fetch = unauthenticated({ calls: 0 });

  /* `listTrainingRuns` has no corpus fallback, so even here it reaches the network. */
  await screen.window.MarpApi.listTrainingRuns().catch(() => {});

  assert.deepEqual(screen.navigations, [], 'fixture mode stays where it is');
});

test('the caller still gets its error, so nothing waits for ever', async (t) => {
  const screen = await drawScreen('jobs.html', {}, { realApi: true });

  t.after(screen.close);

  screen.window.fetch = unauthenticated({ calls: 0 });

  /* The redirect is started and the rejection still happens. Navigation is not instant,
     and a screen whose error was swallowed would draw its loading state until it. */
  await assert.rejects(
    () => screen.window.MarpApi.listJobs({ limit: 1 }),
    (error) => error.status === 401 && /Authentication is required/.test(error.message));
});
