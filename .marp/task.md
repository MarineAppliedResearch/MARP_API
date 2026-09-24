---
task: MarineAppliedResearch/MARP_API#232
repos: [marp-api, marp-inference-worker]
status: design
needs: []
---

## Goal

When somebody looks at an observation that inference produced, they can say exactly how
the model was run: every setting that shaped the result, whether the job asked for it or
it was a default, and anything the job asked for that the worker ignored. Today two runs
of the same model at confidence 0.60 and 0.001 — different scientific instruments — are
indistinguishable in the database.

## What investigation found

Read from `origin/develop` of both repositories and the development database on
2026-09-23. It changes the size of the job.

- **The worker already logs the settings it applies.** Worker PR #48 added an
  `inference settings: confidence=… imgsz=… iou=…` log line, which cites this issue.
  It reaches the database as free text inside `gpu_job_events` (690 attempts so far).
- **The engine already returns the effective tracker settings.** `TrackingEngine.run()`
  returns `"tracker": tracker_args.as_dict` and `"confidence"` in its summary, which is
  stored inside the `attempt finished as succeeded` log event (3,124 attempts).
- **What is genuinely missing:**
  - effective values for predict settings the job did not set — the log line says
    `(ultralytics defaults)` instead of the values, which is the gap the issue names;
  - whether each value came from the job or from a default;
  - ignored keys, as data rather than as a phrase in a log line;
  - a queryable home — today the values are only recoverable by parsing log payloads;
  - failed, preempted and cancelled attempts, which never return a summary;
  - any link from an observation to the attempt that produced it. `observations`
    carries `gpu_job_id` only.

## Requirements

- **R1** — Every attempt records the inference settings the worker applied: at least
  `confidence`, `iou`, `imgsz`, `augment`, `agnostic_nms`, `max_det`, `half`,
  `track_thresh`, `match_thresh`, `track_buffer` and `mot20`.
- **R2** — Every recorded value states its source: `job` when the spec set it,
  `default` when it did not. A default is recorded as its value, never as "default".
- **R3** — Keys the job spec set and the worker did not honour are recorded as ignored.
- **R4** — Settings are recorded when the engine resolves them, before the first frame,
  so an attempt that fails, is preempted or is cancelled still carries them.
- **R5** — The record is a queryable column on `gpu_job_attempts`, not only a log payload.
- **R6** — An observation can be traced to the settings of the attempt that produced it.
- **R7** — An attempt from a worker that does not report settings stores nothing, and
  that absence is stored as absence: never guessed, never copied from the job spec.

## Open assumptions

- [ ] **A1 · database/schema · blocking** — Store the record as one nullable `jsonb`
  column, `gpu_job_attempts.inference_settings`, following `capabilities_snapshot` beside
  it? The alternative is a normalised settings table, which is heavier and buys nothing
  until something queries individual settings across many attempts.
- [ ] **A2 · API contract / cross-repository · blocking** — The worker reports the record
  as a structured event the moment the engine resolves it, and the API copies it into
  the column. The alternative, adding it to the finish summary that already exists, is
  less code but breaks R4: a failed attempt never returns a summary. This adds a named
  field to the worker-to-API protocol.
- [ ] **A3 · scientific/data-meaning · blocking** — How an observation reaches its
  attempt (R6). A job that yields and resumes can hold observations from several
  attempts on different workers — potentially different worker versions with different
  defaults — so `gpu_jobs.published_attempt_id` names one attempt and can be wrong for
  the rest. Proposal: a nullable `observations.gpu_attempt_id`, set at ingest for new
  rows only. Existing rows stay NULL, so nothing is changed or lost. This is a migration
  on the observations table and wants your decision.
- [ ] **A4 · data-meaning · non-blocking** — No backfill. Existing attempts carry the
  tracker settings in a log payload but the predict settings only as
  `(ultralytics defaults)`, so a backfill would record some values as known and others
  as unknown in a way that reads as complete. They stay NULL, per R7.
- [ ] **A5 · behavioural · non-blocking** — Ultralytics defaults are read at run time
  from `ultralytics.cfg.DEFAULT_CFG` rather than written into worker code, so a recorded
  default is what that worker's pinned Ultralytics actually used.
- [ ] **A6 · behavioural · non-blocking** — Engine constants that shape results but are
  not job settings, such as the class-matching IoU of 0.4, are recorded with source
  `engine`. Cheap, and within the issue's intent that nothing about how the model ran
  goes unrecorded.
- [ ] **A7 · environment · non-blocking** — Implementation happens in isolated
  workspaces (`marp agent start`) for both repositories. The main MARP_API checkout is
  serving the API on port 3000 for another agent, and nodemon restarts it on every
  `.js` change. The worker checkout is mid-task on the watch-window branch with
  uncommitted work.

## Decisions

## Plan

1. Worker: build the record in `TrackingEngine.run()` — every setting as
   `{value, source}` plus an `ignored` list — and report it as a structured event before
   the first frame (A2).
2. API: migration adding `gpu_job_attempts.inference_settings` (A1).
3. API: accept the event and write the column; accept its absence from an older worker
   without error (R7).
4. API: migration adding `observations.gpu_attempt_id`, written at ingest (A3).
5. Tests at the tiers that can see each change; see the test plan.

## Acceptance criteria

- A job that sets `conf 0.001` and nothing else produces an attempt whose record shows
  `confidence 0.001` from `job` and every other setting with its real value from
  `default`.
- A job that sets a key the worker does not honour lists it under `ignored`.
- An attempt that fails after settings are resolved still has its record.
- An attempt from a worker without this change stores NULL and ingests as it does today.
- An observation ingested after this change resolves to its attempt's record.

## Test plan

Filled in at G3.

## Status

- **Gate:** design
- **Notes:** Investigation done. Waiting on A1–A3.
