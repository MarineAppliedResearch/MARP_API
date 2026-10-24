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

  assert.deepEqual(heads, ['Loss', 'Validation quality', 'Confusion matrix', 'Per-class quality', 'Training output'],
    'every section has a place, whether or not anything fills it yet');

  /* An empty frame reads as broken. Each of these names the missing piece instead. */
  assert.match(detail.textContent, /Nothing records one yet/, 'the matrix says why it is absent');
  assert.match(detail.textContent, /Nothing writes .*metrics_summary.* yet/, 'and so does per-class');
  assert.match(detail.textContent, /once the worker uploads them/, 'and the gallery names who it waits on');

  /* This asserted the opposite until `ea964f18`: the worker sent only `val/*`, so the
     chart said the train split was not recorded. The columns exist now and the chart
     draws both, which is what makes the overfitting gap readable. */
  assert.match(detail.textContent, /solid is train, dashed is validation/);
});

test('a matrix MARP carries as numbers is drawn, not shown as a picture', async (t) => {
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779, {
    confusion_matrix: { labels: ['Cookie star', 'Urchin', 'Background'], rows: [[8, 1, 1], [0, 9, 1], [2, 0, 8]] },
  })]));

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
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779, {
    confusion_matrix_url: '/api/v2/artifact/abc/confusion_matrix.png',
  })]));

  t.after(screen.close);

  const detail = await open(screen, 21779);

  assert.equal(detail.querySelector('.confusion'), null, 'no grid, because there are no numbers');
  assert.ok(detail.querySelector('.result-plot img[src$="confusion_matrix.png"]'), 'the render is shown');
  assert.match(detail.textContent, /MARP does not carry the counts/,
    'and says so, rather than passing a picture off as a reading');
});

test('the trainer plots are captioned by what they are, not by filename', async (t) => {
  const screen = await drawScreen('training.html', answers([epoch(1)], [run(202, 21779, {
    plots: [
      { name: 'PR_curve.png', url: '/a/pr.png' },
      { name: 'val_batch0_pred.jpg', url: '/a/vb.jpg' },
      { name: 'something_new.png', url: '/a/new.png' },
    ],
  })]));

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

  assert.match(detail.textContent, /charts a classification run should show are not described yet/,
    'and the panel says so rather than drawing detection-shaped charts for it');
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
