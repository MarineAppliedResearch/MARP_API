/**
 * The fixture's invariants — the ones that would otherwise rot silently.
 *
 * A fixture is not test data here, it is the whole application's data source, so a
 * contradiction inside it becomes a defect drawn on a screen. The ones asserted below all
 * have that shape: a stat card that disagrees with the table under it, a split that does
 * not add up, a busy worker pointing at a job that finished last week, a progress bar that
 * claims a measurement nobody took. Every one of them looks completely fine in a
 * screenshot.
 *
 * Everything is recounted from the rows. Nothing here reads a number out of `counts` and
 * compares it with itself.
 *
 * Run: `node --test tests/unit/fixture.test.mjs`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build } from '../../tools/make-fixture.mjs';

const data = build();

/** The instant the fixture calls "now". Nothing in it is dated later. */
const NOW = data.now;
const NOW_MS = Date.parse(NOW);
const TODAY = '2026-09-09';

/** A running state, for the purpose of "a busy worker's job is still going". */
const LIVE = new Set(['running', 'cancelling']);

/** Every object in the tree, with the path that reaches it. */
function eachObject(node, path, visit) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => eachObject(v, `${path}[${i}]`, visit));
    return;
  }
  if (node && typeof node === 'object') {
    visit(node, path);
    for (const [k, v] of Object.entries(node)) eachObject(v, `${path}.${k}`, visit);
  }
}

test('the fixture is dated today, not tomorrow', () => {
  assert.equal(data.generated, TODAY);
  assert.equal(NOW.slice(0, 10), TODAY);
});

/* ------------------------------------------------------------------ counts */

/**
 * Every count, recounted from the rows.
 *
 * The key set is asserted against `counts` as well, so adding a count without a recount
 * for it fails here rather than shipping a card nothing checks.
 */
const RECOUNTS = {
  running: (d) => d.jobs.filter((j) => j.state === 'running').length,
  running_inference: (d) => d.jobs.filter((j) => j.state === 'running' && j.kind === 'inference').length,
  running_training: (d) => d.jobs.filter((j) => j.state === 'running' && j.kind === 'training').length,
  queued: (d) => d.jobs.filter((j) => j.state === 'queued').length,
  queued_inference: (d) => d.jobs.filter((j) => j.state === 'queued' && j.kind === 'inference').length,
  queued_training: (d) => d.jobs.filter((j) => j.state === 'queued' && j.kind === 'training').length,
  cancelling: (d) => d.jobs.filter((j) => j.state === 'cancelling').length,
  paused: (d) => d.jobs.filter((j) => j.state === 'paused').length,
  failed: (d) => d.jobs.filter((j) => j.state === 'failed').length,
  issues: (d) => d.jobs.filter((j) => j.state === 'issues').length,
  cancelled: (d) => d.jobs.filter((j) => j.state === 'cancelled').length,
  succeeded: (d) => d.jobs.filter((j) => j.state === 'succeeded').length,
  needs_attention: (d) => d.jobs.filter((j) => j.state === 'failed' || j.state === 'issues').length,
  completed_today: (d) => d.jobs.filter((j) => j.finished_at
    && j.finished_at.slice(0, 10) === TODAY
    && (j.state === 'succeeded' || j.state === 'issues')).length,
  jobs_total: (d) => d.jobs.length,
  workers_total: (d) => d.workers.length,
  /* "Online" on the card means reachable — a paused machine is still connected. See the
     note in the generator: 124 + 6 + 19 is not 143, and this is why. */
  workers_online: (d) => d.workers.filter((w) => w.state !== 'offline').length,
  workers_busy: (d) => d.workers.filter((w) => w.activity === 'busy').length,
  workers_idle: (d) => d.workers.filter((w) => w.activity === 'idle').length,
  workers_paused: (d) => d.workers.filter((w) => w.state === 'paused').length,
  workers_offline: (d) => d.workers.filter((w) => w.state === 'offline').length,
  gpu_slots_total: (d) => d.workers.reduce((n, w) => n + w.slot_count, 0),
  gpu_slots_in_use: (d) => d.workers.reduce((n, w) => n + w.attempts.length, 0)
};

test('counts has a recount for every key, and no more', () => {
  assert.deepEqual(Object.keys(data.counts).sort(), Object.keys(RECOUNTS).sort());
});

test('every count equals a recount of the rows', () => {
  for (const [key, recount] of Object.entries(RECOUNTS)) {
    assert.equal(data.counts[key], recount(data), `counts.${key} disagrees with the rows`);
  }
});

test('the job states in counts add up to every job', () => {
  const { counts } = data;
  const sum = counts.running + counts.queued + counts.cancelling + counts.paused
    + counts.failed + counts.issues + counts.cancelled + counts.succeeded;
  assert.equal(sum, counts.jobs_total);
});

test('the worker states add up to the pool, and busy is a subset of online', () => {
  const { counts } = data;
  assert.equal(counts.workers_busy + counts.workers_idle + counts.workers_paused
    + counts.workers_offline, counts.workers_total);
  assert.ok(counts.workers_busy < counts.workers_online);
  assert.ok(counts.gpu_slots_in_use <= counts.gpu_slots_total);
});

/* ------------------------------------------------------------------ datasets */

test("every dataset's split sums to its observation count", () => {
  for (const d of data.datasets) {
    const { train, val, test: held } = d.split;
    assert.equal(train + val + held, d.observations, `${d.name} split does not add up`);
    assert.ok(train > 0 && val > 0 && held > 0, `${d.name} has an empty partition`);
  }
});

test("every dataset's class breakdown sums to its observation count", () => {
  for (const d of data.datasets) {
    const sum = d.classes.reduce((n, c) => n + c.count, 0);
    assert.equal(sum, d.observations, `${d.name} class breakdown does not add up`);
    assert.ok(d.classes.every((c) => c.count > 0), `${d.name} has an empty class`);
  }
});

test('a split group holds at least one observation and never more than the whole set', () => {
  for (const d of data.datasets) {
    assert.ok(d.split_groups >= 1 && d.split_groups <= d.observations, `${d.name} split_groups`);
  }
});

/* ------------------------------------------------------------------ workers */

test("every busy worker's job exists and is still running", () => {
  const byId = new Map(data.jobs.map((j) => [j.id, j]));
  const busy = data.workers.filter((w) => w.activity === 'busy');
  assert.ok(busy.length > 0, 'no busy workers to check');
  for (const w of busy) {
    assert.ok(w.current_job, `${w.name} is busy with nothing`);
    const job = byId.get(w.current_job.id);
    assert.ok(job, `${w.name} references job ${w.current_job.id}, which does not exist`);
    assert.equal(job.name, w.current_job.name, `${w.name} has the wrong name for job ${job.id}`);
    assert.ok(LIVE.has(job.state), `${w.name} is busy on a ${job.state} job`);
    assert.ok(w.attempts.length > 0, `${w.name} is busy with no attempt`);
    for (const a of w.attempts) {
      assert.equal(a.job_id, job.id, `${w.name} attempt ${a.id} is on another job`);
    }
  }
});

test('a worker that is not busy holds no attempt, and its activity follows its state', () => {
  for (const w of data.workers) {
    if (w.activity === 'busy') continue;
    assert.equal(w.attempts.length, 0, `${w.name} is ${w.activity} and holds an attempt`);
    assert.equal(w.current_job, null, `${w.name} is ${w.activity} and names a job`);
    const expected = w.state === 'online' ? 'idle' : w.state;
    assert.equal(w.activity, expected, `${w.name} activity does not follow state`);
  }
});

test("a job's worker count is the number of machines actually on it", () => {
  for (const job of data.jobs) {
    const on = data.workers.filter((w) => w.current_job && w.current_job.id === job.id).length;
    assert.equal(job.workers.using, on, `job ${job.id} claims ${job.workers.using} workers, ${on} are on it`);
    assert.ok(job.workers.using <= job.workers.cap, `job ${job.id} exceeds its own cap`);
  }
});

test('a worker never holds more attempts than it has slots', () => {
  for (const w of data.workers) {
    assert.ok(w.attempts.length <= w.slot_count, `${w.name} holds ${w.attempts.length} attempts in ${w.slot_count} slots`);
  }
});

/* ------------------------------------------------------------------ dates */

test('nothing is dated in the future', () => {
  let checked = 0;
  eachObject(data, '$', (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      if (!key.endsWith('_at') || typeof value !== 'string') continue;
      /* The one exemption, and it is deliberate: a live lease deadline is in the future
         by definition. A worker whose lease has already expired reads as dead. */
      if (key === 'lease_expires_at') continue;
      checked += 1;
      assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `${path}.${key} is not ISO 8601 with a Z`);
      assert.ok(Date.parse(value) <= NOW_MS, `${path}.${key} is ${value}, after ${NOW}`);
    }
  });
  assert.ok(checked > 500, `only ${checked} timestamps checked; the walk is not reaching the rows`);
});

test('a live lease expires in the future, which is the point of a lease', () => {
  const live = data.workers.flatMap((w) => w.attempts);
  assert.ok(live.length > 0, 'no live attempts to check');
  for (const a of live) {
    assert.ok(Date.parse(a.lease_expires_at) > NOW_MS, `attempt ${a.id} holds an expired lease`);
    assert.ok(Date.parse(a.leased_at) <= Date.parse(a.last_heartbeat_at), `attempt ${a.id} beat before it was leased`);
  }
});

test('no updated_at precedes its own created_at', () => {
  let checked = 0;
  eachObject(data, '$', (node, path) => {
    if (typeof node.created_at !== 'string' || typeof node.updated_at !== 'string') return;
    checked += 1;
    assert.ok(Date.parse(node.updated_at) >= Date.parse(node.created_at),
      `${path} was updated ${node.updated_at}, before it was created ${node.created_at}`);
  });
  assert.ok(checked > 100, `only ${checked} created/updated pairs checked`);
});

test('a finished job finished after it was created, and never later than now', () => {
  for (const j of data.jobs.filter((x) => x.finished_at)) {
    assert.ok(Date.parse(j.finished_at) >= Date.parse(j.created_at), `job ${j.id} finished before it started`);
    assert.ok(Date.parse(j.finished_at) <= NOW_MS, `job ${j.id} finishes in the future`);
  }
});

test('a worker was last seen after it enrolled', () => {
  for (const w of data.workers) {
    assert.ok(Date.parse(w.last_seen_at) >= Date.parse(w.enrolled_at), `${w.name} was seen before it enrolled`);
  }
});

/* ------------------------------------------------------------------ jobs */

test('a queued job has no progress at all, rather than zero progress', () => {
  const queued = data.jobs.filter((j) => j.state === 'queued');
  assert.ok(queued.length > 0, 'no queued jobs to check');
  for (const j of queued) {
    assert.equal(j.progress, null, `queued job ${j.id} carries progress`);
    assert.equal(j.duration_s, null, `queued job ${j.id} carries a duration`);
    assert.equal(j.detections, null, `queued job ${j.id} carries detections`);
    assert.equal(j.finished_at, null, `queued job ${j.id} has finished`);
  }
});

test('a succeeded job has a duration, is fully done, and has finished', () => {
  const done = data.jobs.filter((j) => j.state === 'succeeded');
  assert.ok(done.length > 0, 'no succeeded jobs to check');
  for (const j of done) {
    assert.notEqual(j.duration_s, null, `succeeded job ${j.id} has no duration`);
    assert.ok(j.duration_s > 0, `succeeded job ${j.id} took no time`);
    assert.notEqual(j.finished_at, null, `succeeded job ${j.id} never finished`);
    assert.notEqual(j.progress, null, `succeeded job ${j.id} has no progress`);
    assert.equal(j.progress.done, j.progress.total, `succeeded job ${j.id} is not complete`);
    assert.equal(j.failure_reason, null, `succeeded job ${j.id} carries a failure reason`);
    assert.deepEqual(j.issues, [], `succeeded job ${j.id} carries issues`);
  }
});

test('a job that is still going has not finished, and a finished one is not still going', () => {
  for (const j of data.jobs) {
    const live = j.state === 'queued' || j.state === 'running'
      || j.state === 'cancelling' || j.state === 'paused';
    if (live) assert.equal(j.finished_at, null, `${j.state} job ${j.id} has a finish time`);
    else assert.notEqual(j.finished_at, null, `${j.state} job ${j.id} has no finish time`);
  }
});

test('progress never exceeds its total, and its unit matches the kind of work', () => {
  for (const j of data.jobs) {
    if (!j.progress) continue;
    assert.ok(j.progress.done <= j.progress.total, `job ${j.id} is past 100%`);
    assert.ok(j.progress.done >= 0, `job ${j.id} has negative progress`);
    assert.equal(j.progress.unit, j.kind === 'training' ? 'epochs' : 'frames', `job ${j.id} unit`);
  }
});

test('a failed job says why, and a job that did not fail does not', () => {
  for (const j of data.jobs) {
    if (j.state === 'failed') {
      assert.ok(typeof j.failure_reason === 'string' && j.failure_reason.length > 20,
        `failed job ${j.id} has no usable failure reason`);
    } else {
      assert.equal(j.failure_reason, null, `${j.state} job ${j.id} carries a failure reason`);
    }
  }
});

test('a completed-with-issues job names the work that failed, and nothing else does', () => {
  for (const j of data.jobs) {
    if (j.state === 'issues') {
      assert.ok(j.issues.length > 0, `job ${j.id} is in the issues state with no issues`);
      for (const issue of j.issues) {
        assert.ok(issue.video, `job ${j.id} has an issue naming no video`);
        assert.equal(issue.range.length, 2, `job ${j.id} issue range`);
        assert.ok(issue.range[1] > issue.range[0], `job ${j.id} issue range runs backwards`);
        assert.ok(issue.reason.length > 20, `job ${j.id} issue has no usable reason`);
      }
      /* Mostly succeeded is what this state means. A job that lost everything failed. */
      assert.ok(j.progress.done / j.progress.total > 0.5, `job ${j.id} lost more than half its work`);
    } else {
      assert.deepEqual(j.issues, [], `${j.state} job ${j.id} carries issues`);
    }
  }
});

test("every job's model, version and dataset exist", () => {
  const byId = new Map(data.models.map((m) => [m.id, m]));
  for (const j of data.jobs) {
    const model = byId.get(j.model.id);
    assert.ok(model, `job ${j.id} names model ${j.model.id}, which is not in the registry`);
    assert.equal(model.name, j.model.name, `job ${j.id} has the wrong name for model ${model.id}`);
    const version = model.versions.find((v) => v.id === j.model.version_id);
    assert.ok(version, `job ${j.id} names version ${j.model.version_id}, which ${model.name} does not have`);
    assert.equal(version.version, j.model.version, `job ${j.id} version label`);
    /* Locked at submission: the sha256 travels with the job so that changing which
       version is preferred cannot alter work already queued. */
    assert.equal(version.sha256, j.model.sha256, `job ${j.id} sha256 does not match version ${version.id}`);
    if (j.kind === 'training') {
      assert.ok(data.datasets.some((d) => d.id === j.dataset.id), `job ${j.id} names a dataset that does not exist`);
    } else {
      assert.equal(j.dataset, null, `inference job ${j.id} names a dataset`);
    }
  }
});

test('jobs are newest first, and the ids run with them', () => {
  for (let i = 1; i < data.jobs.length; i += 1) {
    const prev = data.jobs[i - 1];
    const here = data.jobs[i];
    assert.ok(Date.parse(prev.created_at) >= Date.parse(here.created_at), `job ${here.id} is out of order`);
    assert.ok(prev.id > here.id, `job ${here.id} has an id out of sequence`);
  }
});

/* ------------------------------------------------------------------ models */

test('exactly two versions are preferred, each for one task and each with a note', () => {
  const preferred = data.models.flatMap((m) => m.versions.filter((v) => v.preferred_for_task));
  assert.equal(preferred.length, 2);
  for (const v of preferred) {
    assert.ok(v.preferred_note && v.preferred_note.length > 40, 'a preference carries a note saying what for');
    /* MARP's wording: preferred *for a task*, never promoted. */
    assert.doesNotMatch(v.preferred_note, /promot/i);
  }
});

test('a version was trained on a dataset that exists, after that dataset was saved', () => {
  const byId = new Map(data.datasets.map((d) => [d.id, d]));
  for (const m of data.models) {
    for (const v of m.versions) {
      const ds = byId.get(v.dataset_id);
      assert.ok(ds, `${m.name} ${v.version} names dataset ${v.dataset_id}, which does not exist`);
      assert.ok(Date.parse(v.trained_at) > Date.parse(ds.created_at),
        `${m.name} ${v.version} was trained before its dataset was saved`);
      assert.equal(v.sha256.length, 64, `${m.name} ${v.version} sha256 length`);
      assert.equal(v.classes.length, m.class_count, `${m.name} ${v.version} class count`);
    }
  }
});

test('a version has metrics in range, and later versions are not worse', () => {
  for (const m of data.models) {
    let last = 0;
    for (const v of m.versions) {
      for (const [key, value] of Object.entries(v.metrics)) {
        assert.ok(value > 0 && value < 1, `${m.name} ${v.version} ${key} is ${value}`);
      }
      assert.ok(v.metrics.map5095 < v.metrics.map50, `${m.name} ${v.version} mAP50-95 exceeds mAP50`);
      assert.ok(v.metrics.map50 >= last, `${m.name} ${v.version} is worse than the version before it`);
      last = v.metrics.map50;
    }
  }
});

/* ------------------------------------------------------------------ runs */

test('a run and its job agree about what happened', () => {
  const byId = new Map(data.jobs.map((j) => [j.id, j]));
  for (const r of data.runs) {
    const job = byId.get(r.job_id);
    assert.ok(job, `run ${r.id} names job ${r.job_id}, which does not exist`);
    assert.equal(job.run_id, r.id, `job ${job.id} does not point back at run ${r.id}`);
    assert.equal(job.kind, 'training', `run ${r.id} hangs off an inference job`);
    assert.equal(job.state, r.state, `run ${r.id} and job ${job.id} disagree about state`);
    assert.equal(r.epochs_done, job.progress.done, `run ${r.id} and job ${job.id} disagree about progress`);
    assert.equal(r.epochs_total, job.progress.total, `run ${r.id} and job ${job.id} disagree about the plan`);
    assert.equal(r.epochs.length, r.epochs_done, `run ${r.id} reports ${r.epochs_done} epochs and holds ${r.epochs.length}`);
  }
});

test('a finished run converges: loss falls, mAP rises', () => {
  const finished = data.runs.filter((r) => r.state === 'succeeded');
  assert.ok(finished.length > 0, 'no finished runs to check');
  for (const r of finished) {
    const first = r.epochs[0];
    const last = r.epochs[r.epochs.length - 1];
    assert.ok(last.train_loss < first.train_loss * 0.6, `run ${r.id} train_loss barely moved`);
    assert.ok(last.val_loss < first.val_loss * 0.6, `run ${r.id} val_loss barely moved`);
    assert.ok(last.map50 > first.map50 * 2, `run ${r.id} mAP barely moved`);
    /* Plateau: the back half improves less than the front half, or it never converged. */
    const mid = r.epochs[Math.floor(r.epochs.length / 2)];
    assert.ok(last.map50 - mid.map50 < mid.map50 - first.map50, `run ${r.id} never plateaus`);
  }
});

test('the diverged run diverges — val_loss leaves train_loss behind', () => {
  const bad = data.runs.filter((r) => r.state === 'failed');
  assert.equal(bad.length, 1, 'the fixture carries exactly one diverged run');
  const [r] = bad;
  const last = r.epochs[r.epochs.length - 1];
  assert.ok(last.val_loss > last.train_loss * 5, 'val_loss did not run away from train_loss');
  assert.ok(last.map50 < r.epochs[11].map50, 'mAP did not collapse');
  assert.ok(r.epochs_done < r.epochs_total, 'a diverged run stops early');
  assert.ok(r.failure_reason && r.failure_reason.length > 20, 'the diverged run says why');
  /* Monotone from the epoch it turns, index 12 being epoch 13 — the first one past the
     turn. Starting a step later misses a dip at the turn itself, which is exactly the
     chart that lies about when the run went wrong, and is exactly what this fixture had
     until a mutation caught it. */
  for (let e = 12; e < r.epochs.length; e += 1) {
    assert.ok(r.epochs[e].val_loss > r.epochs[e - 1].val_loss, `val_loss dips at epoch ${e + 1}`);
  }
});

test('a run that is still going has produced no version, and a finished one has', () => {
  for (const r of data.runs) {
    if (r.state === 'succeeded') {
      assert.ok(r.produced_version, `run ${r.id} succeeded and registered nothing`);
    } else {
      assert.equal(r.produced_version, null, `${r.state} run ${r.id} registered a version`);
    }
  }
});

test('each registered version was produced by at most one run', () => {
  const made = data.runs.filter((r) => r.produced_version).map((r) => r.produced_version.id);
  assert.equal(new Set(made).size, made.length, 'two runs claim to have produced the same version');
});

/* ------------------------------------------------------------------ events */

test('every event belongs to a job that exists, in order, within that job', () => {
  const byId = new Map(data.jobs.map((j) => [j.id, j]));
  const kinds = new Set(['lease', 'prepare', 'progress', 'metric', 'warn', 'error', 'upload', 'result']);
  const seen = new Map();
  for (const e of data.events) {
    const job = byId.get(e.job_id);
    assert.ok(job, `an event names job ${e.job_id}, which does not exist`);
    assert.ok(kinds.has(e.kind), `event kind ${e.kind} is not in the vocabulary`);
    assert.ok(['info', 'warn', 'error'].includes(e.level), `event level ${e.level}`);
    assert.ok(e.message.length > 0, `job ${e.job_id} seq ${e.seq} has no message`);
    assert.ok(Date.parse(e.at) >= Date.parse(job.created_at), `an event predates job ${job.id}`);
    const prev = seen.get(e.job_id);
    if (prev) {
      assert.equal(e.seq, prev.seq + 1, `job ${e.job_id} events skip a sequence number`);
      assert.ok(Date.parse(e.at) >= Date.parse(prev.at), `job ${e.job_id} events go backwards in time`);
    } else {
      assert.equal(e.seq, 1, `job ${e.job_id} events do not start at 1`);
    }
    seen.set(e.job_id, e);
  }
  assert.ok(seen.size >= 8, `only ${seen.size} jobs have events; the diagnostics view needs several`);
});

test('a diagnosable job has enough of a log to diagnose it', () => {
  const perJob = new Map();
  for (const e of data.events) perJob.set(e.job_id, (perJob.get(e.job_id) || 0) + 1);
  for (const [id, n] of perJob) {
    assert.ok(n >= 30 && n <= 80, `job ${id} has ${n} event lines`);
  }
});

test('a failed job with events says what failed at error level', () => {
  const withEvents = new Set(data.events.map((e) => e.job_id));
  const failed = data.jobs.filter((j) => j.state === 'failed' && withEvents.has(j.id));
  assert.ok(failed.length > 0, 'no failed job has events');
  for (const j of failed) {
    const errors = data.events.filter((e) => e.job_id === j.id && e.level === 'error');
    assert.ok(errors.length > 0, `failed job ${j.id} logged no error`);
    assert.ok(errors.some((e) => e.message === j.failure_reason),
      `failed job ${j.id} logs a different reason than it reports`);
  }
});

/* ------------------------------------------------------------------ scale and shape */

test('the fixture is at the scale the screens were drawn for', () => {
  assert.equal(data.jobs.length, 120);
  assert.equal(data.workers.length, 143);
  assert.equal(data.projects.length, 6);
  assert.equal(data.models.length, 10);
  assert.equal(data.datasets.length, 8);
  assert.equal(data.runs.length, 12);
  assert.equal(data.species.length, 24);
  /* Roughly two inference jobs per training job, which is what the pool actually runs. */
  const inference = data.jobs.filter((j) => j.kind === 'inference').length;
  assert.equal(inference / (data.jobs.length - inference), 2);
});

test('every job state the app draws is present in the rows', () => {
  const states = new Set(data.jobs.map((j) => j.state));
  for (const s of ['queued', 'running', 'succeeded', 'issues', 'failed', 'cancelled', 'cancelling', 'paused']) {
    assert.ok(states.has(s), `no job is in the ${s} state, so that screen has nothing to draw`);
  }
});

test('the pool covers every worker state and real hardware', () => {
  const states = new Set(data.workers.map((w) => w.state));
  assert.deepEqual([...states].sort(), ['offline', 'online', 'paused']);
  const gpus = new Set(data.workers.map((w) => w.capabilities.gpus[0].name));
  assert.ok(gpus.size >= 5, `only ${gpus.size} kinds of GPU in the pool`);
  /* Volunteers can enrol, and a pool of nothing but ml-gpu-NN hides that. */
  const contributed = data.workers.filter((w) => !/^(ml-gpu|marp-rig|campa-lab)-\d+$/.test(w.name));
  assert.ok(contributed.length >= 8, `only ${contributed.length} contributed machines`);
});

/* ------------------------------------------------------------------ determinism */

test('regenerating the fixture produces identical bytes', () => {
  const a = JSON.stringify(build(), null, 1);
  const b = JSON.stringify(build(), null, 1);
  assert.equal(a.length, b.length);
  assert.equal(a, b);
  /* And the copy this file has been asserting on all along is the same one. */
  assert.equal(JSON.stringify(data, null, 1), a);
});
