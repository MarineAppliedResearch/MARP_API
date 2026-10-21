# Verification — MarineAppliedResearch/MARP_API#121, the thumbnail sweeper

Written before the tests were, and the plan and the results are in one file rather than two
passes: everything below is a `db`, `http+db` or `unit` tier test in a group that runs in
tens of seconds, so the usual reason to review a plan before running it — that running it is
expensive — does not apply here. The real Jellyfin round trip, which *is* expensive, is a
known gap and is a manual step rather than a passing test.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R2 | `offers a transient failure nothing has retried` | db | A `failed`, not-permanent row becomes `queued` with no button pressed. |
| R2 | `takes the longest-unswept row first` | db | Ordering is `swept_at NULLS FIRST`, so nothing starves behind a row already retried. |
| R3 | `claims a reviewer retry ahead of a swept row` | db | `claimBatch` returns the reviewer's row first with both queued — the regression that would be silent. |
| R3 | `leaves a swept row at ordinary priority` | db | The sweeper writes `request_priority = 0`, not 1. |
| R4 | `stops offering a row that has exhausted its sweeps` | db | At `SWEEP_MAX_ATTEMPTS` the sweeper passes it by. |
| R4 | `still lets a reviewer ask for a row the sweeper gave up on` | db | `requeue` ignores `sweep_attempts` — the cap is on background generosity only. |
| R4 | `waits out the backoff before offering the same row again` | db | A row swept a moment ago is not offered twice within the hour. |
| R4 | `offers a row again once its backoff has elapsed` | db | The wait ends; it is a delay, not a second cap. |
| R5 | `enqueues an observation that has no record at all` | db | The backfill half. |
| R5 | `finds nothing to backfill, and that is not a failure` | db | An empty sweep returns 0 and does not throw. |
| R6 | `never offers a permanent failure` | db | The flag the whole design rests on. |
| R6 | `never resets a ready row` | db | Neither half can undo a picture that exists. |
| R6 | `never re-offers what the evictor just freed` | db | The loop found during implementation. See *Regression coverage*. |
| R7 | `enqueues nothing while the extractor is paused` | db | Paused stops producing as well as consuming. |
| R8 | `enforces the storage budget even on a pass that enqueued nothing` | db | Eviction runs on the tick, not only after an extraction. |
| R9 | `distinguishes a sweep that has not run from one that found nothing` | http+db | `lastSweep: null` vs `lastSweep.retried === 0`. |
| R9 | `reports what the last sweep did` | http+db | The counters reach the status body. |
| R10 | `is switched off by a zero interval` | unit | `sweep.enabled` is false and no timer is armed. |
| R11 | — | — | Not a test. Every limit is a named export of `config/thumbnails.js`; a second copy is visible in review, not in a run. |

**Choosing the tier is the decision that matters.** Every sweep rule above is an SQL
predicate — the backoff arithmetic, the three exclusions, the ordering, `FOR UPDATE SKIP
LOCKED` — and none of them is observable anywhere but a real PostgreSQL. A unit test over a
mocked repository would assert that the code calls the function, which is the thing nobody
doubts. R10 is the exception and is genuinely a unit question: whether a timer was armed.

## Requirements with no test

- **R1** — *a sweep pass runs on a schedule inside the API process, and not under Jest.* The
  second half is proved by the suite passing at all: `start()` is called only from
  `server.js`, so a sweeper that ran under Jest would appear as the corpus guard failing
  files across the group. The first half is `setTimeout` in a loop, and a test for it tests
  the Node timer. Covered by inspection, plus R10's assertion that the timer is armed only
  when the interval is above zero.
- **R11** — see the table. A constant living in one file is a property of the diff.

## Edge cases

- **A row that is `failed` because it was *evicted*.** `markFileEvicted` writes exactly the
  shape the retry sweep looks for. Covered, and it is the one that would have cost real
  Jellyfin time rather than a test run.
- **A row at the attempt cap, asked for by a person.** The cap must not become a refusal a
  reviewer cannot get past. Covered from both sides.
- **`2 ^ sweep_attempts` at the cap.** Ten attempts is 512 hours before `LEAST` clamps it to
  a week; the arithmetic is done in SQL against an integer column and the clamp is exercised
  by the backoff tests rather than assumed.
- **A sweep racing an extraction for the same row.** `FOR UPDATE SKIP LOCKED` in the `due`
  CTE, the same device `claimBatch` uses. Not separately tested: it is the identical
  construct, already covered by `does not claim a row another extraction is holding`.

## Regression coverage

- **`never re-offers what the evictor just freed`** — written because the first draft of
  `sweepRetryable` would have done exactly that. `markFileEvicted` leaves a row at
  `status = 'failed', permanent = false`, which is indistinguishable from a transient failure
  on the columns the sweep first keyed on. The two would have traded the same bytes forever:
  evict to get under budget, re-extract, evict again — against the media server the
  concurrency bound exists to protect. Caught while writing the query, so it never ran; the
  test is what stops it coming back.

## Known gaps

- **No test extracts a picture.** Whether a re-offered row actually becomes a thumbnail
  depends on Jellyfin being reachable, and that is the manual step below. Everything here
  proves the row reaches the queue in the right state and the right order; nothing here
  proves ffmpeg then succeeds.
- **No test measures the sweeper against the real backlog.** The claim that this clears the
  3,567 failures in the development corpus is a claim about a run, not about a suite.
- **Two API processes both sweeping is not covered.** `SKIP LOCKED` and
  `ON CONFLICT DO NOTHING` make the enqueues safe, but `enforceLimit()` would run twice. It
  is idempotent — the second call finds the budget already met — so the cost is a duplicated
  read rather than a double delete. Recorded rather than tested, because MARP runs one API
  process.
- **The backoff is tested by moving `swept_at` backwards, not by waiting an hour.** That is
  the only practical way, and it means the test proves the predicate rather than the clock.

## Manual steps

Needs the development Jellyfin reachable (`needs: [jellyfin]`), and it is the end-of-phase
run rather than part of a change loop.

1. `marp db status` to confirm which database is serving, and `marp db dump` before starting
   — this is the step that writes to the corpus.
2. Record the baseline:
   `SELECT count(*) FROM observation_thumbnails WHERE status = 'failed' AND permanent = false AND thumbnail_evicted_at IS NULL;`
   It was **3,567** on 2026-10-21.
3. Start the API (`npm run dev`). The sweeper runs its first pass immediately.
4. `GET /api/v2/observations/thumbnails/status` and read `sweep.lastSweep`. Expect
   `retried: 200`, `backfilled: 0`, `skipped: null` on the first pass, then `skipped: "busy"`
   on the passes that fall while the queue drains.
5. Leave it an hour. Re-run the baseline query. **Expected: lower.** Record the number that
   remains and what its `last_error` values say — a residue that does not move is the next
   question, not a failure of this one.
6. Confirm nothing was evicted that should not have been:
   `SELECT count(*) FROM observation_thumbnails WHERE thumbnail_evicted_at IS NOT NULL;`
   It was **0** before and should still be 0: the corpus is nowhere near the budget.

---

## Results

Run on 2026-10-21 against the development PostgreSQL, on branch `121-thumbnail-sweeper`.

### `npx jest tests/thumbnails.test.js`

```
  Test Suites : 1 passed, 0 failed, 1 total
  Tests       : 103 passed, 0 failed, 0 skipped, 103 total
  Duration    : 19.2s

  Result: ALL TESTS PASSED
```

83 of those were already there; the 20 new ones are the table above.

### The tripwires, proved red before they were trusted

Two of the new tests were run against deliberately broken code, because a test that has
never failed is a claim rather than evidence. `thumbnail_evicted_at IS NULL` and the whole
backoff clause were removed from `sweepRetryable`, and:

```
  the background sweeper (#121) > never re-offers what the evictor just freed ... FAIL
  Tests       : 0 passed, 1 failed, 102 skipped, 103 total

  the background sweeper (#121) > waits out the backoff before offering ... FAIL
  Tests       : 0 passed, 1 failed, 102 skipped, 103 total
```

The code was restored from a copy taken before the edit and the file re-verified.

### `npm run test:mosaic` — the group this change belongs to

```
  Test Suites : 13 passed, 1 failed, 14 total
  Tests       : 340 passed, 0 failed, 0 skipped, 340 total
```

**Zero tests failed. The suite-level failure is the corpus guard, and it is environmental.**
It reported:

```
  tests/video-player-vendor.test.js changed the database.
    - gpu_workers: row(s) modified, count unchanged at 13
    - service_clients: row(s) modified, count unchanged at 15
    - service_tokens: row(s) modified, count unchanged at 54
```

Nothing in the mosaic group writes to `gpu_workers`. A real GPU worker was heartbeating
against this database throughout — `ABYSS-fba6be1a`, last seen 25 seconds before the run —
and it authenticates with a service token on each poll, which moves all three tables. The
guard cannot tell a live worker from a leaking test, and says so.

**This was checked rather than assumed, and the first check was wrong.** An unmodified
`develop` worktree was built at `0ba9ed86` and the same group run in it. The first run was
clean, which looked like evidence that the failures were mine. A second run of the *same
unmodified develop* was not:

```
  Test Suites : 11 passed, 3 failed, 14 total
  Tests       : 320 passed, 0 failed, 0 skipped, 320 total

  tests/listen.test.js changed the database.
    - datasets: row(s) modified, count unchanged at 2
    - gpu_job_attempts: row(s) modified, count unchanged at 6855
    - gpu_jobs: row(s) modified, count unchanged at 9563
  tests/mosaic-query.test.js changed the database.
    - gpu_workers, service_clients, service_tokens: row(s) modified
  tests/mosaic-correction.test.js changed the database.
    - datasets, gpu_job_attempts: row(s) modified
```

Those tables belong to a GPU worker and to another agent's dataset work, and the mosaic
group touches none of them. So the guard fails intermittently on this machine right now,
identically with and without this change, and which files it names is a matter of when the
worker's poll lands. **The one clean run was the luck; the failures are the normal state
while a worker is running.**

What that costs this verification, stated plainly: the guard could not be used to prove that
these tests leave the database unchanged. The narrower evidence that they do is that
`tests/thumbnails.test.js` passes the guard when run on its own, repeatedly, and that every
sweep test runs inside a transaction it rolls back. That is weaker than a green group run
and it is what there is.

### What was not run

The manual steps above. No picture has been extracted, and the 3,567 figure has not moved.
