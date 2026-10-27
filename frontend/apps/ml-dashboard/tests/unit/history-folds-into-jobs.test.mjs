/**
 * History is gone, and the two things it had that Jobs did not are on the Dashboard.
 *
 * Isaac: *"it doesn't make sense that we have a jobs tab, and a history tab, the jobs tab
 * is the jobs history!"* The two screens ran the identical `listJobs({ limit: 500 })` and
 * differed by a window and a state filter, so the table was a duplicate. What was not a
 * duplicate was the outcome breakdown and the completion-activity chart — those are an
 * *outcomes* view rather than a queue, which is the Dashboard's job.
 *
 * **The deletion is asserted as hard as the move.** A tab removed from the rail while
 * four screens still link to its URL is a dead link nobody meets until they click one,
 * and the screens that link to it are not the screen being changed — so the check has to
 * read the files rather than a rendered page.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { drawScreen, APP } from './screen.mjs';

const DAY = 86400000;
const BASE = Date.parse('2026-10-20T12:00:00.000Z');

/**
 * A job as `GET /gpu/jobs` returns one.
 *
 * @param {Object} fields - `{id, state, daysAgo, kind}`.
 * @returns {Object}
 */
function job({ id, state, daysAgo = 0, kind = 'inference' }) {
  const at = BASE - daysAgo * DAY;
  return {
    id,
    kind,
    name: null,
    state,
    spec: { model: { name: 'rockfish5' } },
    created_at: new Date(at).toISOString(),
    updated_at: new Date(at + 300000).toISOString(),
    created_by: 7,
    worker_name: 'ABYSS-fba6be1a',
    workers_used: 1,
    progress_done: null,
    progress_total: null,
    batch_id: null,
  };
}

/**
 * Draw the Dashboard over a set of jobs.
 *
 * @param {Object[]} jobs - What `listJobs` should answer with.
 * @returns {Promise<Object>} From `drawScreen`.
 */
function drawDashboard(jobs) {
  return drawScreen('dashboard.html', {
    listJobs: async ({ state } = {}) => {
      const rows = state ? jobs.filter((j) => j.state === state) : jobs;
      return { jobs: rows, total: rows.length, limit: 500, offset: 0 };
    },
    listWorkers: async () => [],
    listModels: async () => [],
    listDatasets: async () => [],
    listProjects: async () => [{ project_id: 11, name: 'CAMPA2026' }],
    listUsers: async () => [{ user_id: 7, name: 'Isaac Assegai' }],
    listSessions: async () => [],
  });
}

/** Every page of the application, which is what a link check has to cover. */
const PAGES = readdirSync(APP).filter((f) => f.endsWith('.html'));

test('the rail no longer offers a History tab', async (t) => {
  const screen = await drawDashboard([job({ id: 1, state: 'succeeded' })]);
  t.after(screen.close);

  const destinations = [...screen.document.querySelectorAll('.rail-nav a')]
    .map((a) => a.getAttribute('href'));

  assert.ok(destinations.length > 0, 'the rail should have drawn its links');
  assert.ok(!destinations.includes('./history.html'),
    'History folded into Jobs, so the rail should not still offer it');
  assert.ok(destinations.includes('./jobs.html'), 'Jobs is the screen that absorbed it');
});

test('nothing in the application links to the screen that is gone', async (t) => {
  const offenders = [];

  for (const page of PAGES) {
    const text = readFileSync(join(APP, page), 'utf8');
    if (text.includes('history.html')) offenders.push(page);
  }

  const script = readFileSync(join(APP, 'screens.js'), 'utf8');
  if (script.includes('history.html')) offenders.push('screens.js');

  assert.deepEqual(offenders, [],
    'a tab removed from the rail while other screens still link to its URL is a dead '
    + 'link nobody meets until they click one');

  assert.equal(existsSync(join(APP, 'history.html')), false,
    'the screen itself should be gone, not merely unreachable');
});

test('the Dashboard counts how work ended, from the jobs it already fetched', async (t) => {
  /* The Dashboard was already calling the same `listJobs({ limit: 500 })` History did, so
     the outcomes cost no second request. */
  const screen = await drawDashboard([
    job({ id: 1, state: 'succeeded' }),
    job({ id: 2, state: 'succeeded' }),
    job({ id: 3, state: 'succeeded' }),
    job({ id: 4, state: 'failed' }),
    job({ id: 5, state: 'cancelled' }),
    /* Still running, so not an outcome: it has not ended. */
    job({ id: 6, state: 'leased' }),
    /* Outside the thirty days the panel reports on. */
    job({ id: 7, state: 'succeeded', daysAgo: 200 }),
  ]);
  t.after(screen.close);

  const donut = screen.document.querySelector('.job-donut');
  assert.ok(donut, 'the Dashboard should carry the outcomes donut History had');
  assert.equal(donut.querySelector('span > b')?.textContent.trim(), '5',
    'five jobs ended inside the window: the running one has not ended and the old one is outside it');

  const legend = screen.document.querySelector('.job-mix-key')?.textContent.replace(/\s+/g, ' ') ?? '';
  assert.match(legend, /3 Completed/, 'three completed');
  assert.match(legend, /0 With issues/, 'none finished with issues');
  assert.match(legend, /2 Failed \/ cancelled/, 'one failed and one cancelled');
});

test('the Dashboard carries the completion-activity chart', async (t) => {
  const screen = await drawDashboard([job({ id: 1, state: 'succeeded' })]);
  t.after(screen.close);

  const panel = screen.document.querySelector('[data-ops-activity="outcomes"]');
  assert.ok(panel, 'the completion-activity panel should have moved to the Dashboard');
  assert.ok(panel.querySelector('.ops-chart'), 'with its chart');
  assert.ok(panel.querySelectorAll('[data-ops-range]').length >= 3,
    'and its range buttons, which are what made it worth keeping');
});
