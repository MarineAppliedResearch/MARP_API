/**
 * Which dataset a model learned from, in the registry's Training dataset column.
 *
 * **It was a permanent dash over data MARP already holds.** `ml_models` carries no
 * dataset link and never will -- the link is `training_runs.dataset_id` -- and the column
 * said so with a tooltip claiming training runs "cannot be listed". That stopped being
 * true when #260 added the collection read, and nothing noticed for weeks because a dash
 * that is always a dash looks the same whether it is honest or stale.
 *
 * So what is pinned here is the join, and the three ways it can be empty, because they
 * are three different facts that have to read as one dash:
 *
 * - a model with a run that names a dataset gets the name, linked;
 * - a model with no run at all gets the dash;
 * - a model whose run trained on something outside MARP gets the dash too.
 *
 * And the one behavioural rule underneath: **the newest run wins.** A model retrained on
 * a wider dataset shows the wider one, or the column is a record of what it used to be.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** One registry row, with the columns `modelView` reads. */
const model = (id, name) => ({
  id,
  name,
  model_type: 'detection',
  architecture_version: 'YOLOv8l',
  status: 'trained',
  parent_model_id: null,
  storage_path: `/weights/${name}.pt`,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
});

/** One training run. The route answers newest first, so order here is the route's. */
const run = (id, modelId, datasetId, createdAt) => ({
  id,
  model_id: modelId,
  dataset_id: datasetId,
  created_at: createdAt,
  start_time: createdAt,
  end_time: null,
  total_epochs: 100,
});

/** The cell, for one model id. */
const cell = (screen, modelId) =>
  screen.document.querySelector(`#models tbody tr[data-model="${modelId}"] .hdset`);

/** Everything the registry needs drawn, with three models standing for three cases. */
const answers = {
  listModels: async () => [
    model(1, 'MARP-Rockfish-Det'),
    model(2, 'MARP-Legacy-Det'),
    model(3, 'MARP-External-Det'),
  ],
  listDatasets: async () => [
    { id: 41, name: 'CAMPA_2024_Rockfish_v3', status: 'ready' },
    { id: 42, name: 'ALL_Projects_Inverts_v5', status: 'ready' },
  ],
  listTrainingRuns: async () => [
    /* Newest first, as the repository orders it. Model 1 has two: the wider dataset is
       the recent one, and it is what the column must show. */
    run(12, 1, 42, '2026-10-18T10:00:00.000Z'),
    run(11, 1, 41, '2026-10-02T10:00:00.000Z'),
    /* Model 3 trained on something outside MARP. A run, but no dataset. */
    run(13, 3, null, '2026-10-15T10:00:00.000Z'),
    /* Model 2 has no run at all and is simply absent here. */
  ],
};

test('a model shows the dataset its most recent run learned from, linked', async (t) => {
  const screen = await drawScreen('models.html', answers);
  t.after(screen.close);

  const link = cell(screen, 1).querySelector('a');

  assert.ok(link, 'the column should carry a link rather than a dash');
  assert.equal(link.textContent.trim(), 'ALL_Projects_Inverts_v5',
    'the newest run wins: this model was retrained on the wider dataset, and showing the '
    + 'older one would make the column a record of what it used to be');
  assert.equal(link.getAttribute('href'), './datasets.html?dataset=42',
    'and it should land on that dataset, the way a build does from the Jobs screen');
});

test('a model with no training run reads as the same dash as the columns beside it', async (t) => {
  const screen = await drawScreen('models.html', answers);
  t.after(screen.close);

  const mine = cell(screen, 2);
  const beside = screen.document.querySelector('#models tbody tr[data-model="2"] .hcache');

  assert.equal(mine.querySelector('a'), null, 'nothing to link to');

  /* **Identical, deliberately.** Some models predate runs being kept, and an honest "no
     run for this" has to look like the other empty columns rather than become a third
     kind of empty -- a blank, a zero or a "None" would each read as a different fact. */
  assert.ok(mine.querySelector('.dash'), 'it should be a dash');
  assert.equal(mine.textContent.trim(), beside.textContent.trim(),
    'and the same dash the Cached column draws, character for character');

  /* The tooltip is the one thing that differs, because the reason differs. */
  assert.notEqual(mine.querySelector('.dash').getAttribute('title'),
    beside.querySelector('.dash').getAttribute('title'),
    'the reason should differ even though the glyph does not: a reader who hovers deserves '
    + 'the real one rather than a sentence about ml_models');
  assert.match(mine.querySelector('.dash').getAttribute('title'), /no training run/i);
});

test('a run that trained outside MARP reads as a dash, not as a broken link', async (t) => {
  const screen = await drawScreen('models.html', answers);
  t.after(screen.close);

  const mine = cell(screen, 3);

  /* A run with a null `dataset_id` is not the same fact as having no run, but it is the
     same answer to "which dataset" -- and a link to `?dataset=null` would be worse than
     either. */
  assert.equal(mine.querySelector('a'), null, 'a null dataset_id should not become a link');
  assert.ok(mine.querySelector('.dash'), 'it should take the dash');
});

test('the registry still draws when training runs cannot be fetched', async (t) => {
  /* The registry is the screen; the runs are a column on it. A catalogue that is slow or
     a route that 404s on an older MARP should cost one column, not the table. */
  const screen = await drawScreen('models.html', {
    listModels: answers.listModels,
    listDatasets: answers.listDatasets,
    // listTrainingRuns deliberately absent, so the stub answers 404.
  });

  t.after(screen.close);

  assert.equal(screen.document.querySelectorAll('#models tbody tr.runrow-head').length, 3,
    'every model should still have a row');
  assert.ok(cell(screen, 1).querySelector('.dash'),
    'and the column it could not fill should be a dash rather than empty');
});

test('the dataset filter offers what models actually trained on, and narrows to it', async (t) => {
  const screen = await drawScreen('models.html', answers);
  t.after(screen.close);

  const select = [...screen.document.querySelectorAll('select')]
    .find((one) => one.getAttribute('aria-label') === 'Dataset');

  assert.ok(select, 'the registry should have a dataset filter');
  assert.equal(select.disabled, false,
    'it was disabled for a reason that stopped being true: training runs can be listed since #260');

  /* Only what something trained on. Offering the whole catalogue means offering options
     that narrow to nothing, which is a filter nobody trusts twice. */
  assert.deepEqual([...select.options].map((one) => one.textContent),
    ['All datasets', 'ALL_Projects_Inverts_v5'],
    'the options should be the datasets models here actually used');

  select.value = 'ALL_Projects_Inverts_v5';
  select.dispatchEvent(new screen.window.Event('change', { bubbles: true }));

  assert.deepEqual(
    [...screen.document.querySelectorAll('#models tbody tr.runrow-head')].map((row) => row.dataset.model),
    ['1'],
    'choosing it should leave the one model that trained on it -- the filter had options '
    + 'and no listener before, so even enabled it would have done nothing');
});
