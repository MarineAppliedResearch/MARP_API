/**
 * A Jobs row links to the job on the screen that owns it, and that screen opens it.
 *
 * #291. Every Jobs row expanded inline into a detail of its own. Now the name links out --
 * training to its row on Training, inference (and tracking, its older name) to its row on
 * Inference, a dataset build to its dataset -- and a `?job=` link opens that row.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const at = new Date(Date.now() - 3600e3).toISOString();
const job = (id, kind, state = 'succeeded', extra = {}) => ({
  id, kind, name: `job ${id}`, state, priority: 0, attempts_made: 1, max_attempts: 3,
  spec: kind === 'dataset_build' ? { dataset_id: 392 } : { range: { start_frame: 0, end_frame: 100 } },
  progress_done: null, progress_total: null, created_at: at, updated_at: at, finished_at: at, ...extra,
});

const answers = (jobs) => ({
  listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
  listSessions: async () => [], listModels: async () => [], listDatasets: async () => [],
  listTrainingRuns: async () => [], listWorkers: async () => [],
  getJob: async (id) => ({ job: jobs.find((one) => one.id === Number(id)), attempts: [], artifacts: [] }),
  jobObservations: async () => ({ species: [], total: 0, session_id: null }),
  jobTimeline: async () => { throw Object.assign(new Error('none'), { status: 404 }); },
});

test('each kind of job links to the screen that owns it, and no row expands', async (t) => {
  const jobs = [job(1, 'training'), job(2, 'inference'), job(3, 'tracking'), job(4, 'dataset_build'), job(5, 'diagnostic')];
  const screen = await drawScreen('jobs.html', answers(jobs));
  t.after(screen.close);

  const link = (id) => screen.document.querySelector(`#jobs tbody tr[data-job="${id}"] .jname a`)?.getAttribute('href') ?? null;

  assert.equal(link(1), './training.html?job=1');
  assert.equal(link(2), './inference.html?job=2');
  assert.equal(link(3), './inference.html?job=3', 'tracking is inference by its older name');
  assert.equal(link(4), './datasets.html?dataset=392');
  assert.equal(link(5), null, 'a diagnostic job has no screen, so no link');
  assert.equal(screen.document.querySelectorAll('#jobs .exbtn, #jobs tr.runrow-body').length, 0);
});

for (const [page, kind] of [['training.html', 'training'], ['inference.html', 'inference']]) {
  test(`${page}?job= turns to that job's page and opens its row`, async (t) => {
    /* Thirty jobs, newest first, so job 3 is on the second page of eighteen. */
    const jobs = Array.from({ length: 30 }, (_, i) => job(i + 1, kind, 'failed', {
      created_at: new Date(Date.now() - (i + 1) * 60000).toISOString(),
    }));
    const screen = await drawScreen(page, answers(jobs), { search: '?job=3' });
    t.after(screen.close);
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    const head = screen.document.querySelector('tr[data-job="3"]');
    assert.ok(head, 'its page is the one drawn');
    assert.equal(head.getAttribute('aria-expanded'), 'true', 'and its row is open');
  });
}
