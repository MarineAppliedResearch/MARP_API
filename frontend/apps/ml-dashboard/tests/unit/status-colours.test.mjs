/**
 * One colour per meaning, on every tab (#318).
 *
 * Isaac, 2026-10-31: the Datasets and Models legends had rows with no dot, and the colours
 * of each tab's rings looked chosen at random. They were two palettes: the row pills said
 * queued was blue and the ring above them said violet. Settled 2026-11-03: in progress
 * cyan, waiting violet, done or usable green, warning amber, failed red, inactive grey;
 * job kinds keep their own colours only where a ring splits running work by kind.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP, drawScreen } from './screen.mjs';

const CSS = readFileSync(join(APP, 'screens.css'), 'utf8');

/** What each state means, as settled: the tone its `--st-` colour points at. */
const MAP = {
  running: 'progress', busy: 'progress', building: 'progress',
  queued: 'waiting',
  done: 'done', ready: 'done', active: 'done', online: 'done', idle: 'done',
  issues: 'warning', expired: 'warning', cancelling: 'warning',
  failed: 'failed', attention: 'failed',
  cancelled: 'inactive', archived: 'inactive', paused: 'inactive', offline: 'inactive',
  inference: 'inference', training: 'training',
};

test('every state points at the tone that was settled for it', () => {
  for (const [state, tone] of Object.entries(MAP)) {
    assert.match(CSS, new RegExp(`--st-${state}: var\\(--tone-${tone}\\);`), `${state} is ${tone}`);
  }
});

test('ring arcs, legend dots and pills all read the same --st- colour for a state', () => {
  for (const state of Object.keys(MAP)) {
    assert.match(CSS, new RegExp(`\\.donut-part\\.${state} \\{ stroke: var\\(--st-${state}\\); \\}`), `arc ${state}`);
    assert.match(CSS, new RegExp(`\\.job-mix-key \\.${state} \\{ --key: var\\(--st-${state}\\); \\}`), `legend ${state}`);
    assert.match(CSS, new RegExp(`\\[data-state="${state}"\\]\\s+\\{ --s: var\\(--st-${state}\\); \\}`), `pill ${state}`);
  }
});

/* Enough of MARP for each ring to draw its legend. */
const ANSWERS = {
  listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
  listModels: async () => [
    { id: 1, name: 'a', model_type: 'detection', status: 'active', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
    { id: 2, name: 'b', model_type: 'detection', status: 'archived', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
  ],
  listDatasets: async () => [{ id: 1, name: 'd', status: 'ready' }],
  listDatasetBuilds: async () => [],
  listTrainingRuns: async () => [],
  listWorkers: async () => [{ worker_id: 1, name: 'w', state: 'online', activity: 'idle', slot_count: 1, attempts: [], capabilities: {}, enrolled_at: '2026-10-01T00:00:00Z' }],
};

for (const page of ['jobs.html', 'inference.html', 'training.html', 'datasets.html', 'models.html', 'workers.html']) {
  test(`${page}: every legend row has a state the map colours, and its ring an arc of that state`, async (t) => {
    const screen = await drawScreen(page, ANSWERS);
    t.after(screen.close);

    const rows = [...screen.document.querySelectorAll('.job-mix-key > span')];
    assert.ok(rows.length >= 2, `${page} draws its legend`);

    for (const row of rows) {
      const state = row.className;
      assert.ok(state in MAP, `"${row.textContent.trim()}" on ${page} has class "${state}", which the map has no colour for`);
      assert.ok(row.querySelector('i'), `"${row.textContent.trim()}" has its dot`);

      const ring = screen.document.querySelector('.job-donut svg');
      assert.ok(ring.querySelector(`.donut-part.${state}`), `${page}'s ring has an arc for "${state}", the legend row's state`);
    }
  });
}
