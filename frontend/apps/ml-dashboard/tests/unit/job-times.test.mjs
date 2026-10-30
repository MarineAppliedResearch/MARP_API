/**
 * *Took* keeps moving while a job runs, and every job table says when it last reported.
 *
 * #281. Isaac, testing: the Inference tab showed *Started* and *Took* and nothing saying
 * when a job was last updated, and *Took* was `updated_at - created_at` -- which does not
 * move while a job runs, because only the attempt's heartbeat does. *Took* is now elapsed
 * so far for a running job and the final duration for a finished one, and *Last update*
 * is the same column, under the same name, on Inference, Training and Jobs.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

const job = (id, kind, state, extra = {}) => ({
  id, kind, name: `job ${id}`, state, priority: 0, attempts_made: 1, max_attempts: 3,
  spec: { range: { start_frame: 0, end_frame: 1000 } }, progress_done: null, progress_total: null,
  created_at: ago(90), updated_at: ago(89), finished_at: null, ...extra,
});

const cell = (screen, id, css) => screen.document.querySelector(`tr[data-job="${id}"] ${css}`);

test('Inference: a running job\'s Took is elapsed so far, and every row has a Last update', async (t) => {
  const jobs = [
    /* Running for 90 minutes; its own row stamp has not moved since the first minute, and
       its heartbeat says it reported a minute ago. */
    job(1, 'inference', 'leased', { last_heartbeat_at: ago(1) }),
    /* Finished: 90 minutes from creation to finish, whatever touched the row since. */
    job(2, 'inference', 'succeeded', { finished_at: ago(0), updated_at: ago(0) }),
    job(3, 'inference', 'queued', { created_at: ago(2), updated_at: ago(2) }),
  ];

  const screen = await drawScreen('inference.html', {
    listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listModels: async () => [],
  });
  t.after(screen.close);

  const heads = [...screen.document.querySelectorAll('.inference-table thead th')].map((th) => th.textContent.trim());
  assert.ok(heads.includes('Last update'), `the column is there (${heads.join(', ')})`);

  assert.equal(cell(screen, 1, '.jtook').textContent, '1h 30m', 'running: elapsed so far, not frozen at a minute');
  assert.equal(cell(screen, 2, '.jtook').textContent, '1h 30m', 'finished: creation to finish');
  assert.equal(cell(screen, 3, '.jtook').textContent.trim(), '—', 'queued: nothing taken yet');

  const seen = new Date(cell(screen, 1, '[data-updated]').dataset.sort);
  assert.ok(Date.now() - seen.getTime() < 2 * 60000, 'Last update is the heartbeat, a minute ago, not the row stamp');
});

test('Training: a running job\'s Took is elapsed so far, a finished one\'s its duration', async (t) => {
  /* Its own row stamp moved a minute after creation and not since -- the figure the old
     Took froze at. */
  const jobs = [
    job(7, 'training', 'leased', { created_at: ago(30), updated_at: ago(29) }),
    job(8, 'training', 'succeeded', { created_at: ago(200), finished_at: ago(155), updated_at: ago(5) }),
  ];

  const screen = await drawScreen('training.html', {
    listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listModels: async () => [],
    listDatasets: async () => [],
    listTrainingRuns: async () => [],
  });
  t.after(screen.close);

  assert.equal(cell(screen, 7, '.jtook').textContent, '30m', 'running: elapsed, not the minute the row stamp says');
  assert.equal(cell(screen, 8, '.jtook').textContent, '45m', 'finished: to finished_at, not to a later touch of the row');
});

for (const page of ['inference.html', 'training.html', 'jobs.html']) {
  test(`${page}: the column is called Last update`, async (t) => {
    const screen = await drawScreen(page, {
      listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
      listSessions: async () => [], listModels: async () => [], listDatasets: async () => [],
      listTrainingRuns: async () => [], listWorkers: async () => [],
    });
    t.after(screen.close);

    const heads = [...screen.document.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    assert.ok(heads.includes('Last update'), heads.join(', '));
    assert.ok(!heads.includes('Updated'), 'one name on every tab');
  });
}
