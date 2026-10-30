/**
 * A training job that failed says why, on the Training tab.
 *
 * Isaac, on job 21953 (*WpFeCec*): *"WP training failed and it doesn't say why or show
 * why."* The panel said only that no training run had been recorded. The reasons were on
 * the attempts -- a lease that expired, then *PermissionError: [WinError 32]* twice -- and
 * nothing read them. Now the failed panel heads with the last attempt's reason and lists
 * every attempt with its own.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const at = '2026-10-29T06:01:43.000Z';

const failed = {
  id: 21953, kind: 'training', name: 'WpFeCec', state: 'failed', priority: 0, attempts_made: 3, max_attempts: 3,
  spec: { model: { ml_model_id: 91, name: 'CAMPA_GR1_TEST6-mixed' }, dataset: { dataset_id: 391, name: 'WP - FE - CUC' } },
  progress_done: null, progress_total: null, created_at: at, updated_at: at, finished_at: at,
};

const ATTEMPTS = [
  { id: 19319, lease_epoch: 1, state: 'abandoned', worker: { name: 'ABYSS' }, progress_done: 71303168, progress_total: 20126426112, progress_unit: 'bytes', progress_phase: 'fetching_dataset', leased_at: at, finished_at: at,
    failure_reason: 'Lease expired: the worker kept sending heartbeats but MARP could not save them (integer out of range).' },
  { id: 19321, lease_epoch: 3, state: 'failed', worker: { name: 'ABYSS' }, progress_done: 0, progress_total: 0, progress_unit: 'bytes', progress_phase: 'fetching_dataset', leased_at: at, finished_at: at,
    failure_reason: 'exception | PermissionError: [WinError 32] The process cannot access the file because it is being used by another process' },
];

test('a failed training job heads with why, and lists every attempt with its own reason', async (t) => {
  const screen = await drawScreen('training.html', {
    listJobs: async () => ({ jobs: [failed], total: 1, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listModels: async () => [],
    listDatasets: async () => [],
    listTrainingRuns: async () => [],
    getJob: async () => ({ job: failed, attempts: ATTEMPTS, artifacts: [] }),
  });

  t.after(screen.close);

  const head = screen.document.querySelector('.training-table tbody tr[data-job="21953"]');
  head.querySelector('.exbtn').click();
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  const detail = head.nextElementSibling;

  assert.match(detail.querySelector('.jobstate h4').textContent, /Failed/);
  assert.match(detail.querySelector('[data-job-failure]').textContent, /PermissionError: \[WinError 32\]/,
    'the last attempt\'s reason heads the panel');

  const rows = [...detail.querySelectorAll('[data-job-attempts] tbody tr')];
  assert.equal(rows.length, 2, 'every attempt');
  assert.match(rows[0].textContent, /MARP could not save them \(integer out of range\)/, 'each with its own reason');
  assert.match(rows[0].textContent, /71,303,168 \/ 20,126,426,112 bytes/, 'and how far it got');
  assert.match(detail.textContent, /ended before training began/, 'and no claim that a run is on its way');

  /* The date and the time on one clock: an evening attempt must not read as tomorrow. */
  const local = new Date(at);
  const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  assert.ok(rows[0].textContent.includes(`${day} ${local.toTimeString().slice(0, 5)}`), 'leased at, in local time');
});
