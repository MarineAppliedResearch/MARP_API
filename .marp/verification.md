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

### The manual run, 2026-10-21

`marp db dump` first: 136.5 MB plus 109,658 thumbnail files, at
`MARP_API/.marp/local/corpus/20261021-140548`.

The API was started from this branch on **port 3001**, not 3000, because another API was
already running there; both drain the same queue, so the figures below are the queue's
rather than one process's.

Baseline, and after eight minutes:

| | before | after |
| --- | --- | --- |
| ready | 111,319 | 111,322 |
| queued | 0 | 189 |
| retryable failures | 3,567 | 3,373 |
| permanent failures | 38 | **40** |
| rows the sweeper has offered | 0 | 200 |

**The sweeper itself did exactly what it was built to do.** The first pass enqueued 200 —
`SWEEP_BATCH_SIZE` exactly — at ordinary priority, and subsequent passes correctly enqueued
nothing while the queue was busy. Nothing was evicted. No reviewer-facing behaviour changed.

**Extraction is another matter, and this run is mostly a finding about Jellyfin.** Of the 200
offered, eleven had resolved when the run was stopped:

- **3 became real pictures**, 27,799 bytes between them — a mean of 9.3 KB, consistent with
  the 8.2 KB measured across the existing corpus.
- **6 failed again** with `ffmpeg timed out after 120s` and `frame= 0 fps=0.0 size=0KiB` —
  ffmpeg connected and received nothing for two minutes. `GET /System/Info/Public` answers
  (Mare Video Server 10.11.11), so the server is up and the streams are not delivering.
- **2 were marked permanently failed on a Jellyfin 401** (observations 258 and 308, both
  `20240730_171520_Fwd.mp4`).

The run was stopped at that point rather than left going, because of the third line.

### The defect this run exposed, which is not the sweeper's

`resolveVideoSource` treats *any* failure to match a video as structural, so an HTTP **401
from Jellyfin — an authentication problem, which is transient by nature — is recorded as
`permanent: true`.** A permanent failure is refused by *Ask again* and skipped by the
sweeper, by design, so those two observations are now unreachable by either recovery path
and need a hand-written `UPDATE` to come back.

This is pre-existing: the same code path, and the 28 rows already carrying
`No Jellyfin video matched video_source ""` prove it has always classified this family as
permanent. **But the sweeper is what turns it from rare into systematic.** Nothing used to
retry these rows at all; now a sweep that lands inside a 401 window can permanently retire up
to 200 perfectly good observations in one pass, unattended, and the flag is what stops anyone
noticing. That is the opposite of what this issue is for.

It is out of this task's scope and it is **not fixed here**. It needs a decision rather than a
guess: whether a Jellyfin HTTP status in the 401/403/5xx family should be transient while a
genuine no-such-video stays permanent.

### Throughput, measured rather than estimated

Eleven rows resolved in roughly eight minutes against three concurrent streams, because the
dominant outcome is a 120-second timeout rather than a 1.5-second decode. At that rate the
3,373 remaining would take on the order of **40 hours**. The sweeper's own pacing is not the
constraint and tuning `SWEEP_BATCH_SIZE` would not help; Jellyfin is the constraint, exactly
as #118 said it would be.

### The repair, and what it revealed

Asked for and done 2026-10-21: observations 258 and 308 were reset to
`permanent = false`, with `sweep_attempts` back to 0 and `swept_at` cleared, so both *Ask
again* and the sweeper can reach them again. `status` and `last_error` were left alone, so
the record of why still reads.

Checked before touching them rather than assumed: **2,531 observations on that same
`20240730_171520_Fwd.mp4` already have ready thumbnails**, so the video resolves perfectly
well and the 401 was spurious. The repair restores a true state rather than masking a real
refusal.

It also turned up that **those two were not the only ones.** Sixteen rows on that one video
carry the identical permanent failure, so fourteen were retired this way before this work
started — on a video with 2,531 working pictures. They were left alone: the ask was for two.

**And it is still happening.** The API on port 3000 kept draining the queue the sweep filled,
and fourteen further rows were permanently retired between the run being stopped and this
being written, the newest at 21:17:38, all carrying the same 401. Pausing the extractor
through `thumbnail_extraction_state` is the designed control for exactly this and is one
reversible write, but it is a shared resource and was left to the human.

### The pause, and the final accounting

Paused on the human's instruction at 21:25, through `thumbnail_extraction_state` -- the
control #118 built for exactly this. It behaved as specified and the specification earned
its keep:

| | T+0 | T+60s | T+120s | T+240s |
| --- | --- | --- | --- | --- |
| claimed | 29 | 21 | 5 | **0** |
| ready | 111,328 | 111,336 | 111,349 | 111,349 |
| permanent | 66 | 66 | 66 | **66** |

**Permanent failures froze the moment the pause landed**, which is what it was for. And
in-flight extractions were allowed to finish rather than killed, which produced **21 more
real pictures** out of Jellyfin streams already paid for -- the reason the migration gives
for there being no `stopped` state, demonstrated rather than argued.

Against the baseline:

| | before | after |
| --- | --- | --- |
| ready | 111,319 | **111,349** (+30) |
| retryable failures | 3,567 | 3,447 |
| permanent failures | 38 | **66** (+28) |
| queued | 0 | 62, extractor paused |

**Every one of the 28 new permanent failures is the spurious 401**, across two videos -- 14
on `20240730_171520_Fwd.mp4` and 14 on `20260614_203200_Fwd.mp4`. The 38 that were there
before are all genuine: 28 with an empty `video_source` and 10 with no keyframes. So the
defect has a clean signature and the damage has an exact boundary:
`permanent AND last_error LIKE '%401%'` is 28 rows, all recoverable by the same two-column
reset that fixed 258 and 308.

**This is the honest cost of the run: 30 pictures gained, 28 observations retired that should
not have been.** The sweeper did not misbehave -- it offered 200 rows at the right priority,
stopped offering more while the queue was busy, and recorded itself accurately throughout.
What it did was drive an existing misclassification hard enough to be visible, which is worth
something, but it is not a trade worth repeating. **Resuming before the 401 is settled would
simply retire more.**

### State left behind

62 rows are still `queued` with `sweep_attempts = 1`, and nothing is draining them: the
extractor is **paused**, persistently, with the reason recorded in
`thumbnail_extraction_state.note`. They resume where they left off whenever somebody resumes
it. The port 3001 process was stopped; port 3000 was never touched and is still serving.
