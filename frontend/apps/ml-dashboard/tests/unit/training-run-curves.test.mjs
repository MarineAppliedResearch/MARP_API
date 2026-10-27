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
  /* The shape a real training spec has: both halves carry a name beside the id, which is
     what the row shows and what it used to reach past. */
  spec: {
    model: { ml_model_id: 7, name: 'rockfish5-2026-10-20' },
    dataset: { dataset_id: 41, name: 'CookieStarTest' },
  },
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

/**
 * One epoch. Anything not named is null, which is the normal case today.
 *
 * **Every column the endpoint serves is named here, null rather than left out.** They are
 * different answers: an absent key says this MARP does not have the column, a null says
 * this epoch has no value for it. The train trio was absent from the response for a while
 * — the columns existed and `epochs.model.js` had not declared them — and a fixture that
 * omits them cannot tell the two apart either.
 */
const epoch = (number, values = {}) => ({
  id: 500 + number,
  training_run_id: 202,
  epoch_number: number,
  box_loss: null,
  cls_loss: null,
  dfl_loss: null,
  train_box_loss: null,
  train_cls_loss: null,
  train_dfl_loss: null,
  precision: null,
  recall: null,
  map50: null,
  map5095: null,
  duration_seconds: 42,
  start_offset_s: null,
  end_offset_s: null,
  ...values,
});

/**
 * What the three end-of-run reads answer.
 *
 * **They are requests, not fields on the run.** The panel used to read
 * `run.confusion_matrix`, `run.class_metrics` and `run.plots`, which
 * `GET /training_run/:id` has never carried — so every section drew its empty state
 * over a gap that looked like missing data and was a missing request. The evidence
 * comes from `/metrics`, `/curves` and `/artifacts`, and the fixtures say so too.
 */
const found = (evidence = {}) => ({
  trainingRunMetrics: async () => ({
    metrics: evidence.metrics || [],
    confusion_matrices: evidence.matrices || [],
  }),
  trainingRunCurves: async () => evidence.curves || [],
  trainingRunArtifacts: async () => evidence.files || [],
});

const answers = (epochs, runs = [run(202, 21779)], evidence = {}) => ({
  ...found(evidence),
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
  /* **Names, with the id kept beside them.** The row printed "Dataset 41" while the spec
     was carrying `CookieStarTest` in the same object. */
  assert.match(withRun.querySelector('.jdset').textContent, /CookieStarTest/);
  assert.match(withRun.querySelector('.jdset').textContent, /41/, 'and the id stays reachable');

  /* Produces is the version the run registers, which a finished run has and a running one
     does not. This fixture is succeeded. */
  assert.match(withRun.querySelector('.jmakes').textContent, /rockfish5-2026-10-20/);

  /* The task comes off the base model rather than from which columns are null. */
  assert.equal(withRun.querySelector('.jtask').textContent.trim(), 'Detection');
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
  const loss = cards.find((card) => /^Loss$/.test(card.querySelector('h5')?.textContent.trim() || ''));

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

test('the pool chart draws a hole as a hole, not a dip to the floor', async (t) => {
  /* **This is the one that appears the day sampling lands.** The three telemetry series
     were mapped with `|| 0`, so an unsampled bucket drew 0% -- hidden while *nothing* had
     samples, because the chart blanks itself then, and visible the moment a window is
     only partly covered: a real curve falling to the floor across the gaps and climbing
     back out, which reads as GPUs going idle. */
  const at = (n) => `2026-10-23T${String(n).padStart(2, '0')}:00:00.000Z`;

  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    jobSeries: async () => ({ points: [] }),
    gpuSeries: async () => ({
      points: [
        { at: at(10), machines: 1, avg_inference_utilization_percent: 40, avg_training_utilization_percent: 70, avg_memory_percent_used: 55 },
        { at: at(11), machines: 0, avg_inference_utilization_percent: null, avg_training_utilization_percent: null, avg_memory_percent_used: null },
        { at: at(12), machines: 1, avg_inference_utilization_percent: 44, avg_training_utilization_percent: 80, avg_memory_percent_used: 60 },
      ],
    }),
  });

  t.after(screen.close);

  const root = screen.document.querySelector('[data-ops-activity="workers"]');
  const training = root.querySelector('[data-ops-line="training"]').getAttribute('d');

  assert.ok(training, 'the measured buckets should still draw');

  /* A break, rather than three points joined through the middle one. */
  assert.equal((training.match(/M/g) || []).length, 2,
    `the line should stop at the unsampled bucket and start again after it (d="${training}")`);

  /* 196 is the baseline in this viewBox. A null plotted as 0% lands exactly there. */
  assert.doesNotMatch(training, /,196(\.0)?\b/,
    'nothing should be drawn on the floor: that is what a null read as 0% looks like, and '
    + 'on a utilization chart it reads as the GPUs having gone idle');

  /* The shading would fill the gap it was just taught to leave. */
  assert.equal(root.querySelector('[data-ops-area]').getAttribute('d'), '',
    'and no area while the series it shades has a hole in it');
});

test('the run panel offers every section, and each empty one says what it waits for', async (t) => {
  const screen = await drawScreen('training.html', answers([epoch(1, { precision: 0.19 })]));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const heads = [...detail.querySelectorAll('.evaluation-card h5')].map((h) => h.textContent.trim());

  assert.deepEqual(heads,
    ['Loss', 'Validation quality', 'Confusion matrix', 'Per-class quality', 'Threshold curves', 'Training output'],
    'every section has a place, whether or not anything fills it yet');

  /* **An empty frame reads as broken, and a stale sentence is worse.** Each of these
     names what is missing *about this run* rather than what MARP has not built: the
     matrix, the per-class rows and the curves are all served now, so "nothing writes
     metrics_summary yet" would be a sentence that was true in October and is not. */
  assert.match(detail.textContent, /This run recorded none/, 'the matrix says why it is absent');
  assert.match(detail.textContent, /This run recorded no per-class/, 'and so does per-class');
  assert.match(detail.textContent, /once the worker uploads them/, 'and the gallery names who it waits on');

  /* The curves are the one section that is not fetched with the rest, so its empty state
     is an offer rather than a wait. */
  assert.ok(detail.querySelector('[data-read-curves]'),
    'the curves are read on asking, because they are a thousand points per class');

  /* This asserted the opposite until `ea964f18`: the worker sent only `val/*`, so the
     chart said the train split was not recorded. The columns exist now and the chart
     draws both, which is what makes the overfitting gap readable. */
  assert.match(detail.textContent, /solid is train, dashed is validation/);
});

test('a matrix MARP carries as numbers is drawn, not shown as a picture', async (t) => {
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    matrices: [{
      dataset_split: 'val',
      labels: ['Cookie star', 'Urchin', 'background'],
      rows: [[8, 1, 1], [0, 9, 1], [2, 0, 8]],
      orientation: 'rows_true_cols_predicted',
      background_index: 2,
    }],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const grid = detail.querySelector('.confusion');

  assert.ok(grid, 'drawn as a grid rather than an <img>');
  assert.equal(grid.style.getPropertyValue('--cols'), '3',
    'sized from the data: the mockup was hardcoded to four classes');
  assert.equal(detail.querySelectorAll('.confusion > i').length, 9, 'three by three');

  /* The whole reason to prefer numbers: a cell can say what it is. */
  const first = grid.querySelector('i');

  assert.equal(first.dataset.count, '8');
  assert.match(first.getAttribute('title'), /Cookie star predicted as Cookie star: 8/);
});

test('an image-only matrix is shown as a render, and labelled as one', async (t) => {
  /* The matrix as the trainer rendered it and nothing else: the numbers never arrived,
     so the picture is all MARP has. `confusion_matrix` is the role the worker files it
     under, which is what the gallery and this card both key on. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    files: [{
      name: 'confusion_matrix',
      url: '/api/v2/training_run/202/artifacts/abc/confusion_matrix.png',
      content_type: 'image/png',
    }],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.equal(detail.querySelector('.confusion'), null, 'no grid, because there are no numbers');
  assert.ok(detail.querySelector('.result-plot img[src$="confusion_matrix.png"]'), 'the render is shown');
  assert.match(detail.textContent, /MARP does not carry the counts/,
    'and says so, rather than passing a picture off as a reading');
});

test('the trainer plots are captioned by what they are, not by filename', async (t) => {
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    files: [
      { name: 'PR_curve', url: '/a/pr.png', content_type: 'image/png' },
      { name: 'val_batch0_pred', url: '/a/vb.jpg', content_type: 'image/jpeg' },
      { name: 'something_new', url: '/a/new.png', content_type: 'image/png' },
    ],
  }));

  t.after(screen.close);

  const captions = [...(await open(screen, 21779)).querySelectorAll('figcaption')].map((c) => c.textContent);

  assert.deepEqual(captions, [
    'Precision against recall, per class',
    'Sample predictions on held-out images',
    'something new',
  ], 'PR_curve.png means nothing to someone who has not run YOLO; an undescribed plot is '
    + 'still shown rather than hidden');
});

test('adding a task is a list of series, not a new component', async (t) => {
  /* **The test that the structure held.** Every run today is detection, which is exactly
     when hard-coding box/class/DFL and mAP@50 looks harmless -- and then classification
     arrives with top-1 and top-5 and no boxes. A task MARP knows about but nobody has
     described says so; it does not draw detection's charts under a classification run. */
  const screen = await drawScreen('training.html', {
    ...answers([epoch(1, { precision: 0.5 })]),
    listModels: async () => [{ id: 7, name: 'habitat-cls', model_type: 'classification', status: 'trained', parent_model_id: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }],
  });

  t.after(screen.close);

  const row = screen.document.querySelector('.training-table tbody tr[data-job="21779"]');

  assert.equal(row.querySelector('.jtask').textContent.trim(), 'Classification',
    'the row says which kind of run it is, which is the point of the column');
  assert.equal(row.dataset.task, 'classification');

  const detail = await open(screen, 21779);

  /* **Described, and not storable — which is a different sentence.** This said "not
     described yet" while the shape was settled between the API and worker sessions; what
     is actually missing is columns, so the panel names that rather than implying nobody
     has thought about it. */
  assert.match(detail.textContent, /epochs.*has no accuracy columns/,
    'and says what is missing rather than drawing detection-shaped charts for it');
  assert.equal(detail.querySelector('.result-line.box-loss'), null,
    'no box loss on a run that has no boxes');

  /* The sections that are not task-specific still appear. */
  assert.match(detail.textContent, /Confusion matrix/);
});

test('a job whose base model is unknown says so rather than guessing', async (t) => {
  const screen = await drawScreen('training.html', {
    ...answers([epoch(1)]),
    listModels: async () => [],
  });

  t.after(screen.close);

  const row = screen.document.querySelector('.training-table tbody tr[data-job="21779"]');

  assert.ok(row.querySelector('.jtask .dash'), 'a dash, not a guessed task');
  assert.equal(row.dataset.task, undefined);

  /* The name still shows: it is in the spec and does not depend on the registry. */
  assert.match(row.querySelector('.jdset').textContent, /CookieStarTest/);
});

test('a job whose spec carries no name falls back to the id, never to blank', async (t) => {
  const screen = await drawScreen('training.html', {
    ...answers([epoch(1)]),
    listJobs: async () => ({
      jobs: [{ ...job(21779), spec: { model: { ml_model_id: 7 }, dataset: { dataset_id: 41 } } }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const row = screen.document.querySelector('.training-table tbody tr[data-job="21779"]');

  /* Older jobs predate the spec carrying names. The id alone says what it can. */
  assert.equal(row.querySelector('.jdset').textContent.trim(), 'Dataset 41');
  assert.notEqual(row.querySelector('.jdset').textContent.trim(), '', 'never an empty cell');
});

/** Progress samples as GET /training_run/:id/pace returns them, oldest first. */
const sample = (minute, done, total = 10) => ({
  at: `2026-10-23T19:${String(minute).padStart(2, '0')}:00.000Z`,
  done,
  total,
  unit: 'epochs',
  attempt_id: 900,
});

test('a remaining estimate is measured from the run, or it is not shown', async (t) => {
  /* This is where "~4h 10m" lived, for a run that took 27 seconds -- two literals in the
     markup that no selection moved. Four epochs over eight minutes is half an epoch a
     minute, so six left is twelve minutes. */
  const screen = await drawScreen('training.html', {
    ...answers([epoch(1)], [run(202, 21779, { end_time: null })]),
    listJobs: async () => ({
      jobs: [{ ...job(21779, 'leased'), progress_done: 4, progress_total: 10, progress_unit: 'epochs', progress_phase: 'training' }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
    trainingRunPace: async () => [sample(0, 0), sample(4, 2), sample(8, 4)],
  });

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.match(detail.textContent, /0\.50 \/ min/, 'the rate it has actually held');
  assert.match(detail.textContent, /~12m/, 'and six epochs left at that rate');
});

test('one sample is not a rate', async (t) => {
  /* A single reading has no elapsed time to divide by. Inventing a rate from it would be
     the old estimate again: a number that looks measured and is not. */
  const screen = await drawScreen('training.html', {
    ...answers([epoch(1)], [run(202, 21779, { end_time: null })]),
    listJobs: async () => ({
      jobs: [{ ...job(21779, 'leased'), progress_done: 1, progress_total: 10, progress_unit: 'epochs' }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
    trainingRunPace: async () => [sample(0, 1)],
  });

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.match(detail.textContent, /not enough progress samples yet/);
  assert.doesNotMatch(detail.textContent, /\/ min/, 'no rate claimed from one reading');
});

test('a pace route that is not there costs two figures, not the panel', async (t) => {
  const screen = await drawScreen('training.html', {
    ...answers([epoch(1, { precision: 0.5 })], [run(202, 21779, { end_time: null })]),
    listJobs: async () => ({
      jobs: [{ ...job(21779, 'leased'), progress_done: 3, progress_total: 10, progress_unit: 'epochs' }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
    // trainingRunPace absent, so the stub 404s the way an older MARP would.
  });

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.match(detail.textContent, /3 of 10 epochs/, 'the attempt progress still draws');
  assert.ok(detail.querySelector('.result-line.precision'), 'and so do the charts');
  assert.match(detail.textContent, /not enough progress samples yet/, 'only the pace is absent');
});

test('epoch time is the mean of what the epochs reported, or absent', async (t) => {
  /* `duration_seconds` is a column nothing wrote until worker 0.1.6. It fills in as a run
     goes, so it averages what has arrived rather than waiting for the end -- and it is a
     second opinion on the pace, measured from the epochs instead of from the attempt's
     progress samples. */
  const withTimes = await drawScreen('training.html', answers([
    epoch(1, { duration_seconds: 30 }),
    epoch(2, { duration_seconds: 50 }),
    epoch(3, { duration_seconds: null }),
  ]));

  t.after(withTimes.close);

  const detail = await open(withTimes, 21779);

  assert.match(detail.textContent, /Epoch time/);
  assert.match(detail.textContent, /40s/, 'the mean of the two that reported, not of three');
  assert.match(detail.textContent, /mean of 2 reported/, 'and it says how many it averaged');

  /* A run whose worker predates the column says nothing rather than zero. */
  const without = await drawScreen('training.html', answers([
    epoch(1, { duration_seconds: null }), epoch(2, { duration_seconds: null })]));

  t.after(without.close);

  const bare = await open(without, 21779);
  const card = [...bare.querySelectorAll('.jobmetric')].find((m) => /Epoch time/.test(m.textContent));

  assert.ok(card.querySelector('.dash'), 'a dash, never a zero');
  assert.match(card.textContent, /not reported/);
});

test('a short run is reported in seconds, not rounded to zero minutes', async (t) => {
  /* Isaac's last training run finished in 27 seconds. Under the minute-rounded formatter
     the whole panel reads "0m" for its entire life -- elapsed, remaining and epoch time
     all claiming nothing has happened. */
  const screen = await drawScreen('training.html', {
    ...answers([epoch(1, { duration_seconds: 12 })], [run(202, 21779, { end_time: null })]),
    listJobs: async () => ({
      jobs: [{
        ...job(21779, 'leased'),
        created_at: new Date(Date.now() - 27000).toISOString(),
        progress_done: 4,
        progress_total: 10,
        progress_unit: 'epochs',
      }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
    trainingRunPace: async () => [sample(0, 0), sample(1, 4)],
  });

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.match(detail.textContent, /2[5-9]s/, 'elapsed in seconds');
  assert.match(detail.textContent, /12s/, 'and the epoch time');
  assert.doesNotMatch(detail.textContent, /\b0m\b/, 'nothing should read as zero minutes');
});

test('train and validation loss draw as a pair, so the gap between them is readable', async (t) => {
  /* The overfitting signal, and the thing this panel could not show until `ea964f18`
     added the train trio beside the validation one. A pair shares a colour and differs
     by dash; six unrelated colours would make it a puzzle rather than a comparison. */
  const screen = await drawScreen('training.html', answers([
    epoch(1, { train_box_loss: 1.8, box_loss: 1.9 }),
    epoch(2, { train_box_loss: 1.1, box_loss: 1.6 }),
  ]));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const train = detail.querySelector('.result-line.box-loss-train');
  const val = detail.querySelector('.result-line.box-loss');

  assert.ok(train.getAttribute('d'), 'the train split draws');
  assert.ok(val.getAttribute('d'), 'and so does validation');
  assert.notEqual(train.getAttribute('d'), val.getAttribute('d'),
    'two different series, not one drawn twice');

  const legend = [...detail.querySelectorAll('.result-legend button')].map((b) => b.textContent);

  assert.ok(legend.includes('Box (train)') && legend.includes('Box (val)'),
    'the legend names which split each line is');
});

test('a run from before the train columns draws validation alone, without a hole in the legend', async (t) => {
  /* Backfilled runs and older ones have the validation three and null for the train
     three. The pair degrades to one line rather than the chart claiming a collapse. */
  const screen = await drawScreen('training.html', answers([
    epoch(1, { box_loss: 1.9 }),
    epoch(2, { box_loss: 1.6 }),
  ]));

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.equal(detail.querySelector('.result-line.box-loss-train').getAttribute('d'), '',
    'no train line, rather than one along the bottom');
  assert.ok(detail.querySelector('.result-line.box-loss').getAttribute('d'), 'validation still draws');

  const trainKey = [...detail.querySelectorAll('.result-legend button')]
    .find((b) => b.textContent === 'Box (train)');

  assert.ok(trainKey.disabled, 'and its key cannot be pressed to reveal nothing');
});

test('a loss above the old ceiling is drawn, not flattened against it', async (t) => {
  /* `gappyPath` clamps to the chart's max, so the fixed 2 this used to carry drew every
     higher loss flat along the top -- and a YOLO class loss routinely starts above 2 when
     there are many classes. A flat line that is really a clamp cannot be told from a
     plateau, which is the worst way to be wrong about a loss curve. */
  const screen = await drawScreen('training.html', answers([
    epoch(1, { cls_loss: 4.2 }),
    epoch(2, { cls_loss: 2.6 }),
    epoch(3, { cls_loss: 1.3 }),
  ]));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const card = [...detail.querySelectorAll('.evaluation-card')]
    .find((one) => /^Loss$/.test(one.querySelector('h5')?.textContent.trim() || ''));

  /* 24 is the top of the plot box. Three distinct heights, not two of them pinned there. */
  const d = card.querySelector('.result-line.cls-loss').getAttribute('d');
  const ys = [...d.matchAll(/,(\d+\.\d)/g)].map((m) => Number(m[1]));

  assert.equal(new Set(ys).size, 3, `three different losses should draw at three heights (d="${d}")`);
  assert.equal(ys.filter((y) => y === 24).length, 1,
    'only the largest sits at the top of the axis');

  /* And the axis says what it is scaled to, rather than a literal 2.0. */
  assert.equal(card.querySelector('.result-axis text').textContent, '4.2');
});

test('the quality chart keeps a fixed axis, so two runs can be compared by eye', async (t) => {
  /* Precision, recall and mAP are 0 to 1 by definition. Scaling this one to its data
     would make a weak run look like a strong one. */
  const screen = await drawScreen('training.html', answers([
    epoch(1, { map50: 0.12 }),
    epoch(2, { map50: 0.19 }),
  ]));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const card = [...detail.querySelectorAll('.evaluation-card')]
    .find((one) => /Validation quality/.test(one.querySelector('h5')?.textContent || ''));

  assert.equal(card.querySelector('.result-axis text').textContent, '1.0',
    'a run topping out at 0.19 still draws against a full axis');
});

test('run 203 draws as the curve it is, dips and all', async (t) => {
  /* **Real values, not invented ones.** These are the eight mAP@50 the backfill recovered
     for run 203 from the event stream. Worth pinning with the real numbers because the
     shape is the awkward case: it falls at epoch 3, recovers, falls again at the end. A
     chart that only ever saw a smooth fixture could mishandle that and look fine. */
  const map50 = [0.479, 0.617, 0.470, 0.621, 0.541, 0.636, 0.679, 0.607];

  const screen = await drawScreen('training.html', answers(
    map50.map((value, index) => epoch(index + 1, {
      map50: value,
      /* Populated by the same backfill; train_* and duration_seconds were not. */
      box_loss: 1.6 - index * 0.05,
      duration_seconds: null,
    })),
  ));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const quality = [...detail.querySelectorAll('.evaluation-card')]
    .find((one) => /Validation quality/.test(one.querySelector('h5')?.textContent || ''));

  const d = quality.querySelector('.result-line.map').getAttribute('d');
  const ys = [...d.matchAll(/,(\d+\.\d)/g)].map((m) => Number(m[1]));

  assert.equal(ys.length, 8, 'eight epochs, eight points');
  assert.equal((d.match(/M/g) || []).length, 1, 'one unbroken line: every epoch reported one');

  /* The dip at epoch 3 has to be lower on the page than epochs 2 and 4 -- y grows
     downward, so a dip is a larger y. This is the assertion a smooth fixture cannot make. */
  assert.ok(ys[2] > ys[1] && ys[2] > ys[3], `epoch 3 should sit below its neighbours (${ys.join(', ')})`);
  assert.ok(ys[6] < ys[7], 'and the best epoch, 7, should be the highest point');

  /* The axis stays fixed, so 0.679 does not touch the top. */
  assert.equal(quality.querySelector('.result-axis text').textContent, '1.0');
  assert.ok(Math.min(...ys) > 24, 'nothing is pinned to the ceiling');
});

test('run 203 draws validation loss alone, with the train keys disabled', async (t) => {
  /* The other half of that chart, on the same real row shape: the backfill filled the
     validation three and could not fill the train three, because no existing event
     carries them. Absent, not zero -- and the legend says which. */
  const screen = await drawScreen('training.html', answers([
    epoch(1, { box_loss: 1.62, cls_loss: 2.41, dfl_loss: 1.11, duration_seconds: null }),
    epoch(2, { box_loss: 1.48, cls_loss: 2.02, dfl_loss: 1.04, duration_seconds: null }),
  ]));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const key = (text) => [...detail.querySelectorAll('.result-legend button')].find((b) => b.textContent === text);

  assert.ok(detail.querySelector('.result-line.box-loss').getAttribute('d'), 'validation box loss draws');
  assert.equal(detail.querySelector('.result-line.box-loss-train').getAttribute('d'), '', 'train does not');

  assert.ok(key('Box (train)').disabled, 'and its key cannot be pressed');
  assert.ok(!key('Box (val)').disabled, 'while the one with data can');

  /* Mean epoch time is in the same position: correct code, no data until 0.1.6. */
  const card = [...detail.querySelectorAll('.jobmetric')].find((m) => /Epoch time/.test(m.textContent));

  assert.ok(card.querySelector('.dash'), 'epoch time is a dash, not a zero');
});

test('a class MARP could not resolve is shown under the name the model used', async (t) => {
  /* `species_id` null with `class_name` set means the lookup found nothing -- not that
     the row is junk. Dropping it would hide a class the model is actively predicting. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    metrics: [
      { species_id: 775, class_name: 'Cookie star', metric_family: 'box', precision: 0.81, recall: 0.74, f1_score: 0.77, map50: 0.8, map5095: 0.5 },
      { species_id: null, class_name: 'Unknown urchin', metric_family: 'box', precision: 0.4, recall: 0.3, f1_score: 0.34, map50: 0.35, map5095: 0.2 },
      { species_id: null, class_name: null, metric_family: 'box', precision: 0.6, recall: 0.52, f1_score: 0.56, map50: 0.57, map5095: 0.35 },
    ],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const bodyRows = [...detail.querySelectorAll('.class-metrics tbody tr')];

  /* Worst AP first, so the unresolved class at .35 leads the resolved one at .80. */
  assert.deepEqual(bodyRows.map((r) => r.querySelector('th').textContent.replace(/\s+/g, ' ').trim()),
    ['Unknown urchin unmatched', 'Cookie star'],
    'both classes listed, the unresolved one marked rather than hidden');

  /* **The aggregate is not one of the classes.** Left in the list it reads as a species
     called nothing, and it is a different quantity from the rows above it. */
  const foot = detail.querySelector('.class-metrics tfoot tr');

  assert.ok(foot, 'the aggregate row is pulled out');
  /* **"Classes seen", not "all classes".** It is a mean over the classes that appeared in
     validation, not over the vocabulary -- a species the run never saw is absent from it,
     not a zero in it. */
  assert.match(foot.textContent, /Classes seen \(2\)/);
  assert.doesNotMatch(foot.textContent, /All classes/);
  assert.match(foot.textContent, /0\.570/, 'with its own numbers');
});

test('two metric families are two tables, so segmentation is not a rewrite', async (t) => {
  /* A segmentation run reports box and mask for the same class -- the same four metric
     names twice. Keyed on class alone, one would silently replace the other. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    metrics: [
      { species_id: 775, class_name: 'Cookie star', metric_family: 'box', precision: 0.81, recall: 0.74, f1_score: 0.77, map50: 0.8, map5095: 0.5 },
      { species_id: 775, class_name: 'Cookie star', metric_family: 'seg', precision: 0.72, recall: 0.66, f1_score: 0.69, map50: 0.71, map5095: 0.41 },
    ],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.equal(detail.querySelectorAll('.class-metrics').length, 2, 'one table per family');
  /* `seg` is Ultralytics' own name -- `SegmentMetrics.seg`. `(M)` is only the suffix on
     the metric keys, and guessing "mask" would have shown up on the first segmentation
     run and nowhere before it. */
  assert.deepEqual([...detail.querySelectorAll('.evaluation-card h6')].map((h) => h.textContent),
    ['Box', 'Segmentation'], 'each named, which only appears when there is more than one');
});

test('a CSV in the gallery is offered as a file, not drawn as a picture', async (t) => {
  /* `results` is Ultralytics' CSV of every metric it recorded. An <img> pointed at it is
     a broken image icon with a caption underneath. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    files: [
      { name: 'PR_curve', url: '/a/pr.png', content_type: 'image/png', bytes: 40000 },
      { name: 'results', url: '/a/results.csv', content_type: 'text/csv', bytes: 2048 },
    ],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.equal(detail.querySelectorAll('.result-plot img').length, 1, 'only the image is drawn');

  const file = detail.querySelector('.result-plot.is-file');

  assert.ok(file, 'the CSV gets a file tile');
  assert.ok(file.querySelector('a[download][href="/a/results.csv"]'), 'offered for download');
  assert.match(file.textContent, /spreadsheet/, 'and captioned as what it is');
  assert.match(file.textContent, /2 KB/);
});

test('the shared-threshold caveat sits where two classes get compared', async (t) => {
  /* Per-class precision, recall and F1 are all reported at one confidence threshold,
     chosen from the mean F1 across classes -- so a class whose own optimum is elsewhere
     reads below its peak. That is a caveat about comparing two rows, so it belongs on the
     card where the rows are, not in a tooltip somebody has to find. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    metrics: [
      { species_id: 1, class_name: 'A', metric_family: 'box', precision: 0.9, recall: 0.8, f1_score: 0.85, map50: 0.88, map5095: 0.6 },
      { species_id: 2, class_name: 'B', metric_family: 'box', precision: 0.4, recall: 0.9, f1_score: 0.56, map50: 0.5, map5095: 0.3 },
    ],
  }));

  t.after(screen.close);

  const card = [...(await open(screen, 21779)).querySelectorAll('.evaluation-card')]
    .find((one) => /Per-class quality/.test(one.querySelector('h5')?.textContent || ''));

  assert.match(card.querySelector('header p').textContent, /one shared confidence threshold/);
  assert.match(card.querySelector('header p').textContent, /below its peak/,
    'and says what that costs the reader, not just that it happens');
});

test('support and images sit before the scores they qualify', async (t) => {
  /* A precision of 1.000 over three instances and one over three thousand render
     identically without these, and on a survey whose point is the rare species that is
     the difference between a number somebody acts on and one that misleads them. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    metrics: [
      { species_id: 1, class_name: 'Cookie star', metric_family: 'box', support: 3, image_count: 2, precision: 1, recall: 1, f1_score: 1, map50: 1, map5095: 0.8 },
      { species_id: 2, class_name: 'Urchin', metric_family: 'box', support: 3412, image_count: 740, precision: 0.81, recall: 0.77, f1_score: 0.79, map50: 0.8, map5095: 0.5 },
      { species_id: 3, class_name: 'Sponge', metric_family: 'box', support: null, image_count: null, precision: 0.6, recall: 0.5, f1_score: 0.55, map50: 0.58, map5095: 0.3 },
      { species_id: null, class_name: null, metric_family: 'box', precision: 0.8, recall: 0.75, f1_score: 0.77, map50: 0.79, map5095: 0.53 },
    ],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const headers = [...detail.querySelectorAll('.class-metrics thead th')].map((h) => h.textContent);

  assert.deepEqual(headers, ['Class', 'Support', 'Images', 'Precision', 'Recall', 'F1', 'AP@50', 'AP@50–95'],
    'the size of the sample arrives before the claim about it');

  /* **Worst AP first**, which is what the table is asked: Sponge .58, Urchin .80,
     Cookie star 1.00. Looked up by name rather than by position, so the sort can change
     without this test quietly asserting the old one. */
  const byName = new Map([...detail.querySelectorAll('.class-metrics tbody tr')]
    .map((row) => [row.querySelector('th').textContent.trim(), row]));

  assert.equal(byName.get('Cookie star').children[1].textContent, '3');
  assert.equal(byName.get('Urchin').children[1].textContent, '3,412');

  /* Null means the trainer reported no count; 0 would mean it counted none. */
  assert.ok(byName.get('Sponge').children[1].querySelector('.dash'),
    'an absent count is a dash, not a zero');

  /* **Attribution rather than a warning.** A "low support" flag would need a cutoff, and
     any cutoff would be invented here. Each score says what it rests on instead. */
  assert.match(byName.get('Cookie star').children[3].getAttribute('title'), /over 3 labelled instances/,
    'the perfect score carries its sample size');
  assert.equal(byName.get('Sponge').children[3].getAttribute('title'), null,
    'and a class with no count claims nothing about one');

  /* The aggregate has neither, and summing would invent one -- images especially, where
     a frame holding three species would be counted three times. */
  const foot = detail.querySelector('.class-metrics tfoot tr');

  assert.ok(foot.children[1].querySelector('.dash') && foot.children[2].querySelector('.dash'),
    'the aggregate shows dashes rather than a sum nobody reported');
});

test('Updated follows the heartbeat when the job row itself is frozen', async (t) => {
  /* **The real shape of job 21782.** `gpu_jobs.updated_at` sat at the instant the job was
     created while the worker heartbeated every sixty seconds and progress advanced --
     nothing on the heartbeat path touches the job row. So the fixture freezes updated_at
     and moves only the heartbeat, which is what the server actually does. */
  const created = '2026-10-26T14:21:57.000Z';
  let heartbeat = '2026-10-26T14:47:13.000Z';

  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: [{
        ...job(21782, 'leased'),
        created_at: created,
        updated_at: created,
        last_heartbeat_at: heartbeat,
        progress_done: 5,
        progress_total: 10,
        progress_unit: 'epochs',
      }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const head = screen.document.querySelector('.training-table tbody tr[data-job="21782"]');
  const cell = head.querySelector('[data-updated]');

  assert.equal(cell.dataset.sort, heartbeat,
    'the later of the two, not the job row that has not moved since it was created');

  const detail = await open(screen, 21782);

  /* A minute later: still no progress, still no change to the job row, new heartbeat. */
  heartbeat = '2026-10-26T14:48:13.000Z';

  let cycle = null;
  const real = screen.window.setTimeout;

  screen.window.setTimeout = (fn, delay) => {
    if (delay === 5000 && !cycle) { cycle = fn; return 1; }
    return real(fn, delay);
  };

  screen.window.watchTrainingJobs();
  await cycle();

  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => real(resolve, 20));

  assert.equal(cell.dataset.sort, heartbeat, 'and the patch path follows it');
  assert.equal(head.querySelector('[data-updated]'), cell, 'same cell, not a rebuilt row');
  assert.equal(head.getAttribute('aria-expanded'), 'true', 'with the expansion still open');
});

test('a job with no heartbeat still shows its own timestamp', async (t) => {
  /* Queued jobs and every job on a MARP that does not yet serve the column. Reading the
     heartbeat defensively means this is unchanged rather than blank. */
  const stamp = '2026-10-26T14:21:57.000Z';

  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: [{ ...job(21783, 'queued'), created_at: stamp, updated_at: stamp }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const cell = screen.document.querySelector('.training-table tbody tr[data-job="21783"] [data-updated]');

  assert.equal(cell.dataset.sort, stamp);
  assert.ok(cell.textContent.trim(), 'and renders rather than going blank');
});

test('a heartbeat older than the job row does not drag Updated backwards', async (t) => {
  /* **Live job 21782 is this case**: updated_at 22:10:47, last_heartbeat_at 22:10:29.
     A finished or stalled attempt leaves a heartbeat behind the job's own timestamp, and
     taking the heartbeat unconditionally would walk the column backwards. */
  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: [{
        ...job(21782, 'succeeded'),
        updated_at: '2026-10-26T22:10:47.000Z',
        last_heartbeat_at: '2026-10-26T22:10:29.000Z',
      }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const cell = screen.document.querySelector('.training-table tbody tr[data-job="21782"] [data-updated]');

  assert.equal(cell.dataset.sort, '2026-10-26T22:10:47.000Z',
    'the later of the two, which here is the job row rather than the heartbeat');
});

test('a long generated name keeps its whole self on hover', async (t) => {
  /* The column is 188px, about thirty-two characters, and a generated name runs to the
     forties -- so every one truncates. The time leads so that the part telling three runs
     of one model over one dataset apart survives; the model name is what falls off. */
  const full = '15:44 · CookieStarTest · rockfish5-2026-10-20';

  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: [{ ...job(21779), name: full }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const cell = screen.document.querySelector('.training-table tbody tr[data-job="21779"] .jname');

  assert.equal(cell.getAttribute('title'), full,
    'the whole name is one hover away rather than only inside the row');
});

test('the heading counts the rows it drew, and says what they are out of', async (t) => {
  /* **The invariant that would have caught this.** The panel ranked by state and took
     three, so with eight jobs and three failures it drew the three failures and headed
     them "(8)". A table rendering fewer rows than it claims reads as missing data rather
     than as a summary -- and here it hid every run that worked, including the first with
     real train and validation losses. */
  const at = (h, m) => `2026-10-26T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
  const states = [
    ['succeeded', 15, 59], ['failed', 15, 14], ['succeeded', 15, 10],
    ['cancelled', 14, 30], ['failed', 14, 0], ['succeeded', 13, 0],
  ];

  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: states.map(([state, h, m], index) => ({
        ...job(21780 + index, state),
        created_at: at(h, m),
        updated_at: at(h, m),
      })),
      total: states.length,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const rows = [...screen.document.querySelectorAll('.training-table tbody tr.runrow-head')];
  const heading = screen.document.querySelector('.training-recent .panel-hd h2').textContent;

  assert.match(heading, /\(3 of 6\)/,
    'the heading says how many it drew and how many exist, rather than only the total');
  assert.equal(rows.length, 3, 'and that is how many rows there are');

  /* Newest first, because the panel is called Recent. Under the old state ranking these
     three would have been the two failures and a cancelled one. */
  assert.deepEqual(rows.map((r) => r.dataset.job), ['21780', '21781', '21782'],
    'the three most recent, whatever happened to them');

  /* The run that worked is visible, which is the whole complaint. */
  assert.ok(rows.some((r) => /Done|Succeeded/i.test(r.querySelector('.jstatus').textContent)),
    'a successful run is not hidden beneath the failures');
});

test('a panel showing everything does not say "of"', async (t) => {
  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({ jobs: [job(21779)], total: 1, limit: 500, offset: 0 }),
  });

  t.after(screen.close);

  const heading = screen.document.querySelector('.training-recent .panel-hd h2').textContent;

  assert.match(heading, /\(1\)/);
  assert.doesNotMatch(heading, /of/, 'nothing is truncated, so nothing claims to be');
});

/**
 * Run 205, exactly as the development database recorded it: ten epochs, both splits, the
 * first real paired-loss run MARP has.
 *
 * **It is here because it broke the chart and the numbers are what proves it fixed.**
 * `train_cls_loss` is 12.10 at epoch 1 and 0.65 at epoch 2 -- the optimizer before the
 * model has learned anything -- while every other value in the chart lives between 0.35
 * and 2.27. Scaled to the maximum, that one point put validation box loss on 3.4px of
 * travel and DFL loss on 0.5px.
 *
 * Columns in order: train box, box, train class, class, train DFL, DFL, mAP@50.
 */
const RUN_205 = [
  [2.01598, 1.56838, 12.10451, 1.99301, 1.07113, 0.83593, 0.47876],
  [1.33830, 1.57532, 0.65267, 1.66628, 0.81858, 0.83760, 0.61734],
  [1.26893, 1.47264, 0.58359, 2.16418, 0.81572, 0.82321, 0.46993],
  [1.13353, 1.42726, 0.53769, 1.63361, 0.80008, 0.82218, 0.62103],
  [1.11700, 1.44315, 0.49579, 2.12085, 0.79685, 0.82250, 0.54051],
  [1.04744, 1.44185, 0.46930, 1.90590, 0.78473, 0.81771, 0.63568],
  [0.98506, 1.36701, 0.43705, 1.51008, 0.78709, 0.81572, 0.67946],
  [0.91968, 1.41954, 0.40327, 1.99494, 0.77886, 0.81222, 0.60744],
  [0.86114, 1.30672, 0.37399, 1.89357, 0.77972, 0.80387, 0.66262],
  [0.80756, 1.30187, 0.35822, 2.26563, 0.76763, 0.80049, 0.60060],
].map((row, index) => epoch(index + 1, {
  train_box_loss: row[0],
  box_loss: row[1],
  train_cls_loss: row[2],
  cls_loss: row[3],
  train_dfl_loss: row[4],
  dfl_loss: row[5],
  map50: row[6],
}));

/** The Loss card out of an opened run panel. */
function lossCard(detail) {
  return [...detail.querySelectorAll('.evaluation-card')]
    .find((one) => /^Loss$/.test(one.querySelector('h5')?.textContent.trim() || ''));
}

/** Every point of a drawn line, as `{x, y}` in viewBox units. */
function points(card, key) {
  const d = card.querySelector(`.result-line.${key}`)?.getAttribute('d') || '';

  return [...d.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

test('a warm-up first epoch does not set the scale for the whole run', async (t) => {
  const screen = await drawScreen('training.html', answers(RUN_205));

  t.after(screen.close);

  const card = lossCard(await open(screen, 21779));

  /* 2.3 is the highest loss any epoch after the first reached. 12.2 was the old answer,
     and it is the single number this whole change is about. */
  assert.equal(card.querySelector('.result-axis text').textContent, '2.3',
    'the axis follows the settled losses, not the warm-up');
});

test('every loss series uses the chart it is drawn in', async (t) => {
  /* **The failure stated as a measurement.** Scaled to 12.2 the six series lived in the
     bottom 16% of a 150px box -- six flat lines, on the chart whose caption says the gap
     between a pair is the overfitting signal. Epoch 1 is excluded here because it is the
     point that is deliberately off the top; what is asserted is that everything else
     spreads out. */
  const screen = await drawScreen('training.html', answers(RUN_205));

  t.after(screen.close);

  const card = lossCard(await open(screen, 21779));
  const keys = ['box-loss-train', 'box-loss', 'cls-loss-train', 'cls-loss', 'dfl-loss-train', 'dfl-loss'];
  const settled = keys.flatMap((key) => points(card, key)).filter((p) => p.x > 46);
  const ys = settled.map((p) => p.y);
  const spread = Math.max(...ys) - Math.min(...ys);

  assert.ok(spread > 90,
    `the settled losses should use most of the 150px box, not ${spread.toFixed(1)}px of it`);
});

test('the gap between a train and validation pair is readable', async (t) => {
  /* This is the thing the chart exists to show. At the old scale box train and box
     validation finished 6.1px apart on a 150px axis, for a validation loss 1.6x the
     training one. */
  const screen = await drawScreen('training.html', answers(RUN_205));

  t.after(screen.close);

  const card = lossCard(await open(screen, 21779));
  const train = points(card, 'box-loss-train').at(-1);
  const val = points(card, 'box-loss').at(-1);
  const gap = Math.abs(train.y - val.y);

  assert.ok(gap > 20, `the final pair should be separable, not ${gap.toFixed(1)}px apart`);
});

test('the clipped epoch is marked as a break and names its real value', async (t) => {
  const screen = await drawScreen('training.html', answers(RUN_205));

  t.after(screen.close);

  const card = lossCard(await open(screen, 21779));
  const mark = card.querySelector('.result-break.cls-loss-train');

  assert.ok(mark, 'the series that went off the top is marked where it did');
  assert.equal(mark.querySelector('text').textContent, '12.10',
    'and the measurement is on the chart, not only in a note');
  assert.ok(mark.querySelector('.break-mark'),
    'with the broken-axis mark, so it cannot read as a point at the ceiling');

  /* **The part that would otherwise be a lie.** A clamped first epoch draws a vertex at
     the top of the axis that cannot be told from a measurement taken there -- which is
     the failure this avoids, not a smaller version of it. x=46 is epoch 1. */
  const first = points(card, 'cls-loss-train')[0];

  assert.ok(first.x > 46, 'the line starts at epoch 2, not pinned to the ceiling');
  assert.ok(card.querySelector('.result-stub.cls-loss-train'),
    'and a stub shows it coming down from above');

  assert.match(card.querySelector('p').textContent, /12\.10/,
    'the note says why the axis is where it is');
});

test('a loss that merely starts high keeps every point on the chart', async (t) => {
  /* The guard on the other side: a healthy curve starts at its maximum and falls, and
     clipping that would throw away a real measurement to tidy the axis. 4.2 is within
     twice the 2.6 the run settles at, so nothing is cut. */
  const screen = await drawScreen('training.html', answers([
    epoch(1, { cls_loss: 4.2 }),
    epoch(2, { cls_loss: 2.6 }),
    epoch(3, { cls_loss: 2.4 }),
  ]));

  t.after(screen.close);

  const card = lossCard(await open(screen, 21779));

  assert.equal(card.querySelector('.result-axis text').textContent, '4.2',
    'the axis still fits the highest point');
  assert.equal(card.querySelectorAll('.result-break').length, 0, 'nothing is marked as cut');
  assert.equal(points(card, 'cls-loss')[0].x, 46, 'and epoch 1 is still drawn');
});

/** The Best mAP cell of a row. */
const mapCell = (screen, id) => screen.document
  .querySelector(`.training-table tbody tr[data-job="${id}"] .jmap`);

/** A one-job table, so each case stands alone. */
const onlyJob = (one) => ({
  ...answers([], []),
  listJobs: async () => ({ jobs: [one], total: 1, limit: 500, offset: 0 }),
});

test('Best mAP shows the number the job list carries', async (t) => {
  const screen = await drawScreen('training.html',
    onlyJob({ ...job(21785), best_map50: 0.67946 }));

  t.after(screen.close);

  const cell = mapCell(screen, 21785);

  assert.equal(cell.textContent.trim(), '0.679');
  assert.equal(cell.dataset.sort, '0.67946', 'and sorts on the value, not the rendered text');
});

test('a training job that reached no epoch says so, and sorts below the ones that did', async (t) => {
  /* null is an answer about this job: it ran and produced no epoch. Job 21784 queued and
     never started, which is exactly this. */
  const screen = await drawScreen('training.html',
    onlyJob({ ...job(21784, 'queued'), best_map50: null }));

  t.after(screen.close);

  const cell = mapCell(screen, 21784);

  assert.equal(cell.textContent.trim(), '—');
  assert.equal(cell.dataset.sort, '-1', 'unmeasured sorts below every real mAP');
});

test('a response that does not carry best_map50 is not read as "no mAP"', async (t) => {
  /* **Absent is not null, and this is the fourth time today that distinction mattered.**
     `GET /gpu/jobs` unfiltered omits the field deliberately -- deriving it costs 22ms a
     page for thousands of inference jobs that have no epochs. An older API omits it too.
     Neither is a statement that this job has no mAP, so the cell must not make one. */
  const { best_map50: _unused, ...withoutTheField } = { ...job(21785), best_map50: 0.5 };

  const screen = await drawScreen('training.html', {
    ...onlyJob(withoutTheField),
    listTrainingRuns: async () => [run(202, 21785)],
  });

  t.after(screen.close);

  const cell = mapCell(screen, 21785);
  const title = cell.querySelector('[title]').getAttribute('title');

  assert.equal(cell.textContent.trim(), '—');
  assert.match(title, /open the row/i,
    'it points at where the number is, rather than claiming there is none');
  assert.doesNotMatch(title, /no epoch|no mAP/i,
    'a response that was never asked for the field answers nothing about the job');
});

test('a best mAP of zero is a measurement, not a missing value', async (t) => {
  /* The `||` trap in one test. A model that found nothing scored 0.000, and that is a
     result somebody needs to see rather than a dash that reads as not yet run. */
  const screen = await drawScreen('training.html',
    onlyJob({ ...job(21785), best_map50: 0 }));

  t.after(screen.close);

  assert.equal(mapCell(screen, 21785).textContent.trim(), '0.000');
});

test('Best mAP follows a running job, in place, including the poll that finishes it', async (t) => {
  /* **Patched before the terminal check**, like Updated. The poll that marks a job done
     is the one carrying its final mAP, so patching after the check would leave every
     finished run showing the second-to-last number it had. */
  let state = 'leased';
  let best = 0.41;

  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async () => ({
      jobs: [{ ...job(21782, state), best_map50: best }],
      total: 1,
      limit: 500,
      offset: 0,
    }),
  });

  t.after(screen.close);

  const cell = mapCell(screen, 21782);

  assert.equal(cell.textContent.trim(), '0.410');

  state = 'succeeded';
  best = 0.67946;

  let cycle = null;
  const real = screen.window.setTimeout;

  screen.window.setTimeout = (fn, delay) => {
    if (delay === 5000 && !cycle) { cycle = fn; return 1; }
    return real(fn, delay);
  };

  screen.window.watchTrainingJobs();
  await cycle();

  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => real(resolve, 20));

  assert.equal(cell.textContent.trim(), '0.679', 'the finishing poll brings the final value');
  assert.equal(mapCell(screen, 21782), cell, 'same cell, not a rebuilt row');
});

test('the Training screen asks for training jobs, on the first read and on every poll', async (t) => {
  /* **The defect this pins is invisible in the table and lives in the query string.**
     `best_map50` is a lateral the API computes only when the list is filtered to
     training -- unfiltered it omits the field entirely rather than selecting NULL, so
     thousands of inference jobs do not pay 22ms a page for a column they have no row in.
     The first read asked for everything, so the field came back absent and every Best mAP
     cell took the absent branch, while the five-second poll asked correctly and the same
     table was therefore filled from two different response shapes.

     `renderTraining` discards every job that is not training in any case, so this also
     stops fetching 500 rows to keep eight. */
  const asked = [];

  const screen = await drawScreen('training.html', {
    ...answers([], []),
    listJobs: async (query) => {
      asked.push(query);
      return { jobs: [job(21782, 'leased')], total: 1, limit: 500, offset: 0 };
    },
  });

  t.after(screen.close);

  /* The header's three live counters read the job list too, deliberately unfiltered or
     filtered to another kind. The table's own read is the paged one. */
  const forTheTable = () => asked.filter((query) => query.limit === 500);

  assert.equal(forTheTable().length, 1, 'one table read on load');
  assert.equal(forTheTable()[0].kind, 'training', 'filtered, or the API omits best_map50');

  let cycle = null;
  const real = screen.window.setTimeout;

  screen.window.setTimeout = (fn, delay) => {
    if (delay === 5000 && !cycle) { cycle = fn; return 1; }
    return real(fn, delay);
  };

  screen.window.watchTrainingJobs();
  await cycle();

  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => real(resolve, 20));

  assert.ok(forTheTable().length > 1, 'the poll reads too');
  assert.ok(forTheTable().every((query) => query.kind === 'training'),
    `every table read is filtered, so the rows are filled from one response shape (${
      forTheTable().map((query) => query.kind || 'unfiltered').join(', ')})`);
});

/* ------------------------------------------------- the Training runs panel */

/** The runs panel's rows, excluding the expansion rows between them. */
const runRows = (screen) => [...screen.document.querySelectorAll('#runs tbody > tr.runrow-head')];

/** A screen with a set of jobs and the runs they produced. */
const withRuns = (jobs, runs) => ({
  ...answers([], runs),
  listJobs: async () => ({ jobs, total: jobs.length, limit: 500, offset: 0 }),
});

/** A job carrying the progress its attempt reported. */
const ran = (id, state, done, total) => ({
  ...job(id, state),
  progress_done: done,
  progress_total: total,
  progress_unit: 'epochs',
});

test('the Training runs panel draws a row per run, newest first', async (t) => {
  /* It was a fixture: an empty tbody under a footer hardcoded to "Showing 1-6 of 28
     runs" and three dead pager buttons. Isaac asked twice about things on screen that
     were not real, and this was one of them. */
  const screen = await drawScreen('training.html', withRuns(
    [ran(21782, 'succeeded', 10, 10), ran(21785, 'succeeded', 10, 10)],
    [
      run(204, 21782, { start_time: '2026-10-26T21:28:49.093Z', end_time: '2026-10-26T22:10:47.017Z', total_epochs: 10 }),
      run(205, 21785, { start_time: '2026-10-26T22:44:14.986Z', end_time: '2026-10-26T23:06:08.498Z', total_epochs: 10 }),
    ],
  ));

  t.after(screen.close);

  const rows = runRows(screen);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.run, '205', 'newest first');
  assert.equal(rows[1].dataset.run, '204');

  const footer = screen.document.querySelector('#runs').closest('.panel').querySelector('.panel-ft > span');

  assert.match(footer.textContent, /Showing 1.2 of 2 runs/,
    'the footer counts what was drawn, rather than claiming 28');
  assert.doesNotMatch(footer.textContent, /28/);
});

test('Epochs come from what the run reported, not from what it was configured for', async (t) => {
  /* **A cancelled run is where the two part company.** `total_epochs` is the
     configuration -- run 203 was set up for 10 and stopped at 8 -- and `progress_done`
     persists after the job ends and matches the epoch rows exactly. Reading
     total_epochs would print "10" for a run that did eight, which is a guess that is
     right most of the time and silently wrong on every cancellation. */
  const screen = await drawScreen('training.html', withRuns(
    [ran(21780, 'cancelled', 8, 10)],
    [run(203, 21780, { total_epochs: 10, end_time: null })],
  ));

  t.after(screen.close);

  const cell = runRows(screen)[0].querySelector('.jepochs');

  assert.equal(cell.textContent.trim(), '8 / 10');
  assert.equal(cell.dataset.sort, '8', 'and sorts on what was done');
});

test('a run with no end time borrows its job wall clock and says it did', async (t) => {
  /* Run 203 again: cancelled, so it has a start and never recorded an end. A dash would
     lose a duration MARP does know; printing it unmarked would claim the run timed
     itself. */
  const screen = await drawScreen('training.html', withRuns(
    [{ ...ran(21780, 'cancelled', 8, 10), created_at: '2026-10-23T19:52:20.446Z', updated_at: '2026-10-23T20:30:20.446Z' }],
    [run(203, 21780, { start_time: '2026-10-23T19:52:20.446Z', end_time: null })],
  ));

  t.after(screen.close);

  const took = runRows(screen)[0].querySelector('.jtook span');

  assert.match(took.getAttribute('title'), /no end time/i, 'the cell says whose clock it is');
  assert.ok(took.textContent.trim(), 'and still shows the duration rather than a dash');
});

test('the search box and the status filter narrow the runs, and the count follows', async (t) => {
  const screen = await drawScreen('training.html', withRuns(
    [ran(21782, 'succeeded', 10, 10), ran(21780, 'cancelled', 8, 10)],
    [run(204, 21782), run(203, 21780)],
  ));

  t.after(screen.close);

  assert.equal(runRows(screen).length, 2);

  const panel = screen.document.querySelector('#runs').closest('.panel');
  const select = panel.querySelector('.sel');

  /* **Cancelled is selectable at all**, which it was not: the markup offered
     All / Running / Completed / Failed, so a cancelled run could be seen and not
     filtered to. */
  select.value = 'cancelled';
  select.dispatchEvent(new screen.window.Event('change'));

  assert.equal(runRows(screen).length, 1, 'only the cancelled run');
  assert.equal(runRows(screen)[0].dataset.run, '203');
  assert.match(panel.querySelector('.panel-hd .count').textContent, /\(1\)/,
    'the heading counts the filtered list');

  select.value = 'all';
  select.dispatchEvent(new screen.window.Event('change'));

  const box = panel.querySelector('.search input');

  box.value = 'run 204';
  box.dispatchEvent(new screen.window.Event('input'));

  assert.equal(runRows(screen).length, 1, 'the search narrows too');
  assert.equal(runRows(screen)[0].dataset.run, '204');
});

test('a run outside the recent three still opens', async (t) => {
  /* **The map used to hold only the three rows drawn above.** Both tables' expansions
     are the same `wireTrainingJobDetail`, which looks a job up in it -- so the fourth
     run down this panel would have expanded to nothing at all. */
  const jobs = [21779, 21780, 21782, 21785].map((id, index) => ({
    ...ran(id, 'succeeded', 1, 1),
    created_at: `2026-10-2${index + 1}T09:00:00.000Z`,
  }));

  const screen = await drawScreen('training.html', {
    ...withRuns(jobs, jobs.map((one, index) => run(200 + index, one.id))),
    trainingRunEpochs: async () => [epoch(1, { box_loss: 1.4 })],
  });

  t.after(screen.close);

  assert.equal(runRows(screen).length, 4);
  assert.equal(screen.document.querySelectorAll('.training-table tbody tr[data-job]').length, 3,
    'the panel above still shows three');

  /* The oldest, which is the one the recent table cuts. */
  const oldest = runRows(screen).at(-1);

  oldest.querySelector('.exbtn').click();

  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  const detail = oldest.nextElementSibling;

  assert.doesNotMatch(detail.textContent, /Reading this run/,
    'it resolved rather than sitting on its placeholder');
  assert.ok(detail.querySelector('.result-line'), 'and drew the run&rsquo;s curves');
});

/* ------------------------------------------- what a finished run produced */

/** A per-threshold series for one class, as `/curves` groups them. */
const curve = (name, at) => ({
  dataset_split: 'val',
  metric_family: 'box',
  class_name: name,
  species_id: 1,
  confidence: [0, 0.25, 0.5, 0.75, 1],
  precision: at.map((v) => v),
  recall: at.map((v) => 1 - v),
  f1_score: at.map((v) => v * 0.9),
});

test('the evaluation comes from the end-of-run reads, not from the run row', async (t) => {
  /* **The defect this pins is a missing request, not missing data.** The panel read
     `run.confusion_matrix`, `run.class_metrics` and `run.plots`, which
     `GET /training_run/:id` has never carried, so all three sections drew their empty
     state for ever over a gap that looked like the API not having the numbers. */
  const asked = [];

  const screen = await drawScreen('training.html', {
    ...answers([epoch(1)], [run(202, 21779)]),
    trainingRunMetrics: async (id) => {
      asked.push(`metrics:${id}`);
      return {
        metrics: [{ species_id: 1, class_name: 'Cookie star', metric_family: 'box', precision: 0.8, recall: 0.7, f1_score: 0.75, map50: 0.79, map5095: 0.5 }],
        confusion_matrices: [],
      };
    },
    trainingRunArtifacts: async (id) => {
      asked.push(`artifacts:${id}`);
      return [{ name: 'PR_curve', url: '/a/pr.png', content_type: 'image/png' }];
    },
  });

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.deepEqual(asked, ['metrics:202', 'artifacts:202'], 'both reads, against the run id');
  assert.ok(detail.querySelector('.class-metrics'), 'the per-class table drew from /metrics');
  assert.ok(detail.querySelector('.plot-gallery img'), 'and the gallery from /artifacts');
});

test('the confusion matrix names its axes in words and can be read as counts', async (t) => {
  /* **True and Predicted is the one thing a reader must have right.** A matrix read the
     wrong way round is entirely plausible and asserts the reverse of what happened, and
     a sentence in the card header is not where somebody checks. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    matrices: [{
      dataset_split: 'val',
      labels: ['Cookie star', 'Urchin', 'background'],
      rows: [[8, 1, 1], [0, 9, 1], [2, 0, 8]],
      orientation: 'rows_true_cols_predicted',
      background_index: 2,
    }],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.equal(detail.querySelector('.matrix-frame .axis-y').textContent, 'True class');
  assert.equal(detail.querySelector('.matrix-frame .axis-x').textContent, 'Predicted class');

  /* The background row is kept and labelled rather than trimmed: from the model's point
     of view it is a real outcome and the row sums mean nothing without it. */
  const labels = [...detail.querySelectorAll('.confusion > b')].map((b) => b.textContent);

  assert.ok(labels.includes('background'), 'the background row is labelled, not dropped');

  /* A share of 100% over two instances and over two thousand look identical, which is
     why both readings are offered rather than one. */
  const first = detail.querySelector('.confusion i');

  assert.equal(first.textContent, '80%', 'normalised by default');

  detail.querySelector('[data-matrix-mode="count"]').click();

  assert.equal(first.textContent, '8', 'and the counts are one press away');
  assert.equal(detail.querySelector('[data-matrix-mode="norm"]').getAttribute('aria-pressed'), 'false');
});

test('per-class quality leads with the worst class, and shows the AP as a bar', async (t) => {
  /* Nobody scans a species list alphabetically to find what the model is bad at. The
     sorted bar is the form the field uses for exactly that question. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    metrics: [
      { species_id: 1, class_name: 'Good', metric_family: 'box', precision: 0.9, recall: 0.9, f1_score: 0.9, map50: 0.91, map5095: 0.7 },
      { species_id: 2, class_name: 'Bad', metric_family: 'box', precision: 0.2, recall: 0.2, f1_score: 0.2, map50: 0.19, map5095: 0.1 },
      { species_id: 3, class_name: 'Unmeasured', metric_family: 'box', precision: null, recall: null, f1_score: null, map50: null, map5095: null },
    ],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const names = [...detail.querySelectorAll('.class-metrics tbody th')].map((th) => th.textContent.trim());

  /* **Unmeasured sorts last, not first.** Never measured is not the same as measured
     badly, and putting it at the top would answer the question wrongly. */
  assert.deepEqual(names, ['Bad', 'Good', 'Unmeasured']);

  const bar = detail.querySelector('.class-metrics tbody tr .apbar');

  assert.equal(bar.style.getPropertyValue('--v'), '0.190', 'the bar is the AP it sits behind');
});

test('the threshold curves are read on asking, once, and drawn per class with a mean', async (t) => {
  /* About a thousand points per class, which is why the API serves them separately and
     why a panel polling every five seconds must not pull them again. */
  let reads = 0;

  const screen = await drawScreen('training.html', {
    ...answers([epoch(1)], [run(202, 21779)]),
    trainingRunCurves: async () => {
      reads += 1;
      return [curve('Cookie star', [0.2, 0.4, 0.6, 0.8, 1]), curve('Urchin', [0.1, 0.2, 0.3, 0.4, 0.5])];
    },
  });

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.equal(reads, 0, 'nothing is fetched until it is asked for');

  detail.querySelector('[data-read-curves]').click();

  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  const panel = screen.document.querySelector('.training-table tbody tr[data-job="21779"]').nextElementSibling;
  const heads = [...panel.querySelectorAll('.curve-card h5')].map((h) => h.textContent.trim());

  assert.deepEqual(heads, ['Precision–recall', 'F1 against confidence',
    'Precision against confidence', 'Recall against confidence'],
    'the four YOLO draws, by the names it draws them under');

  const pr = panel.querySelector('.curve-card');

  assert.equal(pr.querySelectorAll('.curve-class').length, 2, 'one thin line per class');
  assert.ok(pr.querySelector('.curve-mean').getAttribute('d'), 'and the bold mean over them');

  assert.equal(reads, 1, 'read once');

  /* A redraw must not re-read: the numbers cannot change once a run has evaluated. */
  await panel.redraw();

  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(reads, 1, 'and kept, rather than fetched again on every poll');
});

test('a matrix label MARP does not have is named the same way on both axes', async (t) => {
  /* `confusionForReading` serves null where the stored vocabulary was shorter than the
     matrix. The rows called that `Class 2` and the columns left the header blank -- one
     axis labelled two ways, which reads as the column having no name rather than as MARP
     not knowing it. */
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779)], {
    matrices: [{
      dataset_split: 'val',
      labels: ['Cookie star', null, 'background'],
      rows: [[8, 1, 1], [0, 9, 1], [2, 0, 8]],
      orientation: 'rows_true_cols_predicted',
      background_index: 2,
    }],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const headers = [...detail.querySelectorAll('.confusion > b')].map((b) => b.textContent);

  assert.equal(headers.filter((text) => text === 'Class 1').length, 2,
    'the unnamed class is Class 1 on the row and on the column, not blank on one of them');
});

/* ------------------------------------------------------- the classify task */

/**
 * A classification run: the model's `model_type` is what decides the task.
 *
 * **The per-epoch half is an assumption and is marked as one.** The worker session is
 * scoping Ultralytics' classify trainer and the literal metric keys are not confirmed,
 * so nothing here feeds epoch columns for classify — `epochs` has no accuracy columns
 * and its loss pairs are named for a detector's components. The end-of-run accuracy is
 * real: `accuracy_top1` and `accuracy_top5` are on `metrics_summary` as of
 * `20261027120000-a-classification-run-records-its-accuracy`.
 */
const classifyScreen = (evidence = {}) => ({
  ...answers([epoch(1)], [run(202, 21779)], evidence),
  listModels: async () => [{
    id: 7, name: 'habitat-cls', model_type: 'classification', status: 'trained',
    parent_model_id: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  }],
});

test('a classification run shows no section that does not apply to it', async (t) => {
  /* **The part of the panel that was a rewrite rather than a list.** The four evaluation
     sections were concatenated unconditionally, so a classify run drew "this run recorded
     no per-class precision, recall or AP" and a control offering to read threshold
     curves. `ClassifyMetrics` has no per-class array and no thresholds at all, so both
     read as a run that failed to measure something rather than as a task with no such
     measurement. */
  const screen = await drawScreen('training.html', classifyScreen());

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const heads = [...detail.querySelectorAll('.evaluation-card h5')].map((h) => h.textContent.trim());

  assert.deepEqual(heads, ['Confusion matrix', 'Training output'],
    'the matrix and the gallery, and nothing that classification does not report');
  assert.equal(detail.querySelector('[data-read-curves]'), null,
    'no offer to read curves that cannot exist');
  assert.doesNotMatch(detail.textContent, /per-class/i,
    'and no empty per-class section to read as a failure');
});

test('a classification run is headlined by its own metric, not by mAP', async (t) => {
  const screen = await drawScreen('training.html', classifyScreen({
    metrics: [{
      metric_family: 'classify', class_name: null, species_id: null,
      precision: null, recall: null, map50: null, map5095: null, f1_score: null,
      accuracy_top1: 0.864, accuracy_top5: 0.981,
    }],
  }));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const labels = [...detail.querySelectorAll('.jobmetric span')].map((s) => s.textContent);

  assert.ok(labels.includes('Top-1 accuracy'), 'the metric the task actually reports');
  assert.ok(!labels.includes('Best mAP@50'), 'and not one it has no measure of');

  const figure = [...detail.querySelectorAll('.jobmetric')]
    .find((one) => one.querySelector('span').textContent === 'Top-1 accuracy');

  /* End of run rather than best-so-far: top-1 is a single figure on the aggregate row,
     where mAP is the best across the epochs as they arrive. */
  assert.equal(figure.querySelector('b').textContent, '0.864');
  assert.match(figure.textContent, /at the end of the run/);
});

test('Best mAP on a classification row says it is not that task, not that no epoch ran', async (t) => {
  /* **The one that would have reached Isaac as a wrong sentence rather than a blank.**
     `best_map50` is max(map50) over the epochs, so a classify run comes back present and
     null -- identical to a detection run that reached no epoch. Without the task the cell
     cannot tell those apart, and it was saying a finished classifier "has reported no
     epoch yet". */
  const screen = await drawScreen('training.html', {
    ...classifyScreen(),
    listJobs: async () => ({
      jobs: [{ ...job(21779), best_map50: null }],
      total: 1, limit: 500, offset: 0,
    }),
  });

  t.after(screen.close);

  const cell = screen.document.querySelector('.training-table tbody tr[data-job="21779"] .jmap');
  const title = cell.querySelector('[title]').getAttribute('title');

  assert.match(title, /classification run has no mAP/i, 'the null is about the task');
  assert.doesNotMatch(title, /no epoch/i, 'and not a claim that nothing ran');
  assert.match(title, /top-1 accuracy/i, 'with what it does report instead');
});

test('detection keeps every section and its own headline', async (t) => {
  /* The other half of the same change: making sections task-declared must not quietly
     drop one from the task that has them all. */
  const screen = await drawScreen('training.html', answers([epoch(1)]));

  t.after(screen.close);

  const detail = await open(screen, 21779);
  const heads = [...detail.querySelectorAll('.evaluation-card h5')].map((h) => h.textContent.trim());

  assert.deepEqual(heads,
    ['Loss', 'Validation quality', 'Confusion matrix', 'Per-class quality', 'Threshold curves', 'Training output']);
  assert.ok([...detail.querySelectorAll('.jobmetric span')].map((s) => s.textContent)
    .includes('Best mAP@50'));
});
