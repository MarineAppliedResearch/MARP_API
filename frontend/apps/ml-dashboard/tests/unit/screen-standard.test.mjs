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

/**
 * A worker, in the shape  really returns.
 *
 * **Read off the running API rather than imagined.** The first version of this fixture
 * was invented — `status`, `gpu_name`, `gpu_memory_mb` — and the screen rendered its
 * error state, so the test would have asserted against a broken page rather than a
 * feature. The real row carries `state` and `activity` beside each other, the GPU inside
 * `capabilities` as `gpu` and `vram_mb`, and `attempts` as the live leases.
 *
 * Same mistake as the Produces column, one layer down: a fixture that agrees with what I
 * expected instead of with the API.
 */
const worker = (id, name, seenMinutesAgo, extra = {}) => ({
  worker_id: id,
  name,
  state: 'online',
  activity: 'idle',
  slot_count: 1,
  worker_version: '0.1.9',
  capabilities: { gpu: 'RTX 4090', vram_mb: 24576, slots: 1 },
  enrolled_at: '2026-10-01T00:00:00.000Z',
  last_seen_at: new Date(Date.now() - seenMinutesAgo * 60000).toISOString(),
  attempts: [],
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

test('the pool says a worker went quiet, without closing an expanded one', async (t) => {
  /* **A pool screen that does not move is the one that misleads most**: a worker going
     offline looks exactly like one that was offline when the tab was opened. Only the
     pill and the heartbeat are written — a name or a GPU changes when a machine is
     reconfigured, not under a reader's eyes, and rewriting the row would close an
     expansion for nothing. */
  let seen = 1;
  let activity = 'busy';

  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(5, 'rig-01', seen, { activity })],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });

  t.after(screen.close);

  const row = screen.document.querySelector('table#workers tbody tr[data-worker="5"]');

  assert.ok(row, 'the worker drew');
  assert.match(row.querySelector('.jstatus').textContent, /Busy/i);

  row.querySelector('.exbtn').click();

  /* `data-sort` rather than the text: `sinceText` rounds against the data layer's fixed
     present, so two timestamps minutes apart can read the same while the cell has
     genuinely been rewritten. The sort key is the value itself. */
  const before = row.querySelector('.whb').dataset.sort;

  seen = 9;
  activity = 'offline';
  await poll(screen);

  assert.match(row.querySelector('.jstatus').textContent, /Offline/i, 'the pill followed');
  assert.notEqual(row.querySelector('.whb').dataset.sort, before, 'and so did the heartbeat');
  assert.equal(screen.document.querySelector('table#workers tbody tr[data-worker="5"]'), row,
    'the same row, so an expanded one stays open');
  assert.equal(row.getAttribute('aria-expanded'), 'true', 'and it is still open');
});

test('Jobs says when something last happened, not only when it arrived', async (t) => {
  /* **`gpu_jobs.updated_at` does not move while a job runs.** Nothing on the heartbeat
     path writes the job row, so for job 21782 it sat at the instant of creation while
     the worker reported progress every sixty seconds. Submitted answers when it arrived;
     this column has to answer whether anything has happened since, which means the later
     of the row's own timestamp and the latest heartbeat. */
  const beat = '2026-10-27T11:30:00.000Z';

  const screen = await drawScreen('jobs.html', {
    listJobs: async () => ({
      jobs: [job(910, 'leased', { created_at: '2026-10-27T09:00:00.000Z', updated_at: '2026-10-27T09:00:00.000Z', last_heartbeat_at: beat })],
      total: 1,
      limit: 500,
      offset: 0,
    }),
    listSessions: async () => [],
    listWorkers: async () => [],
  });

  t.after(screen.close);

  const row = screen.document.querySelector('table#jobs tbody tr[data-job="910"]');

  assert.equal(row.querySelector('.jseen').dataset.sort, beat,
    'the heartbeat, which is newer than the job row');
  assert.notEqual(row.querySelector('.jseen').dataset.sort, row.querySelector('.jtime').dataset.sort,
    'and not the same answer as Submitted');
});

test('a worker mid-job does not read as quieter than an idle one', async (t) => {
  /* Workers already had this column under a better name — *Last heard* is what Updated
     means for a machine — so the rule lands as a correction to which timestamp it reads
     rather than a thirteenth header. `last_seen_at` is the worker's own heartbeat; a
     running attempt's is the job's, and it can be the newer of the two. */
  const beat = new Date(Date.now() - 60000).toISOString();

  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(6, 'rig-02', 30, {
      activity: 'busy',
      /* The fields the row actually reads off an attempt, taken from the code rather
         than imagined — the corpus has no leased worker to copy one from. */
      attempts: [{
        id: 1,
        job_id: 21790,
        state: 'leased',
        slot_index: 0,
        last_heartbeat_at: beat,
        progress_done: 3,
        progress_total: 10,
        progress_unit: 'epochs',
      }],
    })],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });

  t.after(screen.close);

  const cell = screen.document.querySelector('table#workers tbody tr[data-worker="6"] .whb');

  assert.equal(cell.dataset.sort, String(-Date.parse(beat)),
    'the running attempt is what it was last heard from');
});

test('a machine that is on and sampling shows what it reported, not a note', async (t) => {
  /* **Every clause of the note this replaces was false.** It said live load, temperature,
     power, CPU, system RAM and disk are not reported and that a worker sends its
     capabilities once at enrolment. The worker sends all of it on every poll, and
     `gpu_worker_samples` has been storing the GPU half every minute. The columns were
     empty because the service attached the reading to a running attempt only, and because
     the GPU name was read from `caps.gpu` — a key no worker version has ever sent.

     The shapes here are the ones ABYSS-fba6be1a really reports. */
  const screen = await drawScreen('workers.html', {
    listWorkers: async () => [worker(7, 'ABYSS-fba6be1a', 2, {
      worker_version: '0.1.9',
      capabilities: {
        slots: 1,
        cuda_devices: [{ name: 'NVIDIA GeForce RTX 4080 SUPER', index: 0, total_memory_bytes: 17170956288 }],
        resources: {
          cpu: { cpu_percent: 25.16, physical_cpu_count: 20, logical_cpu_count: 28 },
          memory: { used_bytes: 40750141440, total_bytes: 68470374400, percent_used: 59.5 },
          disk: { free_bytes: 219119099904, total_bytes: 1999210803200, percent_used: 89.04 },
        },
      },
      telemetry: {
        live: true,
        as_of: new Date(Date.now() - 30000).toISOString(),
        gpus: [{
          device_index: 0,
          name: 'NVIDIA GeForce RTX 4080 SUPER',
          gpu_utilization_percent: 29,
          memory_used_bytes: 1319424000,
          memory_total_bytes: 17171480576,
          memory_percent_used: 7.68,
          temperature_c: 35,
          power_usage_watts: 7.81,
        }],
      },
    })],
    listJobs: async () => ({ jobs: [], total: 0, limit: 500, offset: 0 }),
    listSessions: async () => [],
  });

  t.after(screen.close);

  const row = screen.document.querySelector('table#workers tbody tr[data-worker="7"]');

  assert.match(row.querySelector('.wgpu').textContent, /RTX 4080 SUPER/, 'the GPU it has');
  assert.match(row.querySelector('.wgpu').textContent, /16 GB/, 'and its VRAM');
  assert.match(row.querySelector('.wcpu').textContent, /29%/, 'GPU load');
  assert.match(row.querySelector('.wmem').textContent, /8%/, 'VRAM load');
  assert.match(row.querySelector('.wmodel').textContent, /35/, 'temperature');
  assert.match(row.querySelector('.wmodel').textContent, /8 W/, 'and power');

  /* Last heard must move with the clock. It read "0s ago" for every machine for ever,
     because the elapsed time was measured against the corpus's fixed 2026-10-14. */
  assert.match(row.querySelector('.whb').textContent, /2m ago/,
    'measured against the real clock, not the corpus present');

  const detail = row.nextElementSibling;

  assert.match(detail.textContent, /25%/, 'CPU in the expansion');
  assert.match(detail.textContent, /of 64 GB/, 'system RAM');
  assert.match(detail.textContent, /GB free/, 'and disk');
  assert.doesNotMatch(detail.textContent, /are not reported|gap 27/,
    'and no paragraph explaining away what the machine is plainly sending');
});
