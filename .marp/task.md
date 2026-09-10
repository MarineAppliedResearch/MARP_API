---
task: MarineAppliedResearch/marp-inference-worker#3
repos: [MARP_API, marp-inference-worker]
status: verifying
needs: []
---

## Goal

A finished GPU inference job becomes observations in MARP. Today the coordinator ends up
holding the worker's result file and nothing reads it, so a run that found six sea
cucumbers leaves no trace in the annotation record — the animals exist only inside a
sha256-addressed file on disk. After this, a successful job's observations and their
keyframes are in `observations` and `keyframes`, attributed to the model that produced
them and to the job that ran it, in the same shape the annotation GUI writes, so the
mosaic reviewer and every existing report see them as observations rather than as
machine output needing a translation step.

This is the parse that A16 named as the one missing piece. The hand-over itself — hash,
`already_have`, upload, `artifacts` row — is already built and is not touched.

## Requirements

- **R1** — Ingest reads the job's `observations` artifact from
  `storage/gpu-artifacts/<sha256>`, one JSON object per line, and writes one `observations`
  row per line plus one `keyframes` row per entry in its `keyframes[]`.
- **R2** — A zero-byte artifact is a valid outcome: the job detected nothing. Ingest writes
  no rows, reports zero, and does not error. This is a real case — job 833's artifact is
  the sha256 of nothing.
- **R3** — **The class name is resolved to a species by MARP** (A18). The worker sends
  `comname` and no identifier. Resolution is: the species rows the model was trained with
  (`model_species`, A17) whose `comname` matches, and exactly one match is required. Where
  the model has no such row, fall back to `species` as a whole and again require exactly
  one. **An unresolvable or ambiguous name fails the whole ingest loudly** — never skipped,
  never guessed. The resolved row supplies `species_id` and `taxserial`, verbatim,
  including `Fragile pink urchin`'s taxserial of `100`.
- **R4** — A job carries the session it writes into. `spec.session` names an existing
  `session_id`, or carries `project_id`, `dive`, `line` and `type` for one to be found or
  created. Exactly one form; both together is a 400. The submitter owns this, because
  project, dive and line are human decisions and are not recoverable from a video and a
  frame range (A16).
- **R5** — **The session's `type` is checked against the model, not trusted** (A16). The
  species the model was trained with belong to a `species_list`; the session's `type` maps
  to one. A mismatch — an inverts model writing into a `Fish` session — fails the ingest
  and says both sides.
- **R6** — A job names the registered model it ran: `spec.model.ml_model_id`. That is
  written to `observations.ml_model_id` on every row. `ml_models` holds no hash column, so
  the spec's `model.sha256` cannot identify a registry row and the submitter names it
  instead — which is also what `MARP_API#104` means by the model being locked at
  submission.
- **R7** — The timecode columns are written through `db/timecode.js` and nothing
  re-implements the arithmetic. `actualPosition` and `mediaPosition` are derived from the
  worker's `observation_frame` at 25 fps, `tc` from that with `deriveTc`, and `frame` with
  `deriveFrame` — so the derived columns are reproducible and `classifyRow` reports them
  as such. `observations.frame` is the sub-second index 0..24; `keyframes.framenum` is the
  absolute frame number the worker sent, verbatim.
- **R8** — The derivation is checked against what the worker reported, not assumed. If the
  derived `tc` differs from the worker's `tc`, or the derived `frame` from the worker's
  `frame`, the ingest fails. That is the only signal available that a video was not 25 fps,
  and MARP assumes 25 everywhere (`ASSUMED_FPS`, `VIDEO_PROCESSING_GUI#221`).
- **R9** — `observations.confidence` holds the detection score at the observation frame,
  as the worker reports it. `confidence` is part of the observation contract: the key must
  be present on every row, its value a number in 0..1 or `null`. A missing key fails the
  ingest.
- **R10** — Keyframe geometry is passed through unaltered. A width over 1.0 is not clamped,
  the way `Fragile pink urchin`'s taxserial is not corrected.
- **R11** — Primary keys are assigned the way this repository already assigns them:
  `observation_id` as `max + 1`, `obsID` as the session's `max + 1`, `PobsID` as the
  `max + 1` across the project's sessions of the same type. `keyframes` lets its sequence
  assign. Ingest holds a transaction-scoped advisory lock while it does, because
  `max + 1` under concurrency is a collision waiting to happen (#62).
- **R12** — Ingest is idempotent per job. `observations.gpu_job_id` records which job wrote
  a row; a job whose rows are already present is reported as already ingested and nothing
  is written again. **Re-running inference over the same range is a new job and therefore a
  new set of observations** — it does not replace or merge the previous model's results,
  because model-to-model comparison depends on both surviving.
- **R13** — Ingest runs automatically when a successful terminal result publishes a job.
  It runs **after** the result transaction commits, in its own transaction: a parse failure
  must not roll back a job whose compute succeeded, or the worker would be asked to redo
  hours of GPU work over a database problem.
- **R14** — An ingest failure is loud and recoverable, not silent and terminal. It is
  recorded as a coordinator note on the attempt, logged, and reported in the result
  response. `POST /gpu/jobs/:id/ingest` re-runs it once the data problem is fixed.
- **R15** — Two additive nullable columns on `observations`: `gpu_job_id` and
  `jellyfin_item_id`. A16 says the video reference lives on the observation and names both
  `video_source` and `jellyfin_item_id`; only the first exists. Without the second, the
  only durable pointer back to the exact video in Jellyfin is discarded, and `video_source`
  is a filename rather than an identity.
- **R16** — The migration wraps its work in `db/data-integrity.js` and carries a working
  `down`, per this repository's rules. Both columns are nullable adds with no default, so
  they are catalog-only on a 440,000-row table rather than a rewrite.
- **R17** — `docs/openapi.generated.json` and `docs/developer/` are rebuilt, because the
  route family changed and they are tracked.
- **R18** — **The coordinator tells the worker which survey convention counts.**
  `params.data_type` decides the frame a track is recorded at — a fish when its centre
  crosses near the bottom of frame, an invertebrate when it enters the bottom-centre
  trapezoid — and the worker cannot know which applies, because it knows nothing about
  MARP. It is filled from `sessions.type`, which maps straight through: the values are
  identical.
- **R19** — A `data_type` the submitter set is left alone. Filled only when absent.
- **R20** — **A session type the engine has no counting rule for is refused, never
  defaulted.** `pick_observation_time` branches on `Fish`/`GULF_Fish` and
  `Invert`/`GULF_Inverts` and returns nothing otherwise, at which point the worker falls
  back to the track's first frame — a third convention nobody chose, with no error. MARP
  holds session types the engine has no rule for (`Habitat`, `MarineDebris`,
  `Substrate60Second`), so this is a real case. Refused at submit, and again at lease,
  which is the one that counts.
- **R21** — Resolution happens **at lease time, beside the video**, and for the same
  reason: a session's type can be edited while its job sits in the queue, so a spec frozen
  at submission would answer yesterday's question. A failure gives the lease up and fails
  the attempt with the reason named.

## Open assumptions

- [x] **A16 · scientific/data-meaning · blocking** — answered 2026-09-09 by Isaac, on
  `3-gpu-orchestration-api`. A session is a dive and a line, never a video; the video
  reference lives on the observation; a job names an existing `session_id` or carries
  project, dive, line and type; `sessions.type` is checked against the model rather than
  trusted. R4, R5 and R15 are that answer.
- [x] **A17 · scientific/data-meaning · blocking** — answered 2026-09-09 by Isaac.
  `model_species` records which species a model was trained with, plus per-species training
  metrics. It is **not** a class-index translation table and nothing here reads it as one.
  R3 uses it only as the trained-species list A18 asks for.
- [x] **A18 · scientific/data-meaning · blocking** — answered 2026-09-09 by Isaac. The
  class index never leaves the worker; the worker writes the name; MARP resolves the name
  to a species; the model's trained-species list settles an ambiguous name; an unresolvable
  name fails loudly. R3.
- [x] **A19 · scientific/data-meaning · blocking** — answered 2026-09-10 by Isaac:
  **`observations.confidence` holds the detection score at the observation frame.** Not a
  mean over the track and not a maximum, so that the number and the frame it is attributed
  to agree and a later reader can go and look at that exact frame.

  **The worker does not emit it yet.** Every result file now in `artifacts` was written
  before this was settled and carries no confidence at all — not at the top level and not
  on any keyframe — even though YOLO produces a score per detection and
  `track_accumulator.observe()` carries it. The legacy pipeline never recorded one either,
  which is why nobody noticed: `observations.confidence` arrived with the mosaic work.
  Adding it to the worker's output is separate work in `marp-inference-worker` and is not
  part of this task, so **the fixtures here carry the field by hand.**

  One case may legitimately carry no score: ByteTrack predicts through gaps, so a track can
  exist on a frame with no detection behind it, and the reduction does not guarantee a real
  detection sits on the chosen frame. So the value may be `null` — but the **key is always
  present**, and its absence is a contract violation that fails the ingest (R9).
- [ ] **A20 · database/schema · non-blocking** — **`observations.gpu_job_id` and
  `observations.jellyfin_item_id` are added** (R15). `ml_model_id` says which model, and
  that is not enough: re-running the same model is settled as producing a second set of
  observations, so without a job reference the two sets are indistinguishable and ingest
  cannot tell a replay from a re-run. `jellyfin_item_id` is the reference A16 says lives on
  the observation. The alternative for the first is a marker in `artifacts.metadata`, which
  cannot be joined from an observation; for the second, relying on `video_source`, which is
  a filename and not unique.
- [ ] **A21 · api contract · non-blocking** — **the session and the model are named in the
  job spec** (`spec.session`, `spec.model.ml_model_id`), following the existing
  `video`/`range`/`reduction` shape rather than as columns on `gpu_jobs`. The spec is
  already where everything the run needs is recorded and is already kept as submitted, so a
  job stays self-describing. Not required for a `diagnostic` or `training` job, which
  produce no observations.
- [ ] **A22 · scientific/data-meaning · non-blocking** — **the timecode columns are derived
  from `observation_frame`, not copied from the worker's strings** (R7), and the derivation
  is checked against the worker's own `tc` and `frame` (R8).

  Copying looked obvious and is wrong twice. The worker's `frame_to_media_position` does
  `int((seconds - int(seconds)) * 1000)` on a float, so `00:12:06.639` is written where the
  frame is exactly `00:12:06.640`; three of six observations in job 1256's real result file
  are a millisecond short. And it writes three fractional digits where these columns hold
  .NET `TimeSpan` text with seven. Stored as sent, `deriveFrame(actualPosition)` gives 15
  where the worker's own `frame` says 16, so `classifyRow` would report the row's derived
  columns as unreproducible — which is the flag meaning "something else wrote this, never
  rewrite it", and a timecode resync would then skip exactly the rows a machine produced.

  Deriving at 25 fps makes all four columns agree and reproducible. It is only right while
  the video really is 25 fps, which is why R8 checks rather than assumes: the worker
  computes from the video's measured rate, so a disagreement is the one available signal
  that the assumption broke.
- [x] **A24 · scientific/data-meaning · blocking** — answered 2026-09-10 by Isaac: **wire
  `params.data_type`.** The coordinator passes the session's type through, so an inverts
  survey is scored by the inverts rule. R18 to R21 are that answer.

  **What this means for the runs already on disk.** Every real inverts run so far — jobs
  1105, 1256 and 1257, all against model 91 — carried no `data_type`, so the worker used
  its default of `Fish` and picked each observation's frame by *the fish rule*: the first
  frame where the centre crosses y > 0.8, rather than the frame where the animal enters the
  bottom-centre trapezoid. Their observation frames, and therefore their timecodes, were
  chosen by the wrong survey convention.

  So **the six observations in `tests/fixtures/gpu-observations-job-1256.jsonl` are
  fish-scored invertebrates.** They are real detections of real animals with real boxes,
  which is what makes them a good fixture for the parse — but their `observation_frame` is
  not where an inverts survey would count them, and **nothing in those files should ever be
  treated as reference data for where an observation belongs.** Re-run the jobs to get that.

- [ ] **A25 · api contract · non-blocking** — **a submitted `params.data_type` wins.** Only
  an absent one is filled. A submitter who set it meant it, the same way a bare `video.url`
  is handed through rather than second-guessed — and it is the one escape hatch for running
  a model over a session type the engine has no rule for, which is otherwise refused
  outright. The alternative, letting the session override it, would mean a job could not be
  made to do what it plainly said.
- [ ] **A23 · scientific/data-meaning · non-blocking** — **`videoLocation` is left null,
  and `user_id` is the job's `created_by`.** In the legacy pipeline `videoLocation` was the
  operator's own local path to the file, which on a distributed worker does not exist;
  `observations.py` says so and drops it deliberately. The resolved Jellyfin stream URL is
  not a substitute — it is per-lease and will carry an expiring token — and Jellyfin's
  library path would make ingest depend on Jellyfin being reachable, which the test tiers
  cannot be. `video_source` plus `jellyfin_item_id` (R15) carry the identity instead.
  `user_id` records who ran the job, which is what `user_id` means on every other
  observation; `ml_model_id` is what says a model did the detecting.

## Decisions

- **2026-09-10** — Ingest is a service of its own (`service/observation-ingest.service.js`)
  rather than a branch inside `gpu.service.js`. It is the only place in MARP that turns
  machine output into annotation, and it needs the timecode module, the species catalogue
  and the session table, none of which the coordinator otherwise touches.
- **2026-09-10** — Observations are written through a new
  `repository/observation-ingest.repository.js` rather than through
  `observation.repository.js#createObservation`. That method swallows its errors, prints
  the model registry to the console, computes its maxima outside any transaction and writes
  one observation per call. Ingest needs the opposite of all four.
- **2026-09-10** — `db/species-lists.js` holds the session-type-to-species-list map. It
  existed only inside `migrations/20260901120500-add-observations-species-id.js`, which
  keeps its own copy: a migration is a record of what was run, not a live import.

- **2026-09-10** — `params.data_type` is resolved by `resolveSpecForLease`, which does the
  video and the convention together. Two resolutions, both the coordinator's, both needing
  the same lease-time placement; one function saying so is better than two call sites that
  have to be kept beside each other.

## Plan

1. Migration: `observations.gpu_job_id` and `observations.jellyfin_item_id`, guarded, with
   a `down`. Add both to `model/observation.model.js`, which is also missing `version` and
   `ml_model_id`.
2. `db/species-lists.js`.
3. `repository/observation-ingest.repository.js`: the key assignment, the advisory lock,
   the transaction, the already-ingested check.
4. `service/observation-ingest.service.js`: parse, resolve session, check type, resolve
   species, derive timecodes, build rows.
5. Job spec validation for `spec.session` and `spec.model.ml_model_id`.
6. Hook into `recordResult` after the publish commits; the coordinator note on failure.
7. `POST /gpu/jobs/:id/ingest`, its OpenAPI entry, and `npm run docs:build`.
8. `params.data_type`: the engine's accepted set in config, the session-type lookup reusing
   the session validation, the submit-time refusal, and the lease-time resolution.
9. Tests.

## Acceptance criteria

- Job 1256's real result file, with `confidence` hand-added, ingests as six observations of
  California sea cucumber in an `Invert` session, each carrying the species catalogue's own
  `species_id` and `taxserial`, the model, and the job — 78 keyframes between them.
- A zero-byte artifact ingests as zero observations and no error.
- A result naming a species the model was not trained with fails, and writes nothing.
- An inverts model against a `Fish` session fails, and writes nothing.
- Ingesting the same job twice writes one set of rows; a re-run gets its own set.
- A successful worker result triggers ingest without anybody asking for it.
- A leased spec for an `Invert` session carries `params.data_type` of `Invert`.
- A job against a `Habitat` session is refused at submit, and one whose session type is
  edited to `MarineDebris` after submission fails its attempt rather than being leased.
- `npm test` is green.

## Test plan

`.marp/verification.md`. It carries which test proves which requirement, the results as
run, and — the part worth reading — what is **not** covered.

## Status

- **Gate:** verifying
- **Notes:** implemented and verified 2026-09-10. `tests/gpu-observation-ingest.test.js` is
  34 for 34; `npm test` is 471 for 471, of which 437 predate this branch. **The 285 figure
  in the retired spec is stale** — `develop` has moved a long way since, mostly the mosaic
  work.

  Two things a reader needs to know.

  The fixture's `confidence` values are **hand-added**. `confidence` has since merged into
  the worker's `develop` (PR #6), so a real run will replace them, but the file as it stands
  is hand-made and nothing yet proves the two sides agree about that key. It is the most
  likely place for them to disagree.

  And the fixture's observations are **fish-scored invertebrates** — see A24. The
  `params.data_type` defect is now fixed, but the result files that already exist were
  produced before the fix, so their observation frames follow the fish rule. Good fixture
  for the parse; not reference data for where an observation belongs.
