---
task: MarineAppliedResearch/MARP_API#118
repos: [marp-api]
status: design
needs: [jellyfin-dev]
---

# Phase 6 — thumbnails

Design specification for MARP_API#118, Phase 6 of #68 — the phase #68 itself calls *"the
largest unknown in the project, and the one with no precedent to copy."*

**G1 only. Nothing is implemented while a `blocking` assumption below is open.** No route, no
service, no migration, no ffmpeg. This branch is cut fresh from `develop` and is not stacked
on anything.

`needs: [jellyfin-dev]` is not decoration. Every real verification in this phase reads video
from the one development Jellyfin, which does not parallelise, and the whole design is
organised around that machine's ceiling.

## Goal

A reviewer opens the mosaic and sees the animals, not the seabed. Each tile carries a picture
cut from the video at the moment that observation was recorded and cropped to the box the
detector or the annotator drew, so a page of forty-five tiles can be judged at a glance
instead of one video seek at a time. A picture that has not arrived yet says so, a picture
that can never arrive says that instead of pretending it might, and neither stops the reviewer
flagging the tile. Nothing a reviewer does waits on Jellyfin, and nothing this phase adds can
make the media server too busy for the person watching video next door.

## The basis, and what each recommendation rests on

Four bases. Every recommendation below says which one it stands on, and where a number would
decide something and no number exists, it says what to measure instead.

- **The live development database, read only.** Queried through `information_schema` and
  `pg_catalog` for the `keyframes` and `observations` column lists and the seeded permission
  keys. **Superseded on 2026-09-09 — see *What the first real run changed* below.** It held
  **0 observations, 0 keyframes, 0 sessions and 0 projects** when this spec was written; the
  pipeline has since been run. Throughput is still not benchmarked and nothing below is
  benchmarked. Same agreed basis as #99, #103, #105
  and #106.
- **The repository's files**, in this repository and three others: `MARP_API`,
  `VIDEO_PROCESSING_GUI`, `marp-inference-worker` and the mosaic client under
  `frontend/apps/marp-mosaic-review/`. The client's files are a constraint on the contract,
  not background.
- **`tests/fixtures/gpu-observations-job-1256.jsonl`**, six observations and 78 keyframes from
  a real run. This is the closest thing to real keyframe data that exists, and every count and
  fraction quoted below was computed from it rather than estimated.
- **The human, directly**, for the two things that are settled rather than derived — recorded
  under *What is settled* below with that attribution.

## What is settled before this phase starts

Given, not decided here. Contradicting one of these is a mistake, not a trade-off.

- **The keyframe box values are normalised** — `x`, `y`, `width` and `height` on `keyframes`
  are fractions of the frame, not pixel counts. **Answered by the human, 2026-09-09.** Four
  consequences are carried through this spec and none of them is obvious: the crop needs the
  source frame's real pixel dimensions and the keyframe does not carry them (R6); a
  thumbnail's output size becomes a decision rather than a consequence (A5); padding around a
  small fractional box becomes a real question (A5); and values outside 0–1 occur and have to
  clamp (R7).
- **Jellyfin will not go fast: roughly five or six concurrent ffmpeg streams.** This is
  rate-limited work and cannot happen inline on a request.
- **The crop is part of the job.** A tile shows the organism, not the whole seabed frame.
- **Storage is a sister folder to the species pictures**, served the way they are served.
- **The mosaic already draws a tile with no picture.** Phase 1 built *no-imagery* and
  *partial-imagery*, so the API's job is to report the state.
- **No new permission keys** without saying why (#68, Phase 2). The catalogue is 27 keys and
  holds no thumbnail key; `observations:read` and `observations:write` are what exist.
- **`comname`, `taxserial`, the `TimeSpan` columns, `taxReview` and `sizereview` are
  untouched.**

## What is already true, checked rather than assumed

Everything here was read or measured. It is the evidence the recommendations rest on, and
several of these are the reason a recommendation is what it is rather than the obvious thing.

### The box

- **F1 — the box is centre-origin, not top-left.** Three independent confirmations, in two
  other repositories:
  `VIDEO_PROCESSING_GUI/MAREGUI_PROOFofCONCEPT/Functions.cs:5054` says it in a comment —
  *"Normalizes a box against the annotation canvas, as the database stores it: centre point
  and size as fractions of the canvas, not pixels"* — and then computes
  `xCenter = annotation.X + annotation.Width / 2.0` before dividing by the canvas width.
  `Functions.cs:837` reverses it: `xLeft = unnormalizedXCenter - unnormalizedWidth / 2.0`.
  And `marp-inference-worker/src/old_scripts/model_training_live.py:614-618` reads MARP's
  keyframe API straight into `AnnotationRectangle(x_center=keyframe["x"],
  y_center=keyframe["y"], width_norm=keyframe["width"], height_norm=keyframe["height"])`.
  So `x, y` is the centre and a crop that treats it as the top-left is off by half a box in
  both axes — which on the median box below is 118 px horizontally at 1920 wide, i.e. the
  organism half out of the picture, silently.
- **F2 — the fractions are frame fractions, despite being normalised against a canvas.** The
  GUI divides by `annotationCanvas.ActualWidth/Height`, not by the video's pixel size. That
  would distort the box if the canvas and the video had different aspect ratios — but
  `VideoPlayer.xaml:409-411` gives the media element `Stretch="Fill"` and `:493` puts
  `annotationCanvas` as a sibling in the same `Grid` cell, so the video is stretched to
  exactly the canvas rectangle and a fraction of one is a fraction of the other whatever the
  aspect ratio. **This is load-bearing and fragile**: changing that `Fill` to `Uniform`
  letterboxes the video and silently invalidates the geometry of every box written afterwards.
- **F3 — boxes run off the frame edge, measured.** Over the fixture's 78 keyframes, read as
  centre-plus-size, the box spans `[-0.0105, 1.0275]` horizontally. (Read as top-left it spans
  `[0.0459, 1.1542]`, which is one more reason F1 is right — the centre reading is the one
  that nearly fits.) A crop has to clamp; it cannot assume 0–1.
- **F4 — the boxes are small.** Fixture medians: width `0.1222`, height `0.0999`, area **1.29%
  of the frame**. At 1920×1080 that is a median crop of **235 × 108 px**, a minimum of
  **87 × 71 px** and a maximum of **499 × 193 px**. A tight crop of the small end is not an
  identification, it is a smudge — which is what makes padding (A5) a real question rather
  than a nicety.

### The frames and the videos

- **F5 — the observation's own frame is usually not one of its keyframes.** Measured: **4 of
  the 6** fixture observations have no keyframe at `observation_frame`. Keyframes are a sparse
  sampling of a track (18000, 18013, 18028, 18049, 18096, …) while the observation is recorded
  at the frame the survey convention picked. So *"the frame the observation is counted at"* and
  *"a frame that has a box"* are different frames, and which one a thumbnail comes from is a
  decision somebody has to make (A4).
- **F6 — an observation can have no keyframes at all.** `tests/mosaic-query.test.js:745`
  asserts a page whose `keyframe_count` values are `[8, 3, 0, 0, 0, 0]`. No keyframe means no
  box, which means no cropped tile, ever. This is what makes a *permanent* failure state
  necessary rather than tidy (R9).
- **F7 — `observations.jellyfin_item_id` exists and is empty.**
  `migrations/20260909120500-record-which-job-wrote-an-observation.js` added it as *"the video
  reference the settled design puts on the observation rather than on the session"*, nullable,
  **nothing backfilled** — *"no observation in MARP was written by a GPU job, and no existing
  row has a Jellyfin item recorded anywhere to backfill from."*
  **Do not read this as "the proper key, which legacy rows lack."** It is provenance. The
  worker contract is explicit (`jobs/job_spec.py`, `VideoRef`): the item id is *"opaque
  provenance… never resolved, parsed or acted on."* **`video_source` is how a video is named
  in MARP**, it is populated on every row including the six the pipeline just wrote, and it is
  what resolution goes through. Corrected by the human on 2026-09-09 after A8 was written the
  other way round.
- **F8 — the API can resolve a filename to a video on its own.**
  `repository/jellyfin.repository.js:1276` is
  `resolveVideoSource(videoSource, minScore = 60, clientIdentity)`, scoring candidates with
  `_scoreVideoMatch` (`:1449`), a port of the GUI's `ScoreJellyfinVideoMatch`, with exact
  display-name, path-stem and full-filename matches scoring 100/98/96 and a `minScore` of 60
  admitting fuzzier ones. `buildDirectStreamUrl` (`:683`) then returns an absolute URL with
  the session token embedded as `api_key`. **The API already holds every piece of this except
  the frame decode.**

### The client, and what it will accept

- **F9 — the client's vocabulary is `ready`, `queued`, `failed`, and it also has a fourth
  idea.** `data.js:494` reads `thumbnail_permanent` and refuses to retry when it is set; the
  fixture defines the field and **no fixture row uses it**. The three states are drawn in
  `src/ui/tile.js:113-124` and `src/model/modes.js:241-242`.
- **F10 — the row's `thumb` is a filename because the fixture serves static files.**
  `tile.js:117` renders `./fixtures/thumbs/${row.thumb}`. That is an artefact of the fixture,
  not a requirement on the API (A6).
- **F11 — the fixture's own thumbnails are 512 × 512 JPEG at 33–66 KB.** Measured with
  `sharp` over `fixtures/thumbs/`. That is the closest thing to a stated output size that
  exists, and at 440,000 observations it implies roughly **20 GB** of thumbnails (A5, A12).
- **F12 — the tile is square and uses `object-fit: cover`.** `styles/app.css:265` gives
  `.tile` `aspect-ratio: 1`; `:268` gives `.tile img` `object-fit: cover`. So a wide crop —
  the median box is 2.2 : 1 — has its **left and right ends cut off by the browser**, which
  for an elongated organism removes exactly the part a reviewer identifies it by. Padding the
  crop to square server-side is not a preference; it is what stops the client throwing half
  the picture away.
- **F13 — the retry seam already has both halves.** `store.js:692` sets the row to `queued`
  itself, awaits `MarpData.retryThumbnail(id)` and writes back whatever status comes home; a
  separate `_chaseQueuedThumbnails` (`store.js:515`, called from `:157`) polls the queued rows.
  Only `data.js:489-497` pretends the retry is synchronous by returning `'ready'`. So an API
  whose retry answers `queued` and whose poll answers later fits the client that exists, and
  the client change is small.
- **F14 — a page-level retry must not re-render per tile.** `store.js:705-736` and that app's
  `CLAUDE.md:516-518`: one paint to show the page queued, one when the answers are in. A test
  fails if it re-renders per tile. So the API needs a **page-shaped retry**, not only a
  per-observation one.
- **F15 — accepting needs imagery; flagging does not.** `data.js:734-741` and
  `CLAUDE.md:329-333`. A marked row is committed whether or not it has a picture; an unmarked
  row without one is `skipped` with reason `no-imagery`.
- **F16 — that skip reason does not exist on the server yet, and this phase creates it.**
  `repository/mosaic-commit.repository.js:147` says so explicitly: *"Never for imagery. The
  server makes no imagery judgement until Phase 6 — there are no thumbnails and nothing on
  `observations` records a status."* Phase 6 is what makes it real (R12).

### The schema constraints this phase must not break

- **F17 — `observations."updatedAt"` is a mosaic sort field.**
  `repository/mosaic.repository.js:116`, `SORT_FIELDS.updatedAt`. So **any thumbnail write
  onto `observations` reorders the mosaic underneath the reviewer** as pictures land. That is
  a concrete, testable defect, not a stylistic worry, and it is the single strongest argument
  against thumbnail columns on `observations`.
- **F18 — `observations.version` is the commit routes' concurrency token.** #106's D1: all
  three commit routes reject a request that omits a version and answer `conflicted` when it
  has moved. A thumbnail write that touched `version` would make **every commit conflict**
  because a picture arrived.
- **F19 — the mosaic row key set is a tripwire, deliberately.**
  `tests/mosaic-query.test.js:1004-1034` names the exact 17 keys, and its own comment says
  `species_comname` was *"moved into this list rather than the list being loosened — naming
  the exact keys is the tripwire, and relaxing it would disable the tripwire permanently to
  admit one field."* Whatever this phase adds is moved in the same way.
- **F20 — `first_framenum` is already on the row and was put there for this phase.**
  `mosaic.repository.js:130-131`: *"`first_framenum` stays: it is free from the same lateral
  that produces `keyframe_count`, and Phase 6 needs it to address a thumbnail."* It is
  `min(framenum)` from the lateral at `:611` — the **start of the track**, which F5 says is
  generally not where the observation was counted.
- **F21 — `storage/` is git-ignored** (`.gitignore:114`), and species pictures survive a
  fresh deployment only because `migrations/20260901120400-import-species-pictures.js`
  re-imports them from `seed-data/species/images/`, which is tracked. **A thumbnail has no
  seed to be re-imported from.** So a redeployment loses every thumbnail and the only recovery
  is re-extraction — which is a requirement on the design (R10), not an operational footnote.

### The two machines

- **F22 — the API has `sharp` and no ffmpeg.** `package.json` dependencies: `sharp ^0.35.4`,
  used already at `routes/species.routes.js:716` to resize a picture on request. libvips
  cannot decode video. So the crop and the resize are already solved and only the *decode*
  is missing (A9).
- **F23 — the worker has OpenCV and knows how to open a Jellyfin stream.**
  `marp-inference-worker` depends on `ultralytics` (which brings `opencv-python`), and
  `src/marp_inference_worker/media/video_source_resolver.py` exists to *"convert database
  video_source values into local paths or Jellyfin stream URLs that OpenCV and future video
  jobs can open."*
- **F24 — but the settled design says the worker does not speak to Jellyfin.**
  `config/gpu-orchestration.js:145-155`: *"the coordinator is the Jellyfin client here, not
  the worker. The worker never speaks to Jellyfin and holds no media credential — it is handed
  a URL it can open."* Commit `40e67ec` is literally *"Resolve the video in the coordinator,
  not the worker."* So even in the GPU option, resolution stays here.
- **F25 — the job system is built for long jobs.** `config/gpu-orchestration.js`:
  `HEARTBEAT_SECONDS 10`, `LEASE_SECONDS 60`, `ATTEMPT_CAP_SECONDS` 24 hours, and the
  `POLL_RETRY_INTERVAL_MS` comment — *"a job appears every few minutes at most, half a second
  of latency on picking it up is irrelevant next to a job that runs for an hour."* One unit of
  work costs a `gpu_jobs` row, a `gpu_job_attempts` row, events, a sha256-addressed artifact
  file with an `artifacts` row, and an ingest pass.
- **F26 — a second job kind is a migration, not a constant.** `JOB_KINDS` is
  `['inference', 'tracking', 'training', 'diagnostic']` in `config/gpu-orchestration.js:171`,
  and that file's own header explains that the migrations spell their vocabularies out
  independently *"so the mismatch will show up as a database error rather than as silence."*
  `INGESTIBLE_JOB_KINDS` and the ingest route both branch on the kind.
- **F27 — there is no per-kind concurrency cap anywhere.** The poll route
  (`routes/gpu.routes.js:233`) hands a queued job to whoever asks. Nothing in
  `config/gpu-orchestration.js` limits how many jobs of one kind may be leased at once.
- **F28 — `service/jellyfin.service.js:14`: "MARP never proxies video bytes."** Today the API
  redirects a client to Jellyfin and never reads the stream itself. Extraction in the API
  would be the first time the API opens a video stream for its own purposes. Nothing is
  proxied to a client, so the sentence is not contradicted — but it is the first, and it
  should be said out loud rather than discovered.
- **F29 — the GPU environment on this machine works, and the umbrella says otherwise.**
  `Workspace/marp-inference-worker` has CUDA, torch 2.11, ultralytics 8.4.90 and a real
  seven-class model. The umbrella's `CLAUDE.md` still records the checked-in virtualenv as
  broken and needing recreation against Python 3.12; that line is stale. This matters twice:
  it removes an availability argument this spec would otherwise have leaned on against the GPU
  option, and it means **real keyframes are close** — the only missing piece is the Jellyfin
  address — so the throughput checklist below is a near-term plan rather than an indefinite
  deferral.

## Where extraction runs — the recommendation

**Recommendation: extraction runs in the API**, as a small bounded worker inside this
process, with a fourth option — extraction as a by-product of inference on the worker —
named as the right *eventual* answer for machine-written observations and explicitly not
this phase. Basis: the repository's files, cited by line below. This is A1 and it is
`blocking`; everything else in this spec assumes this answer and changes if it changes.

### The reasoning, from what is here

**1. The rate limit is Jellyfin's, and moving the work does not move the limit.** Five or six
concurrent streams is a property of the media server. Running ffmpeg on a GPU machine does not
raise that ceiling; it changes *who queues behind it* and it removes the one place that can
count. In the API the limiter is a semaphore in one process. Across N workers MARP could only
limit at job granularity, and F27 says no per-kind cap exists — so the GPU option's first cost
is inventing one in machinery that stabilised this week.

**And the ceiling is shared with people.** The video player and the annotation GUI stream from
the same Jellyfin, and a reviewer watching a clip is one of the five or six. Whatever
extraction takes has to be *less* than the ceiling, or a reviewer's own video stalls because
their own thumbnails are being made. That is an argument for a limiter MARP controls tightly,
which is the in-process one.

**2. The API already holds every piece except the decode.** `resolveVideoSource`
(`jellyfin.repository.js:1276`), `buildDirectStreamUrl` (`:683`), `sharp` for the crop and
resize (F22), and the storage-plus-row pattern from species pictures
(`routes/species.routes.js:35`, `repository/species.repository.js:560-620`). Meanwhile F24
says video resolution stays in the coordinator even in the GPU option — so a thumbnail job
would carry the resolved URL, the frame list *and* the box list out to the worker, and the
only thing genuinely moved is one `cv2.read()`.

**3. The work is not GPU work, and the GPU machine is the scarcest thing in the platform.**
Decoding to a frame is CPU and network. Sending it to the inference machine occupies the
machine whose entire purpose is producing the observations these thumbnails are pictures of.
"Offloading the API" is true, and it offloads onto the wrong machine. This cuts the other way
too and should be said: *because* extraction needs no GPU, a GPU worker is an unnecessarily
expensive place to do it, and *because* it needs no GPU, any machine could do it later — so
choosing the API now forecloses nothing.

**4. Granularity.** F25's unit of work — job, attempt, events, sha256 artifact, ingest — is
not a unit you can spend per thumbnail at 440,000 observations. So a thumbnail job has to be a
*batch*, and a batch is exactly the thing a reviewer cannot wait for. A page of 45 tiles is
one video in the best case and 45 in the worst.

**5. Latency.** F25 again: the poll loop's own comment budgets half a second of pickup latency
against a job that runs for an hour. A reviewer pressing *Ask again* is a person waiting, and
in the good case the answer arrives after a poll interval plus an upload plus an ingest pass.

### Each option's cost, in the three cases asked for

| | **In the API** | **As a GPU job** | **At inference time, on the worker** |
| --- | --- | --- | --- |
| **When it fails** | The row records `failed` and the reason on the observation, at once. Retry is the same code in the same process. One log, one place to look. | A failure is an attempt outcome, then a retry the lease machinery may or may not make (`gpu.service.js:348`), then an artifact that never arrives, then an ingest with nothing to write. The tile says `queued` throughout. Three systems to look in and none of them is looking at the observation. | Wrong blast radius: you would not fail a two-hour tracking run because a JPEG did not encode. Needs its own soft-failure channel inside the result file — a new piece of the cross-repository contract. |
| **When it is slow** | Bounded and visible: the queue is `queued` rows in one table, its depth is a number, and the semaphore is the only thing that decides. The cost is sharing the API host — mitigated because the decode is a child process and the crop is `sharp`'s thread pool, so neither sits on the event loop. **Unmeasured; see the deferred checklist.** | Unbounded and *invisible*, because "slow" silently includes "no worker is polling". Nothing the mosaic can show distinguishes a busy queue from an offline machine. | Not slow at all — the frame is already decoded and in memory. This is the option's real strength. |
| **When nobody is watching** | Nothing happens, and that is correct: if the queue is fed by what a reviewer is looking at, an idle system extracts nothing and leaves Jellyfin alone. | The queue drains only when a worker is online and polling, and a thumbnail is wanted by a person who is looking at the screen right now. So the tile's state stops being a fact about the picture and becomes a fact about whether a machine happened to be awake — and nothing the mosaic can draw distinguishes the two. **This machine's GPU environment does work** (CUDA, torch 2.11, ultralytics 8.4.90, a seven-class model), so this is a coupling argument rather than an availability one. | Extraction happens when a person asked for a run. Ideal — and it never touches the legacy rows that no run ever processed. |

### The fourth option, named because it is the right end state

**Extract the crop on the worker as a by-product of inference.** The worker has already
decoded the frame — it ran a detector on it — so the crop costs approximately nothing and
opens **no second Jellyfin stream at all**. That collapses the rate-limit problem entirely for
every future machine-written observation.

It is not this phase, for two reasons: it does nothing for the ~440,000 legacy rows that were
never run (F7), and it is a change to the worker's result-file contract, which is
`marp-inference-worker`'s to make. The API path has to exist anyway — for the legacy rows, and
for *Ask again* — so building it first is not wasted work, and adding this later is an
optimisation to a working system rather than a bet.

### What would change this recommendation, and the number that decides

- **A measured extraction rate the API host cannot sustain while serving requests.** Measure:
  seconds per thumbnail at concurrency 3 against the development Jellyfin, and the API's p95
  request latency during the run. **Above roughly 2 s per thumbnail at concurrency 3**, a page
  of 45 takes over 30 s and page-scoped extraction can no longer keep up with a reviewer who
  pages every half minute — at which point batching by video has to work, or the work has to
  move off this process.
- **The API host not being allowed an ffmpeg binary** (A9). That is an environment fact, not a
  design argument, and it would decide this on its own.
- **A "extract all 440,000" backlog becoming a requirement.** That is a batch job, it belongs
  on a machine that is not serving requests, and it is a different job from the one this phase
  needs. If it is wanted, the GPU option earns its cost — for the backlog only, with the API
  path still handling what a reviewer asks for.

## Requirements

Numbered so a test can cite one.

**The schema**

- **R1** — A new table, `observation_thumbnails`, **one row per observation**, holding the
  state and the file reference. Not columns on `observations`: F17 (a write would reorder the
  mosaic through the `updatedAt` sort) and F18 (a write near `version` would make every commit
  conflict) are each sufficient on their own, and #103 already set the precedent that reviewer
  state belongs in a table rather than a column on the scientific record.
- **R2** — `observation_id` is `NOT NULL`, **unique**, and `REFERENCES observations
  (observation_id) ON DELETE CASCADE`. One picture per tile; and Delete Mode is a real
  permanent delete (#106), so the row must go with the observation rather than orphan the way
  `subset_observations` does (#103's finding).
- **R3** — `status` is constrained to `queued | ready | failed`, spelled out in the migration's
  own check constraint rather than read from a config module — the rule
  `config/gpu-orchestration.js` states in its header and the reason it gives.
- **R4** — The absence of a row is a state in its own right: *nothing has ever been asked for*.
  No row is pre-created for the ~440,000 existing observations, and the creation trigger does
  not backfill them. What absence reports to the client is A3: **`queued`**, which is honest
  because the page fetch that reported it also enqueued it (R28).

**The extraction**

- **R5** — Extraction resolves the video from `observations.jellyfin_item_id` where it is
  present (F7) and falls back to `resolveVideoSource(video_source)` (F8) where it is not,
  recording which route was used and, for a fuzzy match, the score.
- **R6** — **The crop is computed from the decoded frame's own pixel dimensions**, read from
  the decode itself, never from a stored or assumed size. The dimensions are recorded on the
  row as `source_width` and `source_height`. If they cannot be determined the extraction
  **fails**; it does not guess. A normalised box multiplied by the wrong dimensions is a
  silent crop of the wrong part of the seabed and it reads as a bad detection rather than as a
  bug, which is the most expensive failure this phase can have.
- **R7** — The crop rectangle is built as centre-origin (F1) —
  `left = (x - width/2) * source_width`, `top = (y - height/2) * source_height` — then padded
  (A5), then **clamped** to `[0, source_width] × [0, source_height]`. A box running off the
  edge (F3) yields a smaller crop, never an error and never a negative offset.
- **R8** — Which keyframe a thumbnail is cut from is recorded on the row as `framenum`, so the
  picture can always be traced back to the frame it came from and a re-extraction can be
  compared against it. (Which keyframe to pick is A4.)
- **R9** — A failure that retrying cannot help is recorded as **permanently** failed and is
  never retried. At minimum: an observation with no keyframes (F6), a video that resolves to
  nothing, and a frame beyond the end of the video. Without this,
  `retryFailedThumbnails` on a page of legacy rows hammers Jellyfin for ever, on a button the
  page invites the reviewer to press (`ui/grid.js:78`). The client already has the field
  (`thumbnail_permanent`, F9) and no fixture row uses it.
- **R10** — A thumbnail must be **re-derivable from the database alone**. `storage/` is
  git-ignored and has no seed to be re-imported from (F21), so a redeployment starts with an
  empty directory; the row is what says how to make the picture again. A row whose file is
  missing serves the same 404-with-an-explanation species pictures already serve
  (`routes/species.routes.js:490-494`) and is re-extractable, not lost.

**The contract**

- **R27** — **A thumbnail is enqueued when a keyframe is written, by a database trigger, and
  every write path inherits it.** `keyframes_enqueue_thumbnail_trigger` on `keyframes`, not a
  call in a service or a repository: the ingest, the observation route's nested `include` and
  the keyframe route's `bulkCreate` are three different writers, and a hand `INSERT` is a
  fourth. The queue entry is therefore written in the **same transaction** as the keyframes,
  so a rollback takes both. The trigger hangs off the **keyframe** rather than the observation
  because a thumbnail needs a box (F6) and the annotation GUI writes the observation first, in
  its own request. **It is the primary trigger**: by the time anybody looks, the work is
  normally already done or in flight.

- **R28** — **Serving a mosaic page enqueues any row on it that has no record — as a
  backstop.** Scoped to the page being served. It is what makes R4's `queued` honest and what
  reaches the ~440,000 rows the trigger cannot, and it must be a **no-op** on a row that
  already has a record: never a second row, never a reset of a `ready` one, never a
  re-enqueue of a permanent failure. Both R27 and R28 need their own test, and each was
  mutation-checked against the other's removal — a page serve passing while nothing was
  written is exactly the dishonesty A3's two halves exist to prevent.

- **R11** — The mosaic row gains **`thumbnail_status` and nothing else**, and the key is
  **moved into** `tests/mosaic-query.test.js`'s exact-key list rather than the list being
  loosened — the rule that test states about itself (F19). The picture's address is derivable
  from `observation_id`, so no `thumb` field is needed (A6).
- **R12** — `POST /api/mosaic/observations/review` and `…/training` gain the second `skipped`
  reason `no-imagery`, for an **unmarked** row whose thumbnail is not `ready`. This is the
  reason `mosaic-commit.repository.js:147` deliberately did not emit and named Phase 6 as the
  phase that would (F16). A **marked** row is committed whether or not it has a picture (F15),
  and `…/delete` is unaffected because it never touches an unmarked row.
- **R13** — `GET /api/observations/:observationId/thumbnail` (registered by
  `registerVersionedRoute` and therefore served at `/api/v2/…`) serves the bytes under
  `observations:read`. It carries an ETag that **changes when the thumbnail is re-extracted**,
  and `Cache-Control` that is revalidating rather than `immutable` — species pictures may be
  `public, max-age=31536000, immutable` (`routes/species.routes.js:707-710`) because a stored
  picture never changes and a replacement is a new record; a thumbnail at a stable
  per-observation URL is the opposite case, and copying `immutable` here would pin a stale
  picture in every reviewer's browser for a year.
- **R14** — A retry route accepts **a page of observation ids in one request** and answers
  per observation, so a page-level retry is one round trip and two paints (F14). It answers
  `queued` for work it accepted and the current status for anything it refused — never a
  terminal `ready` invented synchronously, which is only the fixture's shortcut (F13).
- **R15** — No new permission keys. Serving is `observations:read`; retrying is A10.

**The rate limit**

- **R16** — Concurrency against Jellyfin is bounded by a single configured number, gathered
  with the phase's other numbers in one module the way `config/gpu-orchestration.js` gathers
  its own and for the reason that file gives. The bound is **below** the five-or-six ceiling,
  because the ceiling is shared with people watching video (A7).
- **R17** — Work is **batched by video**: the frames wanted from one Jellyfin item are cut
  from one stream rather than one stream per frame. This is what makes the ceiling survivable
  — the fixture's six observations are six frames within eleven seconds of **one** video.
- **R18** — The queue is **the `queued` rows in the table**, not an in-memory list, so a
  restart resumes rather than stranding every tile at PREPARING for ever. A row claimed by an
  extraction that then died is reclaimed after a timeout.
- **R19** — Backpressure is by **dropping priority, never by rejecting**. A long queue makes a
  reviewer wait behind a PREPARING tile, which Phase 1 already draws, and never produces a
  state the client has no rendering for.

- **R20** — **The concurrency ceiling is measured, not assumed.** A8's 3 is a starting value,
  and the phase ships a check that establishes what the development Jellyfin actually
  sustains: extraction throughput and error rate at 1, 3 and 6 concurrent streams over one
  real video, recorded as numbers. Required because every other number in this phase is
  derived from *"five or six"*, which is an estimate nobody has tested. Runs against the
  development Jellyfin only, on demand rather than in CI, and never against the live service.

- **R21** — **The frame rate is read, never assumed.** The extractor ffprobes the source's real
  rate and converts `framenum` to a seek time with it. On a rate that disagrees with the 25 fps
  `db/timecode.js` used to derive `observation_frame`, the extraction is **recorded as a
  failure with the two rates in `last_error`** — not warned about and continued. F38: this
  footage is 25.000 so the bug cannot appear here, and on any other footage it silently seeks
  to the wrong moment and produces a confident picture of the wrong thing. Added at the
  human's direction, 2026-09-09: *"we don't want to assume it's gonna be 25 FPS all the time."*

- **R22** — **Clamping is proven by a unit test, not by a run.** F37: no real extraction so far
  has produced an out-of-frame box, so R7's clamp is unexercised. A test constructs boxes that
  overhang each edge and both corners and asserts the intersection, because the only evidence
  that path works will be a test until real data happens to contain one.

### The control surface

Added at the human's direction, 2026-09-09: *"maybe we'll need API endpoints so we could query
the service, and we could run the service and pause the service and stop the service."*
Extraction is background work against a shared, rate-limited media server, so an operator needs
to be able to see it and stop it without restarting the API.

- **R23** — **Status is queryable.** One endpoint reports what the extractor is doing: run
  state, how many are `queued`, `ready`, `failed` and `permanent`, how many are in flight
  against the configured limit, and the last error. This is what makes A7's constant tunable
  by observation rather than by guess, and it is what R20's measurement reads.

- **R24** — **Pause, resume and stop are distinct, and each says what happens to work already
  running.** `pause` stops *starting* new extractions and lets in-flight ones finish, because
  killing an ffmpeg mid-decode wastes the Jellyfin stream it already paid for. `resume` starts
  taking work again. `stop` is pause plus discarding the queue — the rows return to being
  simply absent, which under A3 means the next page view re-enqueues them, so nothing is lost
  and no fourth state is needed.

- **R25** — **The run state is persisted, not in-memory.** A service paused because Jellyfin
  was struggling must still be paused after an API restart, or the pause silently expires at
  the worst moment. It lives in the database with the rest of the phase's state.

- **R26** — **Reading status is `observations:read`; changing the run state is `admin`.** No new
  permission keys, per #68 Phase 2 — both already exist in the 27-key catalogue. The split is
  the point: a reviewer legitimately wants to know whether their pictures are coming, but
  pausing extraction affects everyone using the mosaic and throttles a shared media server,
  which is not a reviewer's decision. This does not disturb A10, which governs what *causes*
  extraction rather than what controls it.

## What the first real run changed

On 2026-09-09 the GPU pipeline ran end to end for the first time (job 132, session 142,
`marp-inference-worker` on this machine, Jellyfin item `4ac4749a…`, frames `[18000, 18300)`).
It wrote **6 observations and 78 keyframes**. Four things below were written against an empty
database and are now measurable, so they are restated as measurements rather than left as
assumptions.

- **F30 · No observation has a keyframe at its own frame.** **0 of 6**, not the fixture's 4 of
  6. `absoluteFrame(parseTimeSpan(mediaPosition))` never coincides with a `framenum`. So A4 is
  not an edge case to handle, it is the only case.
- **F31 · But every observation's frame falls *inside* its keyframe span.** **6 of 6.** Each
  has a keyframe before and a keyframe after the counted moment, so a box at the observation
  frame is always **interpolatable** on this data and the fallback would not have fired once.
  This is what makes the answer to A4 buildable rather than aspirational.
- **F32 · The stored box is already padded, and not by us.** The worker's
  `_apply_directional_pad` (`reduction/keyframes.py`) widens every box by local track
  velocity before it is ever written — faster motion, more padding, biased along the direction
  of travel. **A5's padding recommendation therefore pads an already-padded box.** Whatever
  fraction is chosen, it is a second application, and that has to be a stated choice rather
  than an accident.
- **F33 · `keyframes.confidence` is NULL on all 78 rows.** The reduction emits no per-keyframe
  score; the ingest maps it correctly when present
  (`service/observation-ingest.service.js:772`). So **A4 option (iv), highest-confidence
  keyframe, is not available** for machine-written observations and cannot be chosen without
  the worker change first. Tracked as `MarineAppliedResearch/marp-inference-worker#9`.

Measured box areas, as a fraction of the frame: **0.49% to 4.09%, median ≈ 0.85%** — the same
order as the fixture's 1.29%, so A5's sizing arithmetic still stands.

### What the geometry spike established (`scripts/thumbnail-spike.js`, 2026-09-09)

Six real frames pulled from the real video and cropped, then looked at. Source is
**1920 × 1080, h264, 25.000 fps exactly**, so `db/timecode.js`'s assumed 25 is right *for this
footage*.

- **F34 · F1 is confirmed by eye, not only by inference.** `obs-4-control.jpg` draws the box
  both ways: the centre-origin box sits on the animal, the top-left box is shifted half a box
  right and down, runs off the frame edge, and contains bare rubble. **Centre-origin stands.**
- **F35 · 320 × 320 is already upsampling, and this answers the open half of A5.** Five of the
  six crops are *smaller than 320 px at source* — 127, 210, 213, 271, 298 — and only the
  largest (415) is downscaled. **Raising the output to 512 would buy nothing**: the limit is
  the detection's size at 1920 × 1080, not the tile. 320 is kept, now on a measurement rather
  than on an estimate of storage.
- **F36 · Every frame landed exactly.** `showinfo` `pts_time` read back for all six: **delta 0**.
  One ffprobe plus one ffmpeg, six frames from one stream in **1.5 s** — A7's batching
  recommendation, demonstrated rather than assumed.
- **F37 · The clamp path is written but untested.** After a defect in the spike's own
  clamp-detection was fixed, **0 of 6 boxes clamped** — every one sat well inside the frame.
  F3 says out-of-frame boxes exist in the wider fixture, so **R7's clamping must be proven by
  a unit test**, because no real extraction so far has exercised it. Do not read "0 of 6
  clamped" as "clamping works."
- **F38 · The 25 fps assumption is load-bearing at the seek.** `framenum → seek time` uses 25
  because `absoluteFrame` produced the number that way. This footage is 25.000 so it did not
  bite; on any other rate it silently seeks to the wrong moment. The extractor must ffprobe the
  real rate and refuse, or record a failure, on a mismatch — not warn and continue.

## Open assumptions

Ten, and each one changes the schema, the contract, the data or where the work runs. **Every
recommendation below is a recommendation. Nothing is implemented while one is open.**

- [x] **A1 · architectural · blocking** — **Where does extraction run?** The whole spec above
  assumes the answer. **Recommendation: in the API**, with worker-at-inference-time named as
  the eventual optimisation for machine-written observations and not built now. The reasoning
  is in *Where extraction runs* above and rests on F22–F28: the ceiling is Jellyfin's and does
  not move (F27 says nothing caps per-kind concurrency); the API already has resolution, URL
  building and `sharp` and lacks only the decode (F8, F22); resolution stays in the
  coordinator either way (F24); the job unit is a job-plus-attempt-plus-artifact-plus-ingest
  built for hour-long work (F25) and a second kind is a migration (F26); and a pull-based
  queue couples a tile's state to whether a machine is awake, which is not a thing the mosaic
  can draw. **The availability argument is deliberately not being made** — this machine's GPU
  environment works (F29) — so this recommendation stands on fit, not on the worker being
  unavailable.
  **What it costs, plainly:** the API host acquires an ffmpeg dependency (A9) and reads video
  bytes for the first time (F28), and a busy extraction queue shares a host with request
  serving. **What would change it:** the measurement in *What would change this
  recommendation*, an ffmpeg binary not being allowed on that host, or a whole-corpus backlog
  becoming a requirement.

- [x] **A2 · database/schema · blocking** — **A table or columns on `observations`, and what
  the states are.** **Recommendation: a table, `observation_thumbnails`, one row per
  observation, with `queued | ready | failed` plus a `permanent` flag.** Two findings decide
  the table on their own: `updatedAt` is a mosaic **sort field** (F17), so thumbnail writes
  onto `observations` would reorder the mosaic under a reviewer as pictures land; and
  `version` is the commit routes' concurrency token (F18), so a write anywhere near it risks
  making every commit `conflicted`. #103 set the precedent for the same class of reason.
  **On the vocabulary: the client's three survive contact, and a fourth idea it already has
  becomes necessary.** `permanent` is not tidiness — F6 shows an observation can have **no
  keyframes at all**, which no retry can fix, and the client already reads
  `thumbnail_permanent` (F9). **The alternative, named so it can be chosen:** two columns on
  `observations` (`thumbnail_status`, `thumb`) exactly as #68's audit lists them, which is
  smaller and matches the fixture — and which requires every thumbnail write to suppress
  `updatedAt` and `version` by hand, for ever, with nothing checking that it did. **I would
  not choose it.**

- [x] **A3 · product/UI · blocking** — **What does the absence of a thumbnail row report, and
  does serving a mosaic page enqueue the pictures it is missing?** These are one question
  because the answer to the first is only honest if the second is yes.
  **SUPERSEDED — and it moved twice on 2026-09-10. Read all three `## Decisions` entries
  below, in order, or you will build the middle version.** The text that follows is left
  exactly as written and answered on 2026-09-09, because the reasoning it was answered on is
  what the later judgements are about. In one line: a page fetch does still enqueue, but it is
  no longer the *only* thing that does, and it is no longer what the design leans on.
  **Recommendation: serving a page enqueues its missing thumbnails, and absence reports
  `queued`.** It makes the client's existing `queued` tile truthful; it prioritises for free,
  because only what somebody is actually looking at is ever extracted; it bounds the queue to
  the working set instead of 440,000 rows; and it needs no fourth state and no new rendering.
  **What it costs, plainly:** `POST /api/mosaic/observations/pages` is declared
  `observations:read` and would acquire a side effect — and #99's prefetcher asks for adjacent
  pages, so one reviewer's navigation enqueues up to three pages at a time. Both are real and
  both are why this is blocking.
  **The alternative:** absence reports `failed`, and the reviewer's *Ask again* starts the
  work. No read-with-side-effect and no permission question — but every page of legacy rows
  opens as a wall of NO IMAGE and `pageState` returns `no-imagery` for it
  (`model/modes.js:241`), which is the worst first impression the mosaic can make.
  **A third option, if the side effect is unwelcome:** a fourth state, `absent`, and an
  explicit client call to request a page's thumbnails. Honest, no side effect, and it costs a
  client change plus a tile rendering that does not exist.

- [x] **A4 · scientific or data-meaning · blocking** — **Which keyframe does the picture come
  from?** *Answered, and the answer is none of the four below — see Decisions.* F5 is the problem: **4 of 6** fixture observations have no keyframe at their own
  `observation_frame`, so *the frame the observation was counted at* and *a frame that has a
  box* are different frames. Four candidates, all defensible:
  (i) the keyframe **nearest the observation's absolute frame**, computable with
  `absoluteFrame(parseTimeSpan(mediaPosition))` (`db/timecode.js:152`);
  (ii) the **`start`** keyframe, which is `first_framenum` and already free in the mosaic
  query's lateral (F20);
  (iii) the **largest** box, on the theory that biggest is clearest;
  (iv) the **highest-`confidence`** keyframe, using the column ingest already populates.
  **Recommendation: (i), nearest the observation's own frame**, because that moment is the one
  the survey convention chose (`config/gpu-orchestration.js:203-221` — a fish is counted as
  its centre crosses near the bottom of frame, an invertebrate as it enters the bottom-centre
  trapezoid), and a picture of a different moment is a picture of a different scientific fact.
  **But I am flagging the consequence rather than hiding it:** that convention means the
  counted frame is exactly where the animal is at the edge of the shot and often part-way out
  of it — the fixture's boxes at the observation frame sit at `y ≈ 0.80` — so the *most
  identifiable* picture may well be (iii). Whether a tile should show the moment the animal
  was counted or the moment it is most recognisable is a scientific judgement, and it is
  yours.
  **A second part of the same question:** `keyframes.subset` distinguishes tracks within one
  observation (ingest defaults it to `"1"`, `observation-ingest.service.js:760`, and the
  worker keys its lists `observation_id_subset`). If a legacy observation has more than one
  subset, which one is the picture from?

- [x] **A5 · product/UI · blocking** — **How much padding, and what size is the output?**
  Both follow from the box being normalised, and neither has a default that is obviously
  right. The measured facts: the median fixture box is **1.29% of the frame — 235 × 108 px at
  1920 × 1080** — with a minimum of **87 × 71** (F4); the tile is **square with `object-fit:
  cover`** so the browser cuts the ends off a wide crop (F12); and the fixture's own
  thumbnails are **512 × 512 JPEG at 33–66 KB** (F11).
  **Recommendation: pad by 20% of the box on each side, expand the padded rectangle to square
  before clamping, and resize to a fixed 320 × 320 JPEG.** Padding, because a tight crop of an
  87 × 71 detection is a smudge and the reviewer is judging what the organism looks like.
  Square, because F12 means the client will crop to square anyway and doing it server-side is
  what stops it cutting the ends off the animal. Fixed size, because a wall of tiles has to
  look even and because a fixed size is the only way the storage figure is predictable.
  320 rather than the fixture's 512: 320 covers a 132 px tile at 2× device pixel ratio
  (`styles/app.css:263`), and at 440,000 observations the difference is roughly **20 GB versus
  5 GB** (A12).
  **What is genuinely open here and is yours:** the padding fraction is a product decision
  about how much context around an animal helps identification, and 512 may simply be what you
  want because the reviewer sometimes enlarges a tile.

- [x] **A6 · API contract · blocking** — **Does the mosaic row gain `thumbnail_status` only,
  or `thumb` as well?** #68's schema audit lists both as this phase's. Per this repository's
  own rule — *"a requirement taken from #68 is checked with the human, not inherited"* — it is
  cited and asked rather than inherited, and the citation cuts against it: the fixture's
  `thumb` is a filename because the fixture serves static files from `fixtures/thumbs/`
  (F10), which the API does not.
  **Recommendation: `thumbnail_status` only.** The address is
  `/api/v2/observations/{observation_id}/thumbnail`, derivable from a key the row already
  carries, so a second field would be a URL the client can compute — and every field added to
  the row is 45 copies per page and a change to a published contract with a snapshot tripwire
  over it (F19). Whichever way this goes, the key is **moved into** that list, never appended
  by loosening it.
  **What it costs:** it is a change to a merged contract, `docs/openapi.generated.json` has to
  be rebuilt, and it joins the list of Phase 8 client changes.

- [x] **A7 · performance/concurrency · blocking** — **What share of Jellyfin's five or six
  concurrent streams may extraction take?** The ceiling is shared with people: a reviewer
  watching a clip and the annotation GUI are streams too, so extraction taking all of it means
  a reviewer's video stalls while their own thumbnails are made.
  **Recommendation: 3 concurrent extractions**, one configured constant, leaving at least half
  the ceiling to people. **Recommendation on batching: group a page's missing frames by
  resolved video and cut one video's frames from one stream (R17)** — the fixture's six
  observations are six frames inside eleven seconds of one video, which is one seek and one
  short decode rather than six of each.
  **What is not decided and needs a measurement, not a guess:** whether frames far apart in
  one long video are cheaper as one pass with a `select` filter or as separate seeks. Measure
  both on one real video and take the faster; the crossover is a property of the file's
  keyframe interval, not something to reason out.
  **What would change the number:** if a measured extraction at 3 leaves Jellyfin idle and
  reviewers waiting, raise it; if a reviewer reports video stuttering while a page loads,
  lower it. That is the observation to watch for, and it is the reason the number is one
  constant in one file.

- [x] **A8 · behavioural · blocking** — **What match score is good enough to attach a picture
  to a scientific record?**

  **This assumption was originally written on a false premise and has been rewritten.** It
  framed video lookup as happening by `jellyfin_item_id`, with legacy rows as the deficient
  case that must fall back to a filename match. That is backwards, and the human corrected it:
  *"we're not supposed to be looking things up by jellyfin id."* Recorded here rather than
  quietly fixed, because the wrong framing produced a wrong question.

  **What is actually true, checked:** `observations.video_source` holds the filename and is
  populated on every row — the six the pipeline just wrote all carry
  `20240730_171520_Fwd.mp4`. `jellyfin_item_id` is nullable and is **provenance**, not a key.
  The worker contract says so in as many words (`jobs/job_spec.py`, `VideoRef`): *"Opaque
  provenance, optional. Echoed into the observation output exactly as received and never
  resolved, parsed or acted on."* Jellyfin is one video server, and its internal item id is
  not MARP's identifier for a video.

  **So there is no legacy special case.** `video_source` → a playable stream is the same
  operation for every observation ever recorded, and it goes through `VideoSourceResolver`,
  which normalises the differences that actually occur — `20240727_185645 Fwd.mp4` in the
  database against `20240727_185645_Fwd` as the item name, spaces versus underscores, with or
  without the extension. An exact filename scores **96–100**; the resolver's default
  `minScore` is **60**.

  **The one real question, which applies to the whole corpus and not to a subset:** what score
  is high enough. A match at 60 can produce a **confident, plausible picture of the wrong
  dive**, which a reviewer would read as a bad detection and might delete — so the failure
  mode is silent corruption of the review, not a missing tile.
  **Recommendation: require the exact-match band, 96 or above.** Anything lower is recorded as
  a permanent failure with the score in `last_error`, so the misses are countable and the bar
  can be lowered later against evidence rather than guessed at now.
  **What it costs:** an unknown fraction of rows never get a picture, and nobody can say what
  fraction until it is run against a real corpus — six observations over one video is not a
  sample.
  **This is yours because it is about the scientific record**, not about code: a picture
  attached to the wrong video is worse than no picture, and only you can say by how much.

- [x] **A9 · environment · blocking** — **Where does ffmpeg come from?** The API has `sharp`
  and no video decoder (F22), and adding a dependency is *ask first* under the harness's
  permissions. Three ways: a bundled npm package (`ffmpeg-static`, ~80 MB per platform, no
  system install, pinned version); a system binary the deployment must provide, invoked by
  path from configuration; or `sharp` plus a decoder that is not ffmpeg, which does not
  really exist for this job.
  **Recommendation: a system binary located through configuration, with the API refusing to
  start the extractor — and reporting so — when it is absent.** It keeps a large
  platform-specific binary out of `node_modules` and out of every developer's install, and it
  makes "no ffmpeg here" a loud startup condition rather than a run-time surprise on the first
  thumbnail. **The cost, plainly:** it is a new deployment prerequisite on the production VM
  and on every developer machine, and `marp doctor` should learn to check for it.
  **The alternative** is `ffmpeg-static`, which makes a fresh clone work with no extra step
  and is the friendlier choice for the workspace — at the price of a new ~80 MB dependency in
  the API. If you would rather the workspace just work, say so and it is that instead.

- [x] **A10 · security/permissions · blocking** — **Which permission causes extraction work to
  happen?** #68 settled that this phase seeds no new keys, and serving bytes is plainly
  `observations:read`. But *causing* MARP to open streams against Jellyfin is a different act
  from reading a row, and under A3's recommendation an `observations:read` page fetch would do
  it as a side effect.
  **Recommendation: keep `observations:read` for both, and bound the risk with the rate limit
  rather than with a permission.** Anyone who can read observations can already ask the mosaic
  for pages, the queue is bounded by A7's constant whatever the caller does, and page-scoped
  enqueueing means the load is proportional to what a person is actually looking at.
  **Say the counter-argument out loud:** that makes a read permission able to consume a shared
  media server, and a script that walks every page of a 440,000-row mosaic would enqueue the
  whole corpus. **The alternative:** the explicit retry route requires `observations:write`,
  which every reviewer already has, and only the implicit page-fetch enqueue stays on
  `observations:read`. That is the honest middle and costs one line.

- [ ] **A11 · destructive · non-blocking** — **When an observation is deleted, who unlinks the
  file?** `ON DELETE CASCADE` removes the row (R2) and leaves the JPEG behind for ever. The
  mosaic's delete is a set-based SQL delete, so the delete path has to return the filenames it
  destroyed for the caller to unlink — the same split species pictures already use
  (`species.repository.js:689`: *"Does not touch the file. The caller owns the storage
  directory and unlinks using the returned `filename`"*). Recommendation: follow that split
  exactly. Non-blocking because the pattern is established; recorded because #103 found the
  same class of orphan in `subset_observations` and it was not noticed by anything.

- [ ] **A12 · performance/concurrency · non-blocking** — **How much disk, and is there a
  retention policy?** At the fixture's own 512 × 512 / ~45 KB (F11), 440,000 observations is
  roughly **20 GB**; at the recommended 320 × 320 it is roughly **5 GB**. Recommendation: no
  retention policy in this phase — thumbnails are re-derivable (R10) so the honest control is
  to delete the directory when it is too big, and a policy invented before anybody has seen
  the real numbers would be guesswork. Measure the mean file size on the first real corpus and
  revisit.

## Decisions

Nothing is decided until the assumptions above are answered. These are the ones already
settled elsewhere that this spec is recording so they are not re-litigated.

### A3 moved twice on 2026-09-10. Read these three in order.

Anybody reading only the middle one will build the wrong thing, which is why none of them is
deleted.

- **2026-09-10 (i) · A3 REVERSED, then demoted — the settled answer is TWO triggers.**

  The human overruled the 2026-09-09 answer:

  > *"One of our key criteria is that the user never has to wait. So trying to load the page
  > should not be the thing that makes the back end work. When the observation is created, it
  > should get enqueued."*

  and then, when the consequence of removing the page fetch entirely became clear, refined it:

  > *"If a page tries to view something and those thumbnails aren't available, that page
  > should enqueue the observations that are trying to be seen."*

  **So A3 is demoted rather than reversed, and the reconciliation is:**

  - **Creation is the primary trigger.** Every path that writes keyframes enqueues, so by the
    time anybody looks the work is normally already done or in flight. *That* is what makes
    "the user never has to wait" true, and it is the half the 2026-09-09 answer was missing.
  - **The page serve stays, as a backstop.** If a page is served and a row on it has no
    thumbnail record, it is enqueued. The page is no longer the *only* thing that starts the
    work — which was the objection — but it is a legitimate safety net for anything that
    slipped through: the ~440,000 rows that predate the trigger, and anything an interrupted
    extraction left with no row.
  - **Absence therefore still reports `queued`**, `coalesce(th.status, 'queued')`, and it is
    honest: a row reporting `queued` really does have work behind it, because the fetch that
    reported it also enqueued it. The status was briefly changed to `failed` under the middle
    version — see (iii) — and is changed back.

  **A10's concern comes back, and that is deliberate.** `POST /api/mosaic/observations/pages`
  is declared `observations:read` and does have a side effect; #99's prefetcher asks for
  adjacent pages, so one reviewer's navigation can enqueue up to three pages at once. A10
  answered that with **the rate limit rather than a permission**, and that answer stands
  unchanged: A7's concurrency constant bounds the load whatever the caller does. What the
  primary trigger changes is how often the backstop has anything to do — normally nothing.

- **2026-09-10 (ii) · Where the creation enqueue lives: a trigger on `keyframes`, not a call
  in the ingest.** This is the correction that mattered more, and it was the human's:

  > *"I don't necessarily think ingest itself should do it, because then we'll be skipping it
  > if we do it manually… it might be good if an observation that has keyframes just gets
  > enqueued — in the observation router or the keyframe router even."*

  The first implementation put the enqueue inside
  `repository/observation-ingest.repository.js#writeJobObservations`. **That covers the GPU
  path and silently misses every hand-annotated observation** — `VIDEO_PROCESSING_GUI` creates
  them through the observation and keyframe routes and will keep doing so. It is the kind of
  gap that looks fine for months, because the machine path is the one anybody tests.

  **There are three keyframe write paths, not one**, which is why a second call site was not
  the fix: the ingest's own raw SQL (`insertKeyframes`), the ORM's nested `include` on
  `observation.repository.js#createObservation`, and `keyframe.repository.js#createKeyframes`'
  `bulkCreate`. A fourth writer is a person fixing data by hand.

  So it is **`keyframes_enqueue_thumbnail_trigger`**, a statement-level `AFTER INSERT` trigger
  on `keyframes` — `migrations/20260910120000-enqueue-a-thumbnail-when-a-keyframe-is-written.js`.
  **This repository has already answered this exact question once**: `observations.version` is
  maintained by `observations_bump_version_trigger` and its own column comment says why —
  *"not by the application or the ORM, so it moves whatever code path performs the write."*
  The same reasoning applies and nothing about it is weaker.

  **Why the keyframe and not the observation, established by reading `VIDEO_PROCESSING_GUI`
  rather than by guessing.** A thumbnail is a crop of a box and F6 says an observation with no
  keyframes can never have a picture. The GUI's real write order settles it:

  - `FishWindow.xaml.cs:2772` POSTs `/api/v2/observation` with **no keyframes** — the body is
    a flat object and its vestigial `annotation` field is a string that is always empty;
  - it parses the response at `:2801` for the server-assigned `observation_id`;
  - `:2857` then POSTs `/api/v2/keyframe` with a **bare array** of boxes.

  So the observation is written **first**, in a separate request, and the keyframe write is a
  hard dependency on its response. Enqueueing at observation-creation would hand the extractor
  a boxless row, which R9 records as a **permanent** failure — and the keyframes arriving a
  moment later would never undo it. That is worse than the gap being closed. Hanging off the
  keyframe is order-independent: whether the boxes come with the observation or in a later
  request, the enqueue happens when the box exists and not before.

  **And a boxless observation is routine, not exotic.** The GUI skips the keyframe POST
  entirely when the annotator drew no box (`FishWindow.xaml.cs:2848`, whose own comment cites
  `VIDEO_PROCESSING_GUI#183`), and `:1917` creates observations with no annotations by
  construction. Those correctly get no row from the creation trigger. The page backstop may
  enqueue one later, and that is fine: by then a person is looking, and a permanent failure
  recorded against a real look is the honest answer.

  **Idempotency is load-bearing now that there are two triggers**, and it is
  `ON CONFLICT (observation_id) DO NOTHING` in both — never `DO UPDATE`. A track's 38
  keyframes enqueue once; a later keyframe on the same observation adds nothing; a row that is
  already `ready` is **never** reset to `queued` by either trigger, because re-extracting a
  picture that exists would re-open a Jellyfin stream every time an annotator nudged a box.
  Asking for a fresh picture is the retry route's job, on a button a person pressed.

  **INSERT only.** An updated keyframe box does change what the right picture would be, but
  re-extracting on update would fight with `ready` rows on nobody's request; the retry route
  is how to ask. DELETE needs no trigger — `ON DELETE CASCADE` from `observations` already
  takes the thumbnail row, and losing one keyframe of a track does not invalidate the picture.

  **Nothing is backfilled**, so R4 still holds for the ~440,000 rows that predate this, and
  #121 is still the thing that gives them a picture without somebody looking first.

- **2026-09-10 (iii) · WITHDRAWN: "a legacy row reports `failed`".** Recorded because it was
  briefly the answer, and because the evidence gathered for it is worth keeping.

  Under the middle version — creation-only, no page backstop — a legacy row's absence of a
  record stopped being transient, so `queued` became a promise MARP would not keep and the
  status was changed to `coalesce(th.status, 'failed')`. **With the backstop restored, absence
  is transient again** — a legacy row gets a record the first time somebody looks at it — so
  `queued` is the honest answer once more and the change is reverted.

  **The client evidence gathered for it stands, and it is useful for #121 rather than for
  this.** Checked rather than assumed: `ui/tile.js:142-146` draws anything not `ready` as NO
  IMAGE and adds a `failed` class; `model/modes.js:241-242` reports `pageState` as
  `no-imagery` when every row is `failed`, which `ui/grid.js:70-80` draws as a banner with an
  ***Ask again*** button; `store.js:717` wires that button to the retry route; and `requeue`
  answers it by **creating a row for an observation that never had one**. So the reviewer's
  recovery path works end to end with no client change, and **no fourth state is needed** in
  any version of this design.

  One thing found while checking, now only a latent inaccuracy rather than a live one:
  `ui/grid.js`'s no-imagery banner says *"the server refetches missing imagery on its own"*.
  Under the settled two-trigger answer that is true again. It would have been false under the
  middle version, which is worth knowing if the backstop is ever removed.

  **Recorded on #121** so the sweeper's owner knows what it inherited.

- **2026-09-09 · A2** — **A table, `observation_thumbnails`, but a smaller one than proposed.**
  The human challenged the premise: *"Why would the thumbnail state have to live anywhere? The
  thumbnail is a file. If the file doesn't serve, then we know that its state isn't there."*
  That is right about `ready`, and it shrinks the design — **readiness is not stored, the file
  is the truth for the bytes.** What the filesystem cannot express is the negative space, and
  three things force a row anyway:
  **(1)** absence cannot distinguish *not made yet* from *tried and failed* from *can never be
  made*, and F6 proves the third exists — an observation with no keyframes has no box and can
  never have a picture. **(2)** Under A3 a page fetch enqueues whatever is missing, so without
  a record of permanence a hopeless observation is re-enqueued on every page view, for ever,
  against the media server A7 exists to protect. **(3)** A8 requires the match score to be
  written to `last_error` so misses are countable; a file's absence records no score.
  **The precedent is already in this repository**: species pictures are a row indexing a file,
  and `routes/species.routes.js` handles the disagreement explicitly — *"the row can outlive
  the file if storage is restored separately from the database"* — answering 404 rather than
  throwing. Follow that split exactly. It also matters for #120: if storage ever moves behind
  a network, per-tile `existsSync` in the mosaic query stops being cheap.
  Rejected on the human's reasoning, not merely unchosen: columns on `observations`, because
  `updatedAt` is a mosaic sort field and `version` is the commit concurrency token.

- **2026-09-09 · A6** — **`thumbnail_status` only.** Delegated by the human: *"you're getting
  kind of into an implementation level I haven't dived into… I don't know."* Taken as
  recommended. The address is derivable from a key the row already carries, so a second field
  would be a URL repeated 45 times a page. The key is **moved into** the row-shape snapshot
  test's list, never appended by loosening it.

- **2026-09-09 · A7** — **3 concurrent extractions to begin with, and the ceiling gets
  measured.** Answered by the human: *"let's say three to begin with. But it might not be a
  bad idea to put a test in there to see what's actually possible."* The measurement is not
  optional and is written up as **R20** — the *"five or six"* figure every other number here
  derives from is an estimate nobody has tested. Batching by video stands as recommended.

- **2026-09-09 · A10** — **`observations:read` for both, bounded by A7's constant.** Delegated
  by the human: *"just make the decision."* Taken as recommended. The counter-argument is
  recorded rather than dismissed: a script walking every page of a 440,000-row mosaic would
  enqueue the whole corpus, and the rate limit rather than the permission is what stops that
  hurting. Revisit if it ever does.

- **2026-09-09 · A8** — **A video match must score 96 or above to attach a picture.**
  Answered by the human, taking the recommendation. Anything below the exact-match band is
  recorded as a permanent failure with the score in `last_error`, so the misses are countable
  and the threshold can be lowered later against evidence. Applies to every observation, not
  to a legacy subset — see the rewritten A8 and the correction to F7.

- **2026-09-09 · A3 — SUPERSEDED TWICE on 2026-09-10. Kept, not deleted; read both entries
  above it, in order.** What survives of it: a page fetch does enqueue, and absence does
  report `queued`. What does not: that this is the *only* trigger, or the one the design
  leans on.

  **Serving a mosaic page enqueues its missing thumbnails, and absence
  reports `queued`.** Answered by the human, taking the recommendation. The costs stand as
  written and are accepted: `POST /api/mosaic/observations/pages` is `observations:read` and
  acquires a side effect, and #99's prefetcher means one reviewer's navigation can enqueue up
  to three pages at once. A7's constant is what bounds it.

- **2026-09-09 · A5** — **Pad by 10% of the box on each side**, then expand to square, clamp,
  and resize. Answered by the human after F32: the stored box is *already* velocity-padded by
  the worker, so this is a second, deliberate application — modest rather than the 20% the
  spec recommended before that was known. 10% also hedges the legacy and hand-drawn boxes,
  which carry no velocity padding and would otherwise crop tighter than machine-written ones.
  **Output size is taken as the recommendation, 320 × 320 JPEG**, and is not something the
  human was asked to adjudicate — it is re-derivable (R10) and reversible. Say so and it is
  512.

- **2026-09-09 · A9** — **ffmpeg is a system binary, located through configuration.** Answered
  by the human, taking the recommendation. The API refuses to start the extractor, and reports
  why, when it is absent. Accepted cost: a new deployment prerequisite on the production VM
  and on every developer machine, and `marp doctor` should learn to check for it.

- **2026-09-09 · A1** — **Extraction runs in the API.** Answered by the human: *"for now, let's
  skip the idea of having the GPU do it. We might do that later."* So the recommendation
  stands, and worker-side extraction is explicitly deferred rather than rejected.

- **2026-09-09 · A4** — **The picture comes from the frame at the observation's own time, with
  the box interpolated between the two surrounding keyframes.** Answered by the human: *"we
  want to use a frame at the observation time even if it's not a key frame, because we can
  extrapolate where the frames are in between key frames."*
  **This is not one of the four candidates the assumption listed** — all four picked an
  existing keyframe, and the answer is to extract a frame that is not a keyframe at all and
  compute its box. The four are superseded, not chosen between.
  **The stated fallback:** *"if that's too hard at the moment, if we haven't got the code in
  there to linear extrapolate where it is, then just use the largest keyframe."* So the
  fallback is A4 option (iii), box area, and **not** option (iv) — which F33 has made
  unavailable anyway.
  F30 and F31 say what this costs: interpolation is the only path (0 of 6 have an exact
  keyframe) and it is always available (6 of 6 fall inside their span), so on machine-written
  data the fallback is dead code that still has to exist for legacy rows.
  **The second part of A4, answered 2026-09-09:** *"if it has more than one subset it should
  always be the subset first, subsets are labeled by number starting at 0."* So **the subset is
  chosen before the box, and nothing about the box can change it** — not bracketing, not area.
  An implementation that asked every subset and preferred whichever bracketed the counted
  frame was written first and has been removed: it let a picture come from a track nobody
  chose. `subset` is a `varchar`, so the labels are ordered **as numbers** — a string sort puts
  `"10"` before `"2"` — with a non-numeric label sorting after every numeric one rather than
  throwing.
  **Noted, not resolved:** the ingest defaults a machine-written keyframe's subset to `'1'`
  (`service/observation-ingest.service.js:760`, *"the '1' every reduction in the live script
  writes"*), while the human states the numbering starts at 0. Nothing in this phase depends
  on which is right — "the first subset" is well defined either way — but the two statements
  disagree and somebody should reconcile them.

- **2026-09-09** — The keyframe box values are **normalised**, fractions of the frame.
  Answered by the human. Not derived here.
- **2026-09-09** — The box is **centre-origin**, established from three independent
  consumers in two other repositories (F1). Recorded as a finding rather than an assumption
  because the GUI states it in a comment and then implements it in both directions. If it is
  ever promoted out of this spec it belongs in a decision record, because it constrains every
  future consumer of `keyframes`.

## The shape, written out so it can be reviewed concretely

Subject to every assumption above. Written out because a table sketch is easier to argue with
than a paragraph.

### `observation_thumbnails`

```
observation_thumbnail_id   serial       primary key
observation_id             integer      not null unique
                                        references observations (observation_id) on delete cascade
status                     varchar      not null  check (status in ('queued','ready','failed'))
permanent                  boolean      not null  default false
framenum                   integer                -- the frame it was cut from (R8)
subset                     varchar                -- which track, where an observation has more than one
filename                   varchar      unique    -- relative to storage/observation-thumbnails/
content_type               varchar
byte_size                  integer
width                      integer                -- of the thumbnail
height                     integer
source_width               integer                -- of the decoded frame (R6)
source_height              integer
generation                 integer      not null  default 1   -- bumped by a re-extraction; the ETag
attempts                   integer      not null  default 0
last_error                 text
requested_at               timestamptz            -- also the reclaim clock for a dead extraction (R18)
completed_at               timestamptz
"createdAt"                timestamptz  not null
"updatedAt"                timestamptz  not null
```

Indexes: the unique on `observation_id` serves the mosaic's left join; one partial index on
`status` where `status = 'queued'` serves the queue, which is the only scan this table takes.

**On R18 and the reclaim clock, said plainly:** a `requested_at` plus a timeout is a lease.
It is the smallest one that works, and it is deliberately not the GPU lease. **If it ever
grows past a timestamp and a timeout — attempts, heartbeats, workers — that is the signal
that the job system was the right answer after all**, and this design should be revisited
rather than grown into a second copy of one.

### The routes

```
GET  /api/observations/:observationId/thumbnail        observations:read    the bytes (R13)
POST /api/observations/thumbnails/retry                A10                  a page of ids (R14)
```

Both declared without the `/api/v2/` prefix and registered through `registerVersionedRoute`,
which derives the path and attaches `requirePermission`.

`POST …/retry` takes `{ observationIds: [...] }` and answers per observation — never by
position, the rule #106's R3 established — with each entry carrying the status it now has:
`queued` for accepted work, `failed` with `permanent: true` for what cannot be helped, and
`ready` for anything that arrived in the meantime.

### The mosaic row

One key added, moved into the exact-key list in `tests/mosaic-query.test.js`:

```
thumbnail_status       'queued' | 'ready' | 'failed'
```

produced by a left join and a coalesce over the absent case (A3).

## Plan

Each step small enough to verify, and none of it starts while a blocking assumption is open.

1. The migration: `observation_thumbnails`, its constraint, its two indexes, and a `down` that
   drops it. Wrapped in `db/data-integrity.js` like every other migration here.
2. The model, and the repository: create, claim, complete, fail, and the page-shaped read.
3. The extractor: resolve → decode one frame → crop → pad → resize → write → record. Behind a
   bounded concurrency and batched by video.
4. The serving route, its ETag and its 404-with-an-explanation.
5. The retry route, page-shaped.
6. The mosaic query's left join and the one new row key, plus the tripwire test moved.
7. `mosaic-commit`'s second `skipped` reason (R12).
8. `npm run docs:build`, because `docs/openapi.generated.json` and `docs/developer/` are
   tracked and a route change without them is a diff that lies.
9. The new suite added to a group in `scripts/test-subsystem.mjs` — `mosaic` — because
   `test:subsystems` runs in CI and a suite in no group is a suite no fast loop runs.

## Acceptance criteria

Observable, not aspirational.

- A reviewer opening a page of observations that have keyframes and a resolvable video sees
  pictures of the organisms, cropped, within the page's own load or shortly after it.
- A tile whose picture has not arrived says PREPARING and becomes a picture without the page
  reordering or the reviewer refreshing.
- A tile whose picture can never arrive says NO IMAGE and stays that way through a retry,
  instead of asking Jellyfin again.
- A reviewer can flag a tile that has no picture, and that flag is committed (F15).
- An unmarked tile with no picture is `skipped` with reason `no-imagery` rather than accepted
  blind (R12).
- Extracting a full page never opens more concurrent Jellyfin streams than the configured
  bound, and a person watching video through the player while a page loads is not starved.
- Deleting an observation removes its thumbnail row and its file.
- Deleting `storage/observation-thumbnails/` entirely loses no information that cannot be
  regenerated (R10).

## Test plan

Filled in properly at G3. What is already known about it, because it constrains the design:

- **CI builds an empty database.** Every test seeds the observation, the session, the project
  and the keyframes it needs. A test that borrows an existing row passes here and fails there.
- **Normalise line endings** before comparing file content to a template literal: ECMAScript
  normalises CRLF to LF inside a template literal and `readFileSync` does not.
- **The geometry is unit-testable with no video at all**, and it is the part most likely to be
  silently wrong (F1, F3, R6, R7). A pure function from
  `(x, y, width, height, source_width, source_height, padding)` to a clamped pixel rectangle,
  tested against the centre convention, against a box overhanging each of the four edges, and
  against the fixture's real values. **That test is the tier that can see the failure mode
  this phase is most exposed to**, and it costs a second to run.
- **The extraction itself needs the live Jellyfin** and belongs in the `media` group, which CI
  excludes by name. Run it locally before merging; CI going green will not tell you it broke.
- **A test that asserts a picture was produced must assert something about the picture** — its
  dimensions, and that its content is not the whole frame — not merely that a file exists. A
  crop that silently returned the entire frame would pass a file-exists check for ever.

### The throughput checklist — deferred, but not far

The database holds no observations and no keyframes today, so **correctness is verifiable now
and throughput is not.** Nothing here is benchmarked and no number is claimed. But this is a
short deferral rather than an open-ended one: F29 says the GPU environment works and a real
model is present, so the only thing between here and real keyframes is the Jellyfin address
the human is supplying. **Plan for this to be run, not filed.**

**The first real extraction is one specific run, and it should be treated as an event.** Take
the first video that produces observations, let the ingest write its keyframes, and then:

1. **Look at ten thumbnails before timing anything.** Does each one contain the animal, roughly
   centred, at a sensible size? This is the check that catches F1 being wrong, F2 having been
   broken by a `Stretch` change, and R6 having multiplied by the wrong dimensions — and it is
   the only check that catches them, because every one of those failures produces a valid JPEG
   of the wrong part of the seabed. **Do this before believing any number below.**
2. **Then record the table's rows in order**, on that same video, and write the values into
   `.marp/verification.md` verbatim including the ones that disappoint.
3. **Note which of A4's four keyframe choices you would have preferred**, having now seen real
   pictures. That question is much easier to answer with ten thumbnails in front of you than
   in the abstract, and it is the one assumption here that a picture settles better than an
   argument.

What to measure, and what value fails the phase — the pattern #99, #105 and #106 used:

| Measure | How | Fails the phase at |
| --- | --- | --- |
| Seconds per thumbnail, concurrency 1 | one video, 45 scattered frames, timed per frame | — (baseline) |
| Seconds per thumbnail, concurrency 3 | the same, batched by video (R17) | above ~2 s: a page of 45 takes over 30 s and page-scoped extraction cannot keep up with a reviewer |
| API p95 request latency during a full-page extraction | the mosaic page query, sampled while extracting | above roughly twice its idle p95: the extractor is on the wrong host |
| Concurrent Jellyfin streams observed during a page load | Jellyfin's own session view | above the configured bound (A7), ever |
| Player start-up time while a page extracts | the video player, by hand | any visible stutter: A7's number is too high |
| Mean thumbnail file size | over the first real corpus | informs A12; nothing fails on it |
| Fraction of legacy rows resolving to a video at or above the A8 threshold | count over a real project | informs whether A8's bar is right; a very low fraction means the bar or the approach needs revisiting |

## Status

- **Gate:** design — G1, waiting on the human.
- **Notes:** Ten blocking assumptions, which is more than the four #106 opened and about the
  eight #105 opened. That is proportionate rather than indecisive: #68 calls this the phase
  with no precedent to copy, and six of the ten (A1, A2, A4, A5, A8, A9) are questions where
  the two reasonable answers produce different schemas, different pictures or different
  machines. A1 is the one to answer first — everything else is written assuming its
  recommendation, and a different answer there rewrites the rate limit, the queue and half
  the plan.
- **Not done, deliberately:** nothing is implemented, no migration is written, no dependency
  is added, and nothing was benchmarked against an empty database.

## Findings left alone

Named per `AGENTS.md`, not fixed and not filed.

- **Two conventions for retiring a spec are both visible on `develop`, and they disagree.**
  `.marp/` holds `task-103-*`, `task-105-*` and `task-106-*` with their verifications — a
  spec renamed on the way in. Alongside them, `23c3922` *"Retire the observation ingest spec
  from develop"* and `4fadd5b` for the GPU orchestration spec **deleted** `.marp/task.md`
  instead, leaving the spec on its own branch. This branch follows the second: `.marp/task.md`
  is a single slot the gate reads, nothing was renamed, and the residue of the first
  convention is left untouched. Named because a reader of `.marp/` cannot tell which
  convention is current from the directory alone.
- **The umbrella's `CLAUDE.md` is stale about `marp-inference-worker`.** It records the
  checked-in virtualenv as broken and needing recreation against Python 3.12; the checkout at
  `Workspace/marp-inference-worker` has a working CUDA environment with torch 2.11 and
  ultralytics 8.4.90 (F29). That is a documented environment fact that went stale silently,
  which is the exact failure mode `AGENTS.md`'s *"point at the command; do not restate the
  value"* rule exists to prevent — and `marp harness check` does not catch this one, because
  it greps for hosts, ports and versions rather than for claims about whether something works.
  Not fixed here; it is the umbrella's file.
- **The local development database is named `mare_v1`** — the same name `AGENTS.md` reserves
  for production in its *never without the human present* list. Every query for this spec was
  read-only and against the local one, but the name collision means a careless copy of a
  connection string between machines is indistinguishable from the safe case by inspection.
- **`config/gpu-orchestration.js` has a stray double blank line** at the end of the
  `ENGINE_DATA_TYPES` block, before `TERMINAL_JOB_STATES`. Cosmetic; untouched.
- **`.env.example` documents Jellyfin credentials under four different variable prefixes** —
  `JELLYFIN_BASE_URL/USERNAME/PASSWORD`, `VIDEO_ENGINE_TEST_JELLYFIN_*`, and a commented
  `JELLYFIN_URL/USER/PASS`. Only the first is what the repository reads. Not this phase's to
  tidy, but an agent adding an extraction setting would have to guess which family to join.
