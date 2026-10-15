---
task: MarineAppliedResearch/MARP_API#104
repos: [MARP_API]
status: verified
needs: []
---

# Verification — the ML dashboard API pass (gaps 23 to 28)

G4. The plan is below as it was approved, followed by what actually happened.

**Everything the plan called unprovable is now proved.** The plan said four
requirements could not be checked against this database — no worker is busy, every
model chain is one long, there are no datasets and no training runs. All four were
closed by seeding the rows in the tests themselves, which is the rule anyway: a test
seeds what it asserts, because CI builds an empty database.

**The plan also said there were no route-level tests. There are now.** `global.api`
gives every suite an authenticated agent, so the query-string contract, the 400s and
the two new paths are exercised over HTTP rather than through the service.

## Results

| Suite | Result |
| --- | --- |
| `tests/gpu-job-list.test.js` (new) | **17 passed** — R1, R2, R3, R4 |
| `tests/gpu-pool-telemetry.test.js` (new) | **5 passed** — R5 |
| `tests/ml-registry.test.js` (new) | **15 passed** — R6, R7, R8, R9 |
| `tests/gpu-finished-at.test.js` (new) | **4 passed** — the `finished_at` invariant |
| `npm run test:gpu` | **11 suites, 215 tests, 0 failed** |
| `npm run test:ml` | **10 suites, 52 tests, 0 failed** |
| `npm run test:subsystems` | `ok every suite belongs to exactly one subsystem` |
| dashboard `npm run lint` | `12 files parse` · `5 enums agree with MARP` · `8 screens state no data of their own` |

Before this pass the same two groups were 189 and 37 tests. The new suites account for
the difference: 26 added to gpu, 15 to ml.

## Per requirement

- **R1 — progress on the job list.** A job with no attempt carries nulls and explicitly
  not zeroes, which is the distinction the screen draws a dash for. A job with two
  attempts carries the **later** one: seeded `done: 11, phase: 'first'` then
  `done: 222, phase: 'second'`, and the list returns 222. The five fields carry the
  attempt's own names.
- **R2 — a date range.** Two jobs were seeded a day apart at fixed instants. A window
  over the first returns `total: 1` where the unwindowed query returns more. Adjacent
  windows share no job, so the bound is half-open. `finished_after=last tuesday` is a
  400 naming ISO 8601.
- **R3 — a job can be named.** Every piece of a split batch carries one name. A job
  submitted without one comes back `null` and nothing composes a fallback. A 256-character
  name is a 400, not a database error. A named job is found by searching its name.
- **R4 — sort and search.** Ascending and descending are exact reverses. Page two
  continues page one rather than re-sorting within the page. Nulls sort last. An unknown
  sort key is a 400 listing the valid ones. Search matches a name, a video `source_name`
  and a `batch_id`, and a search that should miss returns `total: 0`.
- **R5 — pool telemetry.** A busy machine returns its GPU with every field named as the
  worker names it, asserted against the exact object. The payload holds `as_of` and
  `gpus` and nothing else — CPU, disk, network and the engine list are asserted absent.
  `as_of` equals the attempt's `leased_at`, so the reading is stamped when the lease
  opened rather than now. A machine reporting no GPU carries `null`. An idle machine has
  no attempt at all.
- **R6 — preferred model.** The flag reads back off the registry listing. A model is not
  preferred unless it says so. **A second preferred model of the same `model_type` is
  refused by the database**, which is where it has to be refused — a check in a service
  is bypassed by the next caller that does not call it. Another `model_type` keeps its own.
- **R7 — version chain.** A three-deep chain returns all three oldest-first from the root,
  **from the middle**, and from the newest. The middle case is the one a one-directional
  walk would fail. A model with no parent and no child is its own chain. An unknown id is
  a 404, not an empty list, because a model is always in its own chain.
- **R8 — dataset status.** A new dataset starts as `draft`; all four values round-trip
  through the listing. The **backfill** was tested by running the migration's own
  statement against a row that looks like one predating the column, inside a transaction
  that is rolled back — so the claim is proved without the database keeping any of it.
  This matters because the column's default is `draft` and every dataset that already
  exists is a finished one; taking the default would have described complete datasets as
  unstarted.
- **R9 — training runs.** The collection read exists, narrowing by `model_id` returns only
  that model's runs, and runs come back newest first.

## What the run found, and what was changed because of it

Four things, none of which a passing suite would have shown.

1. **The sort tie-breaker was fixed at `id DESC` in both directions**, so ascending and
   descending were not exact reverses of one another. Either is a stable total order and
   pages correctly, so this was not a paging bug — it was surprising, because reversing
   the sort left tied rows in the order they were already in. The tie-breaker now follows
   the direction. *Found by the test, fixed in `repository/gpu.repository.js`.*
2. **The first version of the job-list teardown leaked every row it created.** Submitting
   a job writes `gpu_job_events`, which hold a foreign key into `gpu_jobs`, so deleting
   the jobs failed and the corpus guard reported the lot. Teardown now works inside out —
   events, attempts, jobs — and by what belongs to the suite's jobs rather than by what
   the suite remembered creating. *A test bug, caught by the guard, which is what it is for.*
3. **`(job_id, lease_epoch)` is unique**, so a test giving one job two attempts at the
   same epoch failed. The constraint is right and the test was wrong: a job gets one
   attempt per lease.
4. **The four new suites belonged to no subsystem**, so no fast loop would have run them
   — `npm run test:subsystems` fails on exactly that, and did. They are now in `gpu` and
   `ml` in `scripts/test-subsystem.mjs`.

## Honest notes

- **A failed teardown poisons the next run.** While the teardown bug above was being
  found, each aborted run left rows that made the *next* run's unrelated suites fail, so
  `npm run test:gpu` gave three different answers in a row. That is not flakiness in the
  code and not flakiness in the suites; it is one broken afterAll cascading. Once the
  rows were removed the group was green twice running. Worth knowing before anybody
  debugs a strange GPU-group failure.
- **One stray `jest-api-%` user is in the database**, left by the shared authenticated-agent
  fixture during one of those aborted runs. It is not mine to delete under the guard's own
  rule — a test may never delete a row it did not create — and it changes nothing, since
  the guard compares a delta per file.
- **The migrations ran against the development database on a day-old dump**
  (2026-10-14), not a fresh one. They add columns and fill them; nothing touches
  observations, keyframes or thumbnails.
- **`marp_test` is still "exists, not ready"** — 114,839 thumbnail rows and 0 files — so
  nothing here ran against the clean CI-shaped database. `npm run testing-db reset` is the
  fix and remains outstanding.

## Still not covered, deliberately

- **No browser tier.** A18 kept the dashboard out of this pass, so no screen changed.
  The screens still draw dashes where a route now answers; that is the intended state and
  rewiring them is the next pass.
- **Nothing about scale.** Gap 26 is a performance argument, and nothing here measures the
  lateral join or the `ILIKE` over `spec->'video'->>'source_name'`, which is unindexed. At
  9,554 rows it is instant. That is not evidence about a hundred thousand.
- **Permissions are not tested per route.** The shared fixture holds every permission by
  design; permission boundaries live in `tests/v2_species.test.js`, which is the file to
  extend when a gate needs checking.
