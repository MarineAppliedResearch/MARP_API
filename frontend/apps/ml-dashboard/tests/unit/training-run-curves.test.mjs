/**
 * A training run, under the job that produced it.
 *
 * A real run finished from the dashboard and Isaac could see nothing about it: the
 * Training table's Dataset, Produces, Epochs and Best mAP columns were all dashes, the
 * rows did not expand, and the page's own text said why — *"training runs cannot be
 * listed"*. That stopped being true in #260 for the runs; the epochs needed a read of
 * their own, which `GET /training_run/:id/epochs` now is.
 *
 * **The assertion that matters most here is that null is not zero.** Most epoch metrics
 * are null today because the worker does not report them all yet, and a run with no
 * validation split will never have them. A chart that plots a null at zero draws a loss
 * falling off a cliff and an mAP collapsing — a picture of a model failing, invented from
 * a column nobody filled. That is worse than an empty chart, and it is the kind of thing
 * that looks right in a screenshot.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** A training job, the shape the Training table reads. */
const job = (id, state = 'succeeded') => ({
  id,
  kind: 'training',
  name: `Train run ${id}`,
  spec: { model: { name: 'MARP-Rockfish-Det' } },
  state,
  priority: 0,
  attempts_made: 1,
  max_attempts: 3,
  created_at: '2026-10-22T09:00:00.000Z',
  updated_at: '2026-10-22T11:00:00.000Z',
  progress_done: null,
  progress_total: null,
});

/** A run, with `job_id` — the column that existed and no model exposed. */
const run = (id, jobId, extra = {}) => ({
  id,
  job_id: jobId,
  model_id: 7,
  dataset_id: 41,
  total_epochs: 4,
  batch_size: 16,
  learning_rate: 0.001,
  optimizer: 'Adam',
  compute_device: 'RTX 4090',
  start_time: '2026-10-22T09:00:00.000Z',
  end_time: '2026-10-22T11:00:00.000Z',
  created_at: '2026-10-22T09:00:00.000Z',
  ...extra,
});

/** One epoch. Anything not named is null, which is the normal case today. */
const epoch = (number, values = {}) => ({
  id: 500 + number,
  training_run_id: 202,
  epoch_number: number,
  box_loss: null,
  cls_loss: null,
  dfl_loss: null,
  precision: null,
  recall: null,
  map50: null,
  map5095: null,
  duration_seconds: 42,
  ...values,
});

const answers = (epochs, runs = [run(202, 21779)]) => ({
  listJobs: async () => ({ jobs: [job(21779), job(21780)], total: 2, limit: 500, offset: 0 }),
  listModels: async () => [{ id: 7, name: 'MARP-Rockfish-Det', model_type: 'detection', status: 'trained', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }],
  listDatasets: async () => [{ id: 41, name: 'CAMPA_2024_Rockfish_v3', status: 'ready' }],
  listSessions: async () => [],
  listTrainingRuns: async () => runs,
  trainingRunEpochs: async () => epochs,
});

/** Open the row for a job and let its detail fill. */
async function open(screen, jobId) {
  const head = screen.document.querySelector(`.training-table tbody tr[data-job="${jobId}"]`);

  head.querySelector('.exbtn').click();

  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  return head.nextElementSibling;
}

test('only a job whose run was recorded gets an expander', async (t) => {
  const screen = await drawScreen('training.html', answers([epoch(1)]));

  t.after(screen.close);

  const withRun = screen.document.querySelector('.training-table tbody tr[data-job="21779"]');
  const without = screen.document.querySelector('.training-table tbody tr[data-job="21780"]');

  assert.ok(withRun.querySelector('.exbtn'), 'the job that produced run 202 should open');
  assert.equal(without.querySelector('.exbtn'), null,
    'a training job with no run has nothing under it, so it should not offer to open on an apology');

  /* The join itself, which could not be made until `training_runs.job_id` reached the
     model: the column has been in the table since 20261020120000. */
  assert.match(withRun.querySelector('.jdset').textContent, /Dataset 41/);
  assert.match(withRun.querySelector('.jmakes').textContent, /Model 7/);
});

test('a null metric is a gap in the line, never a zero', async (t) => {
  /* Four epochs; box loss is measured, missing, measured, measured. This is the real
     shape of run 202 today -- precision and recall recorded, the rest null. */
  const screen = await drawScreen('training.html', answers([
    epoch(1, { box_loss: 1.8 }),
    epoch(2),
    epoch(3, { box_loss: 1.1 }),
    epoch(4, { box_loss: 0.9 }),
  ]));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const line = detail.querySelector('.result-line.box-loss');

  assert.ok(line, 'box loss was measured, so it should be drawn');

  const d = line.getAttribute('d');
  const moves = (d.match(/M/g) || []).length;

  assert.equal(moves, 2,
    `the line should break at the unmeasured epoch and start again after it (d="${d}")`);

  /* The baseline is y=174 in this viewBox. A null plotted as zero would land exactly
     there, which on a loss chart reads as the loss having reached nothing. */
  assert.doesNotMatch(d, /,174(\.0)?\b/,
    'nothing should be drawn on the zero baseline: that is what a null plotted as zero '
    + 'looks like, and on a loss curve it reads as a model that collapsed');
});

test('a metric nothing reported says so instead of drawing an empty frame', async (t) => {
  const screen = await drawScreen('training.html', answers([
    epoch(1, { precision: 0.1932, recall: 0.40423 }),
  ]));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const cards = [...detail.querySelectorAll('.evaluation-card')];
  const loss = cards.find((card) => /Loss/.test(card.querySelector('h5')?.textContent || ''));

  assert.ok(loss, 'the loss chart should still have a place');
  assert.equal(loss.querySelector('svg'), null,
    'with every loss series null there is nothing to draw, and a frame around nothing is worse');
  assert.match(loss.textContent, /Not reported for this run/);

  /* The quality chart has two of its four, so it draws -- with the two that were not
     reported marked rather than silently absent from the legend. */
  const quality = cards.find((card) => /Validation quality/.test(card.querySelector('h5')?.textContent || ''));

  assert.ok(quality.querySelector('svg'), 'precision and recall were recorded, so it draws');
  assert.ok(quality.querySelector('.result-line.precision').getAttribute('d'), 'precision has a line');
  assert.equal(quality.querySelector('.result-line.map').getAttribute('d'), '',
    'mAP was never reported, so its line is empty rather than flat along the bottom');
});

test('a run still going keeps asking; a finished one settles', async (t) => {
  const unfinished = await drawScreen('training.html',
    answers([epoch(1, { box_loss: 1.8 })], [run(202, 21779, { end_time: null })]));

  t.after(unfinished.close);

  const scheduled = [];
  const realSetTimeout = unfinished.window.setTimeout;

  unfinished.window.setTimeout = (fn, delay) => {
    scheduled.push(delay);
    return realSetTimeout(fn, delay);
  };

  await open(unfinished, 21779);

  assert.ok(scheduled.includes(5000),
    `an open run with no end_time should schedule another read (saw ${scheduled.join(', ')})`);

  /* And the other way, which is the half that stops a finished run polling for ever. */
  const finished = await drawScreen('training.html', answers([epoch(1, { box_loss: 1.8 })]));

  t.after(finished.close);

  const after = [];
  const alsoReal = finished.window.setTimeout;

  finished.window.setTimeout = (fn, delay) => {
    after.push(delay);
    return alsoReal(fn, delay);
  };

  await open(finished, 21779);

  assert.ok(!after.includes(5000), `a finished run should settle after one read (saw ${after.join(', ')})`);
});
