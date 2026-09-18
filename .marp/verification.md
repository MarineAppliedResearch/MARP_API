---
task: MarineAppliedResearch/MARP_API#202
status: verified
---

## What was run

```
DB_NAME=marp_test npx jest tests/gpu-orchestration.test.js tests/gpu-lease-race.test.js \
  tests/gpu-abandoned-poll.test.js tests/gpu-video-resolution.test.js \
  tests/gpu-playback-reporting.test.js tests/gpu-observation-ingest.test.js \
  --runInBand --forceExit

  Test Suites : 6 passed, 0 failed, 6 total
  Tests       : 146 passed, 0 failed, 0 skipped, 146 total
  Result: ALL TESTS PASSED
```

The whole `gpu` subsystem, not only the file that changed — because the sweep now runs on
every poll, which is the path most of those suites drive.

**Against `marp_test` rather than the development database, and that is the notable part.**
`tests/gpu-orchestration.test.js` refuses to run while anything is queued — it leases
whatever is there, so its assertions about "no work left" would be meaningless — and the
development database is holding 958 queued CAMPA 2026 jobs with a worker actively running
them. The testing database was three migrations behind and was migrated forward first,
which `AGENTS.md` asks for anyway after a new migration.

## Requirement by requirement

| | Proved by |
| --- | --- |
| **R1** a stale worker reads `offline` | `R1: a machine that has stopped talking reads offline` — enrol, assert `online`, backdate past the threshold, read the pool |
| **R2** a fresh worker stays `online` | `R2: a machine heard from inside the threshold stays online` — backdated 120 s, which is stale to the eye and inside the 180 s threshold |
| **R3** `paused` survives | `R3: a paused machine that goes quiet stays paused` — paused, then backdated ten times the threshold |
| **R4** it comes back on its own | `R4: a machine that comes back is online again, with nothing done to it` — offline, one poll, `online` |
| **R5** one named constant | `WORKER_OFFLINE_SECONDS` in `config/gpu-orchestration.js`, derived as `3 * POLL_MAX_WAIT_SECONDS`. The test imports it rather than restating 180, so a literal cannot go on passing after somebody changes it |
| **R6** swept where it would be seen | `R6: one machine polling retires another that has stopped` — deliberately makes **no pool read at all**, so it fails if the sweep only happens on the pool view |

Every check moves the coordinator's clock rather than waiting, which is the pattern this
file already uses for lease expiry and the attempt cap.

## Two defects found while verifying, both mine, both fixed

- **`updated_at` does not exist on `gpu_workers`.** The first version of the sweep set it.
  The failure was not local: the sweep runs inside the poll, so *every* test in the file
  failed with a 500 — 41 of 55, including tests that have nothing to do with this change.
  Worth recording because the symptom pointed nowhere near the cause.
- **The sweep could wait on a lease.** `claimJobForWorker` takes
  `SELECT ... FROM gpu_workers WHERE id = :workerId FOR UPDATE` inside the transaction that
  leases a job, and a blanket `UPDATE gpu_workers` needs a row lock on every online worker
  — so a sweep could block behind the busiest thing in the system. It is
  `FOR UPDATE SKIP LOCKED` now, the same idiom `expireStaleLeases` uses. Skipping is free:
  a row locked by a live lease belongs to a machine that is demonstrably talking, so it is
  not stale. `tests/gpu-lease-race.test.js`, which polls twice simultaneously, is in the
  run above.

## The live case this was reported from

At the time of writing, the development pool held exactly what the issue describes:

```
 48  ABYSS-46f37134                online   quiet 6 s       running 3 attempts
898  SoftwareEngineering-a0294ccd  online   quiet 243 s     no live attempt
966  ABYSS-3dd10926                online   quiet 40,634 s  no live attempt
```

966 has been gone eleven hours; 898 is the laptop, which Isaac confirmed he shut down.
Under the current code both read `online` for ever. Under this branch 48 stays `online` and
the other two go `offline` on the next poll or pool read.

## What is NOT covered

- **Behaviour on the development database**, because the suite cannot run there while the
  CAMPA queue is live. The sweep is not database-specific, but this has not been observed
  against the real pool — that happens when the API is next restarted on this branch.
- **A flapping worker.** A machine on a connection bad enough to cross the threshold and
  come back repeatedly would oscillate. The threshold is sized to make that unlikely rather
  than impossible, and nothing damps it.
- **Two API processes sweeping at once.** `SKIP LOCKED` is what makes that safe and it is
  not directly exercised — one process is what runs here.
