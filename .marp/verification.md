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

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `docs/openapi.generated.json` contains 11 `/v2/gpu/…` paths and 24 `Gpu*` schemas, rebuilt by `npm run docs:build` | contract | The family is registered through `registerVersionedRoute` (a literal `/api/v2/` path throws) and documented code-first. The generated tag is `V2 · GpuCompute`, rewritten from the `V1 · GpuCompute` the route file declares. |
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

## Requirements with no test

- **R15 (the dashboard app)** — not implemented in this pass, so nothing is verified. It is
  a separate piece of work and needs its own tiers, including one that can see what was
  drawn.

## Edge cases

- **A worker that restarts and enrols again** — asserted to be the same row with updated
  hardware, not a second row. A pool view full of ghosts would make "which machine is
  live?" unanswerable.
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
- **Splitting a range** — asserted to tile `0..249` into `0..99`, `100..199`, `200..249`:
  no frame processed twice, none missed.

## Regression coverage

Nothing here is a regression yet — this is new surface. Two tests exist specifically
because the implementation got them wrong first, and they are the ones to keep:

- `does not give a machine more concurrent work than the slots it enrolled with`, which
  caught the `slot_count` default described above.
- `negative control: without the locking clause, one job goes to both transactions`, which
  exists so the concurrency tests cannot quietly stop testing anything.

## Known gaps

Stated plainly, because a written gap is a decision and an omitted one is a surprise.

- **No GPU, no worker, no Jellyfin.** Nothing here runs real inference. The worker side is
  being built in parallel in `marp-inference-worker`; the two have never spoken. The job
  spec's `engine`, `model`, `params` and `reduction` are passed through untouched and
  unvalidated by MARP, so a mismatch in their meaning would not be caught by any test here.
- **The acceptance criteria are not met by this pass**, and cannot be by the coordinator
  alone: two real machines enrolling, a real inference job over a real Jellyfin video,
  progress advancing in a UI (there is no UI), and NAT traversal, home-link bandwidth,
  long-haul latency and a machine vanishing mid-job. The last group is explicitly not
  provable by an office-only run at all.
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
  Tests       : 262 passed, 0 failed, 0 skipped, 262 total
  Duration    : 99.2s

  Result: ALL TESTS PASSED
```

262 = the 227 that were there plus 35 new (29 orchestration, 6 lease race). The 17
`tests/jellyfin.test.js` tests, which CI excludes because it cannot reach the media server,
were run and passed here.

### The two new suites, in full

```
$ npx jest --runInBand --forceExit tests/gpu-orchestration.test.js

GPU worker enrolment > returns the same worker when the same name enrols again, with fresh hardware  PASS
GPU worker enrolment > refuses an enrolment with no name                                             PASS
GPU job submission and leasing > queues one job and leases it, in one poll and with no separate claim PASS
GPU job submission and leasing > answers 204 when there is nothing to do                             PASS
GPU job submission and leasing > splits a range into pieces that tile it exactly, sharing one batch_id PASS
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
  Tests       : 29 passed, 0 failed, 0 skipped, 29 total
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

### Documentation

```
$ npm run docs:build
```

`docs/openapi.generated.json` now carries 11 `/v2/gpu/…` paths (12 operations) and 24
`Gpu*` component schemas, under the `V2 · GpuCompute` tag. Every operation has 401 and 403
from `registerVersionedRoute`, and the `Artifact` schema no longer requires
`training_run_id`. The regenerated `docs/developer/` tree changes one navigation line per
existing file, plus the new module pages.
