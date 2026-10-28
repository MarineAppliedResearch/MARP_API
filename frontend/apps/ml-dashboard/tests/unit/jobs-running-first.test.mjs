/**
 * The Jobs screen opens with what is happening now at the top.
 *
 * Asked for by Isaac on 2026-10-28 (#285): newest first put the four running pieces of
 * an 82-piece run wherever they had been submitted, among hundreds of finished jobs.
 * Running first, then queued, then everything else newest first -- across the whole
 * window, so page 1 is where they are, not just a reshuffle of the eighteen on screen.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** A job the shape `rowFor` reads, submitted `minutesAgo` before now. */
const job = (id, state, minutesAgo) => {
  const at = new Date(Date.now() - minutesAgo * 60000).toISOString();
  return {
    id, batch_id: null, kind: 'inference', name: `Job ${state} ${id}`, spec: {}, state,
    priority: 0, attempts_made: 0, max_attempts: 3, workers_used: 0, worker_name: null,
    worker_id: null, created_by: null, created_at: at, updated_at: at,
    progress_done: null, progress_total: null,
  };
};

/* The running and queued jobs are the oldest, so newest first would put them on page 2. */
const JOBS = [
  ...Array.from({ length: 20 }, (_, i) => job(100 + i, 'succeeded', i)),
  job(10, 'queued', 60),
  job(11, 'leased', 90),
  job(12, 'queued', 120),
  job(13, 'leased', 150),
];

const order = (document) => [...document.querySelectorAll('#jobs tbody tr.runrow-head')].map((r) => Number(r.dataset.job));

test('running jobs come first, then queued, then the rest newest first', async () => {
  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({ jobs: JOBS, total: JOBS.length, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });

  const shown = order(screen.document);
  assert.deepEqual(shown.slice(0, 4), [11, 13, 10, 12], 'running (newest first), then queued, on page 1');
  assert.deepEqual(shown.slice(4, 6), [100, 101], 'then finished work, newest first');
  assert.equal(screen.document.querySelector('#jobs thead th.hupd').getAttribute('aria-sort'), 'none',
    'no column claims to be the sort, because none is');
  screen.close();
});

test('clicking a header still sorts by that column', async () => {
  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({ jobs: JOBS, total: JOBS.length, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });

  screen.document.querySelector('#jobs thead th.hupd').click();
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(order(screen.document).slice(0, 2), [100, 101], 'Submitted, newest first');
  assert.equal(screen.document.querySelector('#jobs thead th.hupd').getAttribute('aria-sort'), 'descending');
  screen.close();
});
