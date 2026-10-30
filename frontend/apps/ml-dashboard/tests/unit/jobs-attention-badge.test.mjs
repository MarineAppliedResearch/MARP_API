/**
 * The menu's Jobs badge counts what needs attention, as the Jobs tab does.
 *
 * #315. Isaac, 2026-10-30: the badge showed 1191 in red while the Jobs tab listed 190
 * jobs in all. It counted every failed job ever. Settled the same day: it is the Jobs
 * tab's Needs attention number at its default range, the last 24 hours.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();

/* A mix: what needs attention now, what did long ago, and what is fine. */
const JOBS = [
  { id: 1, kind: 'inference', state: 'failed', finished_at: ago(2) },
  { id: 2, kind: 'training', state: 'expired', finished_at: ago(5) },

  // A batch where one piece failed and one succeeded: both count, as on the card.
  { id: 3, kind: 'inference', state: 'failed', batch_id: 77, finished_at: ago(1) },
  { id: 4, kind: 'inference', state: 'succeeded', batch_id: 77, finished_at: ago(1) },

  // Old failures: the 1,191 were these.
  { id: 5, kind: 'inference', state: 'failed', finished_at: ago(72) },
  { id: 6, kind: 'inference', state: 'failed', finished_at: ago(30 * 24) },

  // Fine, underway, or not a job the tab counts.
  { id: 7, kind: 'inference', state: 'succeeded', finished_at: ago(3) },
  { id: 8, kind: 'training', state: 'leased', finished_at: null },
  { id: 9, kind: 'inference', state: 'queued', finished_at: null },
  { id: 10, kind: 'dataset_build', state: 'failed', finished_at: ago(1) },
];

/* `GET /gpu/jobs` as MARP answers it: state, kind and finished_after filter. */
async function listJobs(query = {}) {
  let jobs = JOBS.filter((j) => (!query.state || j.state === query.state) && (!query.kind || j.kind === query.kind));
  if (query.finished_after) {
    const after = Date.parse(query.finished_after);
    jobs = jobs.filter((j) => j.finished_at && Date.parse(j.finished_at) >= after);
  }
  return { jobs: jobs.slice(0, query.limit || 500), total: jobs.length, limit: query.limit || 500, offset: 0 };
}

test('the Jobs badge counts only what needs attention in the last 24 hours', async (t) => {
  const screen = await drawScreen('models.html', { listJobs, listModels: async () => [] });
  t.after(screen.close);

  const badge = screen.document.querySelector('[data-nav-badge="jobs"]');

  // Jobs 1, 2, 3 and 4: not the two old failures, the running or queued ones, or the build.
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '4');
  assert.equal(badge.title, '4 jobs need attention, last 24 hours');
});

test('the Jobs badge and the Jobs tab\'s Needs attention card agree', async (t) => {
  const screen = await drawScreen('jobs.html', { listJobs });
  t.after(screen.close);

  const card = screen.document.querySelector('.stat[data-job-priority="attention"] .stat-num');
  const badge = screen.document.querySelector('[data-nav-badge="jobs"]');

  assert.equal(card.textContent, '4');
  assert.equal(badge.textContent, card.textContent);
});
