/**
 * The Workers tab says what the pool's GPUs draw now, at idle, and above idle.
 *
 * #214. Settled with Isaac on 2026-10-30: GPU power only, labelled so; idle is a rolling
 * median the API works out; a machine that is offline counts as 0 W.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const now = () => new Date().toISOString();

const worker = (id, name, state, gpus, idle, asOf = now()) => ({
  worker_id: id, name, state, activity: state === 'online' ? 'busy' : state, slot_count: 1,
  worker_version: '0.1.18', capabilities: { slots: 1 }, enrolled_at: '2026-09-10T00:00:00.000Z',
  last_seen_at: asOf, up_since: asOf, idle_power_watts: idle, attempts: [],
  telemetry: { gpus, as_of: asOf, live: true },
});

const gpu = (watts) => ({ device_index: 0, name: 'NVIDIA GeForce RTX 4080 SUPER', power_usage_watts: watts, temperature_c: 72 });

test('the pool\'s power now, idle and above idle, with an offline machine counted as 0 W', async (t) => {
  const workers = [
    /* Two cards: 277 + 23 = 300 W now, idling at 8 W. */
    worker(1, 'ABYSS', 'online', [gpu(277), { ...gpu(23), device_index: 1 }], 8),
    /* Offline with a week-old reading: nothing now, and its idle is not counted either. */
    worker(2, 'VP1', 'offline', [gpu(90)], 14, '2026-10-21T18:53:31.242Z'),
  ];

  const screen = await drawScreen('workers.html', {
    listWorkers: async () => workers,
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    gpuSeries: async () => ({ points: [] }),
  });
  t.after(screen.close);

  const figure = (key) => screen.document.querySelector(`[data-workers-power] [data-power="${key}"]`).textContent;

  assert.equal(figure('now'), '300 W');
  assert.equal(figure('idle'), '8 W');
  assert.equal(figure('above'), '292 W');
  assert.match(screen.document.querySelector('[data-workers-power]').textContent, /GPU power only/);

  const cell = (id) => screen.document.querySelector(`#workers tbody tr[data-worker="${id}"] .wmodel`).textContent;
  assert.match(cell(1), /300 W\s*\+292 W/, 'its row: now, and above idle');
});

test('GPU power is drawn in the GPU pool activity chart, on a watts axis (#317)', async (t) => {
  /* Isaac, 2026-10-30: two charts over the same time did not need to be two. Settled
     2026-11-03: watts on the right; the queue keeps its line on an axis that is not drawn. */
  const at = (hour) => new Date(Date.now() - (3 - hour) * 3600e3).toISOString();
  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(1, 'ABYSS', 'online', [gpu(277)], 8)],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
    gpuSeries: async () => ({ points: [1, 2].map((hour) => ({
      at: at(hour), machines: 1, avg_inference_utilization_percent: 60, avg_training_utilization_percent: null,
      avg_memory_percent_used: 40, total_power_watts: hour === 1 ? 150 : 277,
    })) }),
    jobSeries: async () => ({ points: [{ at: at(1), waiting: 3 }, { at: at(2), waiting: 1 }] }),
  });
  t.after(screen.close);

  assert.equal(screen.document.querySelector('#gpu-power'), null, 'the separate power panel is gone');

  const panel = screen.document.querySelector('#pool-activity');
  assert.ok(panel.matches('[data-workers-power]'), 'the power figures live in the pool activity panel');
  assert.equal(panel.querySelector('[data-power="now"]').textContent, '277 W');
  assert.match(panel.textContent, /GPU power only/);

  const option = panel.querySelector('[data-chart]').marpOption;
  const series = (id) => option.series.find((one) => one.id === id);

  assert.equal(option.yAxis.length, 3);
  assert.equal(option.yAxis[1].name, 'GPU power', 'watts on the right');
  assert.equal(option.yAxis[2].show, false, 'the queue has an axis that is not drawn');
  assert.deepEqual(series('power').data.map((point) => point[1]), [150, 277]);
  assert.equal(series('power').yAxisIndex, 1);
  assert.deepEqual(series('idle').data.map((point) => point[1]), [8, 8], 'the idle baseline across it');
  assert.equal(series('queued').yAxisIndex, 2);
  assert.equal(panel.querySelector('[data-ops-current="power"]').textContent, '277 W');
});
