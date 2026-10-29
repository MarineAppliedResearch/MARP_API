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
