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

test('every training job expands, and the run half appears where there is a run', async (t) => {
  const screen = await drawScreen('training.html', answers([epoch(1)]));

  t.after(screen.close);

  const withRun = screen.document.querySelector('.training-table tbody tr[data-job="21779"]');
  const without = screen.document.querySelector('.training-table tbody tr[data-job="21780"]');

  /* This assertion was the opposite way round for a day, and that was the defect: the
     expander was conditional on a run existing, so a job still running had none. */
  assert.ok(withRun.querySelector('.exbtn'), 'the job that produced run 202 should open');
  assert.ok(without.querySelector('.exbtn'), 'and so should one with no run recorded');

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

test('the screen keeps asking while a job is live, and stops when none is', async (t) => {
  /* The timer belongs to the screen rather than to each open panel: one poll patches
     every row and refreshes whatever is open, instead of a request per expanded row. */
  const live = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({ jobs: [job(21782, 'leased')], total: 1, limit: 500, offset: 0 }),
  });

  t.after(live.close);

  const scheduled = [];
  const real = live.window.setTimeout;

  live.window.setTimeout = (fn, delay) => { scheduled.push(delay); return real(fn, delay); };
  live.window.watchTrainingJobs();

  assert.ok(scheduled.includes(5000),
    `a leased job should keep the screen watching at the builder's cadence (saw ${scheduled.join(', ')})`);

  /* And the half that matters for a screen left open on finished work. */
  const settled = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({ jobs: [job(21779, 'succeeded')], total: 1, limit: 500, offset: 0 }),
  });

  t.after(settled.close);

  const after = [];
  const alsoReal = settled.window.setTimeout;

  settled.window.setTimeout = (fn, delay) => { after.push(delay); return alsoReal(fn, delay); };
  settled.window.watchTrainingJobs();

  assert.ok(!after.includes(5000),
    `nothing queued or leased means nothing to ask about (saw ${after.join(', ')})`);
});

test('no control on the setup form is left saying Loading', async (t) => {
  /* **The invariant behind a real defect.** "Worker selection" sat on *Loading…* for ever
     because nothing filled it -- no worker-list request was ever made -- and a placeholder
     that never resolves is indistinguishable from a slow page. The control is gone now,
     because nothing in MARP targets a job at a named worker: submission has no field for
     it and the claim is pull-based, so a chosen worker would have been discarded.

     This guards the rest of the form, where the same placeholder is used by selects that
     *are* filled. A new one added without a filler fails here rather than in front of
     somebody trying to queue a run. */
  const screen = await drawScreen('training.html', answers([epoch(1)]));

  t.after(screen.close);

  const stuck = [...screen.document.querySelectorAll('select')]
    .filter((one) => [...one.options].every((option) => /loading/i.test(option.textContent)))
    .map((one) => one.id || one.getAttribute('data-fills') || one.outerHTML.slice(0, 60));

  assert.deepEqual(stuck, [],
    'every select should have been filled, emptied or removed -- a placeholder that never '
    + 'resolves reads as a page still loading, for ever');
});

test('a job with no run yet still expands, and says what it is waiting for', async (t) => {
  /* **The defect this fixes.** The expander used to be conditional on a training run
     existing, so the one job anybody watches -- the one still going -- had none. Isaac,
     on the run he had just queued: "it's not expandable, it should be expandable". */
  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: [{ ...job(21781, 'queued'), progress_done: null, progress_total: 10 },
        { ...job(21782, 'leased'), progress_done: 3, progress_total: 10, progress_unit: 'epochs', progress_phase: 'training' }],
      total: 2,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const queued = screen.document.querySelector('.training-table tbody tr[data-job="21781"]');
  const leased = screen.document.querySelector('.training-table tbody tr[data-job="21782"]');

  assert.ok(queued.querySelector('.exbtn'), 'a queued job should expand');
  assert.ok(leased.querySelector('.exbtn'), 'a job being worked on should expand');

  const waiting = await open(screen, 21781);

  assert.match(waiting.textContent, /Waiting for a worker/,
    'a job nothing has leased should say so rather than opening on nothing');

  const running = await open(screen, 21782);

  /* The live half comes off the attempt, so it needs no training run at all. */
  assert.match(running.textContent, /3 of 10 epochs/, 'progress comes from the attempt');
  assert.match(running.textContent, /[Tt]raining/, 'and the phase the worker reports');
  assert.match(running.textContent, /No training run has been recorded/,
    'with the run half honestly absent rather than invented');
});

test('a poll patches the rows and leaves an open one open', async (t) => {
  /* **The regression that goes silent.** Rebuilding the table every five seconds closes
     the row being read -- the exact defect the Datasets table was fixed for. Asked as node
     identity, because a rebuild replaces the elements. */
  let done = 3;

  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: [{ ...job(21782, 'leased'), progress_done: done, progress_total: 10, progress_unit: 'epochs', progress_phase: 'training' }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const head = screen.document.querySelector('.training-table tbody tr[data-job="21782"]');
  const detail = await open(screen, 21782);

  assert.equal(head.getAttribute('aria-expanded'), 'true');
  assert.match(detail.textContent, /3 of 10 epochs/, 'the panel starts at what the attempt said');

  /* Run one real cycle: the watcher schedules at 5000, so firing that callback is what
     the page does five seconds later. */
  done = 7;

  let cycle = null;
  const real = screen.window.setTimeout;

  screen.window.setTimeout = (fn, delay) => {
    if (delay === 5000 && !cycle) { cycle = fn; return 1; }
    return real(fn, delay);
  };

  screen.window.watchTrainingJobs();

  assert.ok(cycle, 'a leased job should have scheduled a poll');

  await cycle();

  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => real(resolve, 20));

  assert.equal(screen.document.querySelector('.training-table tbody tr[data-job="21782"]'), head,
    'the same <tr> should still be in the document -- a new node means the table was rebuilt '
    + 'around the reader, which is what closed rows on Datasets');
  assert.equal(head.nextElementSibling, detail, 'and the same detail row beside it');
  assert.equal(head.getAttribute('aria-expanded'), 'true', 'still open');
  assert.match(head.querySelector('.jepochs').textContent, /7 \/ 10/, 'with the moved number written in');
  assert.match(detail.textContent, /7 of 10 epochs/, 'and the open panel refreshed in place');
});

test('section 3 follows the form instead of stating a mockup', async (t) => {
  /* Every value here was a literal that contradicted the selections above it: with a
     rockfish base and dataset 388 chosen it still read "Registers MARP-Multiclass-Det-XL
     1.0.3", base 1.0.2, ALL_Projects_Inverts_v5, 12,846 observations and itravers. */
  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listModels: async () => [
      { id: 90, name: 'MARP-Rockfish-Base', model_type: 'detection', status: 'trained', parent_model_id: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' },
      { id: 91, name: 'rockfish5-2026-10-20', model_type: 'detection', status: 'trained', parent_model_id: 90, created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z' },
    ],
    listDatasets: async () => [
      { id: 388, name: 'CookieStarTest', status: 'ready', num_observations: 3361, num_classes: 2 },
    ],
  });

  t.after(screen.close);

  const result = screen.document.querySelector('[data-fills="result-det"]');
  const trace = screen.document.querySelector('[data-fills="trace"]');

  /* The first option wins by default, which is the base with no parent: generation 1. */
  assert.match(result.textContent, /Registers a new detection model from MARP-Rockfish-Base/);
  assert.doesNotMatch(result.textContent, /MARP-Multiclass-Det-XL|1\.0\.3/,
    'the mockup name and version should be gone');
  assert.match(result.textContent, /MARP records no version number/,
    'ml_models has no version column, so the number is not invented -- it is explained');

  assert.match(trace.textContent, /CookieStarTest/, 'the dataset the form has');
  assert.match(trace.textContent, /3,361, by membership/, "and that dataset's own count");
  assert.doesNotMatch(trace.textContent, /12,846|itravers|ALL_Projects_Inverts_v5/,
    'none of the literals should survive');

  /* Changing the selection moves it, which is the half that was most obviously wrong. */
  const base = screen.document.querySelector('#base-det');

  base.value = '91';
  base.dispatchEvent(new screen.window.Event('change', { bubbles: true }));

  assert.match(result.textContent, /from rockfish5-2026-10-20/, 'it follows the base picker');
  assert.match(result.textContent, /Generation v3/,
    'and the generation is walked from parent_model_id rather than guessed: 91 is a child of 90');
});

test('the dataset quad fills what a Dataset records and dashes what it does not', async (t) => {
  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listDatasets: async () => [{ id: 388, name: 'CookieStarTest', status: 'ready', num_observations: 3361, num_classes: 2 }],
  });

  t.after(screen.close);

  const cells = [...screen.document.querySelectorAll('[data-fills="dataset-quad"] span b')];

  assert.equal(cells[0].textContent, '3,361', 'observations is a column');
  assert.equal(cells[1].textContent, '2', 'and so is classes');

  /* Videos and dives belong to what went into a build, not to the dataset row. They read
     142 and 36 before this, which were simply made up. */
  assert.ok(cells[2].querySelector('.dash'), 'videos is not recorded on a dataset');
  assert.ok(cells[3].querySelector('.dash'), 'nor is dives');
});

test('a poll where only updated_at moved repaints that cell and nothing else', async (t) => {
  /* The Datasets table had this exact cell sit frozen for as long as a build ran: the
     patch path wrote frames and the pill, and Updated had only ever been refreshed by
     accident, back when the whole table was thrown away every poll. */
  let updated = '2026-10-22T11:00:00.000Z';

  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: [{ ...job(21782, 'leased'), updated_at: updated, progress_done: 3, progress_total: 10, progress_unit: 'epochs', progress_phase: 'training' }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const head = screen.document.querySelector('.training-table tbody tr[data-job="21782"]');
  const detail = await open(screen, 21782);
  const cell = head.querySelector('[data-updated]');

  assert.ok(cell, 'the row should carry the same marker the Datasets row does');
  assert.equal(cell.dataset.sort, updated);

  const before = cell.textContent.trim();

  /* Only the timestamp moves: no state change, no progress change. */
  updated = '2026-10-22T11:04:00.000Z';

  let cycle = null;
  const real = screen.window.setTimeout;

  screen.window.setTimeout = (fn, delay) => {
    if (delay === 5000 && !cycle) { cycle = fn; return 1; }
    return real(fn, delay);
  };

  screen.window.watchTrainingJobs();
  await cycle();

  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => real(resolve, 20));

  assert.equal(head.querySelector('[data-updated]'), cell, 'the same cell node, not a rebuilt one');
  assert.notEqual(cell.textContent.trim(), before, 'repainted');
  assert.equal(cell.dataset.sort, updated,
    'and its sort key too, or sorting by Updated orders by what the page was drawn with');
  assert.equal(head.getAttribute('aria-expanded'), 'true', 'with the expansion still open');
});

/** One bucket of the jobs series, as GET /gpu/jobs/series returns it. */
const bucket = (at, extra = {}) => ({
  at,
  machines: 1,
  avg_training_utilization_percent: null,
  training_machines: 0,
  created: 0,
  finished: 0,
  succeeded: 0,
  waiting: 0,
  ...extra,
});

test('the activity chart draws what the series says, at a 1h default', async (t) => {
  /* It drew four hardcoded arrays: the tiles above said 1 running, 0 queued, 2 completed
     while this footer said 2, 3 and 3. `GET /gpu/jobs/series` takes kind, so no route had
     to be added -- the same two reads the Datasets activity chart already makes. */
  const screen = await drawScreen('training.html', {
    ...answers([], []),
    jobSeries: async (q) => ({
      since: q.since,
      until: q.until,
      bucket: q.bucket,
      points: [
        bucket('2026-10-23T19:00:00.000Z', { avg_training_utilization_percent: 61, training_machines: 1, waiting: 2 }),
        bucket('2026-10-23T19:30:00.000Z', { avg_training_utilization_percent: 74, training_machines: 2, waiting: 1, succeeded: 1 }),
      ],
    }),
  });

  t.after(screen.close);

  const root = screen.document.querySelector('[data-training-activity]');
  const cur = (n) => root.querySelector(`[data-training-current="${n}"]`).textContent.trim();

  assert.deepEqual(
    [...root.querySelectorAll('[data-training-range]')].map((b) => b.dataset.trainingRange),
    ['1h', '24h', '7d', '30d'],
    'the same set workers.html offers, rather than a fourth variant');
  assert.equal(root.querySelector('[data-training-range].on').dataset.trainingRange, '1h',
    'defaulting to the hour Isaac asked for');

  assert.ok(root.querySelector('.training-line.compute').getAttribute('d'), 'compute draws');
  assert.ok(root.querySelector('.training-line.queued').getAttribute('d'), 'queued draws');
  assert.ok(root.querySelector('.training-bars.completed').getAttribute('d').trim(), 'completed draws as bars');

  /* The readouts are the last bucket, except completed which is a count of events. */
  assert.equal(cur('compute'), '74%');
  assert.equal(cur('running'), '2');
  assert.equal(cur('queued'), '1');
  assert.equal(cur('completed'), '1');
});

test('a GPU reading nobody took is absent, not a flat zero', async (t) => {
  /* `avg_training_utilization_percent` comes from gpu_worker_samples, written only while a
     worker holds a lease and heartbeats -- so it is null far more often than it is zero. A
     0% line says the GPUs were idle; null says nobody looked, and drawing the first for
     the second is the same lie as plotting a null loss at zero. */
  const screen = await drawScreen('training.html', {
    ...answers([], []),
    jobSeries: async (q) => ({
      since: q.since,
      until: q.until,
      bucket: q.bucket,
      points: [bucket('2026-10-23T19:00:00.000Z', { training_machines: 1, waiting: 1 }),
        bucket('2026-10-23T19:30:00.000Z', { training_machines: 1, waiting: 0, succeeded: 1 })],
    }),
  });

  t.after(screen.close);

  const root = screen.document.querySelector('[data-training-activity]');

  assert.equal(root.querySelector('.training-line.compute').getAttribute('d'), '',
    'no line at all, rather than one along the bottom');
  assert.equal(root.querySelector('.training-area').getAttribute('d'), '',
    'and no area under it');
  assert.ok(root.querySelector('[data-training-highlight="compute"]').disabled,
    'its legend key cannot be pressed to reveal nothing');
  assert.ok(root.querySelector('[data-training-current="compute"] .dash'),
    'and the readout is a dash');

  /* The series that were recorded still draw. */
  assert.ok(root.querySelector('.training-line.queued').getAttribute('d'), 'queued is unaffected');
});
