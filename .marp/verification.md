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
| R12 | `does not give up when the media server could not be asked` | unit | A Jellyfin 401 is transient — the regression that cost 28 observations. |
| R12 | `does not give up when the media server was unreachable` | unit | A network failure is transient. |
| R12 | `still gives up when the library has no such video` | unit | #118's A8 is unchanged. |
| R12 | `still gives up when the observation names no video at all` | unit | An empty `video_source` stays permanent. |
| R12 | `treats an unrecognised failure as worth retrying` | unit | The default inverted, which is the fix. |
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

  **This is where CI caught something the local runs could not.** The first version built
  that timestamp with `Date.now()` and set it to exactly the backoff ago -- so the comparison
  was a JavaScript clock measured against SQL `NOW()`, which locally is one machine and in CI
  is two containers. It passed here every time and failed there on a few milliseconds of
  skew: a coin flip wearing a test's clothes. Every relative `swept_at` is now written by the
  database itself, `NOW() - make_interval(...)`, so one clock decides both sides of the
  comparison, and the margins are whole backoff periods rather than hairs. Fixed instants are
  still built in JavaScript, because no plausible skew spans six years.

  Worth saying plainly: "340 green locally" did not catch this and could not have. It took
  the slower tier on different hardware, which is the argument for having one.

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

### The 401 fix, and the run that followed it

`resolutionIsPermanent` now reads `error.code` instead of assuming. Proved red before it was
trusted: reverted to the old `return true` and the 401 test failed, then restored.

```
  which Jellyfin failures are permanent (#121 R12) ... 5 passed
  Tests       : 108 passed, 0 failed, 0 skipped, 108 total
```

All 28 rows were then reset -- `permanent AND last_error LIKE '%401%'`, exactly the boundary
recorded above, 28 matched and 28 repaired -- and extraction resumed. The queue drained to
empty with nothing wrongly retired:

| | T+0 | T+45s | T+90s |
| --- | --- | --- | --- |
| queued | 49 | 33 | **0** |
| ready | 111,361 | 111,377 | **111,410** |
| permanent | 38 | 38 | **38** |

**Final state against the baseline: 111,319 -> 111,410 ready, a net +91 pictures.** Permanent
failures are back to 38 and every one is genuine -- 28 naming no video, 10 with no keyframes.
Retryable failures are 3,476 against 3,447 before, because the drain also recorded fresh
transient failures; that is the system working rather than regressing. Nothing is queued and
the extractor is running.

Jellyfin also stopped timing out partway through, which is why the last 49 rows went from
hopeless to finished in ninety seconds. That matters for the 40-hour estimate above: it was
measured inside a bad window, and the media server's mood is the variable rather than
anything here.

**One honest limit on all of this.** The API still serving on port 3000 was started before
this branch existed and runs the **old** classification. It did not retire anything this time
because the 401 window had passed, not because it is fixed. The fix protects a process running
this branch; that one needs a restart to pick it up.

**And one thing the pause exposed that is not fixed.** `refuses a run-state change to a
caller who is not an admin` asserts the run state is literally `running`, so the whole file
fails for anybody whose extractor is legitimately paused -- which this feature's own control
surface makes more likely, not less. It passes again now only because the extractor was
resumed. Comparing against the state the suite already records in `runStateBefore` would fix
it; left alone deliberately, because it is somebody else's test and the human decides.

### State left behind

62 rows are still `queued` with `sweep_attempts = 1`, and nothing is draining them: the
extractor is **paused**, persistently, with the reason recorded in
`thumbnail_extraction_state.note`. They resume where they left off whenever somebody resumes
it. The port 3001 process was stopped; port 3000 was never touched and is still serving.

**All three of those are now resolved**, in the order that was settled: the 401 was
reclassified, the 28 rows were repaired, and extraction was resumed. The database is back to
an ordinary state -- running, nothing queued, 38 permanent failures and every one of them
genuine.

---

# Verification plan — MARP_API#268, YOLO training output

**Everything in this plan has now been run.** The results are first, with the plan kept
below them so a reader can see what was intended as well as what happened.

## It is verified. What ran, and what it found

The schema-load obstacle was a database **name**, not a permission: every database
`marp db up` creates carries production's, and the danger-gate refuses any command
naming it. The way through was a database of this worktree's own -- `marp db up -Port
5447 -DataDirName yolo-5447`, then `createdb marp_yolo_5447` -- which is a different
database, not a rephrasing of the refused command. `DB_*` passed inline per command, so
nothing reached disk and the `.env` deny rule did not matter.

| Ran | Result |
| --- | --- |
| **V1** baseline + 28 migrations, including this one | **pass** -- 23 tables and 4 views from the baseline, then every migration. The integrity guard reported `before: training_runs=0 metrics_summary=0 \| 9 foreign key(s) watched` and `after: no rows deleted, dereferenced or orphaned`. |
| **V2** `db:migrate:undo` | **pass** -- all four columns and the matrix table gone (`cols after undo: 0`, `matrix table after undo: 0`). |
| **V3** re-apply | **pass** -- clean, so the index names do not survive the drop. |
| **V4** `tests/final-metrics.test.js` | **pass** -- 30 of 30. |
| **V5** transpose proved red **inside** Jest | **pass** -- with the transpose removed, `1 failed, 29 skipped` in the unit suite and `1 failed, 18 skipped` in the endpoint suite. Both tiers see it. Restored: 30 of 30. |
| **V6-V15, V17-V25** `tests/training-run-yolo-output.test.js` | **pass** -- 19 of 19, after three fixture faults. |
| **V18** the curves measurement | **done**, below. |
| `npm run test:ml` | **pass** -- 18 suites, 320 tests. |
| `npm run test:gpu` | **pass** -- 19 suites, 323 tests. |
| `npm run test:subsystems` | **pass**. |

**The first execution failed 19 of 19, and all three causes were in the fixture rather
than in the code under test.** Recorded because the file had claimed, correctly, that it
had never been run: `species.taxserial` is NOT NULL with no default and there is no
`is_active` column; `model_species` needs explicit timestamps; and a PNG stub recorded as
`application/json` made the byte-serving test try to parse it -- which was the route
correctly serving the content type the hand-off had recorded. A test nobody has run is a
draft.

### Re-read against live traffic, 2026-10-27

**A fact in this record went stale within a day, which is the point of re-reading.** On
2026-10-26 no stored event had ever carried `fitness`, `duration_seconds` or a `train/*`
loss, and this document said so. Worker 0.1.6 landed in between, and three of those are
now in traffic on jobs 21782, 21785 and 21786. The fixture in `tests/final-metrics.test.js`
is re-copied from job 21786 attempt 19223, and the tripwire that asserted
`train/box_loss` was absent now asserts its value instead -- kept rather than deleted,
because a fixture agreeing with yesterday's traffic is exactly the failure this work keeps
guarding against.

Two things that re-read also settled:

- **`fitness` has still never appeared in any metric event MARP has stored**, checked
  across every training attempt rather than one payload. `OVERALL_FIELDS` maps it for the
  end-of-run report, which is a different payload, so nothing changes.
- **The offsets are a version boundary, not a gap.** Jobs 21782 and 21785 carry the
  training losses and duration with no offsets; 21786 carries all five. `epochs` mirrors
  it exactly -- run 205 has ten rows with durations and no offsets, run 206 one row with
  both. Working as intended.

**No `final_metrics` or `metrics_curves` artifact exists yet.** `artifacts` holds only
`weights` (5) and `observations` (3,053), and job 21786 succeeded on 2026-10-27 with
weights alone. So the end-of-run fixtures are still derived from the library rather than
from traffic, and V18's sizes are still synthetic. Both are owed again once a run emits
one.

### V18, measured rather than estimated

20 classes x 1,000 confidence points, which is the shape the worker described:

| | |
| --- | --- |
| artifact on the wire, 5dp, three curves | **0.46 MB** |
| `metrics_curves` rows | **20,000** |
| row data on disk | **1,719 kB** |
| insert, batched 500 | **441 ms** |
| `GET /curves` payload | **0.60 MB** |
| read and group | **748 ms** |

**That is at or below the estimate on every axis** -- the worker's 1-1.5 MB was for four
curves unrounded, and three curves at 5dp come to 0.46 MB. 20,000 rows is exactly the
figure raised as the thing to check, and 1.7 MB per run is not a storage problem. The
read is the number to watch rather than the write: 748 ms to assemble a 0.6 MB response
is fine for a panel opened deliberately and would not be fine on a dashboard that polled
it.

**One thing the measurement makes concrete:** a 90-class model would be 90,000 rows and
about 7.7 MB per run, and the read would scale with it. Nothing needs doing now; it is
the point at which paging or a per-class fetch would start to earn its place.

## The plan as written, for reference

### The migration, both ways

- **V1** `npx sequelize-cli db:migrate` applies `20261026160000` against a database built
  from the baseline plus migrations. Proves the two columns, the table, both indexes and
  the integrity guard's own output.
- **V2** `db:migrate:undo` returns the schema to what it was. A `down` that does not is
  a migration that cannot be backed out of a shared database.
- **V3** Re-run `up` after the undo. An index name that survives a drop fails here.

### The reader, through Jest rather than beside it (R3, R4, R5, R6, R8)

- **V4** `npx jest tests/final-metrics.test.js` — the 17 assertions already written.
  They currently have *no* Jest evidence at all.
- **V5** Prove the transpose red inside Jest, by name, the way the harness asks:
  `npx jest tests/final-metrics.test.js -t 'transposes to rows-are-true when serving'`
  against a mutated module. Done outside Jest already; not yet inside it.

### The ingest (R1, R6, R7)

Not yet written. This is the gap in the plan and it is the biggest one.

- **V6** A `final_metrics` artifact on disk, named in a result, produces the expected
  `metrics_summary` rows and one matrix row. Asserted against the rows, not against the
  service's return value — a service that reports what it meant to write rather than
  what landed is how five of seven epoch columns were empty for months.
- **V7** The same result reported **twice** leaves the same row count. The replace is
  the claim; a duplicate per class is the failure it prevents.
- **V8** A malformed report leaves the attempt `succeeded` and the job unwithdrawn, and
  returns `failed` in its answer. This is the deliberate difference from the observation
  ingest and nothing currently proves it.
- **V9** A class name that resolves to two species lands with `species_id` null and
  `class_name` set — not dropped, not guessed at.
- **V10** A training attempt that hands over no `final_metrics` writes nothing and is
  not an error.

### The curves (R9)

- **V17** A `metrics_curves` artifact produces `classes × confidence` rows, each holding
  precision, recall and F1 at one threshold — not three rows per threshold.
- **V18** **The measurement the managing session asked for: the real row count and byte
  size for a run.** The estimate is 20 classes × 1,000 points = 20,000 rows and 1–1.5 MB
  of JSON. If the measurement is far worse, that is Isaac's call and the work stops
  there rather than continuing on the estimate.
- **V19** A curve one point shorter than the confidence axis stores nothing for that
  family. Proven red by shortening a fixture, since a shifted curve is subtly wrong
  rather than visibly broken.
- **V20** A curves artifact whose `split` disagrees with the report's stores nothing.
- **V21** A class with no `metrics_summary` row gets no curve — structural, because
  `metrics_summary_id` is NOT NULL, so this test is guarding the structure rather than
  a rule.
- **V22** `metrics_curves.support` is null on every row written — the count lives on the
  class's `metrics_summary` row, where its grain is right.
- **V24** `support` and `image_count` land on the per-class row, and stay null where the
  trainer reported none. "No instances" and "not counted" are different facts.
- **V25** A curve that is flat zero across every threshold is **stored**, not refused.
  The general rule here is that a gap must not read as a zero; this is the converse, and
  it is the one case where discarding would lose the record of a class the model missed
  completely.
- **V23** `GET /v2/training_run/:id/curves` returns index-aligned parallel arrays, and
  an empty array for a run whose worker sent no curves.

### The routes (R2, R6)

- **V11** `GET /v2/training_run/:id/metrics` on a run with nothing returns empty arrays
  and **200, not 404**.
- **V12** The same on a run with data returns rows whose nulls are still null. Assert on
  a null specifically; a snapshot would pass with zeros in it.
- **V13** `GET /v2/training_run/:id/artifacts` lists a file whose stem the code has never
  seen, under that stem. **This is the acceptance criterion for the open set** and a test
  that only uses known stems cannot see it fail.
- **V14** `GET /v2/training_run/:id/artifacts/:hash` serves the bytes, and refuses a hash
  belonging to a different run with 404.
- **V15** All four refuse an anonymous request with 401, like every route here.

### The corpus guard

- **V16** Every new suite leaves the database as it found it. `corpus-guard.js` enforces
  this and will fail the file otherwise; it is listed because a test that seeds
  `metrics_summary` is writing to a table that has never had a row, and nothing has ever
  had to clean it up before.

## What is deliberately not covered, and why

- **A real training run.** Nothing in MARP has ever produced a `final_metrics` artifact —
  the worker half is designed and agreed but unbuilt, and it is Isaac's gate. So **the
  report fixture is a contract, not an observation.** It is built from what the worker
  session read out of Ultralytics 8.4.145 rather than from stored traffic, and that is
  the weakest evidence in this work. The first real run is what confirms the field names,
  and until then this is the exact failure mode that has already bitten this stream twice.
  The per-epoch fixture *is* from stored rows, including the `child_kind` field no
  document mentions, as a standing reminder of the difference.
- **Ultralytics' own PR curve**, the one interpolating precision onto a fixed *recall*
  grid. Not stored, because `metrics_curves.confidence_threshold` is NOT NULL and means
  confidence; a recall value in it would make the table unreadable without knowing which
  curve each row came from. A PR curve is drawn by plotting the stored precision against
  the stored recall, which is two measurements against each other rather than a
  derivation, and the trainer's rendering is kept as an image besides.
- **`metrics_curves.support`.** A per-class count, not a per-threshold one. Left null
  rather than repeated a thousand times down a column that would then state something
  nobody measured.
- **The dashboard's rendering.** Another session's, built against this shape already.
- **Any backfill.** There is none and there cannot be one: the run directory is deleted
  once MARP holds the result.

## Status

**Verified at G4, 2026-10-26.** Migration applied, reversed and re-applied; 30 unit
assertions and 19 endpoint assertions green; `test:ml` 320 and `test:gpu` 323 green; the
transpose proved red inside Jest at both tiers before being restored. The curves
measurement is real rather than estimated.

**What this still does not prove**, and it is the important sentence: **no training run
has ever produced a `final_metrics` or `metrics_curves` artifact.** The worker half is
agreed and unbuilt, and its gate is Isaac. So every fixture here is built from what the
worker read out of Ultralytics 8.4.145 rather than from traffic. The two halves are built
and tested against each other's stated contract; nobody should say this works until a
real run has been through it.

The database-naming collision is unresolved as a piece of tooling: every database
`marp db up` creates carries production's own name, whatever port it is on. It did not
block this work in the end -- a separate database solved it -- but the next person to
run `marp db up` on a fresh port will meet the same gate.
