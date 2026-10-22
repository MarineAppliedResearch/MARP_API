/**
 * The data layer. One module, shaped like the real API, and the only thing the
 * screens read from (#128, R1).
 *
 * **This is not a second implementation of MARP.** It is a local module with no
 * server, no database and no build step (R11). Its whole purpose is that the
 * screens stop carrying values in their markup, so that wiring MARP in later is
 * a change of source and not a change of vocabulary.
 *
 * Three things about it are deliberate and are the reason it looks like this:
 *
 * - **The shapes are the real ones, awkwardness included.** `GET /gpu/jobs`
 *   pages and `GET /gpu/workers` does not; `POST /gpu/jobs` answers `200` and
 *   not `201`. Those were measured out of `docs/openapi.generated.json` and
 *   `routes/gpu.routes.js` rather than taken from #104's measurement comment,
 *   which is a comment and not a contract.
 * - **The states are the API's, not the design's.** A job is `leased`, never
 *   `running`; `succeeded`, never `done`. The design vocabulary in `DESIGN.md`
 *   is a *rendering* of these, and the mapping belongs to the screen. A layer
 *   that served `running` would be inventing a route, which is exactly what
 *   `DESIGN.md`'s gap list exists to prevent.
 * - **Progress is on the job, and that is a known lie.** The real list route
 *   returns no progress at all -- it is on the attempt, and only the detail
 *   route returns attempts. Recorded as gap 23: the screen is drawn as if the
 *   list carries it and the route will have to learn to. The field *names* here
 *   are the attempt's own, so when the route learns, nothing is renamed.
 *
 * Everything is deterministic from one seed (R3). Nothing here reads the wall
 * clock -- `NOW` below is a fixed instant, because a corpus that drifts with
 * the clock is not byte-identical between two people looking at one screen.
 *
 * @fileoverview Deterministic data layer shaped like the GPU routes.
 * @module mockups/api
 */

(function () {
  'use strict';

  /* ============================================================== determinism */

  /** The corpus's present. Fixed, so two people see the same relative times. */
  const NOW = Date.parse('2026-10-14T12:00:00Z');

  /** One seed for the whole corpus. Changing it changes every generated value. */
  const SEED = 0x4d415250; // "MARP"

  /**
   * mulberry32: small, fast, and good enough for fixture data.
   *
   * Seeded rather than `Math.random` because R3 is the requirement that makes
   * the rest trustworthy -- a regenerated fixture has to be byte-identical, and
   * a screenshot check comparing against a corpus that reshuffles every reload
   * is a check that can only ever be flaky.
   *
   * @param {number} seed - Any 32-bit integer.
   * @returns {function(): number} A generator returning [0, 1).
   */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** An integer in [lo, hi]. @returns {number} */
  const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

  /** One of the given values. @returns {*} */
  const pick = (r, list) => list[Math.floor(r() * list.length)];

  /** An ISO instant `minutes` before the corpus's present. @returns {string} */
  const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();

  /**
   * `length` lower-case hexadecimal characters.
   *
   * Weights and videos are addressed by hash and by Jellyfin item id, and a
   * screen that only ever sees `abc123` will not reveal that it has nowhere to
   * put sixty-four characters.
   *
   * @param {function(): number} r - The generator.
   * @param {number} length - How many characters.
   * @returns {string}
   */
  function hex(r, length) {
    let out = '';
    while (out.length < length) out += Math.floor(r() * 16).toString(16);
    return out;
  }

  /* ============================================================ the real enums */

  /* Straight out of config/gpu-orchestration.js. Written here rather than
     imported because this file is a plain script served to a browser and that
     module is CommonJS on the server -- so they are checked against each other
     by tools/api-contract-check.mjs instead, which fails when they drift. */

  /** @type {string[]} */
  const JOB_KINDS = ['inference', 'tracking', 'training', 'diagnostic', 'dataset_build'];

  /**
   * The kinds the generated corpus actually produces for the GPU queue.
   *
   * **Not every kind belongs in the pool's queue.** A `dataset_build` is a `gpu_jobs`
   * row the API runs itself, and it has its own place on Datasets -- so the corpus does
   * not scatter builds through the Jobs screen, while `JOB_KINDS` above still matches
   * MARP exactly, which is what the contract check compares.
   *
   * @type {string[]}
   */
  const QUEUE_KINDS = ['inference', 'tracking', 'training', 'diagnostic'];

  /** @type {string[]} */
  const JOB_STATES = ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'interrupted', 'expired'];

  /** @type {string[]} */
  const WORKER_STATES = ['online', 'offline', 'paused'];

  /** @type {string[]} */
  const LIVE_ATTEMPT_STATES = ['assigned', 'preparing', 'running', 'uploading'];

  /* `ml_models.status`. Not a GPU enum -- it is declared on the model itself --
     so `api-contract-check` reads it out of the generated contract. */
  /** @type {string[]} */
  const MODEL_STATUSES = ['draft', 'training', 'trained', 'archived'];

  /* ================================================================= the corpus */

  const GPUS = [
    { name: 'NVIDIA RTX 4090', vram: 24576 },
    { name: 'NVIDIA RTX A6000', vram: 49152 },
    { name: 'NVIDIA L40S', vram: 46068 },
    { name: 'NVIDIA A100 80GB', vram: 81920 },
    { name: 'NVIDIA RTX 3090', vram: 24576 },
  ];

  /**
   * Models by the session type they are trained for.
   *
   * Keyed rather than listed because the pairing is a rule MARP enforces:
   * `checkSessionTypeAgainstModel` refuses an inverts model writing into a Fish
   * session. Picking a model and a session type independently produced jobs the
   * real API would have rejected at submission -- a corpus full of work that
   * could not exist, which teaches a screen to draw something it will never see.
   */
  const MODELS = {
    Fish: ['marp-fish-v7', 'marp-fish-v6', 'marp-rockfish-v1'],
    Invert: ['marp-inverts-v4', 'marp-inverts-v3'],
    Habitat: ['marp-habitat-v2'],
  };

  const SURVEYS = ['CAMPA 2024', 'GULF 2025', 'PACIFIC 2023', 'SALT 2025'];

  /**
   * Builds the whole corpus once, from the seed.
   *
   * Built eagerly rather than per call so that every route sees one consistent
   * world: a job's `published_attempt_id` has to name an attempt that exists,
   * and a worker's live attempts have to be the same attempts the job detail
   * reports. Generating per request produced two worlds that disagreed, which
   * looked like a UI bug.
   *
   * @returns {{workers: Object[], jobs: Object[], attempts: Object[]}}
   */
  function build() {
    const r = rng(SEED);
    const workers = [];
    const jobs = [];
    const attempts = [];

    /* 143 machines, because #128 asks for the Workers screen to be drawn at a
       scale that exercises it. Twelve rows of anything proves nothing. */
    for (let i = 1; i <= 143; i++) {
      const gpu = pick(r, GPUS);
      const state = r() < 0.82 ? 'online' : pick(r, WORKER_STATES);
      const slots = int(r, 1, 4);

      workers.push({
        worker_id: i,
        name: `gpu-${String(i).padStart(3, '0')}`,
        state,
        slot_count: slots,
        worker_version: r() < 0.9 ? `0.1.${int(r, 0, 9)}` : null,
        capabilities: {
          gpu: gpu.name,
          vram_mb: gpu.vram,
          driver: `${int(r, 550, 580)}.${int(r, 10, 99)}`,
          cuda: '12.4',
        },
        enrolled_at: ago(int(r, 1440, 200000)),
        /* Null is the honest value for a machine that has never checked in, and
           the pool view has to survive it. */
        last_seen_at: state === 'offline' ? ago(int(r, 120, 10000)) : ago(int(r, 0, 4)),
        activity: 'idle',
        attempts: [],
      });
    }

    /* Jobs: a bounded window of several hundred, so History is drawn over
       something. Newest last here; the route reverses. */
    let attemptId = 1000;

    /**
     * Batches, planned rather than sprinkled.
     *
     * A batch is one video cut into frame ranges, and the screens' `issues`
     * state is *derived* from it: a batch with both `succeeded` and `failed`
     * pieces is "completed with issues", which is the one place that state can
     * come from -- a single job is never succeeded-with-problems, because #225
     * settled that a job whose results did not reach the database is failed.
     *
     * Sprinkling a `batch_id` at random left that state reachable only by
     * luck, which is not the same as reachable. Five batches are therefore
     * built to finish mixed, so the screen always has one to draw.
     */
    const batchPlan = new Map();

    for (let b = 0; b < 12; b++) {
      const batchId = `b${String(b + 1).padStart(4, '0')}-a7c1-4e55-9f32-0d81cc0e91aa`;
      const size = int(r, 4, 8);
      const start = int(r, 1, 400);
      const mixed = b < 5;

      for (let k = 0; k < size; k++) {
        if (batchPlan.has(start + k)) continue;
        /* In a mixed batch two pieces fail and the rest land, which is what
           "usable work is preserved; only failed work needs to run again"
           describes on the screen. */
        batchPlan.set(start + k, {
          batchId,
          forced: mixed ? (k === 0 || k === 2 ? 'failed' : 'succeeded') : null,
          /* One mixed batch is made recent on purpose. The list is newest
             first, so a batch scattered through a fortnight is reachable in the
             data and still invisible on the first page -- and a state nobody
             can see on the screen they open is not a state the design has been
             shown to handle. */
          recent: b === 0,
        });
      }
    }

    for (let i = 1; i <= 420; i++) {
      /* **Two jobs are placed rather than rolled**, for the same reason the
         mixed batch is: #180's R16 is a whole review hierarchy that only a
         *completed training* job draws -- epoch curves, per-class metrics, a
         confusion matrix, the best checkpoint. Left to chance, training is a
         tenth of the corpus and completed training a fraction of that, so the
         screen could go a whole page without showing any of it. A state the
         design is built around has to be on the first page. */
      const placed = i <= 2 ? { kind: 'training', state: 'succeeded', recent: true } : null;
      const kind = placed ? placed.kind : (r() < 0.62 ? 'inference' : pick(r, QUEUE_KINDS));

      /* **State first, then when it happened** -- not the other way round. The
         first cut of this drew a time and then let the time decide the state,
         which left two jobs `leased` out of 420: a pool screen about work in
         flight, with no work in flight. A state is chosen from a weighted table
         and the timestamp is then made to agree with it, so live work is recent
         and finished work is spread back through the window. */
      const plan = batchPlan.get(i) || null;

      let state;
      const roll = r();
      if (placed) state = placed.state;
      else if (plan && plan.forced) state = plan.forced;
      else if (roll < 0.05) state = 'leased';
      else if (roll < 0.11) state = 'queued';
      else if (roll < 0.74) state = 'succeeded';
      else if (roll < 0.86) state = 'failed';
      else if (roll < 0.94) state = 'cancelled';
      else state = 'expired';

      /* Live work is minutes old; everything terminal is spread over the window
         the History screen is drawn for. */
      /* **Finished work can be minutes old.** Terminal jobs used to start an
         hour back, so the newest eighteen rows -- the first page, sorted newest
         first -- were nothing but running and queued work. A queue where
         nothing has finished recently is not a queue anybody has seen, and it
         left the Jobs screen unable to show a completed or cancelled job at all
         without paging. */
      const live = state === 'leased' || state === 'queued';
      /* Squared, so finished work clusters in the last few hours and thins out
         across the fortnight. Spread evenly, a hundred-odd live jobs drowned
         every terminal one out of the newest page: the first page of a job
         queue showed nothing that had ever finished. Real queues finish work
         constantly, and most of what finished, finished recently. */
      const aged = Math.round((r() ** 2) * 60 * 24 * 14);
      const createdMinutes = (live || (plan && plan.recent) || (placed && placed.recent))
        ? int(r, 0, 240)
        : 5 + aged;

      /* Drawn once here because the spec below and the title the screen
         composes from it have to agree -- a dive on the job and a different
         dive in its name is the kind of thing nobody notices for weeks. */
      const dive = String(int(r, 100, 999)).padStart(4, '0');
      const line = int(r, 1, 24);
      const survey = pick(r, SURVEYS);
      const sessionType = pick(r, ['Fish', 'Invert', 'Habitat']);
      const modelName = pick(r, MODELS[sessionType]);
      const endFrame = int(r, 1200, 48000);

      const job = {
        id: 9000 + i,
        batch_id: plan ? plan.batchId : null,
        kind,
        /* The real `GpuJobSpec`, not a convenient flattening of it. It has no
           `name` field -- the job titles the screens show are composed from
           `session` and `model`, which is why they read
           "CAMPA_2024_D0305_L15_...". A spec with a `name` on it would be a
           field MARP does not have, invented here and then expected later. */
        spec: {
          engine: 'ultralytics',
          model: {
            name: modelName,
            sha256: hex(r, 64),
            ml_model_id: int(r, 1, 15),
          },
          video: {
            url: `https://jellyfin.local/Items/${hex(r, 32)}/Download`,
            jellyfin_item_id: hex(r, 32),
            source_name: `${survey} D${dive} L${line}.mp4`,
          },
          session: {
            session_id: int(r, 1, 127),
            project_id: int(r, 1, 13),
            dive,
            line: String(line),
            type: sessionType,
          },
          range: { start_frame: 0, end_frame: endFrame },
          params: {
            conf: Number((0.2 + r() * 0.3).toFixed(2)),
            iou: 0.7,
            imgsz: pick(r, [640, 960, 1280]),
            tracker: 'bytetrack',
            data_type: sessionType,
          },
          reduction: { name: 'bytetrack', version: 1 },
        },
        state,
        priority: int(r, 0, 9),
        attempts_made: 0,
        max_attempts: 3,
        published_attempt_id: null,
        created_by: r() < 0.8 ? int(r, 1, 6) : null,
        created_at: ago(createdMinutes),
        /* Never exactly the corpus present: clamping to zero put most live
           work at the same instant, which reads as synthetic in an Updated
           column. A running job is touched within the last few minutes. */
        updated_at: ago(live ? int(r, 0, 6) : Math.max(1, createdMinutes - int(r, 0, 120))),
        /* Gap 23. The attempt's own field names, so the route learning to carry
           this renames nothing. Null is not zero: a job with no heartbeat yet
           has no measurement, and the screen draws a dash rather than a 0% bar. */
        progress_done: null,
        progress_total: null,
        progress_unit: null,
        progress_phase: null,
        progress_elapsed_s: null,
      };

      /* A leased job is being worked on right now: it holds a live attempt on a
         machine, and that machine is therefore busy. This is the one place the
         two halves of the corpus are tied together. */
      if (state === 'leased') {
        const worker = workers[int(r, 0, workers.length - 1)];
        const total = job.spec.range.end_frame;
        const done = int(r, 0, total);
        const attempt = {
          id: ++attemptId,
          job_id: job.id,
          worker_id: worker.worker_id,
          slot_index: int(r, 0, worker.slot_count - 1),
          lease_epoch: 1,
          state: pick(r, LIVE_ATTEMPT_STATES),
          leased_at: ago(int(r, 1, 120)),
          lease_expires_at: ago(-int(r, 1, 30)),
          last_heartbeat_at: ago(int(r, 0, 2)),
          progress_done: done,
          progress_total: total,
          progress_unit: 'frames',
          progress_phase: kind === 'training' ? 'train' : 'infer',
          progress_elapsed_s: int(r, 30, 7200),
          capabilities_snapshot: worker.capabilities,
          failure_reason: null,
          finished_at: null,
          worker: { worker_id: worker.worker_id, name: worker.name },
        };

        /* A heartbeat may not have landed yet, and that is a real state the
           screen has to draw. Leave the whole measurement null when it has not. */
        if (r() < 0.12) {
          attempt.last_heartbeat_at = null;
          attempt.progress_done = null;
          attempt.progress_total = null;
          attempt.progress_unit = null;
          attempt.progress_phase = null;
          attempt.progress_elapsed_s = null;
        }

        attempts.push(attempt);
        worker.attempts.push(attempt);
        worker.activity = 'busy';
        job.attempts_made = 1;
        job.progress_done = attempt.progress_done;
        job.progress_total = attempt.progress_total;
        job.progress_unit = attempt.progress_unit;
        job.progress_phase = attempt.progress_phase;
        job.progress_elapsed_s = attempt.progress_elapsed_s;
      }

      if (state === 'succeeded' || state === 'failed') {
        job.attempts_made = state === 'failed' ? int(r, 1, 3) : 1;
        const total = job.spec.range.end_frame;
        const attempt = {
          id: ++attemptId,
          job_id: job.id,
          worker_id: workers[int(r, 0, workers.length - 1)].worker_id,
          slot_index: 0,
          lease_epoch: 1,
          state: state === 'succeeded' ? 'succeeded' : 'failed',
          leased_at: ago(createdMinutes - 1),
          lease_expires_at: ago(createdMinutes - 30),
          last_heartbeat_at: ago(createdMinutes - 20),
          progress_done: state === 'succeeded' ? total : int(r, 0, total),
          progress_total: total,
          progress_unit: 'frames',
          progress_phase: 'done',
          progress_elapsed_s: int(r, 120, 14400),
          capabilities_snapshot: null,
          failure_reason: state === 'failed'
            ? pick(r, ['CUDA out of memory', 'worker lost', 'model load failed', 'video unreadable'])
            : null,
          finished_at: ago(Math.max(0, createdMinutes - int(r, 10, 200))),
          worker: null,
        };
        attempts.push(attempt);
        if (state === 'succeeded') job.published_attempt_id = attempt.id;
        job.progress_done = attempt.progress_done;
        job.progress_total = attempt.progress_total;
        job.progress_unit = attempt.progress_unit;
        job.progress_phase = attempt.progress_phase;
        job.progress_elapsed_s = attempt.progress_elapsed_s;
      }

      /* `cancelling` is derived and not stored: a cancelled job that still holds
         a live attempt, which #104 measured at 18-20 seconds. The screen derives
         it; the layer's job is to make the state reachable at all. */
      if (state === 'cancelled' && r() < 0.25) {
        const worker = workers[int(r, 0, workers.length - 1)];
        const attempt = {
          id: ++attemptId,
          job_id: job.id,
          worker_id: worker.worker_id,
          slot_index: 0,
          lease_epoch: 1,
          state: 'running',
          leased_at: ago(int(r, 1, 60)),
          lease_expires_at: ago(-int(r, 1, 20)),
          last_heartbeat_at: ago(0),
          progress_done: int(r, 1, 1000),
          progress_total: job.spec.range.end_frame,
          progress_unit: 'frames',
          progress_phase: 'infer',
          progress_elapsed_s: int(r, 30, 900),
          capabilities_snapshot: null,
          failure_reason: null,
          finished_at: null,
          worker: { worker_id: worker.worker_id, name: worker.name },
        };
        attempts.push(attempt);
        worker.attempts.push(attempt);
        worker.activity = 'busy';
        job.attempts_made = 1;
      }

      jobs.push(job);
    }

    /* Activity is derived in the real route and never stored, so it is derived
       here the same way -- and "the same way" means exactly `gpu.service.js`:

           activity: row.state === 'online' ? 'idle' : row.state
           ... then `activity = 'busy'` for any row with an attempt

       **Holding an attempt wins over every state**, including paused and
       offline. This had the precedence the other way round, so a paused machine
       still running work reported `paused` here and would report `busy` from
       MARP. `data-layer-check` caught it on its first run; it is the kind of
       difference a screen cannot show you, because both answers look sensible. */
    for (const w of workers) {
      w.activity = w.state === 'online' ? 'idle' : w.state;
      if (w.attempts.length) w.activity = 'busy';
    }

    return { workers, jobs, attempts };
  }

  /**
   * The registry and the saved datasets.
   *
   * **These are not GPU routes**, which is why they were missed at first: the
   * dashboard reads `GET /api/v2/ml_models` and `GET /api/v2/dataset`, outside
   * the `/gpu/` group entirely. Both are plain arrays and neither pages.
   *
   * `training_run` is *not* here, and that is a fact rather than an omission:
   * `/v2/training_run` has only a `POST`. A run can be created and never
   * listed, so no screen can show training history from the API.
   *
   * @returns {{models: Object[], datasets: Object[]}}
   */
  function buildRegistry() {
    const r = rng(SEED ^ 0x5eed);
    const models = [];
    const datasets = [];

    const TYPES = ['detection', 'classification', 'segmentation'];

    /* **Built as chains, not as 28 independent rows.** Picking a family, a
       version and a parent separately produced a model called `-v5` whose
       `parent_model_id` walk said it was the third generation, and a reader
       comparing the name with the Version column would have been right to
       distrust both. A family is now generated in order: generation k is named
       for k and its parent is generation k-1, so the name and the self-join
       cannot disagree. */
    const FAMILIES = [
      ['fish', 'detection'], ['inverts', 'detection'], ['rockfish', 'detection'],
      ['habitat', 'classification'], ['substrate', 'classification'],
      ['coral-masks', 'segmentation'], ['sponge-masks', 'segmentation'],
    ];

    let modelId = 0;
    for (const [family, type] of FAMILIES) {
      const generations = int(r, 2, 6);
      let parent = null;
      /* The oldest generation is the oldest row; each one follows its parent. */
      let bornMinutes = int(r, 200000, 320000);

      for (let version = 1; version <= generations; version++) {
        modelId += 1;
        /* The newest generation is the live one; older ones are archived, which
           is what a registry actually looks like after a year. */
        /* The newest generation is the live one. Older ones mostly retire, but
           not all of them: archiving every ancestor left a registry that was
           four fifths archived, which is a graveyard rather than a registry. */
        const newest = version === generations;
        const status = newest
          ? (r() < 0.78 ? 'trained' : pick(r, ['training', 'draft']))
          : (r() < 0.55 ? 'archived' : 'trained');

        models.push({
          id: modelId,
          name: `marp-${family}-v${version}`,
          /* A version chain is a self-join, not a `versions` array -- gap 16. */
          parent_model_id: parent,
          model_type: type,
          architecture_version: `yolov8${pick(r, ['n', 's', 'm', 'l'])}`,
          storage_path: `models/marp-${family}-v${version}/weights/best.pt`,
          status,
          notes: null,
          created_at: ago(bornMinutes),
          /* The live generation was touched this week; its ancestors were last
             touched around when they were superseded. All of them updated
             within a day made "recently trained" mean "every model", and all
             of them old made it mean none. */
          updated_at: newest
            ? ago(int(r, 60, 7 * 1440))
            : ago(Math.max(1440, bornMinutes - int(r, 500, 40000))),
        });

        parent = modelId;
        bornMinutes = Math.max(2000, bornMinutes - int(r, 20000, 60000));
      }
    }

    /* **Three of the thirty-eight are not ready**, and that is the whole reason the
       corpus carries `status` at all. Every dataset here used to be finished, so the
       design review and the screenshot tool could not see a build in flight -- the one
       state #268's item 1.2 is about -- and the Datasets screen's *Building now*,
       *Queued builds* and *Needs attention* cards were nothing but zeroes. Fixed ids
       rather than a roll of the generator, because R3 is that a regenerated corpus is
       byte-identical and a screenshot of a build has to be of the same build. */
    const BUILDING = 1;
    const QUEUED = 2;
    const FAILED = 3;

    for (let i = 1; i <= 38; i++) {
      const classes = int(r, 4, 24);
      const status = i === BUILDING || i === QUEUED ? 'building' : i === FAILED ? 'failed' : 'ready';
      datasets.push({
        id: i,
        name: `${pick(r, SURVEYS).replace(' ', '_')}_${pick(r, ['Fish', 'Inverts', 'Habitat'])}_v${int(r, 1, 5)}`,
        description: 'Training corpus built from reviewed observations',
        location: `datasets/${i}/`,
        /* Null until a build finishes. The counts are written when the archive is
           packaged, so a row that exists while they do not is the normal case for
           hours, and it is the case that threw when the screen assumed a number.

           **Two quantities, not one.** `num_samples` is images -- one per extracted
           frame -- and `num_observations` is how many observations went in. The second
           is far smaller, because the frames between two keyframes are interpolated and
           trained on as well, so a corpus that made them equal would hide the column
           that was being filled with the wrong one. */
        num_samples: status === 'ready' ? int(r, 2000, 60000) : null,
        num_observations: status === 'ready' ? int(r, 40, 900) : null,
        num_classes: status === 'ready' ? classes : null,
        source: 'mosaic review',
        status,
        notes: null,
        created_at: ago(int(r, 1440, 300000)),
        updated_at: ago(int(r, 60, 20000)),
      });
    }

    /* The two builds in flight, as `GET /dataset/builds` answers for them.
       **Frozen, not advancing.** A corpus that moved with the wall clock would make two
       people looking at one screen see different numbers, and a screenshot check compare
       against something that had changed since -- which is R3. So this is one instant of
       one build, and the screen draws it exactly as it draws a real one. */
    const datasetBuilds = [
      {
        dataset_id: BUILDING,
        job_id: 2048,
        state: 'leased',
        attempts_made: 1,
        max_attempts: 3,
        queued_at: ago(140),
        attempt_id: 4096,
        progress_done: 42816,
        progress_total: 63200,
        progress_unit: 'frames',
        progress_phase: 'extracting',
        started_at: ago(138),
        last_heartbeat_at: ago(1),
      },
      {
        dataset_id: QUEUED,
        job_id: 2049,
        state: 'queued',
        attempts_made: 0,
        max_attempts: 3,
        queued_at: ago(12),
        attempt_id: null,
        progress_done: null,
        progress_total: null,
        progress_unit: null,
        progress_phase: null,
        started_at: null,
        last_heartbeat_at: null,
      },
    ];

    /* Projects and the people who submit jobs. Both are real list routes --
       `GET /api/v2/projects` and `GET /api/v2/users` -- which is worth saying
       because a job carries `created_by` and `session.project_id` as bare
       integers, and a screen that shows "6" where a name belongs looks like a
       missing feature rather than an unresolved id. */
    const projects = [];
    const PROJECT_NAMES = [
      'CAMPA 2024', 'GULF 2025', 'PACIFIC 2023', 'SALT 2025', 'VENTS 2025',
      'ARCTIC 2024', 'CAMPA 2025', 'GULF 2024', 'PACIFIC 2024', 'SALT 2024',
      'VENTS 2024', 'ARCTIC 2025', 'CAMPA 2023',
    ];
    PROJECT_NAMES.forEach((name, index) => {
      projects.push({
        project_id: index + 1,
        name,
        createdAt: ago(int(r, 100000, 400000)),
        updatedAt: ago(int(r, 1440, 90000)),
      });
    });

    const users = [];
    const PEOPLE = ['A. Travers', 'J. Okafor', 'M. Lindqvist', 'R. Nakamura', 'S. Oyelaran', 'T. Brennan'];
    PEOPLE.forEach((name, index) => {
      users.push({
        user_id: index + 1,
        name,
        username: name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, ''),
        status: 'active',
        last_login_at: ago(int(r, 0, 10000)),
        createdAt: ago(int(r, 100000, 400000)),
        updatedAt: ago(int(r, 1440, 90000)),
      });
    });

    return { models, datasets, datasetBuilds, projects, users };
  }

  const CORPUS = build();
  const REGISTRY = buildRegistry();

  /* ============================================================== the switch */

  /**
   * Latency and failure, asked for explicitly (#128, A3).
   *
   * `?mock=slow` makes every call take two seconds; `?mock=fail:jobs` makes the
   * job routes answer 500. The default path is instant and successful, so R3's
   * determinism is untouched and nobody meets a failure by accident -- and a
   * failure is reproducible by URL, which is what makes it demonstrable.
   */
  const SWITCH = (function () {
    const raw = new URLSearchParams(location.search).get('mock') || '';
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const fail = new Set();
    let slow = false;

    let fixture = false;

    for (const part of parts) {
      if (part === 'slow') slow = true;
      else if (part.startsWith('fail:')) fail.add(part.slice(5));
      else if (part === 'fail') fail.add('*');
      else if (part === 'empty') fail.add('@empty');
      else if (part === 'all') fixture = true;
    }
    return { slow, fail, raw, fixture };
  })();

  /** An error carrying a status, so a screen can tell 500 from 404. */
  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  /**
   * Every route goes through here, so latency and failure are one decision
   * rather than something each route remembers to do.
   *
   * @param {string} route - Short name the `fail:` switch matches on.
   * @param {function(): *} produce - Builds the answer.
   * @returns {Promise<*>}
   */
  /**
   * The one place that knows `fetch`, a URL, a header and an HTTP status.
   *
   * **`credentials: 'same-origin'`, and no scheme invented.** These pages are served by the
   * API they call, `resolve-principal.middleware.js` fills `req.principal` from the Passport
   * session before it looks for a bearer token, and the cookie is `httpOnly`/`sameSite:lax`
   * -- so a same-origin request is authorised by the session the person already has. Nothing
   * is stored here, no token goes in a query string. `marp-mosaic-review` settled this and
   * this follows it rather than inventing a second answer.
   *
   * Nothing is retried. Which failures are worth retrying is a screen's question, and a
   * transport that retries a 403 turns "you are not allowed" into a hang.
   *
   * @param {string} path - Below `/api/v2`, e.g. `/gpu/workers`.
   * @param {Object} [options]
   * @param {string} [options.method] - Defaults to GET.
   * @param {Object} [options.query] - Appended, skipping undefined and null.
   * @param {Object} [options.body] - Sent as JSON when present.
   * @returns {Promise<*>} The parsed body, or null for a 204.
   * @throws {ApiError} With the status, and the API's own message where it sent one.
   */
  async function request(path, options) {
    const { method = 'GET', query, body } = options || {};
    const url = new URL(`/api/v2${path}`, location.origin);

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') continue;

      /* **Scalars only.** A caller that passes an object gets it stringified into
         the query, and the one time that happened the object was `window` -- so
         the request carried every global as a parameter, ran to several thousand
         characters, and came back 431 with a reason that said nothing about the
         mistake. Skipping is better than a URL nobody meant to build. */
      const kind = typeof value;

      if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') {
        console.warn(`MarpApi: ignoring query parameter "${key}" of type ${kind}`);
        continue;
      }

      url.searchParams.set(key, value);
    }

    let response;

    try {
      response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // No status at all: the request never arrived. Distinct from a 500, and a
      // screen should say "could not reach MARP" rather than "MARP failed".
      throw new ApiError(0, `Could not reach MARP: ${error.message}`);
    }

    if (!response.ok) {
      /* `error-contract.middleware.js` answers {error:{code,message,status}}.
         Read defensively: a proxy in front of the API can answer with HTML, and
         a client that throws while working out what went wrong says nothing. */
      let message = `${response.status} ${response.statusText || ''}`.trim();

      try {
        const problem = await response.json();
        if (problem && problem.error && problem.error.message) message = problem.error.message;
      } catch { /* not JSON, or empty */ }

      throw new ApiError(response.status, message);
    }

    return response.status === 204 ? null : response.json();
  }

  /**
   * Every route goes through here, so latency, failure and the choice between MARP and the
   * built-in corpus are one decision rather than something each route remembers.
   *
   * **Live by default.** `?mock=all` serves the generated corpus instead, which is what the
   * design review and the screenshot tool run against: they need a page that draws without a
   * database behind it, and the corpus is deterministic so the pictures do not move.
   *
   * `?mock=slow` and `?mock=fail:<route>` still work either way, because they are how the
   * loading and error states are demonstrated and a real API cannot be asked to fail on cue.
   *
   * @param {string} route - Short name the `fail:` switch matches on.
   * @param {function(): Promise<*>} live - Asks MARP.
   * @param {function(): *} produce - Builds the same answer from the corpus.
   * @returns {Promise<*>}
   */
  async function serve(route, live, produce) {
    if (SWITCH.slow) await new Promise((done) => setTimeout(done, 2000));
    if (SWITCH.fail.has(route) || SWITCH.fail.has('*')) {
      throw new ApiError(500, `Mock failure for ${route}`);
    }
    return SWITCH.fixture ? produce() : live();
  }

  /** Deep copy, so a caller cannot edit the corpus by editing what it got. */
  const copy = (value) => JSON.parse(JSON.stringify(value));

  /* ================================================================= routes */

  /**
   * `GET /api/v2/gpu/workers` -- every machine, **unpaged**.
   *
   * Unpaged because the real route is, and `DESIGN.md` gap 12 is the record of
   * that being a problem at scale rather than a licence to fix it here.
   *
   * @returns {Promise<Object[]>}
   */
  function listWorkers() {
    return serve('workers', () => request('/gpu/workers'), () => {
      if (SWITCH.fail.has('@empty')) return [];
      return copy(CORPUS.workers);
    });
  }

  /**
   * `GET /api/v2/gpu/jobs` -- a page, newest first.
   *
   * Ordered by `created_at` then `id`. The tie-breaker is not decoration: a
   * batch's pieces are inserted in one statement and share a timestamp, and
   * without it two pages of the same list can show one piece twice and miss
   * another.
   *
   * @param {Object} [query] - `state`, `kind`, `batch_id`, `limit`, `offset`.
   * @returns {Promise<{jobs: Object[], total: number, limit: number, offset: number}>}
   */
  function listJobs(query) {
    const q = query || {};
    return serve('jobs', () => request('/gpu/jobs', { query: q }), () => {
      if (SWITCH.fail.has('@empty')) return { jobs: [], total: 0, limit: 50, offset: 0 };

      let rows = CORPUS.jobs.slice();
      if (q.state) rows = rows.filter((j) => j.state === q.state);
      if (q.kind) rows = rows.filter((j) => j.kind === q.kind);
      if (q.batch_id) rows = rows.filter((j) => j.batch_id === q.batch_id);

      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));

      const limit = Math.min(Number(q.limit) || 50, 500);
      const offset = Number(q.offset) || 0;
      return { jobs: copy(rows.slice(offset, offset + limit)), total: rows.length, limit, offset };
    });
  }

  /**
   * `GET /api/v2/gpu/jobs/:id` -- the job, its attempts, its artifacts.
   *
   * @param {number} id - Job id.
   * @returns {Promise<{job: Object, attempts: Object[], artifacts: Object[]}>}
   */
  function getJob(id) {
    return serve('jobs', () => request(`/gpu/jobs/${encodeURIComponent(id)}`), () => {
      const job = CORPUS.jobs.find((j) => j.id === Number(id));
      if (!job) throw new ApiError(404, `No job ${id}`);
      const mine = CORPUS.attempts.filter((a) => a.job_id === job.id);
      /* `artifacts.path` is recorded and nothing serves the bytes -- gap 6. The
         rows exist so the screen can list them; there is nowhere to download. */
      const artifacts = job.published_attempt_id
        ? [{ artifact_id: job.published_attempt_id, kind: 'observations', path: `artifacts/${job.id}/observations.json`, byte_size: 1048576 + job.id }]
        : [];
      return { job: copy(job), attempts: copy(mine), artifacts };
    });
  }

  /**
   * `POST /api/v2/gpu/jobs` -- answers **200**, not 201.
   *
   * Kept wrong-looking on purpose: R2 says the shapes match the real routes
   * including the awkward ones, and a layer that quietly corrected this would
   * teach the screen an answer the API does not give.
   *
   * @param {Object} spec - The job spec.
   * @returns {Promise<{status: number, job: Object}>}
   */
  function submitJob(spec) {
    return serve('jobs', () => request('/gpu/jobs', { method: 'POST', body: spec }), () => {
      const job = {
        id: 9000 + CORPUS.jobs.length + 1,
        batch_id: null,
        kind: (spec && spec.kind) || 'inference',
        spec: copy(spec || {}),
        state: 'queued',
        priority: (spec && spec.priority) || 5,
        attempts_made: 0,
        max_attempts: 3,
        published_attempt_id: null,
        created_by: 1,
        created_at: new Date(NOW).toISOString(),
        updated_at: new Date(NOW).toISOString(),
        progress_done: null,
        progress_total: null,
        progress_unit: null,
        progress_phase: null,
        progress_elapsed_s: null,
      };
      CORPUS.jobs.push(job);
      return { status: 200, job: copy(job) };
    });
  }

  /**
   * `POST /api/v2/gpu/jobs/:id/cancel`.
   *
   * @param {number} id - Job id.
   * @returns {Promise<Object>}
   */
  function cancelJob(id) {
    return serve('jobs', () => request(`/gpu/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }), () => {
      const job = CORPUS.jobs.find((j) => j.id === Number(id));
      if (!job) throw new ApiError(404, `No job ${id}`);
      job.state = 'cancelled';
      job.updated_at = new Date(NOW).toISOString();
      return copy(job);
    });
  }

  /**
   * `POST /api/v2/gpu/workers/:id/rename` -- the one worker mutation that
   * exists. Pause, drain, retire and the rest are gap 7.
   *
   * @param {number} id - Worker id.
   * @param {string} name - The new name.
   * @returns {Promise<Object>}
   */
  function renameWorker(id, name) {
    return serve('workers', () => request(`/gpu/workers/${encodeURIComponent(id)}/rename`, { method: 'POST', body: { name } }), () => {
      const worker = CORPUS.workers.find((w) => w.worker_id === Number(id));
      if (!worker) throw new ApiError(404, `No worker ${id}`);
      worker.name = String(name);
      return copy(worker);
    });
  }

  /**
   * `GET /api/v2/ml_models` -- the registry, as a plain array.
   *
   * An `MlModel` carries `preferred` since #260 -- one per `model_type` -- and its
   * version chain is reachable at `/ml_models/:id/versions`. What is still not on
   * it is any count of how many workers hold the model cached.
   *
   * @returns {Promise<Object[]>}
   */
  function listModels() {
    return serve('models', () => request('/ml_models'), () => (SWITCH.fail.has('@empty') ? [] : copy(REGISTRY.models)));
  }

  /**
   * `POST /api/v2/dataset/build` -- build a dataset out of the matching observations.
   *
   * **Answers immediately with the dataset and the job, not with a dataset.** A real
   * build cuts tens of thousands of frames out of video and takes hours, so what comes
   * back is something to watch: the job carries progress, can be cancelled, and appears
   * on the Jobs screen like any other.
   *
   * @param {Object} build - `{name, description, filters, splits}`.
   * @returns {Promise<{dataset: Object, job: Object}>}
   */
  function queueDatasetBuild(build) {
    // Not `request`: that is this module's transport, and shadowing it here would make
    // the call unable to reach the thing it is trying to call.
    return serve('datasets',
      () => request('/dataset/build', { method: 'POST', body: build || {} }),
      () => ({ dataset: { id: 0, status: 'building' }, job: { id: 0, state: 'queued' } }));
  }

  /**
   * `GET /api/v2/ml_models/:id/versions` -- the chain a model belongs to, oldest first.
   *
   * A model is always in its own chain, so a one-element answer means "not versioned"
   * rather than "not found". Nothing in this database sets `parent_model_id` yet, so
   * every chain is currently one long -- which the Inference screen says out loud
   * rather than offering a version picker with one entry.
   *
   * @param {number|string} id - Any model in the chain.
   * @returns {Promise<Object[]>}
   */
  function listModelVersions(id) {
    return serve('models',
      () => request(`/ml_models/${encodeURIComponent(id)}/versions`),
      () => []);
  }

  /**
   * `GET /api/v2/ml_models/:id/species` -- the classes a model can detect.
   *
   * **An empty array is a real answer**: a registered model nothing has mapped yet.
   * The spread is wide -- one model here maps a single species and another maps 499 --
   * which is why "all 8 species" could never have been markup.
   *
   * @param {number|string} id - The model.
   * @returns {Promise<Object[]>}
   */
  function listModelSpecies(id) {
    return serve('models',
      () => request(`/ml_models/${encodeURIComponent(id)}/species`),
      () => []);
  }

  /**
   * `GET /api/v2/dataset` -- saved datasets, as a plain array.
   *
   * A `Dataset` carries `status` since #260: draft, building, ready or failed.
   * What no API records is a build's *progress*, which is gap 19.
   *
   * @returns {Promise<Object[]>}
   */
  function listDatasets() {
    return serve('datasets', () => request('/dataset'), () => (SWITCH.fail.has('@empty') ? [] : copy(REGISTRY.datasets)));
  }

  /**
   * `GET /api/v2/dataset/builds` -- how far every build still running has got.
   *
   * **The progress is on the attempt, which is why this is not on the dataset.** A
   * `dataset_build` job names its dataset in `spec.dataset_id`; its latest attempt carries
   * `progress_done`, `progress_total` and `progress_phase`. The route does that join once
   * for every building dataset, so a screen listing them draws progress without a request
   * per row.
   *
   * **`[]` is the answer that matters.** Nothing in flight, so a screen polling this stops.
   *
   * A `queued` build comes back with no attempt and no counts: `datasets.status` says
   * `building` from the instant one is queued, so the job state is the only thing that can
   * tell waiting from started.
   *
   * The corpus answers with two frozen builds -- one extracting, one queued -- so the
   * design review and the screenshot tool can see the state this route exists for. Frozen
   * rather than advancing, because R3 is that a regenerated corpus is byte-identical and a
   * build that moved with the wall clock would show two people different numbers.
   *
   * @returns {Promise<Object[]>}
   */
  /**
   * `GET /api/v2/dataset/:id/composition` -- what one dataset is made of.
   *
   * Splits counted out of `dataset_observations`, and the class vocabulary out of
   * `dataset_classes` in index order. Asked when a row is expanded rather than for every
   * row the table draws: it answers about one dataset and only a person opening one needs
   * it.
   *
   * Both arrays come back empty for a dataset built before membership was recorded, which
   * is every legacy import -- the panel says so rather than drawing an empty bar.
   *
   * @param {number|string} id - The dataset.
   * @returns {Promise<{splits: Object[], classes: Object[]}>}
   */
  function datasetComposition(id) {
    return serve('datasets',
      () => request(`/dataset/${encodeURIComponent(id)}/composition`),
      () => ({ splits: [], classes: [] }));
  }

  /**
   * `GET /api/v2/dataset/:id/preview` -- a sample of the frames the build cut.
   *
   * The actual training images, read out of the archive, each with the boxes its YOLO
   * label file records. What sat here before was four hardcoded Jellyfin item ids, the
   * same four pictures on every dataset.
   *
   * **The corpus answers with nothing, on purpose.** A preview is the one thing on this
   * screen that cannot be stood in for: a plausible picture of an animal is exactly the
   * failure that was just taken out, and a design review looking at invented frames would
   * be reviewing the fixture again. The panel says it has no preview instead.
   *
   * @param {number|string} id - The dataset.
   * @param {number} [limit] - How many frames.
   * @returns {Promise<{sha256: string, total: number, frames: Object[]}>}
   */
  /**
   * `DELETE /api/v2/dataset/:id` -- remove a dataset, its membership and its archive.
   *
   * Refuses with 409 when a model was trained from it, which is the schema's own rule:
   * `training_runs.dataset_id` is `NO ACTION`, so a dataset stays as long as it is the
   * record of what a model saw. Also 409 while it is still building, which asks for the
   * build to be cancelled first. Both carry the sentence to show.
   *
   * **No corpus fallback.** A delete that silently succeeds against a fixture would teach
   * the control works when nothing was removed; in corpus mode the request is made and
   * its answer is whatever the API says.
   *
   * @param {number|string} id - The dataset.
   * @returns {Promise<{deleted: boolean, archive_removed: boolean}>}
   */
  /**
   * `GET /api/v2/dataset/:id/build-setup` -- the queries a dataset was built from.
   *
   * What *Duplicate setup* fills the build flow with. Reads only; nothing is created
   * until the ordinary Queue button is pressed.
   *
   * 404 means there is nothing worth copying -- a legacy import with no job, or a build
   * whose queries were not recorded -- and the control says so rather than opening an
   * empty form that looks like it worked.
   *
   * @param {number|string} id - The dataset to copy.
   * @returns {Promise<Object>}
   */
  /**
   * `GET /api/v2/dataset/build-queue` -- the builds waiting, in the order they will run.
   *
   * The order was always real -- `claimBuild` selects by priority then age -- and was
   * nowhere on screen, so nothing could be reordered meaningfully.
   *
   * @returns {Promise<{concurrency: number, running: number, queue: Object[]}>}
   */
  function datasetBuildQueue() {
    return serve('datasets',
      () => request('/dataset/build-queue'),
      () => ({ concurrency: 2, running: 0, queue: [] }));
  }

  /**
   * `POST /api/v2/dataset/build-queue/:jobId/move` -- one place sooner or later.
   *
   * @param {number|string} jobId - The queued build.
   * @param {string} direction - `up` or `down`.
   * @returns {Promise<{moved: boolean, queue: Object[]}>}
   */
  function moveQueuedBuild(jobId, direction) {
    return request(`/dataset/build-queue/${encodeURIComponent(jobId)}/move`, {
      method: 'POST',
      body: { direction },
    });
  }

  function datasetBuildSetup(id) {
    return request(`/dataset/${encodeURIComponent(id)}/build-setup`);
  }

  function deleteDataset(id) {
    return request(`/dataset/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  function datasetPreview(id, limit) {
    return serve('datasets',
      () => request(`/dataset/${encodeURIComponent(id)}/preview${limit ? `?limit=${encodeURIComponent(limit)}` : ''}`),
      () => ({ sha256: '', total: 0, frames: [] }));
  }

  function listDatasetBuilds() {
    return serve('datasets',
      () => request('/dataset/builds'),
      () => (SWITCH.fail.has('@empty') ? [] : copy(REGISTRY.datasetBuilds)));
  }

  /**
   * `GET /api/v2/projects` -- every project, as a plain array.
   *
   * A job carries `session.project_id` as a bare integer, so this is what turns
   * a 4 into "SALT 2025" anywhere a screen names a project.
   *
   * @returns {Promise<Object[]>}
   */
  function listProjects() {
    return serve('projects', () => request('/projects'), () => (SWITCH.fail.has('@empty') ? [] : copy(REGISTRY.projects)));
  }

  /**
   * `GET /api/v2/users` -- the people, as a plain array.
   *
   * `created_by` on a job is a user id and nothing more, so a History column
   * headed *By* needs this to say a name instead of a number.
   *
   * @returns {Promise<Object[]>}
   */
  function listUsers() {
    return serve('users', () => request('/users'), () => (SWITCH.fail.has('@empty') ? [] : copy(REGISTRY.users)));
  }

  /**
   * Who is signed in, or null.
   *
   * `/auth/me` answers 401 with no session, which is not an error here -- it is the answer.
   * A screen asks this before it draws so that a visitor without a session is told to sign
   * in, rather than shown eight screens of empty tables that look like a broken MARP.
   *
   * Always answers somebody under `?mock=all`: the design review and the screenshot tool
   * have no session and no API, and a sign-in wall in front of the fixtures would make the
   * corpus unreachable.
   *
   * @returns {Promise<?Object>} The signed-in user, or null.
   */
  function whoAmI() {
    return serve('auth',
      async () => {
        try {
          return await request('/auth/me');
        } catch (error) {
          if (error.status === 401) return null;
          throw error;
        }
      },
      () => copy(REGISTRY.users[0]));
  }

  /**
   * `GET /api/v2/sessions` -- every session, as a plain array.
   *
   * A real job's `spec.session` is `{session_id}` and nothing else: the dive and the line
   * live on the session row, and `describeSession` resolves them server-side only at lease
   * time, for the worker. A screen has to resolve them itself.
   *
   * This was the gap behind every job reading "No session". The fixtures inlined
   * `{dive, line}` into the spec, so the Scope column worked against them and had nothing to
   * resolve -- and the moment it met a real job it had an id it could not turn into a name.
   *
   * @returns {Promise<Object[]>}
   */
  function listSessions() {
    return serve('sessions',
      () => request('/sessions'),
      () => (SWITCH.fail.has('@empty') ? [] : copy(REGISTRY.sessions || [])));
  }

  /**
   * `GET /api/v2/jellyfin/libraries` -- the top of the video library.
   *
   * One entry per project folder, each carrying a `childCount`. This is what the Inference
   * screen's project picker is: the videos MARP can run against live in Jellyfin, not in
   * MARP, and `spec.video.jellyfin_item_id` is the id from here.
   *
   * @returns {Promise<Object[]>}
   */
  function listVideoLibraries() {
    return serve('jellyfin',
      () => request('/jellyfin/libraries').then((r) => r.items || []),
      () => (REGISTRY.libraries || []));
  }

  /**
   * `GET /api/v2/jellyfin/items/:id/children` -- one level down.
   *
   * A library's children are dives; a dive's children are videos. The same call does both,
   * which is why the picker is a drill-down rather than three different routes.
   *
   * `runtimeTicks` is Jellyfin's: ten-million per second. Left as it arrives rather than
   * converted here, because the screen that draws a duration is the one that knows what
   * format it wants.
   *
   * @param {string} id - The parent item.
   * @returns {Promise<Object[]>}
   */
  function listVideoChildren(id) {
    return serve('jellyfin',
      () => request(`/jellyfin/items/${encodeURIComponent(id)}/children`).then((r) => r.items || []),
      () => (REGISTRY.libraryChildren || {})[id] || []);
  }

  /**
   * `GET /api/v2/gpu/jobs/series` -- what went in and what came out, bucketed.
   *
   * `created`, `finished`, `succeeded` and `waiting` per bucket, with **nothing sampled**:
   * it is counted out of `gpu_jobs`, and `waiting` is reconstructed -- a job was waiting at
   * an instant if it was created before it and had not finished by it. Answerable only
   * because `gpu_jobs.finished_at` exists (#104 gap 24); `updated_at` moves on a heartbeat
   * and would have counted last week's job as finishing today.
   *
   * @param {Object} [query] - `{since, until, bucket}`.
   * @returns {Promise<{since: string, until: string, bucket: string, points: Object[]}>}
   */
  function jobSeries(query) {
    return serve('series',
      () => request('/gpu/jobs/series', { query: query || {} }),
      () => ({ since: null, until: null, bucket: (query && query.bucket) || 'hour', points: [] }));
  }

  /**
   * `GET /api/v2/gpu/telemetry/series` -- what the pool's GPUs were doing.
   *
   * Averaged across the machines in each bucket, with the maximum beside it. **Only
   * machines that were working appear**: a reading exists because a heartbeat wrote it, and
   * a heartbeat only happens during an attempt. So this is utilization of the machines
   * doing work, not of the pool's whole capacity, and a screen drawing it should say so.
   *
   * @param {Object} [query] - `{since, until, bucket}`.
   * @returns {Promise<{since: string, until: string, bucket: string, points: Object[]}>}
   */
  function gpuSeries(query) {
    return serve('series',
      () => request('/gpu/telemetry/series', { query: query || {} }),
      () => ({ since: null, until: null, bucket: (query && query.bucket) || 'hour', points: [] }));
  }

  /**
   * `GET /api/v2/gpu/throughput/series` -- how fast work went through.
   *
   * `units_done` per bucket, differenced from the cumulative progress MARP keeps per
   * attempt per minute, plus the current backlog in units rather than jobs. A rate needs
   * two readings and the attempt row only ever holds the latest, which is why this is a
   * route rather than a sum over the job list.
   *
   * @param {Object} [query] - `{since, until, bucket, kind}`.
   * @returns {Promise<Object>} `{since, until, bucket, kind, points, queued}`.
   */
  function throughputSeries(query) {
    return serve('series',
      () => request('/gpu/throughput/series', { query: query || {} }),
      () => ({ points: [], queued: { units: 0, jobs: 0 } }));
  }

  /**
   * `GET /api/v2/gpu/registry/series` -- how the model registry grew.
   *
   * `registered` cumulative, `added` per bucket, and `in_use`: how many distinct models
   * anything actually ran. The screen originally asked for `preferred` over time; see
   * `DESIGN.md`, *Decisions*, for why it does not.
   *
   * @param {Object} [query] - `{since, until, bucket}`.
   * @returns {Promise<Object>} `{since, until, bucket, points}`.
   */
  function registrySeries(query) {
    return serve('series',
      () => request('/gpu/registry/series', { query: query || {} }),
      () => ({ points: [] }));
  }

  /**
   * `POST /api/v2/mosaic/observations/counts` -- how a question divides across the
   * review states.
   *
   * **The status filters are ignored here**, deliberately and by the route: it
   * returns all six counts whether or not a status is selected. So the dataset
   * builder, which only ever wants promoted observations, reads `promoted` from the
   * answer rather than filtering for it and reading `total`. Those are two different
   * numbers over two different sets and substituting one for the other is the
   * mistake the route's own description warns about.
   *
   * @param {Object} filters - A `MosaicQueryFilters`.
   * @returns {Promise<Object>} `{total, unreviewed, reviewed, flagged, undecided, promoted, excluded}`.
   */
  function mosaicCounts(filters) {
    return serve('mosaic',
      () => request('/mosaic/observations/counts', { method: 'POST', body: { filters: filters || {} } }),
      () => ({ total: 0, unreviewed: 0, reviewed: 0, flagged: 0, undecided: 0, promoted: 0, excluded: 0 }));
  }

  /**
   * `POST /api/v2/mosaic/observations/facets` -- the values each dimension can still
   * offer under the filters already chosen.
   *
   * Unlike the counts route this one **does** apply the status filters, so asking it
   * with `trainingDisposition: ['promoted']` gives the species breakdown of promoted
   * work and nothing else. `count` rides along, which is what makes it a breakdown
   * rather than a list.
   *
   * The route answers `{facets: {...}}`; the envelope is unwrapped here so a screen
   * reads `species` rather than `facets.species` and cannot silently get an empty
   * list by forgetting the wrapper -- which reads on screen as "MARP has no species".
   *
   * @param {Object} filters - A `MosaicQueryFilters`.
   * @param {string[]} [dimensions] - Which to answer for. Absent means all of them.
   * @returns {Promise<Object>} One `{value, label, count, list?}[]` per dimension.
   */
  function mosaicFacets(filters, dimensions) {
    const body = { filters: filters || {} };
    if (dimensions) body.dimensions = dimensions;

    return serve('mosaic',
      () => request('/mosaic/observations/facets', { method: 'POST', body })
        .then((answer) => (answer && answer.facets) || {}),
      () => ({}));
  }

  /**
   * `POST /api/v2/mosaic/observations/frames` -- how much video a question covers.
   *
   * `frames` is the keyframes **plus the frames interpolated between them**, because a
   * dataset trains on those too, so it is the number a training run is sized against --
   * not `keyframes`, which is only where somebody drew a box.
   *
   * **The status filters apply here**, unlike the counts route, so a question asking
   * about promoted work gets the frames of promoted work.
   *
   * @param {Object} filters - A `MosaicQueryFilters`.
   * @returns {Promise<Object>} `{observations, keyframes, frames}`.
   */
  function mosaicFrames(filters) {
    return serve('mosaic',
      () => request('/mosaic/observations/frames', { method: 'POST', body: { filters: filters || {} } }),
      () => ({ observations: 0, keyframes: 0, frames: 0 }));
  }

  /**
   * `POST /api/v2/mosaic/observations/pages` -- rows, for the sample thumbnails.
   *
   * One page of one, asked for small: the preview shows six pictures and has no use
   * for the 45 the route serves by default.
   *
   * @param {Object} filters - A `MosaicQueryFilters`.
   * @param {number} pageSize - How many rows.
   * @returns {Promise<Object>} The route's page set.
   */
  function mosaicPages(filters, pageSize) {
    return serve('mosaic',
      () => request('/mosaic/observations/pages', {
        method: 'POST',
        // 1-based. Page 0 is not the first page, it is a 400.
        body: { filters: filters || {}, pages: [1], pageSize },
      }),
      () => ({ pages: [] }));
  }

  window.MarpApi = {
    whoAmI,
    mosaicCounts,
    mosaicFacets,
    mosaicFrames,
    queueDatasetBuild,
    mosaicPages,
    listSessions,
    listVideoLibraries,
    listVideoChildren,
    jobSeries,
    gpuSeries,
    throughputSeries,
    registrySeries,
    listWorkers,
    listJobs,
    getJob,
    listModels,
    listModelVersions,
    listModelSpecies,
    listDatasets,
    listDatasetBuilds,
    datasetComposition,
    datasetBuildQueue,
    datasetBuildSetup,
    datasetPreview,
    deleteDataset,
    moveQueuedBuild,
    listProjects,
    listUsers,
    submitJob,
    cancelJob,
    renameWorker,
    ApiError,
    /* Exposed for the checks, not for the screens. A screen reading these is a
       screen that has learned something the real API will not tell it. */
    _meta: { NOW, SEED, SWITCH, JOB_STATES, JOB_KINDS, WORKER_STATES },
  };
})();
