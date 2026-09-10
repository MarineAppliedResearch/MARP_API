# Verification — distributed GPU compute, coordinator half

Covers the `MARP_API` half of `MarineAppliedResearch/marp-inference-worker#3`: the
migrations, the models and repository, and the twelve `/api/v2/gpu` endpoints. The
dashboard app (R15) is not in this pass and is not verified here.

Two tiers are used, and the split matters:

- **HTTP tier (`tests/gpu-orchestration.test.js`)** — Supertest against the real Express
  app and the real local PostgreSQL. This is the tier a worker meets, so the whole worker
  contract is asserted here rather than against the repository.
- **Transaction tier (`tests/gpu-lease-race.test.js`)** — two database transactions held
  open at once. The lease's concurrency claim is invisible at any other tier: calling the
  claim twice in sequence passes whether or not any locking exists.
- **HTTP tier with Jellyfin stubbed (`tests/gpu-video-resolution.test.js`)** — the same
  Supertest setup, with `jellyfinRepository.buildDirectStreamUrl` and `getItem` replaced per
  test. Still the HTTP tier, because what is being asserted is the leased body a worker
  receives; the stub is there because CI cannot reach the media server, which is also why
  `tests/jellyfin.test.js` is excluded there. **What this cannot see: whether Jellyfin
  actually returns a playable URL for a real item.** That needs the media server and is a
  manual step below.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `docs/openapi.generated.json` contains 12 `/v2/gpu/…` paths and 25 `Gpu*` schemas, rebuilt by `npm run docs:build` | contract | The family is registered through `registerVersionedRoute` (a literal `/api/v2/` path throws) and documented code-first. The generated tag is `V2 · GpuCompute`, rewritten from the `V1 · GpuCompute` the route file declares. |
| R2 | `GPU worker enrolment`, `queues one job and leases it`, `GPU heartbeat`, `GPU attempt events`, `GPU attempt result`, `GPU artifact hand-off` | HTTP | All five worker-facing calls plus the two-step hand-off answer as specified. |
| R3 | `shows the machine, its hardware, and the job it is running` asserts the serialised pool entry matches no `host`/`hostname`/`url`/`ip`/`address`/`port` key; the migration creates no such column | HTTP + schema | Push is unrepresentable rather than unused. The assertion fails the day somebody adds such a column and returns it. |
| R4 | `does not offer one queued job to a second transaction while the first holds it`, `gives two overlapping transactions two different jobs`, `leases one queued job to exactly one of two workers polling at once`, `shares four queued jobs among eight simultaneous polls without leasing any twice` | transaction + HTTP | Claiming is inside the poll transaction and two simultaneous pollers cannot lease one job. |
| R4 | `negative control: without the locking clause, one job goes to both transactions` | transaction | That the tests above **can** fail. Without this, deleting `FOR UPDATE SKIP LOCKED` would leave them green. |
| R5 | `delivers a cancel through the heartbeat, and only through the heartbeat`, `delivers a pause to a machine that has been paused`, and the three `abandon` tests | HTTP | Cancel, pause and abandon arrive only as an `{action}` in a heartbeat response. |
| R6 | `requeues the job on a failure while attempts remain, and fails it when they run out` asserts two attempt rows, each keeping its own `failure_reason` | HTTP | A job and one machine's attempt at it are separate records, and a retry does not overwrite the account of the first failure. |
| R7 | `refuses a worker that claims a stale lease epoch, and writes nothing`, `refuses a worker claiming another machine's attempt`, `refuses a batch from a stale lease, and writes none of it`, `will not let a worker declare itself succeeded`, and the resurrected-worker half of the expiry test | HTTP | Every state-changing call carries `(attempt_id, worker_id, lease_epoch)`; a mismatch is answered `abandon` **and writes nothing** — the assertions check the row is untouched, not just the response body. |
| R8 | `returns an expired lease's job to the queue and tells the old worker to abandon`, `takes the lease back from an attempt that has run past the per-attempt cap` | HTTP | Expiry is judged on the coordinator's clock: both tests move a coordinator-written timestamp and assert on what the coordinator then does. |
| R9 | `accepts a batch, and treats a replay of it as duplicates rather than new events`, `answers a replayed terminal report from the stored rows, without a second result`, `answers already_have false, accepts the bytes, then answers already_have true`, `does not let a success reported after a cancel resurrect the job`, `refuses a second attempt at the same job and epoch` | HTTP + schema | Replay is safe at all four points: events keyed `(attempt_id, seq)`, an idempotent terminal report, artifacts addressed by sha256 with an `already_have` short-circuit, and a guarded publish. |
| R10 | Every route declares one of `workers:enrol` / `jobs:execute` / `jobs:read` / `jobs:write`; the seeding migration adds the four keys and grants none | schema + contract | The four keys exist, are held by nobody, and no worker route reuses `models:*` or `datasets:*`. |
| R11 | No new credential mechanism exists: the suite authenticates with `tests/setup/authenticated-agent.js`, and the routes are gated by the existing `requirePermission`, fed by the existing `resolvePrincipal` | contract | Worker credentials are the existing service tokens. |
| R12 | `extends the lease, records progress, and says continue` asserts progress overwritten in place on the attempt; the events tests assert appended rows; `records a success as an artifact…` asserts detections arrive as a hashed artifact | HTTP | Progress is small and overwritten; durable numbers are appended; per-frame detections are never inline. |
| R13 | `records a success as an artifact belonging to the job rather than to a training run` asserts `training_run_id === null` and `job_id === job.id` on the recorded row | HTTP | An inference result now has somewhere to be recorded. |
| R14 | Migration `20260909100200` applies against the local database; `epochs_training_run_id_epoch_number_unique` exists | schema | The constraint is present. See *Known gaps* — no test inserts a duplicate epoch. |
| R16 | `npx sequelize-cli db:migrate` and `db:migrate:undo` run clean in both directions; each migration prints its `[label] before/after` integrity lines | schema | Every migration wraps its work in `db/data-integrity.js` and carries a working `down`. |
| A13 | `keeps the new name when the machine enrols again, and stays one row`, `gives two machines that share a name a row each`, `does not disturb a live lease`, `refuses an empty name, and 404s an unknown machine`, `refuses an enrolment with no durable id, because that is the identity` | HTTP | A worker's identity is the durable id it generated for itself; the name is editable metadata. Enrolment keys on `local_id`, a re-enrolment does not overwrite the name, two machines may share one, and a rename touches neither the row's identity nor its lease. |
| A13 | `does not echo the durable id back, keeping the identity internal`, and the `local_id` key assertion inside `does not disturb a live lease` | HTTP | The durable id is not in any response. `worker_id` is the handle a dashboard addresses a machine by, so exposing the value enrolment keys on would be an avoidable way to adopt somebody else's pool row. |
| A15 | `resolves an item id into a url at lease time`, `fills source_name from the Jellyfin item when the submission left it out` | HTTP | The coordinator's guarantee: the spec a worker is handed carries `video.url`. Asserted on the leased body, which is what a worker actually receives -- a check one layer down would pass while the body handed over had no URL in it at all. |
| A15 | `resolves an item id into a url at lease time` (its closing assertion) and `keeps the stored spec as it was submitted, resolving nothing at submit time` | HTTP | Resolution happens in the poll handler and the job row is not rewritten. A URL carries its own media credential, and one minted at submission would sit in the queue until somebody claimed it -- which is what makes a short-lived per-attempt token possible later. |
| A15 | `resolves an item id into a url at lease time` asserts `spec.video.jellyfin_item_id` unchanged on the leased body | HTTP | The item id travels through as opaque provenance for the worker to echo into its output. A worker never resolves one. |
| A15 | `hands a bare url through unchanged, asking Jellyfin nothing` | HTTP | A worker can process any reachable source, not only a Jellyfin item, because a URL is all the contract carries. Also asserts the media server is not touched at all for such a job. |
| A15 | `refuses a submission carrying both an item id and a url`, `refuses a bare url with no source_name…`, `refuses a video that names neither an item id nor a url`, `refuses an empty url rather than storing one` | HTTP | Exactly one of the two at submit, and `source_name` required with a bare url because it becomes `video_source` on every observation and cannot be guessed from a URL. |
| A15 | `does not hand out a lease when the video cannot be resolved, and lets the job fail`, `does not hand out a lease when Jellyfin does not have the item` | HTTP | A failure to resolve fails the attempt with the reason rather than handing over a spec with no URL, and spends an attempt so the job exhausts them and lands `failed` instead of being retried forever. Both halves are asserted: `queued` while an attempt remains, `failed` when none does. |
| A15 | `never hands over an empty url, even from a spec that already holds one` | HTTP | An empty `video.url` is treated as no URL. The worker refuses a spec whose url is missing *or* empty, and a coordinator that resolved nothing is likelier to emit `""` than to omit the key; this asserts MARP emits neither. |


## Requirements with no test

- **R15 (the dashboard app)** — not implemented in this pass, so nothing is verified. It is
  a separate piece of work and needs its own tiers, including one that can see what was
  drawn.
- ~~**A15's live half** — that a real Jellyfin item resolves to a URL a worker can actually
  open.~~ **Closed 2026-09-09** by the manual step it names: a job carrying only
  `jellyfin_item_id` was resolved at lease time and the worker opened the video, reporting
  `1920x1080 at 25.000 fps, container reports 36159 frames`. The stubbed tests still prove
  only what MARP does with a URL; this proves the URL plays. **Not closed for a transcoded
  item** — that one direct-plays.

## Edge cases

- **A worker that restarts and enrols again** — asserted to be the same row with updated
  hardware, not a second row. A pool view full of ghosts would make "which machine is
  live?" unanswerable.
- **A machine that was renamed and then restarts** — keeps the operator's name. The worker
  computes its name at startup and sends it on every enrolment, so honouring it would have
  reverted every rename at the next reboot.
- **A machine renamed while it is running a job** — its next heartbeat is answered
  `continue`, not `abandon`. This is where the original design broke: with the name as the
  key, the re-enrolment after a rename opened a second row and left the first holding the
  lease.
- **Two machines with the same name** — two rows, because their durable ids differ.
- **A re-enrolment that omits `slot_count`** — must leave the count alone. This was a real
  defect found by this suite: the service defaulted it to 1, which silently cut a
  multi-slot machine down to one slot and then looked like the scheduler refusing to give
  it work.
- **A machine already running as much as it said it can** — answered `204` rather than
  handed more. Without this a single machine leases the whole queue at once.
- **A paused machine polling** — answered `204` at once. Leasing then immediately pausing
  would churn every job in the queue through a pointless lease.
- **Bytes that do not match the hash in the path** — refused, and nothing kept: no file on
  disk and no staging row. A recorded artifact that cannot be opened is worse than a
  failed upload.
- **A result naming an artifact never handed over** — refused with 409 rather than recorded
  pointing at bytes MARP does not hold.
- **A worker sending the coordinator's own `note` kind, or a negative `seq`** — refused.
  Both would corrupt the record of why a lease was taken away, since a colliding `seq` is
  silently swallowed by the same `ON CONFLICT DO NOTHING` that makes replay safe.
- **A success reported after the job was cancelled** — the attempt records its success, the
  job stays cancelled, and nothing is published.
- **Splitting a range** — `[0, 1000)` in pieces of 300 is asserted to give `[0, 300)`,
  `[300, 600)`, `[600, 900)`, `[900, 1000)`, with a per-frame tally over the whole range
  showing every frame covered exactly once, the covered count equal to 1000, and the last
  piece short rather than over-long. A second case, `[40, 47)` in pieces of 3, covers the
  uneven remainder and a non-zero base. The tally is there because a gap and an overlap can
  cancel each other out in a total, so counting alone would not have caught the divergence
  described below.

## Regression coverage

Nothing here is a regression yet — this is new surface. Three tests exist specifically
because the implementation got them wrong first, and they are the ones to keep:

- `splits a range into half-open pieces that cover every frame exactly once`, which exists
  because MARP_API and `marp-inference-worker` had diverged on the frame-range convention:
  this side read both bounds as inclusive, the worker read the end as exclusive. Each side
  was self-consistent, so nothing failed — the cost would have been one frame dropped at
  every piece boundary. Settled half-open, and this test plus the uneven-remainder one are
  what stop it coming back.

- `does not give a machine more concurrent work than the slots it enrolled with`, which
  caught the `slot_count` default described above.
- `negative control: without the locking clause, one job goes to both transactions`, which
  exists so the concurrency tests cannot quietly stop testing anything.
- The four `GPU worker rename` tests, which exist because the identity and the name were
  the wrong way round: `gpu_workers.name` was `UNIQUE` and was what re-enrolment keyed on,
  while the durable id a worker sends on every enrolment had no column to be stored in. Each
  was checked for vacuity by mutating the thing it guards — see *Vacuity checks* below.

## Known gaps

Stated plainly, because a written gap is a decision and an omitted one is a surprise.

- ~~**No GPU, no worker, no Jellyfin.** Nothing here runs real inference. The worker side is
  being built in parallel in `marp-inference-worker`; the two have never spoken.~~
  **Superseded 2026-09-09** — the two have now spoken, repeatedly, and the results sections
  below record it: a real worker on a real GPU ran the real MARP model over real Jellyfin
  footage and returned observations. **What stands unchanged is the second half:** the job
  spec's `engine`, `model`, `params` and `reduction` are passed through untouched and
  **unvalidated** by MARP, so a mismatch in their meaning would still not be caught by any
  test here. It was caught by running the two halves together — seven times over.
- **The acceptance criteria are partly met, as of 2026-09-09.** Met: a real inference job
  over a real Jellyfin video, cancelled mid-run and stopped in 18 s; **a machine vanishing
  mid-job**, killed outright with its lease expiring on MARP's clock in 65 s and the job
  returning to `queued`. Still unmet: **two real machines enrolling at once** (one machine
  only, so nothing has contended for a lease outside the transaction tier); progress
  advancing in a UI, there being no UI; and NAT traversal, home-link bandwidth and long-haul
  latency, which an office-only run cannot prove at all.
- **`MARP_API` restarting mid-job is untested.** Leases are rows, so it should lose
  nothing, but no test kills and restarts the process.
- **The long poll's waiting is only exercised at `wait_seconds: 0`.** The loop and its cap
  are not covered by a test that actually waits; a bug in the waiting path would show as a
  poll returning too early or too late and nothing here would see it.
- **No duplicate-epoch test for R14.** The constraint is verified to exist by the migration
  applying, not by an insert being refused. Epochs are a Milestone 2 concern and nothing in
  Milestone 1 writes one.
- **Whether the two simultaneous polls in the HTTP tests genuinely overlap inside Postgres
  is up to the scheduler.** A pass there does not by itself prove the locking; that is what
  the overlapping-transaction tests and the negative control are for. The HTTP tests prove
  the whole path upholds the invariant.
- **The attempt cap and lease expiry are tested by moving a timestamp**, not by waiting a
  real minute. The comparison under test is against the database's `NOW()`, which an
  `UPDATE` exercises exactly as elapsed time would, but a defect in *how long* the timeouts
  are would not be caught.
- **Artifact size limit untested.** The 4 GiB ceiling and its 413 are not exercised;
  streaming that much through Supertest is not a reasonable test.
- **Nothing verifies the raised body limit at its boundary.** A 2 MB event batch is not
  sent by any test; the limit is asserted only by the routes working at ordinary sizes.

## Manual steps

For a human, once a worker exists. Each step says what to expect.

1. `marp db up` from the umbrella, then `npm run dev` here.
2. Issue a worker token holding only `workers:enrol`, `jobs:execute` and `jobs:write`:
   `node scripts/create-application-token.js --app "GPU worker (office)"`, then grant those
   three keys through `/api/v2/tokens`. **Expect** the token to be printed once.
   **Expect** granting `models:write` to be unnecessary — if a worker seems to need it,
   something has gone wrong.
3. `POST /api/v2/gpu/workers/enrol` from the worker machine. **Expect** a `worker_id` and
   `heartbeat_seconds`, and the machine to appear in `GET /api/v2/gpu/workers` as `idle`
   with its real GPU and VRAM.
4. Submit an inference job over a real Jellyfin item with a real frame range. **Expect**
   one queued job, and the worker to lease it within one poll.
5. Watch `GET /api/v2/gpu/jobs/:id`. **Expect** `progress_done` to climb and the attempt to
   move `assigned` → `running`.
6. `POST /api/v2/gpu/jobs/:id/cancel` while it runs. **Expect** the worker to stop within
   one heartbeat interval, and the attempt to end `cancelled`.
7. Let a second job run to completion. **Expect** an `artifacts` row with `training_run_id`
   null, `job_id` set, and its `hash` matching the file under `storage/gpu-artifacts/`.
8. Pull the worker's network cable mid-job. **Expect** the job to return to `queued` after
   the lease expires on the coordinator's clock, another machine to take it, and the
   original worker — once reconnected — to be told `abandon` and to discard its work.
9. Repeat step 3 with a machine on a home connection, not the office LAN. **Expect** it to
   work unchanged, because nothing needs to reach the worker.

## Walkthrough videos

None. There is no UI in this pass, and a narrated walkthrough of an HTTP contract would
narrate rather than assert. They belong with R15's dashboard.

---

## Results

Run on 2026-09-09 against the local PostgreSQL built from `db/baseline/schema.sql` plus all
23 migrations. Verbatim.

### Migrations, both directions

```
$ npx sequelize-cli db:migrate
== 20260909100000-create-gpu-orchestration-tables: migrating =======
[gpu-orchestration] before: users=1 | 9 foreign key(s) watched
[gpu-orchestration] after: no rows deleted, dereferenced or orphaned
== 20260909100000-create-gpu-orchestration-tables: migrated (0.231s)

== 20260909100100-allow-artifacts-without-a-training-run: migrating =======
[artifacts-job-id] before: artifacts=0 training_runs=0 | 6 foreign key(s) watched
[artifacts-job-id] after: no rows deleted, dereferenced or orphaned
== 20260909100100-allow-artifacts-without-a-training-run: migrated (0.055s)

== 20260909100200-unique-epoch-per-training-run: migrating =======
[unique-epoch] before: epochs=0 training_runs=0 | 6 foreign key(s) watched
[unique-epoch] after: no rows deleted, dereferenced or orphaned
== 20260909100200-unique-epoch-per-training-run: migrated (0.034s)

== 20260909100300-seed-gpu-permissions: migrating =======
[gpu-permissions] before: permissions=23 user_permissions=1 service_token_permissions=11 | 6 foreign key(s) watched
[gpu-permissions] 4 added, 0 already present
[gpu-permissions] nothing was granted -- grant through the V2 users or tokens API
[gpu-permissions] permissions: 4 row(s) added (23 -> 27)
[gpu-permissions] after: no rows deleted, dereferenced or orphaned
== 20260909100300-seed-gpu-permissions: migrated (0.040s)
```

`db:migrate:undo` four times reverted all four cleanly, and `db:migrate` re-applied them.
The rollback failed on the first attempt — `column "job_id" does not exist` — because
`guardDataIntegrity` discovers foreign keys once, up front, and then counts them again
afterwards, so a migration that removes a column the guard is watching makes the second
count fail. Fixed by keeping the row-losing work inside the guard and the column removal
after it, inside the same transaction. Worth knowing before writing the next migration that
drops a column.

### The full suite

```
$ npm test

  Test Suites : 31 passed, 0 failed, 31 total
  Tests       : 264 passed, 0 failed, 0 skipped, 264 total
  Duration    : 103.1s

  Result: ALL TESTS PASSED
```

264 = the 227 that were there plus 37 new (31 orchestration, 6 lease race). The 17
`tests/jellyfin.test.js` tests, which CI excludes because it cannot reach the media server,
were run and passed here.

This is the run after the frame-range convention was settled half-open (A7). The run before
that change was 262 for 262 on the inclusive reading — which is the whole point: each
reading passes its own tests, so nothing but comparing the two repositories was ever going
to catch the disagreement.

### The two new suites, in full

```
$ npx jest --runInBand --forceExit tests/gpu-orchestration.test.js

GPU worker enrolment > returns the same worker when the same name enrols again, with fresh hardware  PASS
GPU worker enrolment > refuses an enrolment with no name                                             PASS
GPU job submission and leasing > queues one job and leases it, in one poll and with no separate claim PASS
GPU job submission and leasing > answers 204 when there is nothing to do                             PASS
GPU job submission and leasing > splits a range into half-open pieces that cover every frame exactly once PASS
GPU job submission and leasing > divides a range that does not divide evenly without losing or repeating a frame PASS
GPU job submission and leasing > refuses an empty frame range rather than queueing a job that does nothing PASS
GPU job submission and leasing > refuses a submission with no frame range, even for a whole video    PASS
GPU job submission and leasing > refuses a job of an unknown kind                                    PASS
GPU job submission and leasing > does not give a machine more concurrent work than the slots it enrolled with PASS
GPU job submission and leasing > does not hand work to a paused machine                              PASS
GPU heartbeat > extends the lease, records progress, and says continue                               PASS
GPU heartbeat > refuses a worker that claims a stale lease epoch, and writes nothing                 PASS
GPU heartbeat > refuses a worker claiming another machine's attempt                                  PASS
GPU heartbeat > will not let a worker declare itself succeeded                                       PASS
GPU heartbeat > delivers a cancel through the heartbeat, and only through the heartbeat              PASS
GPU heartbeat > delivers a pause to a machine that has been paused                                   PASS
GPU heartbeat > takes the lease back from an attempt that has run past the per-attempt cap           PASS
GPU attempt events > accepts a batch, and treats a replay of it as duplicates rather than new events PASS
GPU attempt events > refuses a batch from a stale lease, and writes none of it                       PASS
GPU attempt events > refuses the coordinator's own event kind and its own sequence numbers           PASS
GPU artifact hand-off > answers already_have false, accepts the bytes, then answers already_have true PASS
GPU artifact hand-off > keeps nothing when the bytes do not hash to the sha256 in the path           PASS
GPU artifact hand-off > refuses a hash that is not 64 lower-case hexadecimal characters              PASS
GPU attempt result > records a success as an artifact belonging to the job rather than to a training run PASS
GPU attempt result > answers a replayed terminal report from the stored rows, without a second result PASS
GPU attempt result > requeues the job on a failure while attempts remain, and fails it when they run out PASS
GPU attempt result > does not let a success reported after a cancel resurrect the job                PASS
GPU attempt result > refuses a result naming an artifact that was never handed over                  PASS
GPU lease expiry > returns an expired lease's job to the queue and tells the old worker to abandon    PASS
GPU pool view > shows the machine, its hardware, and the job it is running                           PASS

  Test Suites : 1 passed, 0 failed, 1 total
  Tests       : 31 passed, 0 failed, 0 skipped, 31 total
  Result: ALL TESTS PASSED
```

```
$ npx jest --runInBand --forceExit tests/gpu-lease-race.test.js

Claiming a GPU job under two overlapping transactions > does not offer one queued job to a second transaction while the first holds it  PASS
Claiming a GPU job under two overlapping transactions > gives two overlapping transactions two different jobs                          PASS
Claiming a GPU job under two overlapping transactions > negative control: without the locking clause, one job goes to both transactions PASS
Simultaneous polls through the API > leases one queued job to exactly one of two workers polling at once                                PASS
Simultaneous polls through the API > shares four queued jobs among eight simultaneous polls without leasing any twice                   PASS
The unique attempt-per-epoch index > refuses a second attempt at the same job and epoch                                                PASS

  Test Suites : 1 passed, 0 failed, 1 total
  Tests       : 6 passed, 0 failed, 0 skipped, 6 total
  Duration    : 17.8s

  Result: ALL TESTS PASSED
```

### Failures seen along the way, and what they were

Recorded because each was a real defect rather than a flaky test.

1. **19 tests failed with a `204` where a lease was expected.** The service defaulted a
   missing `slot_count` to 1 on every enrolment, so a machine that enrolled with 64 slots
   was cut to 1 the next time it re-enrolled without saying, and then refused work. Fixed
   by leaving `slot_count` undefined when absent, which the repository reads as "unchanged";
   a *new* machine still defaults to one slot.
2. **`column "job_id" does not exist` on the first rollback**, described above.
3. **The pool-view test asserted one live attempt and found fourteen.** The test's fault,
   not the code's — the suite leaves earlier leases open — but it is what surfaced defect 1,
   because a two-slot machine holding fourteen attempts is the same bug seen from the other
   side.
4. **Nothing failed for the frame-range convention, and that is the interesting one.**
   MARP_API read both bounds as inclusive, `marp-inference-worker` read the end as
   exclusive, and each side's tests passed against its own reading. It was caught by
   comparing the two repositories, not by running anything. Settled half-open, changed
   here, and now covered by two tests that assert the tiling property rather than the
   shape of one example.

### Documentation

```
$ npm run docs:build
```

`docs/openapi.generated.json` now carries 11 `/v2/gpu/…` paths (12 operations) and 24
`Gpu*` component schemas, under the `V2 · GpuCompute` tag. Every operation has 401 and 403
from `registerVersionedRoute`, and the `Artifact` schema no longer requires
`training_run_id`. Every description that said the frame bounds were inclusive now says
half-open, and states both the count and the tiling property. The regenerated `docs/developer/` tree changes one navigation line per
existing file, plus the new module pages.

---

## Results — A13, a worker is renameable

Run on 2026-09-09 against the same local PostgreSQL, now with 24 migrations. Verbatim.

### The migration, both directions

```
$ npx sequelize-cli db:migrate
== 20260909100400-give-a-gpu-worker-a-durable-identity: migrating =======
[gpu-worker-durable-id] before: gpu_workers=1 gpu_job_attempts=8 | 5 foreign key(s) watched
[gpu-worker-durable-id] after: no rows deleted, dereferenced or orphaned
== 20260909100400-give-a-gpu-worker-a-durable-identity: migrated (0.167s)
```

The one pre-existing row was backfilled `legacy-worker-65`. A second row sharing its name
was then inserted by hand — which the old `UNIQUE (name)` would have refused, so the insert
succeeding is itself the check that the uniqueness is gone — and the rollback run against
both:

```
$ npx sequelize-cli db:migrate:undo
== 20260909100400-give-a-gpu-worker-a-durable-identity: reverting =======
[gpu-worker-durable-id-down] before: gpu_workers=2 gpu_job_attempts=8 | 5 foreign key(s) watched
[gpu-worker-durable-id-down] worker 192 renamed to "SoftwareEngineering-a0294ccd-192" so that gpu_workers.name can be unique again
[gpu-worker-durable-id-down] after: no rows deleted, dereferenced or orphaned
== 20260909100400-give-a-gpu-worker-a-durable-identity: reverted (0.048s)
```

`UNIQUE (name)` and the original column comment are back, `local_id` and
`gpu_workers_name_idx` are gone, and no row was lost. `db:migrate` then re-applied it.

**The backfill is deliberately not a recoverable value.** A name carries at most an
eight-character slice of the id the worker chose, so no full value can be rebuilt from it;
the backfill only has to be something no real worker will send, so that such a machine's
next enrolment opens a fresh row rather than adopting a history that is not its own. The
consequence is stated rather than hidden: the one row already in this database becomes a
ghost when its machine next enrols, and it cannot be deleted while its eight attempts exist.

### The full suite

```
$ npm test

  Test Suites : 32 passed, 0 failed, 32 total
  Tests       : 274 passed, 0 failed, 0 skipped, 274 total
  Duration    : 175.8s

  Result: ALL TESTS PASSED
```

274 = the 268 before this change plus 6: four in `GPU worker rename`, and two in
`GPU worker enrolment` for the durable id being required and never echoed back.

### Vacuity checks

Every new assertion was checked by mutating the thing it guards and watching it go red.
Each mutation was reverted immediately.

| Mutation | Went red |
| --- | --- |
| Re-enrolment overwrites `name` again | `keeps the new name when the machine enrols again`, `does not disturb a live lease` — 2 failed |
| Enrolment keys on `name` instead of `local_id` (the original design) | `keeps the new name…` (409, the second row colliding on `local_id`), `gives two machines that share a name a row each`, `does not disturb a live lease` — 3 failed |
| `renameWorker` does not write | `keeps the new name…`, `does not disturb a live lease` — 2 failed |
| `local_id` falls back to the name when absent | `refuses an enrolment with no durable id` — 200 where 400 was expected |
| The durable id is returned in the enrolment answer and the pool view | `does not echo the durable id back`, and the `local_id` assertion in `does not disturb a live lease` — 2 failed |

### Documentation

```
$ npm run docs:build
```

`docs/openapi.generated.json` now carries 12 `/v2/gpu/…` paths and 25 `Gpu*` schemas —
`GpuWorkerRenameRequest` is the new one. `GpuWorkerEnrolRequest` requires `local_id`, and
`GpuWorker` says that the name is metadata and that the durable id is deliberately absent.

### Still not verified

- **Nothing exercises a real worker being renamed.** The rename tests enrol synthetic
  machines through HTTP; the worker's own default name is still hostname plus an id slice,
  which was chosen when uniqueness rested on the name and could now be a plain hostname.
  That is a decision for the worker repository and was deliberately not made here.
- **The ghost row.** No test covers what a backfilled row does when its machine re-enrols,
  because the answer is "a new row appears", which is the accepted consequence rather than
  behaviour worth locking in.


## Results — A15, the coordinator resolves the video, against a live worker

Run 9 Sep 2026. Every A15 test above stubs Jellyfin, because CI cannot reach a media server.
This is the half those tests cannot cover: MARP resolving a real Jellyfin item for a real
worker that has no media credential of its own.

Worker 65 was started with **only** `MARP_WORKER_TOKEN` and `MARP_COORDINATOR_URL` in its
environment — no `JELLYFIN_*` variables at all. Confirmed on its `/status` before submitting.

### An item id in, a playable url out

Job submitted with `video: { jellyfin_item_id: "4ac4749aae0a8d75ac99f2d8d50717ce" }` and
nothing else — no `url`, no `source_name`.

- **The stored job row kept exactly what was submitted**, one key, as asserted by
  `keeps the stored spec as it was submitted`.
- The worker then opened the video and reported
  `opened video 1920x1080 at 25.000 fps, container reports 36159 frames`, so the url MARP
  minted at lease time was genuinely playable rather than merely well-formed.
- **`source_name` was filled by the coordinator** from the Jellyfin item and reached the
  worker's output as `video_source: 20240730_171520_Fwd.mp4`.
- `jellyfin_item_id` travelled through unchanged, and the worker never resolved it — it has
  no code left that could.

That closes the gap this file records under *Requirements with no test* for the live half of
A15. The stubbed tests prove the branching; this proves the url works.

### Cancel, delivered through a heartbeat and nowhere else

Job 1258, 6,000 frames, cancelled at 18:13:06 with the attempt at 240/6000. The job went
`cancelled` on the spot; attempt 949 was still `running` eight seconds later and reported
itself `cancelled` at 18:13:24 with 390/6000 done.

**18 seconds on a 10-second heartbeat.** Two intervals, not one: one to deliver the action and
one for the worker's wind-down and terminal report. `MARP_API#104` describes cancellation as
taking "up to one heartbeat interval" — that is measurably optimistic, and a dashboard should
show the attempt's own state rather than promise a duration.

### Expiry on the coordinator's clock

Job 1259. The worker was killed outright at 18:14:21 at 150/6000, with no final report.

```
18:14:33 .. 18:15:14   attempt 950 still reads running   (inside the lease)
18:15:26               attempt 950 -> abandoned
                       "Lease expired: no heartbeat before lease_expires_at."
                       job 1259 -> queued, re-leasable
```

**65 seconds**: the 60-second lease plus the read that swept it. Worth stating plainly for the
dashboard — **expiry is only noticed when something asks.** With no worker polling and nobody
reading, a dead machine's job keeps reading `running` indefinitely. The sweep now runs on
`POST /gpu/poll`, `GET /gpu/jobs`, `GET /gpu/workers` and `GET /gpu/jobs/:id`.

### Still not covered by anything

- **A resolution failure against the real server.** Every failure path here is stubbed. A real
  Jellyfin outage during a poll would fail the attempt and spend one of its three, which is
  the sharp edge recorded in the judgement calls above.
- **A transcoded item.** This one direct-plays. A transcoded stream's frame count may not
  match its source, and nothing here or in the worker measures that.
- **The ingest.** A finished job produces a hashed artifact and nothing parses it into
  `observations`. The contract is settled in `.marp/task.md` at A16, A17 and A18; the code does
  not exist. This run left a real six-observation JSONL in `artifacts` for it to be built
  against.
