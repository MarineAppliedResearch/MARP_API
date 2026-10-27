/**
 * What every screen does without being asked.
 *
 * Isaac, on the Models tab: *"this page doesn't tell me how long since the last update or
 * anything, why do i have to keep defining all this shit for every single tab?"*
 *
 * The audit behind that found freshness missing on all seven screens and live updating on
 * five of them — because each had been built on the screen he happened to be looking at
 * when he found it missing. These pin the floor from `DESIGN.md`, *What every screen does
 * without being asked*, on the screens that had none of it.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** A job as the list returns it. */
const job = (id, state, extra = {}) => ({
  id,
  kind: 'inference',
  state,
  priority: 0,
  attempts_made: 1,
  max_attempts: 3,
  spec: { session: { session_id: 1 }, model: { ml_model_id: 7 } },
  progress_done: null,
  progress_total: null,
  created_at: '2026-10-27T09:00:00.000Z',
  updated_at: '2026-10-27T09:00:00.000Z',
  ...extra,
});

const worker = (id, name, seenMinutesAgo, extra = {}) => ({
  worker_id: id,
  name,
  status: 'online',
  activity: 'idle',
  attempts: [],
  capabilities: { gpu_name: 'RTX 4090', gpu_memory_mb: 24576 },
  slot_count: 1,
  worker_version: '0.1.9',
  gpu_name: 'RTX 4090',
  gpu_memory_mb: 24576,
  last_seen_at: new Date(Date.now() - seenMinutesAgo * 60000).toISOString(),
  ...extra,
});

/** Run the screen own 5s poll once, and let what it starts settle. */
async function poll(screen) {
  /* The watcher schedules while the screen is still rendering, so there is no moment in
     which a test could intercept the timer -- and waiting five real seconds per
     assertion would make this tier slow enough that nobody runs it. `pollScreenNow` is
     the seam, the way `detail.redraw` is one on a row. */
  await screen.window.pollScreenNow();

  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
}

test('Jobs keeps itself current, writing into the rows it already has', async (t) => {
  /* **The screen somebody leaves open while work runs**, and until this it was a
     snapshot of whenever the tab was opened. */
  let state = 'leased';

  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({ jobs: [job(900, state)], total: 1, limit: 500, offset: 0 }),
    listSessions: async () => [],
    listWorkers: async () => [],
  });

  t.after(screen.close);

  const row = screen.document.querySelector('table#jobs tbody tr[data-job="900"]');

  assert.ok(row, 'the row drew');
  assert.match(row.querySelector('.jstatus').textContent, /Running/);

  state = 'succeeded';
  await poll(screen);

  assert.match(row.querySelector('.jstatus').textContent, /Done/, 'the poll brought the new state');
  assert.equal(screen.document.querySelector('table#jobs tbody tr[data-job="900"]'), row,
    'into the same row, not a rebuilt one');
});

test('Jobs stops asking when nothing is left to watch', async (t) => {
  /* Seven tabs open must not be seven pollers. A screen of finished work makes no
     requests at all. */
  let reads = 0;

  const screen = await drawScreen('jobs.html', {
    /* The header's three live counters read this endpoint too, with `limit: 1`. The
       table's own read is the paged one. */
    listJobs: async (query) => {
      if (query && query.limit === 500) reads += 1;
      return { jobs: [job(901, 'succeeded')], total: 1, limit: 500, offset: 0 };
    },
    listSessions: async () => [],
    listWorkers: async () => [],
  });

  t.after(screen.close);

  /* The header's live counters read the job list too, with limit 1. The table's own
     read is the paged one. */
  assert.equal(reads, 1, 'the table read once, on load');

  const scheduled = [];
  const real = screen.window.setTimeout;

  screen.window.setTimeout = (fn, delay) => { scheduled.push(delay); return real(fn, delay); };

  await new Promise((resolve) => real(resolve, 40));

  assert.ok(!scheduled.includes(5000),
    `a settled screen schedules no poll (saw ${scheduled.join(', ') || 'nothing'})`);
});

test('every screen says when MARP last answered', async (t) => {
  /* The thing Isaac asked for by name, and the reason it lives in `request()` rather
     than in any screen: a screen cannot forget to report what it is not asked to. */
  for (const page of ['jobs.html', 'workers.html', 'models.html', 'training.html']) {
    const screen = await drawScreen(page, {
      listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
      listWorkers: async () => [],
      listModels: async () => [],
      listDatasets: async () => [],
      listSessions: async () => [],
      listTrainingRuns: async () => [],
    });

    const label = screen.document.querySelector('[data-freshness]');

    assert.ok(label, `${page} has the freshness label`);
    assert.match(label.textContent, /updated|reading/, `${page} says how fresh it is`);

    screen.close();
  }
});
