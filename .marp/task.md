---
task: MarineAppliedResearch/MARP_API#121
repos: [MARP_API]
status: verifying
needs: [jellyfin]
---

## Goal

A reviewer opens a page of the mosaic and finds pictures. Today most of them do -- but
**3,567 tiles in the development corpus are stuck showing NO IMAGE**, not because they can
never have a picture, but because Jellyfin refused a connection or ffmpeg timed out at the
moment the extractor reached them. Nothing retries those. The only way back is a person
noticing the hole and pressing *Ask again* on each page that contains one, which means the
quality of the corpus depends on somebody paging through it.

This issue is the thing that works when nobody is looking: it retries what is worth
retrying, it fills what has never been asked for, and it keeps the stored bytes inside the
budget an administrator set -- all on a schedule, at a priority that never gets in front of
a reviewer.

## What investigation found, and how it changes the issue

The issue text was written on 2026-09-10 and **three of its four premises have been overtaken
by work that merged since.** This is the finding, and it is the reason the requirements below
look nothing like the issue's bullet list. Every number here is read from the development
database on 2026-10-21, not estimated.

### 1. Backfill of rows that have never been asked for is already done, by two mechanisms

The issue says the ~440,000 legacy observations "will never be created again, so under this
design they get no picture at all until something backfills them -- and that something is this
issue." That was true when A3's reversal landed. It is not true now:

- `migrations/20260910120000-enqueue-a-thumbnail-when-a-keyframe-is-written.js` puts a trigger
  on `keyframes`, so anything with a keyframe gets a row.
- `repository/mosaic.repository.js:1151` calls `enqueueMissing` when a page is served. The
  comment there records that A3 **moved twice** on 2026-09-10 and landed back on the page
  enqueueing as a backstop.

The measurement: **114,924 observations, 114,924 thumbnail rows, zero observations with no
row.** Of the 114,924, 114,886 have keyframes; the 38 without are exactly the 38 recorded as
permanent failures. There is no legacy backlog left to walk in this corpus.

That does not make backfill worthless -- it makes it a *guard* rather than *the point*. A row
can still go missing: `discardQueue()` (the `stop` control) **deletes** queued rows, and a
corpus loaded by `scripts/load-corpus.js` carries whatever rows the dump had. A backfill pass
that finds nothing is the correct outcome and still worth having. But it is not where the
3,567 broken tiles are.

### 2. The broken tiles are transient failures, and *that* is the real gap

| status | permanent | rows |
| --- | --- | --- |
| ready | false | 111,319 |
| failed | **false** | **3,567** |
| failed | true | 38 |
| queued | -- | 0 |

The top reasons, counted from `last_error`:

- `ffmpeg exited ...: Connection to tcp://...` -- 45 in the largest single variant
- `ffprobe exited 1: Connection to tcp://...` -- 36 across two variants
- `ffmpeg timed out after 120s` -- 79 across the sampled variants

These are Jellyfin being unreachable or slow. **The `permanent` flag already draws the line
the issue asks for** -- `permanent = false` means "retrying could help" -- and nothing in the
codebase acts on it. `requeue()` exists and is only ever called by
`POST /api/v2/observations/thumbnails/retry`, which is the *Ask again* button. So the
distinction the issue says a sweeper "is what would act on" is recorded, correct, and unused.

### 3. Eviction is already built, and the number that was missing now exists

MARP_API#176 and #178 landed `service/review-imagery-storage.service.js`,
`repository/review-imagery.repository.js`, `service/review-imagery-policy.js` and the
`review_imagery_settings` table. That is a real eviction mechanism: a byte budget, a low
watermark, three orderings (`full_frames_first`, `oldest_first`, `thumbnails_first`), LRU by
`thumbnail_accessed_at`, a content-hash reference count so shared files are not deleted out
from under a second row, and a park-then-delete so a filesystem failure cannot lose a file
whose row it already cleared. `enforceLimit()` is called from `extractVideoGroup` and from
`updateSettings`.

The issue's second reason for deferring -- *"nobody has the numbers yet"*, "roughly 5-20 GB
depending on output size, and the mean file size on real data is not yet known" -- is now
answerable:

- **910,002,970 bytes across 111,319 ready thumbnails: a mean of 8.2 KB.**
- At 440,000 observations that extrapolates to **~3.6 GB**.
- The configured budget is **25 GiB**, with a 90% low watermark.
- `thumbnail_evicted_at IS NOT NULL` on **zero** rows: nothing has ever been evicted.

So the size budget is roughly **seven times larger than the whole projected corpus**. An
eviction rule invented now would still be guesswork, but for the opposite reason from the one
the issue gives: not because the number is unknown, but because the known number says
eviction will never fire on thumbnails alone. Full frames are the volatile half -- they are
uncropped source frames, and the default `full_frames_first` ordering says somebody already
believed that.

### 4. The schedule has a place to live, and it is already running

`service/thumbnail-extraction.service.js` `start()` is called from `server.js:83` (never from
`app.js`, deliberately, so the test suite does not open Jellyfin streams). It polls every
`IDLE_POLL_INTERVAL_MS` = 1000 ms, claims up to `CLAIM_BATCH_SIZE` = 45 rows, groups them by
video and runs at most `MAX_CONCURRENT_STREAMS` = 3 concurrent ffmpeg decodes.

A sweeper is therefore **a periodic producer feeding the queue this loop already drains**,
not a second scheduler and certainly not a second extractor. `claimBatch` already orders by
`request_priority DESC` -- a reviewer's retry sets it to 1, the trigger and the page backstop
leave it at 0 -- so **sweeper-enqueued work can be given a priority that already loses to a
reviewer's *Ask again*, with no change to the claim query.** The issue's first reason for
deferring (contention for the Jellyfin ceiling) is answered by an existing field.

## Requirements

- **R1** -- A sweep pass runs on a schedule inside the API process, beside the existing drain
  loop and started from the same place, and does not run under Jest.
- **R2** -- **Retry sweep.** The pass re-queues thumbnail rows that are `failed` with
  `permanent = false`, oldest first, bounded per pass.
- **R3** -- A retried row is enqueued at a priority **strictly below** a reviewer's *Ask
  again*, so background work never claims a stream ahead of somebody waiting.
- **R4** -- A row that keeps failing is not retried for ever. There is a bound, recorded on the
  row, after which the sweeper stops offering it; *Ask again* must still work on it.
- **R5** -- **Backfill sweep.** The pass enqueues observations that have no
  `observation_thumbnails` row at all, oldest first, bounded per pass. Finding none is the
  normal outcome and is not an error.
- **R6** -- The sweeper never re-queues a `permanent` failure, and never resets a `ready` row.
  (`enqueueMissing`'s `ON CONFLICT DO NOTHING` already holds this; the sweeper must not go
  around it.)
- **R7** -- The sweeper respects `thumbnail_extraction_state.run_state`: `paused` stops it
  producing work, exactly as it stops the drain consuming it.
- **R8** -- **Eviction sweep.** `enforceLimit()` runs on the schedule as well as after an
  extraction group, so a budget lowered while nothing is extracting is enforced without
  waiting for the next thumbnail.
- **R9** -- What the sweeper did is observable: counts per pass on
  `GET /api/v2/observations/thumbnails/status`, so a person can tell a sweeper that is working
  from one that is finding nothing from one that is not running.
- **R10** -- The sweeper is switchable off without a deploy, because it is the thing most
  likely to be blamed when Jellyfin is struggling.
- **R11** -- Every limit is one constant in `config/thumbnails.js`, for the reason that file
  already gives about `MAX_CONCURRENT_STREAMS`.
- **R12** -- A failure to resolve a video is recorded as **permanent only when retrying
  genuinely cannot help**. The media server being unreachable, unauthenticated or unhappy is
  transient; a library that answered and has no match, or an observation naming no video at
  all, stays permanent. Added after the first real run, which is where it was found.

## Open assumptions

Each one is phrased so a one-line answer resolves it. The five tagged `blocking` change the
schema, the schedule, or what gets deleted.

### The retry sweep

- [x] **A1 · behavioural · blocking** -- answered 2026-10-21: **backoff with a hard cap,
  cap 10.** -- **What makes a transient failure worth retrying
  again?** The 3,567 failed rows carry `attempts` (how many times extraction was claimed) and
  `completed_at`. Three candidate rules:
  1. **Attempt-capped**: retry while `attempts < N`, no waiting period. Simple, and a row that
     failed five times stops costing Jellyfin anything.
  2. **Age-based backoff**: retry a row whose last attempt was longer ago than a growing
     interval -- an hour, then a day, then a week. Survives "Jellyfin was down all Tuesday"
     without a cap that throws good rows away.
  3. **Both**: backoff, with a hard cap.

  My recommendation is **3**, with a generous cap (say 10). The evidence: every top failure
  reason here is a network or timeout condition, which is exactly the kind that comes back on
  its own -- but a row whose video genuinely no longer resolves would otherwise be asked for
  for ever. **A different answer changes whether a column is added** (see A2), so this is
  blocking.

- [x] **A2 · database/schema · blocking** -- answered 2026-10-21: **yes, add `sweep_attempts`
  and `swept_at`.** -- **May the sweeper add a column to
  `observation_thumbnails`?** Whatever A1 answers, the existing columns do not quite say it.
  `attempts` counts claims and is **incremented by `claimBatch` on every claim including
  reviewer retries**, so capping on it silently punishes a row a reviewer asked about.
  `completed_at` is "when extraction last finished" and is shared with the reviewer path too.
  A clean rule needs something like `sweep_attempts` and `swept_at` -- two nullable columns and
  a partial index. The alternative is to reuse `attempts`/`completed_at` and accept that a
  reviewer pressing *Ask again* consumes part of the background budget. I recommend **adding
  the two columns**; it is operational state on a cache table, nothing is transformed, and the
  precedent is `20260913210000-add-review-imagery-cache.js` doing exactly this. But a new
  migration orders against branches in flight (`104-dashboard-reads-marp` adds
  `dataset_classes` and drops `datasets.class_names`), so it is worth saying yes before it is
  written.

- [x] **A3 · performance/concurrency · non-blocking** -- proceeding on the proposal below;
  every number is one constant in `config/thumbnails.js` and cheap to change. -- -- **How much background work per pass, and how often?**
  Proposal: enqueue at most 200 rows per sweep, sweep every 5 minutes, and **skip the sweep
  entirely while any row is `queued`** -- so the sweeper only ever tops up an empty queue and
  can never build a backlog in front of a reviewer. At 3,567 rows that drains the current
  backlog in about 18 passes, 90 minutes, if Jellyfin cooperates. Not blocking: a different
  number is a constant.

### What "stale" means, and whether anything should be deleted

- [x] **A4 · product/UI · blocking** -- answered 2026-10-21: **no new eviction rule.** The
  eviction half of this issue is R8 alone. -- **Is there any eviction rule beyond the byte budget
  that already exists?** The measurement says the thumbnail corpus projects to ~3.6 GB against
  a 25 GiB budget, and nothing has ever been evicted. So the honest options are:
  1. **Nothing new.** Eviction stays "stay under the administrator's budget", and this issue's
     eviction half becomes R8 alone -- run the existing `enforceLimit()` on the schedule.
  2. **Age**: delete a thumbnail not viewed in N months, budget or no budget.
  3. **Review state**: delete the thumbnail of an observation whose review is committed, on the
     grounds that nobody will look again.

  My recommendation is **1**, and I want to argue against 3 specifically: a committed decision
  is exactly the thing somebody audits, and some of these decisions are the evidence behind
  recorded walkthroughs. **Deleting is destructive**, so this is blocking whatever the answer.

- [x] **A5 · destructive · blocking** -- answered 2026-10-21: **leave the orphans.** Nothing
  deletes a file in this work stream. -- **What happens to the bytes of a thumbnail whose observation was
  deleted?** The foreign key is `ON DELETE CASCADE`, so the *row* goes. The JPEG under
  `storage/observation-thumbnails/` does not: nothing watches for it, and the filename is a
  content hash shared by any observation on the same frame, so it cannot simply be unlinked
  with the row. A sweep for files with no referencing row is the natural fix and it is a
  **delete against the filesystem**, so it needs a yes.

  **Measured 2026-10-21 rather than guessed:** 109,658 files under
  `storage/observation-thumbnails/`, 109,451 of them named by a row. **207 orphans, 1,364,745
  bytes** -- 0.19% of the files and 0.0054% of the 25 GiB budget. Full frames: 29 files, zero
  orphans. So my recommendation is **leave them**, and say so in the spec rather than build
  it: 1.4 MB is not worth a delete pass whose failure mode is racing an extraction that has
  written its file and not yet committed its row. If the answer is to sweep anyway, the safe
  rule is *older than one claim lease and unreferenced*, not *unreferenced*.

### Where it runs

- [x] **A6 · architectural · blocking** -- answered 2026-10-21: **in-process.** -- **In-process beside the drain loop, or a separate
  scheduled job?** Everything above assumes in-process: one timer in
  `thumbnail-extraction.service.js`, started by `server.js`, producing into the queue the
  drain already consumes. It needs no new deployment surface, inherits `run_state`, and is
  reversible. The cost is that **two API processes would each sweep** -- harmless for the
  enqueue (idempotent) but duplicated work for `enforceLimit()`. The alternatives are a
  `node scripts/sweep-thumbnails.js` run by Task Scheduler or cron, or a GPU job. I recommend
  **in-process**, and note that #118's own config file says of its lease: *"if it ever grows
  heartbeats or workers, that is the signal the GPU job system was the right answer after
  all"* -- a sweeper is not that signal. Blocking because it decides where the code goes.

- [x] **A7 · behavioural · non-blocking** -- proceeding on the proposal: no time window. -- -- **Should the sweeper be off-hours only?** The issue's first
  reason for deferring was contention for Jellyfin. R3's priority ordering answers most of it,
  and the extraction loop's own concurrency bound answers the rest. A time window is a third
  control and I do not think it is needed -- but the answer changes whether a constant exists.
  Proposal: **no time window**, priority only.

- [x] **A8 · product/UI · non-blocking** -- proceeding on the proposal: leave the copy. -- -- **Does the mosaic's no-imagery banner get its sentence back?**
  This issue's own comment records that `ui/grid.js` says *"The server refetches missing
  imagery on its own"*, that this stopped being true, and that "either this issue or #124
  should correct it". If the sweeper lands, **it is true again** -- so the question is whether
  to leave the copy alone (it is accurate once this merges) or reword it to say when.
  Proposal: leave it.

## Decisions

- **2026-10-21** -- Branch `121-thumbnail-sweeper` from `develop` at `0ba9ed86`. One branch for
  the whole work stream.
- **2026-10-21** -- **The sweeper never touches an evicted row, and this was nearly a loop.**
  `markFileEvicted` leaves a row at `status = 'failed', permanent = false` with
  `thumbnail_evicted_at` set -- which is exactly the shape R2 re-queues. Without an exclusion
  the evictor frees space, the sweeper re-extracts the same picture, the evictor frees it
  again, and the two fight each other against the media server the concurrency bound exists to
  protect. So the retry sweep requires `thumbnail_evicted_at IS NULL`. Found while writing the
  query rather than while running it; it has its own test. This is forced by A4's answer rather
  than a new assumption: no new eviction rule means the sweeper does not get to undo the one
  there is.
- **2026-10-21** -- **The sweeper enqueues at `request_priority = 0`, which already exists and
  is already what R3 asks for.** `#134`'s migration declares 0 as *"ordinary page/background
  work"* and 1 as *"a reviewer waiting"*, and a check constraint allows only those two. So no
  schema change was needed for the priority, and within the ordinary class the existing
  `requested_at` ordering keeps it FIFO.
- **2026-10-21** -- **Backoff is `1 hour << sweep_attempts`, capped at one week.** One SQL
  expression rather than a table of steps: 1 h, 2 h, 4 h ... 128 h, then a week for the rest of
  the ten. A3's "skip while anything is queued" means the sweeper only ever tops up an empty
  queue, so this is the interval between offers rather than between extractions.
- **2026-10-21** -- The issue's premises were checked against the running database rather than
  taken as written, and three of four had moved. Recorded above under *What investigation
  found* so the next reader does not re-derive it.

- **2026-10-21** -- **The first real run found a defect this issue makes dangerous, and the
  order of the repair was settled rather than assumed.** `resolveVideoSource` records a
  Jellyfin **401** as a *permanent* failure, and permanent means both *Ask again* and the
  sweeper refuse the row. Unattended, a sweep landing inside a 401 window retires up to 200
  good observations in one pass and the flag suppresses any sign of it. 28 rows were lost that
  way, on two videos that demonstrably resolve.

  Extraction is paused, and the 28 are **left damaged on purpose**: repairing them first would
  hand them straight back to the thing that retired them. Fix the classification, then repair,
  then resume. The defect is out of this task's scope and is not fixed here.

- **2026-10-21** -- **R12: the classification was already on the error and was being thrown
  away.** `jellyfin.repository.js` states its error contract in its own header and keeps to
  it -- 404/`RESOURCE_NOT_FOUND` for an item the library does not have, 502/`UPSTREAM_ERROR`
  for the server being unreachable or unhappy, which is where the 401 lands after
  `_authenticatedRequest` has already re-authenticated and retried once. `extractVideoGroup`
  caught the error, flattened it to a message and passed `true` regardless. So the fix reads
  `error.code` rather than parsing text, and the message now follows the classification
  instead of contradicting it: a row that failed because the server could not be reached no
  longer says no video matched.

  **The default is the fix.** Unrecognised now means transient, because being wrong that way
  costs a bounded number of retries against a cap, and being wrong the other way silently and
  permanently loses an observation's picture. 404 and the empty `video_source` stay permanent,
  which leaves #118's A8 exactly as it was.

## Plan

Written for the shape the recommendations above imply. It changes if the answers do.

1. Settle A1, A2, A4, A5 and A6. Nothing is implemented before that.
2. Measure the orphaned-file question in A5 so the answer is given against a number.
3. Migration for the two sweep columns, if A2 says yes.
4. `sweepOnce()` in the repository: the two enqueue statements, each bounded and each
   returning what it enqueued.
5. The timer in `thumbnail-extraction.service.js`, run-state aware, with `enforceLimit()` on
   the same tick.
6. Counters on the status route.
7. Tests, at the tiers listed below.

## Acceptance criteria

- A row that is `failed, permanent = false` and has not exhausted its bound becomes `queued`
  without anybody pressing a button, and a reviewer who then opens its page sees a picture.
- A `permanent` failure and a `ready` row are both untouched by a sweep, proved by assertion
  rather than by inspection.
- A sweep while `run_state = 'paused'` enqueues nothing.
- Sweeper-enqueued work is claimed **after** reviewer-requested work when both are queued.
- `GET /api/v2/observations/thumbnails/status` distinguishes "swept, found nothing" from
  "never swept".
- The development corpus's 3,567 transient failures are measurably fewer after a real run,
  and the number that remains is reported rather than rounded to "it works".

## Test plan

Filled in properly at G3. The tiers that can observe each requirement, named now because the
choice is not obvious:

- **R2, R4, R5, R6, R7** are repository-level SQL against seeded rows --
  `tests/thumbnails.test.js`, group `npm run test:mosaic`. Each test seeds the rows it asserts
  on (`tests/setup/corpus-guard.js` fails any file that changes the database, so seeding and
  cleanup are per-test).
- **R3** is the ordering out of `claimBatch` with one reviewer row and one sweeper row queued --
  the same group, and it is the one that would silently regress.
- **R8** is `enforceLimit()` being reached from the timer, which is a unit assertion on the tick
  function rather than on the loop.
- **R9** is the status route's body.
- **Not covered**: the real Jellyfin round trip. Whether a retried row actually produces a
  picture depends on a media server being reachable, and that is the end-of-phase run on
  `needs: [jellyfin]`, not a unit test. The acceptance criterion about the 3,567 is that run.

`console.log` is swallowed by this repository's Jest reporter -- assert values, never print
them.

## Status

- **Gate:** verifying
- **Notes:** G0-G4 complete, and the defect the first real run exposed is fixed here rather
  than deferred (R12). 108 tests green in `tests/thumbnails.test.js`, 25 of them new, three
  tripwires proved red before being trusted. **Not pushed, no pull request** -- that is G5.

  The development database is back to an ordinary state: extraction running, nothing queued,
  38 permanent failures and every one genuine. Net result of the real runs is **+91
  thumbnails** (111,319 -> 111,410).

  Two things a reader should know rather than discover:

  - **The corpus guard is unreliable on this machine while a GPU worker is running**, and it
    fails identically on unmodified `develop`. Both runs are in `.marp/verification.md`
    verbatim. It means the guard could not be used as evidence here, which is a gap rather
    than a pass.
  - **The API on port 3000 predates this branch** and still runs the old classification. It
    needs a restart to pick up R12.
