/**
 * The activity charts the Inference, Models and Datasets screens share, drawn by ECharts.
 *
 * They were one hand-drawn SVG three times over, with every point spaced evenly along the
 * bottom whatever its time (#275). These pin what the move to ECharts must keep: each
 * point at its own bucket time, each series on the axis it is measured on, an area where
 * the panel drew an area, and a series the data has nothing for left undrawn.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** The chart in a panel, and one of its series by id. */
const chartIn = (root) => root.querySelector('[data-chart]');
const seriesIn = (root, id) => chartIn(root)?.marpOption.series.find((one) => one.id === id) || null;

const AT = ['2026-10-28T10:00:00.000Z', '2026-10-28T11:00:00.000Z', '2026-10-28T13:00:00.000Z'];

test('Datasets activity draws frames and builds on their own axes, at their own times', async (t) => {
  const screen = await drawScreen('datasets.html', {
    listDatasets: async () => [],
    throughputSeries: async () => ({ points: [{ at: AT[0], units_done: 1200 }, { at: AT[2], units_done: 300 }] }),
    jobSeries: async () => ({
      points: AT.map((at, index) => ({ at, waiting: [2, 1, 0][index], succeeded: [0, 1, 1][index] })),
    }),
  });

  t.after(screen.close);

  const root = screen.document.querySelector('[data-dataset-activity]');

  assert.ok(chartIn(root)?.marpChart, 'drawn by ECharts');
  assert.equal(root.querySelector('svg:not([data-chart] svg)'), null, 'and the hand-drawn SVG is gone');

  const rate = seriesIn(root, 'rate');

  assert.deepEqual(rate.data.map((point) => point[0]), AT.map((at) => Date.parse(at)),
    'each point at its bucket time: the gap between 11:00 and 13:00 is two hours wide, not one');
  assert.deepEqual(rate.data.map((point) => point[1]), [1200, 0, 300]);
  assert.ok(rate.areaStyle, 'frames extracted is an area, as the panel drew it');
  assert.equal(rate.yAxisIndex, 0, 'on the frames axis');
  assert.equal(seriesIn(root, 'waiting').yAxisIndex, 1, 'builds waiting on the builds axis');
  assert.equal(seriesIn(root, 'finished').yAxisIndex, 1, 'and builds completed with them');
  assert.equal(chartIn(root).marpOption.yAxis.length, 2, 'two axes, so a thousand frames do not flatten two builds');
});

test('Inference throughput draws what was processed, and nothing it has no series for', async (t) => {
  const screen = await drawScreen('inference.html', {
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    throughputSeries: async () => ({
      points: [{ at: AT[0], units_done: 7500, unit: 'frames' }, { at: AT[1], units_done: 15000, unit: 'frames' }],
      queued: { units: 30000, jobs: 4 },
    }),
  });

  t.after(screen.close);

  const root = screen.document.querySelector('[data-inference-activity]');

  assert.deepEqual(seriesIn(root, 'throughput').data.map((point) => point[1]), [7500, 15000]);
  assert.equal(seriesIn(root, 'throughput').name, 'Processing throughput', 'named as the key names it');
  assert.equal(seriesIn(root, 'backlog'), null,
    'the backlog is a current figure, never recorded per bucket, so it draws no line');
});

test('a worker that was switched off is a gap in its readings, not a ramp across the evening', async (t) => {
  /* On a time axis, readings either side of hours the machine was off would be joined by
     a straight line -- a slow, measured-looking climb nobody measured. */
  const at = ['2026-10-27T18:00:00.000Z', '2026-10-27T18:01:00.000Z', '2026-10-27T18:02:00.000Z',
    '2026-10-27T22:00:00.000Z', '2026-10-27T22:01:00.000Z'];
  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [{
      worker_id: 11, name: 'rig-03', state: 'online', activity: 'idle', slot_count: 1, worker_version: '0.1.9',
      capabilities: { slots: 1 }, enrolled_at: '2026-10-01T00:00:00.000Z', last_seen_at: new Date().toISOString(), attempts: [],
    }],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    workerSeries: async () => ({ at, gpu: [10, 12, 11, 60, 62], vram: [], temperature: [], power: [], cpu: [], memory: [], disk: [] }),
  });

  t.after(screen.close);

  const head = screen.document.querySelector('table#workers tbody tr[data-worker="11"]');
  head.querySelector('.exbtn').click();
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

  const gpu = [...head.nextElementSibling.querySelectorAll('.evaluation-card')]
    .find((card) => card.querySelector('h5').textContent.trim() === 'GPU utilisation');
  const data = gpu.querySelector('[data-chart]').marpOption.series[0].data;

  assert.equal(data.length, 6, 'the five readings and one break');
  assert.equal(data[3][1], null, 'a null between 18:02 and 22:00, where the machine was off');
  assert.deepEqual(data.filter((point) => point[1] !== null).map((point) => point[1]), [10, 12, 11, 60, 62],
    'and every reading itself kept');
});

test('the Dashboard pool chart draws an unsampled bucket as a gap, not idle GPUs', async (t) => {
  const screen = await drawScreen('dashboard.html', {
    listWorkers: async () => [],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    jobSeries: async () => ({ points: [] }),
    gpuSeries: async () => ({
      points: [
        { at: AT[0], machines: 1, avg_utilization_percent: 70, avg_memory_percent_used: 50, avg_inference_utilization_percent: 40, avg_training_utilization_percent: 30 },
        { at: AT[1], machines: 0, avg_utilization_percent: null, avg_memory_percent_used: null, avg_inference_utilization_percent: null, avg_training_utilization_percent: null },
        { at: AT[2], machines: 1, avg_utilization_percent: 80, avg_memory_percent_used: 55, avg_inference_utilization_percent: 50, avg_training_utilization_percent: 30 },
      ],
    }),
  });

  t.after(screen.close);

  const root = screen.document.querySelector('[data-pool-history]');

  assert.deepEqual(seriesIn(root, 'computeUsed').data.map((point) => point[1]), [70, null, 80],
    'it was `|| 0`, which drew the GPUs idle for an hour nobody measured');
  assert.equal(seriesIn(root, 'queueInference').yAxisIndex, 1, 'queues on their own axis');
});

test('Outcomes has no issue rate for a bucket where nothing finished', async (t) => {
  const screen = await drawScreen('dashboard.html', {
    listWorkers: async () => [],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    gpuSeries: async () => ({ points: [] }),
    jobSeries: async () => ({
      points: [
        { at: AT[0], finished: 4, succeeded: 3, median_turnaround_s: 600 },
        { at: AT[1], finished: 0, succeeded: 0, median_turnaround_s: null },
        { at: AT[2], finished: 2, succeeded: 2, median_turnaround_s: 300 },
      ],
    }),
  });

  t.after(screen.close);

  const root = screen.document.querySelector('[data-ops-activity="outcomes"]');

  assert.deepEqual(seriesIn(root, 'issues').data.map((point) => point[1]), [25, null, 0],
    'nothing finished is no rate -- drawn as 0% it read as a spotless hour');
  assert.deepEqual(seriesIn(root, 'turnaround').data.map((point) => point[1]), [600, null, 300]);
  assert.deepEqual(seriesIn(root, 'completed').data.map((point) => point[1]), [4, 0, 2],
    'while a count of none finished is a real zero');
});

test('Training activity draws running and compute from the series that have them (#302)', async (t) => {
  /* Job 21970 trained while the chart said 0 running, 1 queued, and drew no compute: it
     read the running count and the GPU reading off the job series, which carries neither.
     Running is the job series' own count now, and compute comes from the GPU series,
     matched by bucket. */
  const screen = await drawScreen('training.html', {
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listModels: async () => [],
    listDatasets: async () => [],
    listTrainingRuns: async () => [],
    jobSeries: async () => ({
      points: AT.map((at, index) => ({ at, waiting: 0, running: index === 0 ? 0 : 1, succeeded: 0, finished: 0, created: 0 })),
    }),
    gpuSeries: async () => ({
      points: [
        { at: AT[1], machines: 1, avg_training_utilization_percent: 98 },
        { at: AT[2], machines: 1, avg_training_utilization_percent: 99 },
      ],
    }),
  });

  t.after(screen.close);

  const root = screen.document.querySelector('[data-training-activity]');
  const readout = (name) => root.querySelector(`[data-training-current="${name}"]`).textContent;

  assert.deepEqual(seriesIn(root, 'running').data.map((point) => point[1]), [0, 1, 1]);
  assert.deepEqual(seriesIn(root, 'queued').data.map((point) => point[1]), [0, 0, 0]);
  assert.deepEqual(seriesIn(root, 'compute').data.map((point) => point[1]), [null, 98, 99],
    'compute from the GPU series, a gap where nothing was sampled');
  assert.equal(readout('running'), '1');
  assert.equal(readout('queued'), '0');
  assert.equal(readout('compute'), '99%');
});
