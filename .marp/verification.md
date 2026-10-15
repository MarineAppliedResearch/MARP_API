---
task: MarineAppliedResearch/MARP_API#104
repos: [MARP_API]
status: plan
needs: []
---

# Verification plan — the ML dashboard API pass (gaps 23 to 28)

G3. This is the **plan**, for review before the full run. Some of it has already been run
during implementation, because the doctrine says to run the tests that can see a change as
you make it; where that happened the result is given below, verbatim, and marked **already
run**. Nothing here is a claim that the requirement is verified until the gate says so.

## What is being verified

The nine requirements in [task.md](task.md). In short: the job list carries progress, takes
a date range, can be sorted and searched, and a job can be named; the pool view carries the
GPU telemetry MARP already stores; the registry gains a preferred flag, a version chain, a
dataset status and a training-run listing.

## The tiers, and why each one

| Tier | What only it can see |
| --- | --- |
| Source lint | that a *future* statement cannot forget `finished_at`. No behavioural test can see a statement nobody has written yet. |
| Repository / service | the shapes and the SQL. A route test cannot tell a wrong `ORDER BY` from a wrong page size. |
| Route (HTTP) | the query-string contract, the 400s, and the permissions. The service takes parsed values; the route is where a bad one arrives. |
| Migration | the backfills, which run once and are then invisible. |

## Per requirement

- **R1 — progress on the job list.** Service: a page carries `progress_done`, `progress_total`,
  `progress_unit`, `progress_phase`, `progress_elapsed_s`; the values come from the job's
  **latest** attempt, proved by a job with two attempts whose later one has different numbers;
  a job with no attempt has nulls, not zeroes. **Already run, partly:** the fields are present
  and populated (`progress_done 26221` on a real row). *Not yet covered: the two-attempt case,
  which is the half that could be silently wrong.*
- **R2 — a date range.** Service: `finished_after` / `finished_before` / `created_after` /
  `created_before` narrow `total`, and the window is half-open so two adjacent windows do not
  both claim one job. A non-timestamp is a 400. **Already run:** the 400 (`finished_after must
  be an ISO 8601 timestamp.`) and the filter executing. *Not yet covered: that it narrows —
  every job in this database is terminal and backfilled, so the filter returned all 9,554 and
  proved nothing. Needs seeded rows either side of a boundary.*
- **R3 — a job can be named.** Service: submitting with a name stores it on every piece of a
  split batch; submitting without one leaves null and MARP composes nothing; an over-long name
  is a 400; searching for the name finds the job.
- **R4 — sort and search.** Service: each whitelisted key orders ascending and descending;
  **page 2 continues page 1** rather than re-sorting within the page, which is the defect this
  is actually for; nulls sort last; an unknown key is a 400. Search matches name, the video's
  `source_name` and `batch_id`, and misses what it should miss. **Already run:** page boundary
  holds for `created_at asc`; `search "yield"` → 2 matches, a nonsense search → 0; unknown sort
  key → 400. *Not yet covered: the other sort keys, and `name` sorting with nulls present.*
- **R5 — pool telemetry.** Service: a worker holding a live attempt carries
  `telemetry.gpus[]` in the worker's own field names plus `as_of`; a worker with no GPU in its
  snapshot carries null; an **idle** worker carries no attempt and therefore no reading.
  **Already run, weakly:** the stored shape was confirmed against a real
  `capabilities_snapshot` — `resources.nvidia.devices[0]` with
  `gpu_utilization_percent: 22, temperature_c: 34, power_usage_watts: 7.68` on an RTX 4080
  SUPER. *Not covered at all through `listPool`, because no machine in this database is busy
  right now.* **This is the weakest point in the pass** and wants a seeded live attempt.
- **R6 — preferred model.** Service: the flag reads back; the partial unique index refuses a
  second preferred model of the same `model_type` and permits one of another.
- **R7 — version chain.** Service: a three-deep chain returns all three oldest-first from any
  member, including the middle one; a model with no parent and no child returns just itself; an
  unknown id is a 404. **Already run, trivially:** a chain of one. *Every chain in this database
  is length 1, so the recursion is untested. Needs seeded parents.*
- **R8 — dataset status.** Migration: existing rows become `ready`, not `draft`. *This database
  has **zero** dataset rows, so the backfill ran against nothing and is unproven.* Needs a
  seeded row before the migration, i.e. a migration test rather than an observation.
- **R9 — training runs listed.** Service: runs come back newest first; `model_id` narrows.
  *Zero training runs exist here, so this is unproven.*

## Already run in full

- `npm run test:gpu` — **8 suites, 189 tests, all passed.** The existing orchestration,
  lease-race, ingest and settings suites against the changed repository and service.
- `npm run test:ml` — **9 suites, 37 tests, all passed.**
- `npx jest tests/gpu-finished-at.test.js` — **4 tests, all passed.** The source lint plus the
  two directions: cancelling records a finish time, requeueing clears it.
- The dashboard's own lint — `12 files parse`, `5 enums agree with MARP`, `8 screens state no
  data of their own`. Proves the regenerated contract did not move anything the dashboard reads.
- `npm run docs:api:build`, then the contract asserted to carry `GpuJob.name`,
  `GpuJob.finished_at`, the five `progress_*`, `GpuPoolAttempt.telemetry`, `MlModel.preferred`,
  `Dataset.status` with its four values, and both new paths.

## What this plan does NOT cover, and why

- **No route-level tests.** Everything above exercises the service. The query-string parsing,
  the 400s as HTTP, and the `models:read` / `jobs:read` permissions on the two new routes are
  untested. This is a real hole: `GET /ml_models/:id/versions` and `GET /training_run` have
  never been called over HTTP.
- **No browser tier, deliberately.** A18 kept the dashboard out of this pass, so no screen
  changed and there is nothing for a browser test to see. The screens still draw dashes where
  the route now answers, which is the intended state.
- **Nothing about scale.** Gap 26 is a performance argument — browser-side narrowing is wrong
  at #104's assumed scale — and nothing here measures the lateral join or the `ILIKE` on
  `spec->'video'->>'source_name'`, which is unindexed. At 9,554 rows it is instant; that is not
  evidence about a hundred thousand.
- **The idle-machine case for telemetry is argued, not observed.**
- **`marp_test` is still "exists, not ready"** (114,839 thumbnail rows, 0 files), so nothing
  here ran against the clean CI-shaped database. `npm run testing-db reset` is the fix and has
  been outstanding for days.

## What a full G4 run would add

1. A seeder for the cases this database cannot supply: a job with two attempts, a live
   attempt on a worker, a three-deep model chain, a dataset row, a training run, and jobs
   either side of a date boundary.
2. `tests/gpu-job-list.test.js` — R1, R2, R4 against those rows.
3. `tests/gpu-pool-telemetry.test.js` — R5, including the idle and no-GPU cases.
4. `tests/ml-registry.test.js` — R6, R7, R9, and the unique-index refusal.
5. A migration test for R8's backfill.
6. Route-level coverage for the two new paths.

## Results

Filled at G4, verbatim, including failures.
