# Verification — MARP_API#231 (frame rate from Jellyfin) and #230 (no false success)

Written during the night of 2026-09-23/24 while the human was away, so G3 and G4 are
here together: the plan and what was actually run. **Review the plan as a plan** — the
results below do not make it approved.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `gpu-observation-ingest` › *Reading a video's frame rate from Jellyfin* (3 tests) | unit, raw item | both rates are read from the video stream, not audio; a missing or zero rate is none; no video stream is null |
| R1, R2 | › *ingests a result derived at the rate Jellyfin reports, and every timecode agrees with it* | API + DB, Jellyfin stubbed | a 24.946 result ingests; stored `tc`/`frame` equal the worker's; `actualPosition` is the frame's time truncated to the ms; `mediaPosition` equals it; the summary names the rate and its source |
| R2 | › *puts a frame just under a whole second in that second, as the worker does* | unit | frame 923 at 24.946 (36.99991 s) derives `00:00:36`, as the worker writes it |
| R3 | › *still refuses a result that disagrees with itself at the video's rate* | API + DB | a result consistent only at 25 is refused at 24.946, nothing stored |
| R4 | › *derives at 25 when Jellyfin cannot be read…* and › *refuses rather than stores wrong when no rate is reported…* | API + DB | the fallback ingests a 25 result and says `assumed:`; a non-25 result with no rate is refused |
| R5 | `gpu-video-resolution` › *sizes a whole video at the rate Jellyfin reports, not at 25* and › *sizes at 25 when the rate cannot be read* | API + DB | `end_frame` is `floor(duration × 24.946007)`; 25 when the read fails |
| R6 | › *re-ingests a piece refused for its frame rate, once the rate is read* | API + DB | a job left `succeeded` with nothing ingested (the #230 state) is taken in by `POST /api/v2/gpu/jobs/:id/ingest` |
| R7 | › *gives the retry its own artifact row…* and › *still records one row when the same attempt hands the same bytes over twice* | API + DB, and repository | a second attempt's byte-identical artifact is recorded and ingested; a replay records once |
| R8 | › *withdraws a success that hands over no artifacts…* | API + DB | the job does not end `succeeded`; nothing ingested |
| R8 (A6) | › *leaves a stop that handed over nothing as a stop, not a failure* | API + DB | `yielded` is untouched by R8 |
| R4, R9 | `timecode` › *converts at a rate it is given, and at 25 when it is given none* and › *keeps the sub-second index within 0 to 24…* | unit | no rate is exactly the old arithmetic; 12:59 is frame 19432 at 24.946 and 19475 at 25 |

## Requirements with no test

- **R9's "existing observations are not changed"** has no test of its own. Nothing in the
  change writes to existing rows; the argument defaults to 25 everywhere else, and the
  timecode test above pins that default. The note is on `ASSUMED_FPS` in `db/timecode.js`.

## Edge cases

- A second boundary at a non-integer rate: the worker truncates seconds, the API rounded
  milliseconds, and 91 frames in two hours disagreed. Fixed and tested (frame 923 above).
- The rate is read once per ingest, not per line.

## Regression coverage

- #230: 505 jobs ended `succeeded` with nothing ingested, because a retry's byte-identical
  artifact was deduplicated away. The R7 and R8 tests are that reproduction, with no GPU.

## Known gaps

- **A8 is open and blocking.** The worker's `frame` is `observation_frame % int(fps)`, and
  MARP's is the time-based sub-second index. The synthetic rows above are built with MARP's
  definition, so they pass; **a real result from a non-25 video is still refused.** See
  `.marp/task.md` A8. The acceptance criterion on job 7163 fails for that reason.
- Jellyfin is stubbed in every test here. `getVideoFrameRate` was called once by hand
  against the central server for job 7163's item and returned
  `{"averageFrameRate":24.946007,"realFrameRate":25}`. `npm run test:media` was not run.
- `npm run test:observations` fails in 3 suites, 24 tests, **on develop's code as well** —
  see Results. Not caused by this change and not fixed here.

## Manual steps

After A8 is settled and, for option (A), a new worker is running:

1. Submit one piece of `20260611_161158_Fwd` through the normal path.
2. Expect the job `succeeded`, `ingest.frame_rate` 24.946007 and
   `frame_rate_source` `jellyfin AverageFrameRate`, and observations for it in the session.

---

## Results

**2026-09-24, branch `230-231-frame-rate-from-jellyfin` at `ecae9b0c`, against the dev
database.**

`npm run test:gpu`:

```
  Test Suites : 8 passed, 0 failed, 8 total
  Tests       : 183 passed, 0 failed, 0 skipped, 183 total
  Duration    : 65.6s
  Result: ALL TESTS PASSED
```

`npx jest tests/timecode.test.js`: 23 passed, 0 failed.

**Red first.** With develop's `observation-ingest.service.js`, `gpu.repository.js` and
`gpu.service.js` restored, every test that depends on a fix failed and the tests of
unchanged behaviour passed. With the millisecond truncation removed, the frame-923 test
failed with the refusal real results get:

```
✗ A video that is not exactly 25 fps (#231) > puts a frame just under a whole second in that second, as the worker does
    ApiError: line 1 reports tc "00:00:36" at frame 923, but 24.946007 fps puts that frame at "00:00:37". …
```

**One failure of this change's own, on the way:** the first `test:gpu` run failed one test,
a tolerance of ±0.5 ms that stopped fitting once positions truncate (received 0.7356). The
assertion is now "at or below the exact time, by less than 1 ms". Rerun green, above.

**Job 7163's real staged artifact, through `deriveTimecodes` at 24.946007: refused.**

```
reports frame "22" at absolute frame 430, but 24.946007 fps makes the sub-second index "5"
```

That is A8, not a defect in R1–R9.

**`npm run test:observations`: 3 suites, 24 tests failing** — observations, keyframes and
timecode-resync. The same failures occur with develop's code. The `observations` sequence
sits far behind `max(observation_id)` because the ingest assigns `MAX + 1` while other paths
take the sequence, so any observation created through the API or GUI collides and 500s on
this database. Outside this task; reported, not fixed.
