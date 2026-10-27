/**
 * The registry does not credit a model with a dataset it never trained on.
 *
 * **This file used to assert the opposite, and the opposite was wrong.** It pinned a join
 * from `ml_models` through `training_runs.model_id` to `dataset_id`, read as "the dataset
 * this model learned from". That column means the base model a run started *from* —
 * `gpu.service.js` says so where it refuses a training submission without one: *"The
 * starting model has to be one MARP knows, because the run that comes out of it is
 * recorded against it."*
 *
 * So the join named every model after what some *other* run trained on. On Isaac's own
 * corpus six runs carried `model_id = 412` (rockfish5-2026-10-20) and `dataset_id = 384`
 * (CookieStarTest); the registry credited rockfish5 with CookieStarTest, which it never
 * saw, while the five models those runs actually produced showed a dash. One confident
 * lie and five blanks from one misreading — which is worse than a column of dashes,
 * because a reader cannot tell the lie from a fact.
 *
 * **Nothing records which run produced which model.** `ml_models` has no
 * `training_run_id` and `training_runs` has no produced-model column, so there is no
 * correct answer to show yet. The column keeps its place and says nothing.
 *
 * What is pinned here is therefore a refusal: given exactly the shape of data that
 * produced the wrong answer, the screen must not produce it again.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** One registry row, with the columns `modelView` reads. */
const model = (id, name, parent = null) => ({
  id,
  name,
  model_type: 'detection',
  architecture_version: 'YOLOv8l',
  status: 'trained',
  parent_model_id: parent,
  storage_path: `/weights/${name}.pt`,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
});

/** The base model six runs started from, and two of the models they produced. */
const BASE = model(412, 'rockfish5-2026-10-20');
const PRODUCED = [model(433, 'CookieStarTest-2026-10-23', 412), model(434, 'CookieStarTest-2026-10-26', 412)];

/**
 * Runs shaped the way MARP actually writes them: against the model they started from.
 *
 * @returns {Object[]}
 */
const runsFromBase = () => [
  { id: 205, model_id: 412, dataset_id: 384, job_id: 21785 },
  { id: 204, model_id: 412, dataset_id: 384, job_id: 21782 },
];

/**
 * Draw the registry.
 *
 * `listTrainingRuns` and `listDatasets` are still answered even though the screen no
 * longer asks: a stub that throws would pass this test for the wrong reason, by making
 * the join impossible rather than unused.
 *
 * @param {Object[]} models - The registry.
 * @returns {Promise<Object>} From `drawScreen`.
 */
const drawRegistry = (models) => drawScreen('models.html', {
  listModels: async () => models,
  listTrainingRuns: async () => runsFromBase(),
  listDatasets: async () => [{ id: 384, name: 'CookieStarTest' }],
});

/**
 * The Training dataset cell of one row.
 *
 * @param {Object} document - The drawn document.
 * @param {number} id - The model id.
 * @returns {Object} `{text, link}`.
 */
function datasetCell(document, id) {
  const row = document.querySelector(`#models tbody tr[data-model="${id}"]`);
  assert.ok(row, `the fixture should have drawn a row for model ${id}`);
  const cell = row.querySelector('.hdset');
  return { text: cell?.textContent.trim(), link: cell?.querySelector('a')?.getAttribute('href') ?? null };
}

test('a model that runs merely started from is not credited with their dataset', async (t) => {
  const screen = await drawRegistry([BASE, ...PRODUCED]);
  t.after(screen.close);

  const base = datasetCell(screen.document, 412);
  assert.equal(base.link, null,
    'rockfish5 was linked to CookieStarTest on the strength of runs that started FROM it');
  assert.ok(!base.text.includes('CookieStarTest'),
    'the dataset of a run that started from this model is not what this model trained on');
});

test('every row reads the same, so no row looks more known than another', async (t) => {
  const screen = await drawRegistry([BASE, ...PRODUCED]);
  t.after(screen.close);

  const cells = [412, 433, 434].map((id) => datasetCell(screen.document, id).text);
  assert.equal(new Set(cells).size, 1,
    'one populated cell among dashes reads as a fact the others are missing, when it was the only wrong one');
});

test('the registry drops the columns nothing can ever fill', async (t) => {
  /* `Key metrics` and `Cached` were hardcoded to the same dash on every row, for every
     model, always. Isaac asked for them once and asked for them gone after looking at
     them; a column that cannot be filled is a promise the screen cannot keep. */
  const screen = await drawRegistry([BASE]);
  t.after(screen.close);

  const headers = [...screen.document.querySelectorAll('#models thead th')].map((th) => th.textContent.trim());
  assert.ok(!headers.includes('Key metrics'), 'Key metrics was a permanent dash');
  assert.ok(!headers.includes('Cached'), 'Cached was a permanent dash');

  const cells = screen.document.querySelector('#models tbody tr.runrow-head').children.length;
  assert.equal(cells, headers.length, 'every row should carry one cell per column');

  const detail = screen.document.querySelector('#models tbody tr.runrow-body td');
  assert.equal(Number(detail.getAttribute('colspan')), headers.length,
    'the detail row should span the columns that are actually there');
});

test('the expansion states facts and does not explain itself', async (t) => {
  /* DESIGN.md rule 7: no paragraph of prose on a screen, ever. The panel it replaces had
     been rewritten twice because it kept outliving what it described. */
  const screen = await drawRegistry([BASE]);
  t.after(screen.close);

  const detail = screen.document.querySelector('#models tbody tr.runrow-body');
  assert.ok(detail.textContent.includes('In the registry'), 'the facts stay');
  assert.ok(!detail.textContent.includes('Not in the registry'),
    'the paragraph explaining what MARP does not store is documentation, not interface');
  assert.equal(detail.querySelectorAll('p').length, 0, 'no prose in the expansion');
});

test('the dataset filter goes with the association it narrowed on', async (t) => {
  const screen = await drawRegistry([BASE, ...PRODUCED]);
  t.after(screen.close);

  const labels = [...screen.document.querySelectorAll('#models select')]
    .map((s) => s.getAttribute('aria-label'));
  assert.ok(!labels.includes('Dataset'),
    'it offered the datasets of runs that started from a model, which is not what it said it filtered');
});

/* ---------------------------------------------------------------- the recorded link */

/* `ml_models.training_run_id` records which run produced a model, written at
   registration. These fixtures are the real shape from Isaac's corpus: model 412 was
   produced by run 199 over the rockfish5 dataset, and 435 by run 205 over CookieStarTest.
   Under the old join both were named CookieStarTest, because six runs started FROM 412. */
const LINKED = [
  { ...model(412, 'rockfish5-2026-10-20'), training_run_id: 199 },
  { ...model(435, 'CookieStarTest-2026-10-26-2', 412), training_run_id: 205 },
  /* Registered outside the pool: no run produced it, and that is a fact not a gap. */
  model(197, 'rockfish2'),
];

const LINKED_RUNS = [
  { id: 205, model_id: 412, dataset_id: 384, job_id: 21785 },
  { id: 199, model_id: 197, dataset_id: 294, job_id: 21542 },
];

const LINKED_SETS = [{ id: 384, name: 'CookieStarTest' }, { id: 294, name: 'rockfish5' }];

const drawLinked = () => drawScreen('models.html', {
  listModels: async () => LINKED,
  listTrainingRuns: async () => LINKED_RUNS,
  listDatasets: async () => LINKED_SETS,
});

test('a model names the dataset the run that produced it learned from', async (t) => {
  const screen = await drawLinked();
  t.after(screen.close);

  const made = datasetCell(screen.document, 435);
  assert.equal(made.text, 'CookieStarTest', 'run 205 trained on CookieStarTest');
  assert.equal(made.link, './datasets.html?dataset=384', 'and the dataset is reachable');
});

test('the base model keeps its own dataset, not the one its children trained on', async (t) => {
  /* The regression in one assertion. Six runs started FROM 412, all over CookieStarTest,
     and the old join credited 412 with it. 412 was produced by run 199, over rockfish5. */
  const screen = await drawLinked();
  t.after(screen.close);

  const base = datasetCell(screen.document, 412);
  assert.equal(base.text, 'rockfish5', 'what 412 itself was trained on');
  assert.ok(!base.text.includes('CookieStarTest'),
    'CookieStarTest is what runs starting FROM 412 used, which is a different fact');
});

test('a model no run produced still reads as a dash', async (t) => {
  const screen = await drawLinked();
  t.after(screen.close);

  assert.equal(datasetCell(screen.document, 197).text, '—',
    'registered outside the pool: no run, so nothing to name');
});
