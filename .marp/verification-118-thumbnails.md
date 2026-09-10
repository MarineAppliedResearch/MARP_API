# Verification — MarineAppliedResearch/MARP_API#118

Phase 6, thumbnails. The plan below is written from the 26 requirements in `.marp/task.md`
for review **before** it is accepted as the evidence for this phase.

**Say plainly what has already happened, because it changes what this document is.** G2 ran
the suite to know the implementation worked — `43 suites, 559 tests, 0 failures, 40.1 s` — so
these tests exist and have passed. What has *not* happened is anybody agreeing that they are
the right tests. That is what this file is for, and *"that test does not actually prove the
requirement"* is the sentence worth saying now, while moving a test is cheap. The `## Results`
section below is empty and stays empty until the approved plan is run.

#103, #105 and #106 each renamed their verification when the next phase arrived
(`verification-105-mosaic-query.md`, and so on). This file follows that convention and will be
renamed when Phase 7's successor needs the name.

## The tiers, and why each requirement sits where it does

Four tiers are in play and the choice between them is the only decision in this document that
can invalidate the whole package.

- **unit** — `tests/thumbnail-geometry.test.js`, 31 tests, ~1.3 s, no database and no video.
  The geometry is a pure function of numbers, and this is the *only* tier that can exercise a
  box that overhangs the frame, because no real observation has ever produced one.
- **http+db** — `tests/thumbnails.test.js` and the mosaic suites, against the real development
  PostgreSQL through `tests/setup/authenticated-agent.js`. The queue's lease, the cascade, the
  `CHECK` constraints, the permission split and the persisted run state are observable at no
  other tier: a repository unit test cannot see two claims racing, cannot see a constraint
  refuse a value, and cannot see what a foreign key did on the way out.
- **manual/visual** — `scripts/thumbnail-spike.js` against the real Jellyfin. **A human looking
  at a picture is a tier here, not a nicety.** No automated assertion can distinguish a
  correctly cropped sea cucumber from a correctly cropped patch of rubble, and the
  centre-origin error this phase was most exposed to produces a *valid* JPEG of the wrong
  thing.
- **deferred** — R20's throughput measurement, which needs a corpus that does not exist.

`npm test`, never `npx jest`: the suite shares one PostgreSQL and `package.json` passes
`--runInBand` for that reason. New files are grouped in `scripts/test-subsystem.mjs`, and
`npm run test:subsystems` fails if a suite belongs to no group.

## What each test proves

`tests/thumbnails.test.js` unless another file is named.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | *is a table of its own, and writing it does not touch the observation* | http+db | The decisive test for A2. A thumbnail write moves neither `observations.version` nor `updatedAt` — the two columns that would have reordered the mosaic under a reviewer and conflicted every commit. |
| R2 | *holds at most one row per observation* / *goes with the observation when it is deleted* | http+db | Uniqueness, and the `ON DELETE CASCADE` actually firing rather than being declared. |
| R3 | *refuses a status outside queued, ready and failed* / *refuses to call a queued row permanent* | http+db | Both `CHECK`s refuse at the database, not in application code. The second is the one that stops a permanent `queued` row that would never drain and never retry. |
| R4 | *pre-creates nothing: an observation with no record has none* | http+db | Absence is a state. Nothing is pre-created for 440,000 rows. |
| R5 | *records where the picture came from, so it can be made again* | http+db | Resolution is through `video_source`. `jellyfin_item_id` is never consulted — F7's correction. |
| R6 | *the source dimensions are required* | unit | A crop without real pixel dimensions throws rather than guessing 1920×1080. |
| R7 | the eight *clamp* tests, and *puts the box centre at x, y rather than its corner* | unit | Centre-origin, pad, square, clamp, in that order. |
| R8, R10 | *records where the picture came from, so it can be made again* | http+db | Frame, subset and source dimensions on the row, so a re-extraction is reproducible rather than a fresh guess. |
| R9 | *fails an observation with no keyframes permanently* / *fails an unparseable mediaPosition permanently* | http+db | The permanent failures that no retry can fix, which is what stops A3's enqueue-on-page-view hammering Jellyfin for ever. |
| R11 | `tests/mosaic-query.test.js` *is exactly the agreed key set* | http+db | `thumbnail_status` was **moved into** the tripwire's exact-key list, not added by loosening it. |
| R12 | four tests in `tests/mosaic-commit.test.js`: *skips an unmarked row with no thumbnail record at all* / *…still queued* / *…failed permanently* / *commits a MARKED row with no picture* | http+db | The rule and its exception together. The fourth is the one that matters: flagging needs no imagery, so a marked row commits without a picture. |
| R12 | *applies the same rule on the training route* / *leaves the delete route alone* / *withdraws a decision from a row with no picture* | http+db | The rule's edges — same on training, absent on delete, and a withdrawal is not blocked by a missing picture. |
| R13 | *serves the picture with an ETag and a revalidating Cache-Control* / *answers 304…* / *changes the ETag when the thumbnail is re-extracted* | http+db | Not `immutable`: a stable per-observation URL whose content can change would otherwise pin a stale picture in every browser for a year. |
| R13 | *answers 404 when nothing has ever asked* / *…while the picture is still queued* / *…when the row outlived the file* | http+db | Three different absences, each answering 404 with its own explanation. The third is the species-picture precedent: a row can outlive its file. |
| R13 | *is served at the V2 path only* | http | The declared path 404s, so the prefix was derived by `registerVersionedRoute` and the permission wrapper came with it. |
| R14 | five *retry route* tests | http+db | Page-shaped, keyed by `observation_id` rather than position, never a synthetic `ready`, and it clears the failure state of what it re-queues. |
| R15 | *adds nothing to the catalogue* | http+db | The 27-key catalogue is unchanged. |
| R16 | `config/thumbnails.js`, read by the tests above | review | Every tunable number in one module. |
| R17 | *groups a batch by video, so one video is one stream* | http+db | A page's frames are one stream per video, which the spike demonstrated at 1.5 s for six frames. |
| R18 | *claims queued rows and records the lease* / *does not claim a row another extraction is holding* / *reclaims a row whose extraction died* / *releases a claim without deciding an outcome* | http+db | The lease, including the reclaim after death. Observable at no other tier. |
| R19 | *never rejects an enqueue, however long the queue is* / *serves the oldest request first* | http+db | Backpressure is priority, never rejection — so no state the client cannot draw. |
| R21 | *refuses a frame rate that disagrees with the derived frame* | http+db | Nine rates: 25, 25.001, 29.97, 30, 50, 24, 0, null, NaN. A mismatch is a recorded failure carrying both rates, never a warning that continues. |
| R22 | *the clamp*: each of the four edges, both diagonal corners, the real measured span, two boxes entirely outside the frame | unit | **The requirement that already paid for itself** — see *Regression coverage*. |
| R23 | *reports the run state, the counts and the configured limit* | http+db | What makes A7's constant tunable by observation rather than by argument. |
| R24 | *pauses* / *starts no new extraction while paused* / *stop discards the queue* / *re-enqueues on the next page view what stop discarded* / *resumes* | http+db | The three verbs are distinct and each says what happens to work already running. |
| R25 | *pauses, and the pause is persisted rather than held in memory* | http+db | Read back from `thumbnail_extraction_state` directly, so an API restart cannot silently un-pause a service somebody paused because Jellyfin was struggling. |
| R26 | *is readable with observations:read alone* / *refuses a run-state change to a caller who is not an admin* | http+db | The split, and the refusal proved by the state **not** moving rather than only by the status code. |
| A4 | *takes the first subset even when a later one brackets the frame and it does not* | unit | The human's rule: the subset is chosen before the box, and neither bracketing nor area can change it. Adversarial by construction — subset `0` neither brackets nor is larger, and still wins. |
| A4 | *orders subset labels as numbers, so "2" comes before "10"* / *sorts a non-numeric subset label after every numeric one* | unit | `subset` is a `varchar`; a string sort would silently pick the wrong track. |
| A5 | *pads by 10% of the box on each side before squaring* / *expands a wide box to a square about the same centre* | unit | The padding fraction and the square expansion, as answered. |
| — | *never lets a Jellyfin access token through into a message* | http+db | The stream URL embeds an `api_key`. This asserts it reaches no error message. Not a numbered requirement; it is the credential rule, and it belongs in a test rather than in a reviewer's memory. |

## Requirements with no test

- **R20** — the concurrency measurement. Deliberate, and the reason is in *Known gaps*.

Everything else in R1–R26 is named above. That is a claim, not a formality: if a requirement
below is unlisted, it is unproven.

## Edge cases

Each traces to a defect or to a measured fact rather than to imagination.

- **A box entirely outside the frame.** Traces to the R22 defect below.
- **The real measured span**, `[-0.0105, 1.0275]` from F3 — the actual out-of-frame range in
  the fixture, not a made-up one.
- **An observation with no keyframes at all**, from F6 — `keyframe_count` of `0` appears in an
  existing mosaic assertion, so this is real and permanent.
- **A frame rate that is nearly 25** (25.001) as well as plainly not (29.97). The near-miss is
  the one a tolerance check gets wrong.
- **A row that outlived its file**, from the species-picture precedent.
- **A permanent failure served a page repeatedly**, which is the enqueue loop A3 could
  otherwise create.
- **Two subsets where the first is the worse-looking choice.** Constructed to fail if anyone
  reinstates the preference rule.

## Regression coverage

- **The clamp (R22).** During G2 the new test failed with `Expected: <= 1920 / Received: 2765`:
  a box entirely outside the frame produced a rectangle ending past the frame edge, which
  `sharp.extract` would have refused. **`scripts/thumbnail-spike.js` had the identical hole**,
  and it never showed because 0 of 6 real boxes clamped (F37). Fixed by clamping the origin to
  the last pixel as well as the first. This is the case for R22 existing.
- **The subset rule.** The first implementation preferred whichever subset bracketed the
  counted frame, breaking ties by area. That let a picture come from a track nobody chose. The
  replacement test fails if it returns.
- **`wasClamped` in the spike** reported a clamp on all six frames because it compared against
  the square side, which `floor`/`ceil` widens by a pixel. Corrected during the spike; recorded
  because it briefly made clamping look exercised when it was not.

## Known gaps

Written down deliberately. A gap that is recorded is a decision; a gap that is omitted is a
surprise later.

- **Throughput is not measured (R20).** The database holds 6 observations over one 24-minute
  video. Every number in this phase descends from *"roughly five or six concurrent streams"*,
  which is an estimate nobody has tested. R20 names the run — 1, 3 and 6 concurrent streams,
  throughput and error rate — and it is deferred, not done.
- **Clamping has never happened on real data.** 0 of 6. The unit tier is the *only* evidence
  that path works, which is exactly why it is eight tests rather than one.
- **No legacy observation has been extracted.** The ~440,000 rows without a
  `jellyfin_item_id` are the corpus this phase mostly exists for, and none has been tried.
  A8's 96 threshold is therefore untested against the fuzzy matches it was written to refuse —
  **the fraction of legacy rows that will never get a picture is unknown and unknowable until
  it is run.**
- **Multi-subset data does not exist here.** Every real observation has exactly one subset, so
  the rule is proved by construction only.
- **Only 25 fps footage has been extracted.** R21's refusal is unit-tested at nine rates, but
  no non-25 video has been through the extractor end to end.
- **The ingest defaults a subset to `'1'` while the numbering is said to start at 0.** Nothing
  here depends on it — *the first subset* is well defined either way — but the two statements
  disagree and this phase does not resolve it.
- **`keyframes.confidence` is NULL on every row** (F33, `marp-inference-worker#9`). Nothing in
  this phase ranks on it; recorded because a future selection rule would have nothing to read.
- **No client change.** `data.js` still fakes the retry, and `thumbnail_permanent` is unused by
  any fixture row. That is Phase 8.
- **CI runs the fast tiers only.** A green pipeline is not this package.

## The suite does not need the real data

Raised by the human at G3 review — *"we don't always have the real data available"* — and it
is the right question, because CI builds an **empty** database and a test that borrows an
existing row passes here and fails there. Checked rather than assumed:

- `tests/thumbnails.test.js` seeds its own project, session, observations and users in
  `beforeAll` and removes them in `afterAll`. Grepped for references to the six real
  observations, to `session_id` 142 and to `gpu_job_id` 132: **none**. The suite does not know
  the pipeline was ever run.
- `tests/thumbnail-geometry.test.js` touches no database at all.
- **One borrowed row was found and removed.** The suite created its session with a hard-coded
  `user_id` of `1`, and `sessions.user_id` has a foreign key to `users` — so it depended on
  whichever user the bootstrap migration happened to create first. The column is nullable and
  nothing here reads it, so it is now `NULL`.
- **Named, not fixed:** `tests/mosaic-commit.test.js:345`, `tests/mosaic-correction.test.js:261`
  and `tests/mosaic-query.test.js:233` still hard-code `user_id, 1`. They are from earlier
  phases and they pass in CI today, which is itself the evidence that user 1 exists there. It
  is latent fragility rather than a live defect, and it is not this phase's to change.

## Manual steps

Cannot be automated, and the second one is the point of the phase.

1. **Re-run the spike against real video.**
   `node scripts/thumbnail-spike.js` with the development Jellyfin reachable.
   *Expected:* six observations resolve at match score 100; every extracted frame reports a
   `pts_time` delta of 0; six frames come from one stream in a few seconds; images land in
   `.marp/local/thumbnail-spike/`.
2. **Look at the pictures.** Open `contact-sheet.jpg` and judge whether each tile shows the
   animal it claims. *Expected:* an elongated red-brown holothurian, roughly centred, filling
   most of the tile. **This step has been done once and passed** — the human reviewed all six
   crops and the control image on 2026-09-09 and accepted them, including observation 6.
   *Nothing else in this document can substitute for it:* a wrong crop is a valid JPEG and
   every automated assertion passes on it.
3. **The centre-origin control.** `obs-4-control.jpg` draws the box both ways.
   *Expected:* the centre-origin box on the animal; the top-left box half off the frame edge
   and on bare rubble. Confirms F1 by observation rather than by inference. **Done, 2026-09-09.**
4. **Exercise the control surface against a running API.** Pause, confirm no new extraction
   starts, restart the API, confirm it is still paused, then resume.
   *Expected:* the pause survives the restart — the failure this is guarding is a pause that
   silently expires at the worst moment.

## Walkthrough videos

**None for this phase.** The mosaic client is unchanged: `thumbnail_status` is served but
nothing in `frontend/` reads it yet, and the tile states it drives were built in Phase 1. A
walkthrough recorded now would narrate a picture appearing that the client cannot yet request,
which is precisely the scene that *"passes for weeks while excluding nothing."* The
walkthrough belongs to Phase 8, with the client change, and the still images from the spike are
this phase's visual evidence instead.

---

## Results

Run 2026-09-10 after the plan was approved at G3. Real output, failures included.

### The suites

```
  Test Suites : 43 passed, 0 failed, 43 total
  Tests       : 559 passed, 0 failed, 0 skipped, 559 total
  Duration    : 40.7s

  Result: ALL TESTS PASSED
```

`npm run test:subsystems` — `ok   every suite belongs to exactly one subsystem`.

`spec-check` — `10 assumptions answered · 2 open, not blocking · 26 numbered requirements ·
clear to implement`.

`marp harness check` — `everything the harness can verify is consistent`.

### `npm run docs:build` exits 1, and it is not this phase's

Reported rather than smoothed over. Four jsdoc parse errors, all four from **one file this
branch does not touch**:

```
ERROR: Unable to parse a tag's type expression for source file
  frontend/apps/marp-mosaic-review/src/model/schedule.js in line 167 with tag title "param"
  ... Invalid type expression "page, ids, lastUsed"
```

`schedule.js` is byte-identical to `develop` (`git diff develop` is empty) and carries the
same malformed `@param {...}` — commas inside braces, from #99. No file this phase added
produced an error. The generated output is still written; the exit code is not swallowed by
`--lenient`, contrary to a note made during G2. **Left alone, and named:** it is pre-existing
breakage on `develop` and fixing it here would be a different task.

**One thing that was this phase's and is fixed:** the generated docs had gone stale, because
the subset comparator added jsdoc after the docs were last rebuilt. Regenerated and committed
(`9f11fa2`) — `compareSubsets` appears in 567 generated files now and in 0 before.

### Manual step 1 — the spike, reproduced

```
video_source: 20240730_171520_Fwd.mp4  (6 observations)
  match score 100 on search term "20240730_171520_Fwd" -> item "20240730_171520_Fwd"
  stream: 1920x1080 h264 @ 25 fps, 1446.4s
  ffmpeg: 6 frames in 1.5s from one stream
  obs 2: frame 18037 (landed 18037), box 174x115px, crop 210x210px
  obs 3: frame 18070 (landed 18070), box 177x82px, crop 213x213px
  obs 1: frame 18084 (landed 18084), box 247x95px, crop 298x298px
  obs 4: frame 18190 (landed 18190), box 345x115px, crop 415x416px
  obs 5: frame 18251 (landed 18251), box 225x113px, crop 271x271px
  obs 6: frame 18278 (landed 18278), box 92x105px, crop 127x127px
```

Identical to the first run: same score, same frames landed, same crop sizes, same 1.5 s. Every
`landed` equals the frame asked for.

### Manual steps 2 and 3 — the pictures

Reviewed by the human on 2026-09-09 and accepted, including observation 6 and the
centre-origin control (`obs-4-control.jpg`). Not re-judged here; the images regenerated
byte-for-identically by the numbers above.

### Manual step 4 — the control surface against a live server

Against `node server.js` on 3000, with two freshly minted service tokens.

**R26, a reader may read:**
```
GET /api/v2/observations/thumbnails/status   [HTTP 200]
{"runState":"running", ..., "loopStarted":true, "inFlight":0, "concurrencyLimit":3,
 "extractorAvailable":true, "counts":{"queued":0,"ready":0,"failed":0,"permanent":0,"claimed":0}}
```

**R26, a reader may not change it:**
```
POST /api/v2/observations/thumbnails/control {"action":"pause"}   [HTTP 403]
{"error":{"code":"FORBIDDEN","message":"The \"admin\" permission is required.", ...}}
```

**R24, an admin may:**
```
POST .../control {"action":"pause"}   [HTTP 200]
{"action":"pause","discarded":0,"runState":"paused","runStateChangedAt":"2026-09-10T06:07:09.655Z", ...}
```

**R25, the pause survives a full restart.** The process was killed and `node server.js`
started again:
```
GET .../status   [HTTP 200]
{"runState":"paused","runStateChangedAt":"2026-09-10T06:07:09.655Z", ...}
```
Still paused, and the original change timestamp intact — so it was read from
`thumbnail_extraction_state` and not defaulted. **This is the step no suite can prove**, and
it is the failure it guards: a pause that silently expires on restart, at the moment somebody
paused it because Jellyfin was struggling.

Resumed afterwards (`runState: "running"`), so nothing is left paused.

### Two failures that were the operator's, not the code's

Recorded so a reader does not chase them as defects.

- `POST /api/v2/observations/thumbnails/run-state` → `404 ROUTE_NOT_FOUND`. **The route is
  `/control`.** `run-state` was a name used in conversation and never in the code.
- The first two tokens gave `401 UNAUTHORIZED`. The extraction grepped a long alphanumeric run
  out of Sequelize's SQL logging instead of the token. Tokens are `svc_`-prefixed and printed
  under a marker line; extracting by the marker fixed it.

### Noted, expected, not a defect

`runStateChangedBy` is `null` after an admin **service token** changed the state. A bearer
principal's id is a `service_clients.service_client_id`, not a `users.user_id`, and recording
it in a column that references `users` is the trap Phase 5 recorded as D4. Null is the correct
answer for a token; the suite's *records who changed the run state* covers the user case.

`extractorAvailable: true` — ffmpeg 8.0.1 was located through configuration (A9), which is the
condition R23 reports and the extractor refuses to start without.
