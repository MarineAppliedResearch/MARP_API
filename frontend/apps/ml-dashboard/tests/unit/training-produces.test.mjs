/**
 * A run does not claim to have produced the model it trained from.
 *
 * The `Produces` column means the model version a run registers — its header says so, its
 * tooltip says so, and the comment above the cell says so. It was filled with the base
 * model the run started FROM: `spec.model.ml_model_id`, which `gpu.service.js` requires on
 * submission, falling back to `training_runs.model_id`, which is the same fact.
 *
 * On Isaac's corpus every finished run read *"rockfish5-2026-10-20 (412)"* while the models
 * those runs actually produced were 433–437. The expansion beneath names the base
 * separately and correctly, so the panel showed one model twice — a run that trained from
 * itself, which only a reader who already knew could spot.
 *
 * **Nothing records which model a run registered.** `ml_models` has no `training_run_id`
 * and `training_runs` has no produced-model column. The column keeps its place and says
 * nothing until one of them does.
 *
 * The same misreading was in the registry's Training dataset column (a2abf3314). Three
 * cells, one sentence written three times.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** The base checkpoint every run here fine-tuned from. */
const BASE = { ml_model_id: 412, name: 'rockfish5-2026-10-20', sha256: 'a'.repeat(64) };

/**
 * A finished training job, shaped the way the pool records one.
 *
 * @param {number} id - The job id.
 * @returns {Object}
 */
const finishedJob = (id) => ({
  id,
  kind: 'training',
  name: null,
  state: 'succeeded',
  spec: { model: BASE, dataset: { dataset_id: 384, name: 'CookieStarTest' } },
  created_at: '2026-10-26T15:39:00.000Z',
  updated_at: '2026-10-26T16:06:00.000Z',
  created_by: 7,
  worker_name: 'ABYSS-fba6be1a',
  workers_used: 1,
  progress_done: 10,
  progress_total: 10,
  batch_id: null,
});

/**
 * Draw Training over one finished job and the run it recorded.
 *
 * @returns {Promise<Object>} From `drawScreen`.
 */
const drawTraining = () => drawScreen('training.html', {
  listJobs: async () => ({ jobs: [finishedJob(21785)], total: 1, limit: 500, offset: 0 }),
  /* `model_id` is the base, which is what MARP actually writes. */
  listTrainingRuns: async () => [{ id: 205, model_id: 412, dataset_id: 384, job_id: 21785, total_epochs: 10 }],
  listDatasets: async () => [{ id: 384, name: 'CookieStarTest' }],
  listModels: async () => [
    { id: 412, name: 'rockfish5-2026-10-20', model_type: 'detection', status: 'trained', parent_model_id: null, created_at: '2026-10-20T10:00:00.000Z', updated_at: '2026-10-20T10:00:00.000Z' },
    { id: 435, name: 'CookieStarTest-2026-10-26-2', model_type: 'detection', status: 'trained', parent_model_id: 412, created_at: '2026-10-26T16:06:00.000Z', updated_at: '2026-10-26T16:06:00.000Z' },
  ],
  listProjects: async () => [],
  listUsers: async () => [{ user_id: 7, name: 'Isaac Assegai' }],
  listSessions: async () => [],
});

/**
 * Every `Produces` cell drawn on the screen, across both tables that have the column.
 *
 * @param {Object} document - The drawn document.
 * @returns {string[]}
 */
function producesCells(document) {
  const cells = [];

  for (const table of document.querySelectorAll('table')) {
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const column = headers.indexOf('Produces');
    if (column < 0) continue;

    for (const row of table.querySelectorAll('tbody tr')) {
      if (row.children.length !== headers.length) continue;
      cells.push(row.children[column].textContent.trim());
    }
  }

  return cells;
}

test('a finished run does not name its base model as what it produced', async (t) => {
  const screen = await drawTraining();
  t.after(screen.close);

  const cells = producesCells(screen.document);
  assert.ok(cells.length > 0, 'the fixture should have drawn rows in a table with a Produces column');

  for (const cell of cells) {
    assert.ok(!cell.includes('rockfish5'),
      'rockfish5-2026-10-20 is the checkpoint this run fine-tuned FROM, not what it produced');
    assert.ok(!cell.includes('412'), 'nor its id');
  }
});

test('the column says nothing rather than guessing', async (t) => {
  const screen = await drawTraining();
  t.after(screen.close);

  for (const cell of producesCells(screen.document)) {
    assert.equal(cell, '—', 'until MARP records which model a run registered, the cell is empty');
  }
});

test('the header still means what it meant', async (t) => {
  /* The column is right and only its data was wrong, so nothing here is relabelled.
     Renaming `Produces` to match the base model would have made the screen agree with
     the bug instead of reporting it. */
  const screen = await drawTraining();
  t.after(screen.close);

  const headers = [...screen.document.querySelectorAll('table thead th')].map((th) => th.textContent.trim());
  assert.ok(headers.includes('Produces'), 'the column stays, for the value that belongs in it');
});

/* ---------------------------------------------------------------- the recorded link */

/**
 * The same screen, with the model that run 205 produced carrying `training_run_id`.
 *
 * This is the shape `registerTrainedModel` writes: 435 was produced by run 205, which
 * fine-tuned from 412. Both facts are now recorded separately, which is the whole point —
 * the column that means "produced" reads the first, and the expansion reads the second.
 *
 * @returns {Promise<Object>} From `drawScreen`.
 */
const drawLinked = () => drawScreen('training.html', {
  listJobs: async () => ({ jobs: [finishedJob(21785)], total: 1, limit: 500, offset: 0 }),
  listTrainingRuns: async () => [{ id: 205, model_id: 412, dataset_id: 384, job_id: 21785, total_epochs: 10 }],
  listDatasets: async () => [{ id: 384, name: 'CookieStarTest' }],
  listModels: async () => [
    { id: 412, name: 'rockfish5-2026-10-20', model_type: 'detection', status: 'trained', parent_model_id: null, training_run_id: null, created_at: '2026-10-20T10:00:00.000Z', updated_at: '2026-10-20T10:00:00.000Z' },
    { id: 435, name: 'CookieStarTest-2026-10-26-2', model_type: 'detection', status: 'trained', parent_model_id: 412, training_run_id: 205, created_at: '2026-10-26T16:06:00.000Z', updated_at: '2026-10-26T16:06:00.000Z' },
  ],
  listProjects: async () => [],
  listUsers: async () => [{ user_id: 7, name: 'Isaac Assegai' }],
  listSessions: async () => [],
});

test('a finished run names the model it registered', async (t) => {
  const screen = await drawLinked();
  t.after(screen.close);

  const cells = producesCells(screen.document);
  assert.ok(cells.length > 0, 'the fixture should have drawn rows');

  for (const cell of cells) {
    assert.match(cell, /CookieStarTest-2026-10-26-2/, 'run 205 registered model 435');
    assert.ok(!cell.includes('rockfish5'), 'and 412 is what it trained from, which is not this column');
  }
});

test('the produced model is reachable from the cell', async (t) => {
  /* The question after "which model" is always "that one, show me" — the same link the
     registry's dataset cell carries. */
  const screen = await drawLinked();
  t.after(screen.close);

  const link = screen.document.querySelector('.jmakes a');
  assert.ok(link, 'the produced model should be a link');
  assert.equal(link.getAttribute('href'), './models.html?model=435');
});
