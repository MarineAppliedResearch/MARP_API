---
task: MarineAppliedResearch/marp-inference-worker#3
repos: [MARP_API, marp-inference-worker]
status: implemented
needs: []
---

## Goal

From MARP, Isaac can see which GPU machines are online and what they are, send one of them
a job, watch it progress, and stop it. The job's result comes back and is kept. This is the
coordinator half of that: `MARP_API` becomes the control plane, and a GPU worker anywhere —
office or home connection — talks to it outbound only.

Milestone 1's workload is **inference over a Jellyfin video**. Datasets, training and the
model registry are later milestones and are deliberately not built here.

## Requirements

- **R1** — A new route family under `/api/v2/gpu/…`, registered the house way through
  `routes/lib/register-versioned-route.js` and documented code-first in
  `docs/openapi-route-registry.js`.
- **R2** — Worker-facing traffic is three routes plus two hand-offs: poll (long-poll for
  work), heartbeat (progress in, control out), events (batched metrics and log lines),
  result (terminal, idempotent), artifact hand-off (by hash).
- **R3** — There is no route by which MARP contacts a worker, and **no schema field can
  hold a worker's address**. Push must be unrepresentable, not merely unused.
- **R4** — Claiming a job is part of the poll transaction. There is no separate claim call,
  and two workers polling at once cannot lease the same job.
- **R5** — Cancel, pause and abandon are delivered **only** in the heartbeat response, as
  an `{action: …}` value.
- **R6** — A job and one machine's attempt at it are separate records. A job may be
  attempted more than once; an attempt belongs to one worker.
- **R7** — **The coordinator's row is the truth; a worker's report is evidence.** A worker
  cannot set a job to succeeded. Every state-changing call carries
  `(attempt_id, worker_id, lease_epoch)`, and a mismatch is answered with abandon — which
  is what stops a resurrected worker corrupting a job that was reassigned.
- **R8** — All expiry is judged on the coordinator's clock. A missed heartbeat expires a
  lease; the job returns to queued.
- **R9** — Replay is safe: events are keyed `(attempt_id, seq)`, the terminal result is
  idempotent, artifacts are addressed by sha256 with an `already_have` short-circuit, and
  publishing a result is guarded so a second attempt cannot overwrite the first.
- **R10** — Four new permission keys, seeded and granted to nobody by default:
  `workers:enrol`, `jobs:execute`, `jobs:read`, `jobs:write`. The existing
  `models:*` / `datasets:*` are for humans and must not be given to a worker —
  `models:write` would let a worker rewrite the model registry.
- **R11** — Worker credentials use the existing service-token mechanism. Nothing new is
  invented for authentication.
- **R12** — Progress is small and overwritten in place on the attempt. Durable metrics and
  log lines are appended as events. Per-frame detections are never sent inline; they arrive
  as a hashed artifact.
- **R13** — `artifacts.training_run_id` becomes nullable and gains a `job_id`. It is
  `NOT NULL` today, so an inference result currently has nowhere to be recorded.
- **R14** — A `UNIQUE (training_run_id, epoch_number)` constraint is added to `epochs`.
  It is missing today, so a replayed epoch batch would double-insert. (Cheap now; belongs
  with the idempotency work even though epochs are a Milestone 2 concern.)
- **R15** — A dashboard app under `frontend/apps/`, following the mosaic-reviewer pattern:
  the pool with each machine's state and hardware, a job's progress, and a cancel control.
  **Nothing else** — dataset building and model tracking are later.
- **R16** — Every migration wraps its work in `db/data-integrity.js` and carries a `down`,
  per this repository's rules. These are additive tables, but the two alterations in R13
  and R14 touch existing ones.

## Open assumptions

- [x] **A1 · api contract · blocking** — answered 2026-09-09; the contract is in
  *The worker contract* below. Eleven routes, five of them worker-facing.
- [x] **A2 · database/schema · blocking** — answered 2026-09-09: **five tables, not six.**
  Slots are a count on the worker rather than a table, and logs fold into events as a
  `kind`. Shape in *The orchestration schema* below.
- [x] **A3 · api contract · blocking** — answered 2026-09-09: the 100 KB default is not
  wanted. Raise the limit for this route family, and mount artifact upload outside
  `bodyParser` so a large hand-off never depends on it.
- [ ] **A4 · behavioural · non-blocking** — the three timeout values. Proposed: heartbeat
  every 10 s with a 60 s timeout, a per-attempt cap of 24 h, and no whole-job deadline by
  default.
- [ ] **A5 · product/UI · non-blocking** — what the pool view shows per machine. Proposed
  minimum: name, online/idle/busy, GPU model and VRAM, current job and progress, last heard
  from.
- [x] **A6 · security/permissions · blocking** — answered 2026-09-09: the worker talks to
  Jellyfin directly with its own credential, so its MARP token needs no Jellyfin
  permission. Follows from settled decision 5.

  **Superseded the same day by A15.** The worker no longer talks to Jellyfin at all. The
  conclusion survives — a worker's MARP token still needs no Jellyfin permission — but the
  reason is the opposite one: it holds no media credential because the coordinator resolves
  the video for it.

Found while implementing the coordinator, 2026-09-09. Only A7 turned out to matter across
repositories, and it is answered below; the rest are non-blocking — each a one-line change
either way, none moving the schema, the route list or the meaning of a field — but each was
a real choice and is implemented as stated rather than left unsaid.

- [x] **A7 · cross-repository integration · blocking in effect** — answered 2026-09-09 by
  Isaac's delegation, after the two repositories were found to have diverged: **the frame
  range is half-open, `[start_frame, end_frame)`.** `start_frame` is included; `end_frame`
  is one past the last frame.

  Raised as non-blocking because it looked like a one-line choice, and it was not: MARP_API
  had implemented both bounds inclusive while `marp-inference-worker` had implemented
  half-open (`jobs/job_spec.py:48`, and `iter_frame_range` yields half-open). Left alone,
  every piece boundary would have silently dropped a frame — with nothing failing, because
  each side was self-consistent. The lesson is that a convention shared across two
  repositories is not a local choice however small it looks.

  **The worker's reading stands and MARP_API changed.** The reasoning, which is also in
  `service/gpu.service.js#splitRange`: the frame arithmetic happens in Python, where
  `range()` and slicing are half-open natively; the count is `end - start` with no `+1`;
  tiling is `[k·n, (k+1)·n)`, so the next piece's start *is* the previous piece's end and
  there is no boundary arithmetic to get wrong; and an empty range is expressible, which is
  what lets a submission of one be refused rather than queued as a job that does nothing.
  Inclusive needs a `+1` at every site that touches a bound.

  A human-facing view may still read "frames 0–999" for `[0, 1000)`. That is presentation,
  not the contract.
- [ ] **A8 · behavioural · non-blocking** — **enrolment is idempotent per machine.** A
  machine that reboots and enrols again is the same row with updated hardware, so
  `enrolled_at` means "first seen". The alternative fills the pool view with ghosts and
  makes "which row is the live one?" unanswerable. Re-enrolling also returns a `paused`
  machine to `online`, since re-enrolling is how an operator restarts one they had parked.

  Originally written as "idempotent by worker name", and **superseded by A13**: it is keyed
  on the machine's durable id, and a re-enrolment deliberately does not overwrite the name.
- [ ] **A9 · behavioural · non-blocking** — **a machine is never given more concurrent work
  than the `slot_count` it enrolled with**, and a `paused` machine is given none. A2's
  five-tables-not-six reasoning says `slot_count` is what Milestone 1 scheduling needs, and
  without enforcing it one machine leases the entire queue at once and the pool view becomes
  fiction. Both answer `204` immediately rather than waiting out `wait_seconds`.
- [ ] **A10 · api contract · non-blocking** — **the "short-lived upload target" is a plain
  path, not a signed one**, and the staged bytes live on disk under
  `storage/gpu-artifacts/<sha256>` rather than in the database. The upload route is gated on
  the same permission the check needed and verifies the bytes against the hash before
  keeping them, so a signature would be a second and weaker credential for the same thing.
  `gpu_artifacts_staging.bytes` is therefore a size, and a row exists only once the bytes
  have actually arrived — which is what makes its presence the answer to `already_have`.
- [ ] **A11 · behavioural · non-blocking** — **a success reported after the job was
  cancelled does not resurrect it.** The attempt records that it succeeded, the job stays
  cancelled, and nothing is published; the bytes stay in staging, so nothing is destroyed.
  A job's state is the coordinator's decision and not a race between a human and a worker.
- [ ] **A12 · security/permissions · non-blocking** — **`jobs:write` covers both a worker
  reporting results and a person submitting and cancelling jobs**, which follows from R10
  fixing the vocabulary at four keys. A worker token therefore *can* submit and cancel work.
  That is a smaller power than `models:write` and well short of anything touching survey
  data, but it is not nothing; a fifth key would be the fix if it matters.

- [x] **A13 · database/schema · blocking** — answered 2026-09-09 by Isaac: **a worker must be
  renameable.** The durable machine-generated id is the identity and the human-readable name
  is editable metadata, per `MARP_API#104`. Today this is the reverse: `gpu_workers.name` is
  `UNIQUE` and is the column re-enrolment keys on, and the worker's `local_id` is sent on
  every enrolment but has no column to be stored in. A rename would therefore fork the pool
  row on the machine's next enrolment, leaving the old row holding any lease. The fix is a
  durable-id column that enrolment keys on, `name` no longer unique, and a rename route.
- [x] **A14 · architectural · blocking** — answered 2026-09-09 by Isaac: **there is no
  checkpoint resume.** `MARP_API#104` describes an interrupted job resuming from its
  checkpoint; that is withdrawn. A job runs on one worker start to finish, as settled on
  `marp-inference-worker#3`. An interrupted piece returns to the queue and is re-run from
  the start of its range by whichever machine takes it. Ranges are sized so that losing one
  is cheap, which is what makes re-running it acceptable.

- [x] **A15 · cross-repository integration · blocking** — answered 2026-09-09 by Isaac, and
  it reverses part of A1 and all of A6: **the coordinator resolves the video and hands the
  worker a playable URL. The worker knows nothing about MARP or Jellyfin.** It does not
  authenticate to Jellyfin, does not search it by filename, does not score matches and holds
  no media credential. A worker can therefore process **any** reachable source, because a
  URL is all the contract carries.

  The `video` object:

  ```
  video = { url, source_name, jellyfin_item_id }
  ```

  - **At submit, exactly one of `jellyfin_item_id` or `url`.** Both is a 400 rather than one
    silently winning; a submitter who sent both means something by each. `source_name` is
    optional with an item id — the Jellyfin item supplies it — and required with a bare url,
    because it is what appears as `video_source` on every observation and cannot be guessed
    from a URL.
  - **The stored spec keeps what was submitted.** The job row is not rewritten at submit.
  - **At lease, the spec handed over always carries `video.url`.** That is the coordinator's
    guarantee, and resolution happens in the poll handler rather than at job creation: a
    URL will eventually carry an expiring token, and one minted at submission would rot in
    the queue. Resolving here is also what makes a short-lived per-attempt token possible
    later, which is the fix for handing a long-lived media key to a machine MARP does not
    control (the worker task's A9).
  - `jellyfin_item_id` travels to the worker as **opaque provenance** — the worker echoes it
    into its output and never resolves it.
  - **`params` carries no video field.** An undocumented `params.video_source_url` on the
    worker side let a URL be smuggled through engine parameters, and every test on both
    sides used it, which is why the missing contract went unnoticed. The URL is first-class
    in the spec now. Nothing in `MARP_API` ever named that field.

  **If resolution fails at lease time the attempt is failed** with the reason in
  `failure_reason`, rather than handing over a spec with no URL or leaving the job queued to
  be retried forever. That spends one of the job's attempts, so an unresolvable video
  exhausts them and lands the job `failed`, which somebody can see. Reviewed after
  implementing and it is the right call: the alternatives are a worker being blamed for the
  coordinator's failure, or a job that never becomes anybody's problem.

  Also settled with the worker half: an observation the worker writes carries
  `jellyfin_item_id` as a **key present with value `null`** for a bare-url job — never
  absent, never `""` or a placeholder — so a reader needs no branch for "was this a Jellyfin
  job", and `video_source` identifies the video. Nothing in `MARP_API` reads that output
  yet; the note is here for whoever builds the ingest.


## Decisions

Carried in from the investigation (`marp-inference-worker#3`, comments of 9 Sep):

- The coordinator lives **inside `MARP_API`**. No separate service.
- Workers dial out. Push is unrepresentable.
- There is no "volunteer" concept and no trust tier. A worker produces weights; MARP loads
  them. No verification of returned artifacts, no sandboxing, no scoped media credentials.
- Inference first. Training, datasets and the model registry are Milestones 2 and 3.
- The dashboard for Milestone 1 shows and controls running jobs, and nothing more.
- Reuse the ten existing ML tables; new schema is orchestration only. In particular there
  is no new artifacts table — `artifacts` already exists and already has a `hash`.
- Ultralytics licensing is deferred and does not block this work.

## Plan

1. Migrations: six orchestration tables, the two alterations (R13, R14), and the four
   permission keys.
2. Sequelize models and the repository layer for jobs and attempts, with the lease
   transaction as the one piece of real concurrency here.
3. The `/api/v2/gpu/…` route family, permission-gated, with the OpenAPI registry entries.
4. Route families for `artifacts` and `hyperparameters`, which have tables and models but
   no routes at all today.
5. List routes for training runs, epochs-by-run and summaries-by-run — the existing ML read
   API is single-row only, so run comparison is impossible without them. (Needed by
   Milestone 2; include only if it is free to do alongside 4.)
6. The dashboard app: pool, job progress, cancel.

## Acceptance criteria

- Two GPU workers enrol with tokens and appear with their real hardware.
- An inference job over a Jellyfin video is queued from the dashboard, leased by one
  worker, and its progress advances in the UI.
- Cancel from the dashboard takes effect within one heartbeat.
- The result is stored as an artifact and is visible.
- `MARP_API` restarting mid-job loses nothing: leases are rows, and the job either resumes
  its lease or returns to queued.
- Two workers polling simultaneously never lease the same job.
- A worker replaying its terminal report twice does not produce two results.
- **Explicitly not proven by an office-only run**, and the criteria must say so: NAT
  traversal, home-link bandwidth, long-haul latency, a machine vanishing mid-job. At least
  one off-LAN worker should be included, or the milestone only demonstrates a LAN system.

## Test plan

`.marp/verification.md`, written at G3. Note this repository's doctrine: the suite runs
against a real PostgreSQL built from the baseline plus migrations, `npm test` rather than
`npx jest` because of `--runInBand`, and the lease race needs a test that can actually
observe two concurrent pollers — a single-threaded test cannot. It also carries a negative
control, so the concurrency tests cannot quietly stop testing anything.

## Status

Coordinator implemented, 2026-09-09. Migrations 1, models and repository 2, and the route
family 3 of the plan are done and verified; `npm test` was 262 for 262 at that point.

Video resolution moved into the coordinator later the same day (A15): the poll handler now
resolves a Jellyfin item into a playable URL and the worker is handed that, so it knows
nothing about Jellyfin. `npm test` is 285 for 285, up from 274 before that change.

Not done, and deliberately:

- **Plan step 6, the dashboard app (R15).** A separate piece of work: it needs its own test
  tiers, including one that can see what was drawn, and none of that belongs in the same
  pass as the control plane.
- **Plan steps 4 and 5** — route families for `artifacts` and `hyperparameters`, and the
  list routes for run comparison. Milestone 2 concerns, and not free to do alongside this.

The acceptance criteria cannot be met by the coordinator alone: they need the worker, a real
GPU, a real Jellyfin video, and at least one off-LAN machine. `.marp/verification.md` says
what is proven, and lists the manual steps for the rest.


## The orchestration schema

Five new tables. Reuse everywhere else — the ten ML tables already model datasets, runs,
epochs, hyperparameters, metrics and artifacts.

- **`gpu_workers`** — `id`, `local_id` (the durable machine-generated identity,
  unique; A13), `name` (editable metadata, not unique), `enrolled_at`, `last_seen_at`, `state`
  (`online` / `offline` / `paused`), `slot_count`, `worker_version`,
  `capabilities` jsonb (GPUs and VRAM, driver, disk, engines, ranges supported).
  **No host, url or port column** — push must stay unrepresentable (R3).
- **`gpu_jobs`** — `id`, `batch_id` (nullable, groups the pieces of one split video),
  `kind` (`inference` / `tracking` / `training` / `diagnostic`), `spec` jsonb,
  `state` (`queued` / `leased` / `succeeded` / `failed` / `cancelled` / `expired`),
  `priority`, `attempts_made`, `max_attempts`, `published_attempt_id`, `created_by`,
  timestamps.
- **`gpu_job_attempts`** — `id`, `job_id`, `worker_id`, `slot_index`, `lease_epoch`,
  `state` (`assigned` / `preparing` / `running` / `uploading` / `succeeded` / `failed` /
  `cancelled` / `preempted` / `abandoned`), `leased_at`, `lease_expires_at`,
  `last_heartbeat_at`, `progress_done`, `progress_total`, `progress_unit`,
  `capabilities_snapshot` jsonb, `failure_reason`, `finished_at`.
- **`gpu_job_events`** — `(attempt_id, seq)` primary key, `at`, `kind`
  (`metric` / `log` / `note`), `payload` jsonb. Append-only; replay-safe by that key.
- **`gpu_artifacts_staging`** — `sha256` primary key, `bytes`, `content_type`,
  `received_at`, `attempt_id`. Where a hand-off lands before it is recorded in the
  existing `artifacts` table.

Plus the two alterations: `artifacts.training_run_id` becomes nullable and gains
`job_id`; `epochs` gains `UNIQUE (training_run_id, epoch_number)`.

**Why five and not six.** Slots were going to be a table. For Milestone 1 a `slot_count`
on the worker plus `slot_index` on the attempt says everything scheduling needs, and a
table can arrive when multi-GPU placement policy actually exists — the harness's rule
against speculative structure applies to schema too. Logs were going to be their own
table; a `kind` on events costs nothing and keeps one ordered, replay-safe stream per
attempt.

**A split video is N jobs sharing a `batch_id`**, not one job with children. Each piece
leases, retries, fails and reports independently, which is what makes ten workers on a
ten-hour video straightforward. The dashboard groups by `batch_id`.

## The worker contract

Eleven routes under `/api/v2/gpu/…`, declared in V1 terms because
`registerVersionedRoute` rewrites them and throws on a literal `/api/v2/` path.

**Worker-facing** — five, all outbound from the worker.

| Route | Permission | Carries | Returns |
|---|---|---|---|
| `POST /gpu/workers/enrol` | `workers:enrol` | `local_id`, name, `capabilities` | `worker_id`, `heartbeat_seconds` |
| `POST /gpu/poll` | `jobs:execute` | `worker_id`, `capabilities`, free `slot_index`es, `wait_seconds` | `204` when idle, else the job: `job_id`, `attempt_id`, `lease_epoch`, `lease_expires_at`, `kind`, `spec` |
| `POST /gpu/attempts/:id/heartbeat` | `jobs:execute` | `worker_id`, `lease_epoch`, `state`, `progress {done,total,unit}` | `{action: continue \| cancel \| pause \| abandon}`, `lease_expires_at` |
| `POST /gpu/attempts/:id/events` | `jobs:write` | batch of `{seq, kind, at, payload}` | accepted count, `next_seq` |
| `POST /gpu/attempts/:id/result` | `jobs:write` | `outcome`, `failure_reason`, `artifacts[{sha256, role}]` | idempotent ack |

Artifact hand-off is two steps, outside `bodyParser`:
`POST /gpu/artifacts/check` with `{sha256, bytes}` answers `{already_have: true}` or a
short-lived upload target; the upload itself is a raw stream.

**Human-facing** — six: `GET /gpu/workers` (the pool), `POST /gpu/workers/:id/rename`,
`GET /gpu/jobs`,
`GET /gpu/jobs/:id`, `POST /gpu/jobs` (submit; a video plus a range, or a video plus a
piece length, which expands into a batch), `POST /gpu/jobs/:id/cancel`.

**The job spec for Milestone 1** — inference or tracking over a frame range:

```
{ engine: "ultralytics", model: {name, sha256},
  video: {url, source_name, jellyfin_item_id},
  range: {start_frame, end_frame}, params: {conf, iou, imgsz, tracker},
  reduction: {name: "v3_dirpad", version: 1} }
```

`range` is always present, even for a whole video, so nothing special-cases the
undivided case, and it is **half-open** — `[0, frame_count)` for a whole video (A7).
`reduction` is named and versioned per the worker task's R10b.

`video` is A15: exactly one of `url` or `jellyfin_item_id` at submit, always a `url` on a
lease. `params` carries engine parameters and nothing else — there is no video field in it.

**Three rules that are the whole design.** Every state-changing call carries
`(attempt_id, worker_id, lease_epoch)`, and a mismatch is answered `{action: 'abandon'}`.
Leasing happens inside the poll transaction, so two pollers cannot take one job. Expiry is
judged only on the coordinator's clock.
