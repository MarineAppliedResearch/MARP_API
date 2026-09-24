---
task: MarineAppliedResearch/MARP_API#231
repos: [marp-api]
status: implementing
needs: [jellyfin]
---

## Goal

A GPU result from a video that is not exactly 25 fps is ingested, with timecodes that
agree with the video, instead of being refused. And a job can no longer report success
when none of its results reached the database. Together these are why pieces of session 755
hold no data: #231 refuses the result, and #230 turns the retry into a false success.

Covers #231 and #230. One branch, because #231 supplies the failure that #230 launders.

## What investigation found

Read from `origin/develop` and the development database on 2026-09-24.

- **Jellyfin reports two frame rates, and only one is what the video delivers.** For
  `20260611_161158_Fwd` — jobs 7163, 7165 and 7167, the refusals quoted in #231 — Jellyfin
  gives `AverageFrameRate` **24.946007** and `RealFrameRate` **25**; the worker measured
  **24.946** from the stream. Three 25 fps videos report 25 for both. `RealFrameRate` is
  the nominal rate and would reproduce the bug exactly.
- **25 is assumed in three places, not two.** The ingest's timecode derivation and its
  consistency check (`observation-ingest.service.js`, `deriveTimecodes`), `db/timecode.js`,
  and `gpu.service.js#frameCountForVideo`, which sizes a whole-video submission from
  Jellyfin's duration × 25 — so on 24.946 fps the last piece asks for frames that do not exist.
- **#230's cause is one line.** `recordJobArtifacts` skips a hash *already recorded for
  this job* under the same role. A retry producing byte-identical output names the same
  hash, so the retry gets no artifact row; `ingestPublishedJob` filters to the current
  attempt, finds none, returns `skipped`, and the job ends `succeeded` with nothing ingested.
  The dedupe exists to stop a *replay* — the same attempt reporting twice — and keying it on
  the job also swallows a different attempt handing over the same bytes.
- **Nothing blocks a second row.** `artifacts` has no unique index on job, hash and role.
- **Pieces already refused are recoverable by an existing route.** `POST
  /api/gpu/jobs/:id/ingest` ingests from a job's staged artifacts with no attempt filter and
  is idempotent per job, so once the frame rate is read inside the shared ingest, the
  recovery path is the route that exists.
- **Thumbnails are already safe.** The extraction pass refuses to seek when the source rate
  differs from 25 by more than 0.01 (R21), so a 24.946 fps observation gets an honest
  refusal rather than a picture of the wrong moment.

## Requirements

- **R1** — The ingest derives the timecode columns at the video's frame rate as Jellyfin's
  `AverageFrameRate` reports it, read through the job's `jellyfin_item_id`.
- **R2** — A result from a 24.946 fps video ingests, with `tc`, `frame`, `mediaPosition`
  and `actualPosition` agreeing with each other and with the worker's own report.
- **R3** — The consistency check still refuses a result whose timecode does not match its
  frame number, at the video's real rate.
- **R4** — When no rate can be read — a bare `video.url`, Jellyfin unreachable, or a stream
  with no `AverageFrameRate` — the ingest uses 25 as today, says so in the log, and R3 stays
  the backstop: a 25 fps video still ingests, and any other is refused rather than stored wrong.
- **R5** — A whole-video submission is sized at the video's frame rate, not at 25.
- **R6** — A piece already refused for this reason can be re-ingested from its staged
  artifact through `POST /api/gpu/jobs/:id/ingest`.
- **R7** — A different attempt handing over bytes an earlier attempt already handed over
  gets its own artifact row; the same attempt reporting twice still records once.
- **R8** — A `succeeded` attempt that hands over no artifacts, for a job whose spec names a
  session, is withdrawn like an ingest failure rather than recorded as a success.
- **R9** — Existing observations are not changed. Rows written before this were derived at
  an assumed 25; the code says so where a future bug would lead.

## Open assumptions

- [x] **A1 · data-meaning · blocking** — answered 2026-09-24: **the frame rate is what
  Jellyfin reports.** *"what Jellyfin reports and what Jellyfin gives you should be the
  same thing."* Refined by evidence to `AverageFrameRate`, the one of Jellyfin's two rates
  that matches what the stream delivers; `RealFrameRate` is nominal and reads 25 on the
  affected video.
- [x] **A2 · data-meaning · blocking** — answered 2026-09-24: **existing observations are
  not changed**, and the code carries a note so a later bug can be traced to the seam.
- [ ] **A3 · behavioural · non-blocking** — With no readable rate, fall back to 25 (R4)
  rather than failing the ingest. The consistency check makes the fallback safe: it can only
  store a 25 fps video, and it refuses anything else exactly as today. Failing instead would
  refuse every 25 fps result whenever Jellyfin is briefly down.
- [ ] **A4 · behavioural · non-blocking** — #230 offers two fixes: the retry ingests the
  artifact an earlier attempt staged, or a data-caused failure does not retry. Taken: the
  first (R7). The code records the second as the opposite of a settled decision — *"A retry
  … is what turns a silent loss into something that either fixes itself … or keeps failing
  loudly until somebody looks"*, beside Isaac's *"if a job is considered finished the api has
  actually ingested it's data"*. Not retrying data-caused failures could be added later; it
  would reverse that.
- [ ] **A5 · behavioural · non-blocking** — #230's *"cannot reach succeeded with
  ingested_at NULL by any path"* is read for jobs whose spec names a session. A job with no
  session is designed to finish without an ingest — `ingestPublishedJob` calls it a
  legitimate run — and the literal reading would make those impossible to finish.
- [ ] **A6 · behavioural · non-blocking** — R8 applies to `succeeded` only. A `yielded`
  attempt is a stop, not a claim of success, and the engine always publishes a results file,
  so a stop with none is a separate anomaly.
- [ ] **A7 · data-meaning · non-blocking** — Everything downstream that reads these columns
  at 25 is left as it is: thumbnails refuse by R21, `classifyRow` and the timecode resync
  treat a non-25 row as not reproducible and skip it, and the annotation GUI is
  VIDEO_PROCESSING_GUI#221. Each is the safe behaviour for its own assumption.

## Decisions

- **2026-09-24** — Jellyfin's `AverageFrameRate`, measured to agree with the worker's own
  reading on the refused video (A1).
- **2026-09-24** — Existing observations untouched; a note in the code at the seam (A2).

## Plan

1. `repository/jellyfin.repository.js`: read `AverageFrameRate` and `RealFrameRate` from an
   item's video stream.
2. `db/timecode.js`: `deriveFrame` and `absoluteFrame` take an optional frame rate,
   defaulting to 25, so every existing caller is unchanged. The note (R9) goes on
   `ASSUMED_FPS`.
3. `service/observation-ingest.service.js`: resolve the rate once per ingest (R1, R4) and
   derive and check at it (R2, R3).
4. `service/gpu.service.js#frameCountForVideo`: size at the rate (R5).
5. `repository/gpu.repository.js#recordJobArtifacts`: dedupe on the attempt as well (R7).
6. `service/gpu.service.js#recordResult`: withdraw a success that handed over nothing (R8).
7. Tests at the tier that can see each; see the test plan.

## Acceptance criteria

- A result line consistent at 24.946 fps ingests, and its four timecode columns agree.
- The same line checked at 25 is refused, as today.
- A retry handing over the byte-identical artifact of a refused attempt ingests it.
- A `succeeded` attempt naming no artifacts for a session-naming job ends `failed`.
- `npm run test:gpu` and `npm run test:observations` pass.
- Job 7163's real staged artifact passes the derivation at Jellyfin's rate.

## Test plan

- `db/timecode.js`: the frame-rate argument, and that its absence is exactly today's arithmetic.
- The Jellyfin parse: both rates read from a raw item.
- The ingest at the API tier, with Jellyfin stubbed the way `gpu-video-resolution` stubs it:
  R1–R4 and R6.
- `frameCountForVideo` at a stubbed 24.946 (R5).
- #230's own reproduction at the API tier, no GPU: a first attempt hands over a hash and its
  ingest is refused; a second attempt hands over the same hash (R7). And a succeeded attempt
  naming nothing (R8).
- Once, not committed: job 7163's staged artifact through the derivation at 24.946007.

## Status

- **Gate:** implementing
- **Notes:** A1 and A2 answered 2026-09-24 before bed; A3–A7 are judgement calls taken with
  their reasons, for review in the morning before anything is pushed.
