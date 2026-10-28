/**
 * Recent inference jobs means recent.
 *
 * Every failure outranked every success, so six September failures filled the table and
 * the seven Dive-22 runs that succeeded today -- with their detections and Review links --
 * could not be reached from the Inference screen at all.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

const job = (id, state, daysAgo) => ({
  id,
  kind: 'inference',
  name: `job-${id}`,
  state,
  priority: 0,
  attempts_made: 1,
  max_attempts: 3,
  spec: { session: { session_id: 1 }, model: { ml_model_id: 7 } },
  progress_done: null,
  progress_total: null,
  created_at: at(daysAgo),
  updated_at: at(daysAgo),
  finished_at: state === 'queued' ? null : at(daysAgo),
});

test('the recent table leads with what is in flight, then the newest', async (t) => {
  const jobs = [
    ...[1, 2, 3, 4, 5, 6].map((n) => job(100 + n, 'failed', 30 + n)),
    job(200, 'succeeded', 0.1),
    job(201, 'succeeded', 0.2),
    job(300, 'queued', 0.05),
  ];

  const screen = await drawScreen('inference.html', {
    listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });

  t.after(screen.close);

  const order = [...screen.document.querySelectorAll('.inference-table tbody tr[data-job]')]
    .map((row) => Number(row.dataset.job));

  assert.deepEqual(order.slice(0, 3), [300, 200, 201],
    'queued first, then today\'s successes, ahead of month-old failures');
});
