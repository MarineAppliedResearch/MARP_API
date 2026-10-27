/**
 * What the Jobs screen promises before it deletes a build.
 *
 * **It promised to spare a row that was already gone.** A `dataset_build` job keeps its
 * dataset id in `spec`, and nothing clears that when the dataset is deleted — so the id
 * on the row is a claim about the past. The confirmation read it and asserted the present:
 * *"Dataset 385 is not deleted."* Isaac had deleted 385 himself, from the Datasets screen,
 * and the sentence he was being asked to agree to was false.
 *
 * Six datasets were in that state at the time — 374, 379, 380, 383, 385 and 386 — so this
 * was not a corner.
 *
 * The three answers are three different facts and the test keeps them apart, because the
 * failure mode here is a plausible sentence rather than a crash: a confirmation that lies
 * passes every check that does not read it.
 *
 * `window.confirm` is the seam. jsdom's throws by default, which is useful — it means a
 * dialog this test did not expect cannot pass silently.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** One finished dataset build, the shape `rowFor` reads. */
const buildJob = (datasetId) => ({
  id: 21770,
  batch_id: null,
  kind: 'dataset_build',
  name: 'Build CookieStarTest2',
  spec: { dataset_id: datasetId },
  state: 'failed',
  priority: 0,
  attempts_made: 2,
  max_attempts: 3,
  workers_used: 0,
  worker_name: null,
  worker_id: null,
  created_by: null,
  created_at: '2026-10-22T10:00:00.000Z',
  updated_at: '2026-10-22T10:00:00.000Z',
  progress_done: null,
  progress_total: null,
});

/**
 * Press delete on the build row and return what the dialog said.
 *
 * Always answers no, so nothing is deleted and the test is about the sentence.
 *
 * @param {Object} dataset - `{exists}` or `{status}` for a read that failed.
 * @returns {Promise<string>} The confirmation text.
 */
async function confirmationFor(dataset) {
  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({ jobs: [buildJob(385)], total: 1, limit: 500, offset: 0 }),
    listSessions: async () => [],
    getDataset: async () => {
      if (dataset.exists) return { id: 385, name: 'CookieStarTest2', status: 'ready' };
      throw Object.assign(new Error('gone'), { status: dataset.status ?? 404 });
    },
  });

  const said = [];

  screen.window.confirm = (text) => {
    said.push(text);
    return false;
  };

  screen.document.querySelector('#jobs tbody [data-delete-job]').click();

  /* The clause is fetched before the dialog opens, so the click is not synchronous. */
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  screen.close();

  assert.equal(said.length, 1, 'the delete control should have asked exactly once');

  return said[0];
}

test('a dataset that is still there is promised it will be spared', async () => {
  const text = await confirmationFor({ exists: true });

  assert.match(text, /Dataset 385 is not deleted/,
    'the ordinary case: the dataset outlives its build job and the reader should know');
  assert.match(text, /loses the record of the build that made it/);
});

test('a dataset that has already gone is not promised anything', async () => {
  const text = await confirmationFor({ exists: false });

  assert.doesNotMatch(text, /is not deleted/,
    'this is the defect: the id in spec survives the dataset, so reading it and asserting '
    + 'the present told Isaac a row he had deleted himself would be spared');
  assert.match(text, /Dataset 385 was deleted already/);
  assert.match(text, /last trace of that build/,
    'and that makes the delete more obviously right, so it is said rather than hidden');
});

test('a check that fails says so rather than picking an answer', async () => {
  const text = await confirmationFor({ exists: false, status: 500 });

  assert.match(text, /Could not check whether dataset 385 still exists \(500\)/);
  assert.doesNotMatch(text, /is not deleted/, 'no promise it cannot keep');
  assert.doesNotMatch(text, /deleted already/, 'and no claim it cannot support');
});

test('a job with no dataset says nothing about one', async () => {
  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({
      jobs: [{ ...buildJob(385), id: 9001, kind: 'inference', name: 'Dive 417 Line 2', spec: {} }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
    listSessions: async () => [],
  });

  const said = [];

  screen.window.confirm = (text) => { said.push(text); return false; };
  screen.document.querySelector('#jobs tbody [data-delete-job]').click();

  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  screen.close();

  assert.equal(said.length, 1);
  assert.doesNotMatch(said[0], /[Dd]ataset/,
    'an inference job has no dataset, and a sentence about one would be noise at best');
});
