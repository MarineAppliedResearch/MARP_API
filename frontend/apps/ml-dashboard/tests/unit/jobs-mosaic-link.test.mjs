/**
 * The Jobs screen links an inference job straight into the Mosaic (#350).
 *
 * Found on 2026-11-20: after running two habitat lines, nothing on the Jobs screen said where
 * their results were, so reviewing them meant working out the sessions by hand. A job that is
 * running or has finished now offers Review, which opens the Mosaic filtered to its session.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** An inference job the shape `rowFor` reads, writing into session 4376. */
const job = (id, state, extra = {}) => ({
  id,
  batch_id: null,
  submission_id: '558859f2-377b-4b58-a1f6-a4cec94324ce',
  kind: 'inference',
  name: 'Dive-2_20261120',
  spec: { range: { start_frame: 0, end_frame: 33853 }, session: { session_id: 4376 } },
  state,
  priority: 0,
  attempts_made: 1,
  max_attempts: 3,
  workers_used: 1,
  worker_name: 'ABYSS',
  worker_id: 3,
  created_by: 19,
  created_at: '2026-11-20T20:09:39.000Z',
  updated_at: '2026-11-20T20:22:15.000Z',
  progress_done: null,
  progress_total: null,
  ...extra,
});

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

test('a finished or running inference job offers Review, into the Mosaic at its session', async (t) => {
  const jobs = [job(1, 'succeeded'), job(2, 'leased'), job(3, 'queued'), job(4, 'failed'),
    job(5, 'succeeded', { kind: 'training', spec: { dataset: { dataset_id: 7 } } })];
  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });
  t.after(screen.close);
  await settle();

  const reviewOf = (id) => screen.document.querySelector(`#jobs tbody tr[data-job="${id}"] .jacts a[data-mosaic]`);
  assert.equal(reviewOf(1).getAttribute('href'), '/apps/marp-mosaic-review/?session=4376', 'a finished job');
  assert.equal(reviewOf(2).getAttribute('href'), '/apps/marp-mosaic-review/?session=4376', 'a running one, as results arrive');
  assert.equal(reviewOf(3), null, 'not a queued one: nothing to see yet');
  assert.equal(reviewOf(4), null, 'not a failed one');
  assert.equal(reviewOf(5), null, 'not a training job, which writes no observations');
});
