# Build training datasets from the ML Dashboard

Issue: MarineAppliedResearch/MARP_API#268
Branch: `104-dashboard-reads-marp`
Related: #104 (the dashboard's design), #265 (registering a trained model), #120 (the
file server), `MarineAppliedResearch/marp-inference-worker#68` (the training half, merged)

## Goal

Build a training dataset out of MARP's own observations, from the ML Dashboard, ending in
an archive the API can already serve to a worker — and **record what it is made of**, which
is the part nothing has ever done.

`dataset_observations` holds 0 rows for 0 datasets. Every dataset in MARP today says how
many classes it has and nothing about which, and cannot say which observations it came
from. #265 works around that by resolving packaged class names against `species.comname`,
which happens to work for `rockfish5` and is not a design.

## Requirements

- **R1 — A build is a job, not a request.** `rockfish5` is 11,845 images and 4.9 GB;
  `CAMPA_STAR_TEST3` is 20 GB. A build gets a `gpu_jobs` row so it has progress somebody
  can watch, cancellation, retry, and a record of what it produced — and so the Jobs and
  History screens show it with no new rendering.
- **R2 — The API runs it, not a worker.** Settled by the human on 2026-10-20: *"It doesn't
  really make sense to be streaming the video over to a worker and then to re-download the
  entire thing when it can just be a background thread on the API."* `POST /gpu/poll` never
  offers `dataset_build` to a worker.
- **R3 — Membership is recorded.** Every observation that went in gets a
  `dataset_observations` row naming its split.
- **R4 — The vocabulary is recorded, in order.** A class index in a YOLO label file is
  meaningless without the ordered list it indexes. `datasets.num_classes` cannot carry it.
- **R5 — Frames come from the video, with YOLO labels.** A keyframe is a box at a frame
  number; the frames between two keyframes are interpolated and are trained on as well
  (settled 2026-10-20, and the reason `/mosaic/observations/frames` counts the span).
- **R6 — The archive is the shape `scripts/package-dataset.js` already produces**:
  `train/images`, `train/labels`, `eval/images`, `eval/labels` and a `data.yaml` carrying
  `names`, `nc`, `train: train/images`, `val: eval/images`. Content-addressed by SHA-256,
  recorded on `datasets.archive_path` / `archive_sha256` / `archive_bytes`.
- **R7 — No frame leaks across splits.** The Datasets screen states the rule: *"An
  observation or connected frame group keeps its first split assignment."* Two observations
  that share any frame are one group and go to one split.
- **R8 — A failed or cancelled build leaves nothing half-served.** The archive may be
  gigabytes by the time it fails. The dataset ends `failed`, with no `archive_*` set and no
  partial file left behind.

## Open assumptions

- [x] **A1 · architectural · blocking** — **Who executes a build.** Answered by the human
  2026-10-20: the API, as a background runner. Not a GPU worker, and the worker-side framing
  in #268 was the other agent's presupposition rather than his intent. A `gpu_jobs` row is
  still the record, because progress, cancel, retry and the dashboard already work on one.
- [x] **A2 · database/schema · blocking** — **Where the ordered vocabulary lives.** A new
  `dataset_classes` table: `dataset_id`, `class_index`, `species_id`. A table rather than a
  JSONB column because #265 needs to resolve a model's species *by join*, which is the whole
  reason the gap was noticed. Decided, not asked: `datasets` has no column that could carry
  an ordered list and inventing a delimited string in `notes` is the alternative.
- [x] **A3 · data-meaning · non-blocking** — **What `dataset_observations.inclusion_type`
  means.** Nothing has ever written the column, so there is no existing meaning to preserve
  and nothing downstream to break. Defined here as the split: `train` or `eval`.
  `selection_method` records how the observation was chosen, which for a dashboard build is
  the saved query.
- [ ] **A4 · product/UI · non-blocking** — **Whether a built dataset is immutable.** #104
  describes saved datasets as immutable with a fingerprint, and the archive is already
  content-addressed, so this implementation does not edit in place: a rebuild produces a new
  archive. Flagged rather than asked because nothing here depends on the answer; it matters
  the first time somebody wants to add observations to a dataset that exists.
- [ ] **A5 · performance · non-blocking** — **Extraction concurrency.** The thumbnail
  extractor has a measured ceiling that exists to protect Jellyfin (`task-118`, R20). A
  build is a second consumer of the same media server and should share that ceiling rather
  than set its own. Not blocking: one build at a time, inside the existing limit, is
  correct and is what this implements.
- [ ] **A6 · environment · non-blocking** — **Eviction.** Built archives accumulate on the
  API host and nothing removes them. Same shape as #65 for job workspaces. Out of scope
  here, and named so it is not mistaken for finished.

## Decisions

- **2026-10-20 · A `gpu_jobs` row for work no GPU touches.** The table is named for its
  first use, not its only one. What a build needs — a queue, a state machine, attempts,
  progress, cancel, and a row the Jobs screen can draw — is exactly what `gpu_jobs` is, and
  the alternative was a second table carrying all of it again plus new rendering.
  `dataset_build` is excluded from what `poll` offers, the way `INGESTIBLE_JOB_KINDS`
  already subsets kinds for a different reason.
- **2026-10-20 · The build reuses `service/thumbnail-extraction.service.js`.** It already
  cuts a set of frames from one video in a single ffmpeg pass, already talks to Jellyfin,
  and already interpolates a box between two keyframes. #268 predicted a dataset build
  would be a second consumer of that capability; it is.

## Plan

1. Migration: `dataset_classes`, and `dataset_build` accepted as a job kind.
2. `repository/dataset-build.repository.js` — selection, membership, vocabulary.
3. `service/dataset-build.service.js` — the runner: select, extract, label, split, package.
4. Route: queue a build from a saved query; the existing job routes do the rest.
5. The Datasets screen's *Queue dataset build* button calls it.

## Acceptance criteria

- A build queued from the dashboard produces an archive `GET /gpu/datasets/:id/archive`
  serves, which the worker's existing verification accepts.
- `dataset_observations` has one row per included observation, naming its split.
- `dataset_classes` gives the ordered vocabulary, and its order matches `data.yaml`'s
  `names`.
- Two observations sharing a frame are in the same split, always.
- A cancelled build leaves `status = 'failed'`, no `archive_*`, and no partial file.

## Test plan

Written in full at G3, before anything is run. Tiers that can see this: the repository and
service against a seeded database (fast), and one end-to-end build over a short real video.

## Status

G1 — spec written, A1 and A2 settled. Not yet implemented.

---

# 1.2 — Progress on the Datasets screen

Issue: MarineAppliedResearch/MARP_API#268, planning comment of 2026-10-21, item 1.2.
Branch: `claude/268-dataset-build-progress-261a94`, cut from `104-dashboard-reads-marp`.

## Goal

A build's progress is only on the Jobs screen. The Datasets screen — the one place somebody
watching a four-hour build actually looks — shows `—` in FRAMES for a build in flight, and
draws its *Building now* and *Queued builds* cards from six fixture rows typed into
`screens.js`. Join each building dataset to its `dataset_build` job and show what it is doing.

## Requirements

- **P1 — A building row says frames done against total.** `42,816 / 63,200`, from the
  latest attempt's `progress_done` / `progress_total`, not a percentage alone.
- **P2 — And the phase.** `selecting`, `extracting`, `packaging` — because a build sits at
  `0` for minutes during `selecting`, and a reader who sees `0 / 0` with no phase concludes
  it is stuck.
- **P3 — Queued is distinct from building.** `datasets.status` is `building` from the
  instant the build is queued, so the dataset alone cannot say whether anything has started.
  The job's state can: `queued` draws *Queued*, `leased` draws the phase.
- **P4 — Poll while anything is building, and stop when nothing is.** No timer running on a
  screen with nothing in flight.
- **P5 — The cards and the donut count what MARP holds**, not fixtures. The six fixture
  build rows in `screens.js` go; they would otherwise sit above the real rows showing invented
  progress, and the cards would count them.
- **P6 — Nothing invented.** A build's elapsed time is derivable and is shown; its archive
  size so far, its fingerprint and a remaining-time estimate are not recorded anywhere and
  say so, the way every other unbacked field on this screen does.

## The join, and what was rejected

**`GET /api/v2/dataset/builds`** — one request, every `dataset_build` job that is `queued`
or `leased`, with its latest attempt's progress, at most one row per dataset.

Three reasons it is a route of its own rather than a field on the dataset:

1. **`Dataset`'s schema is generated from the Sequelize model.** `docs/openapi.js` derives
   it in `GENERATED_SCHEMAS`, so a `build` object hung on the row is a field the published
   contract cannot describe without a hand-maintained parallel schema — a document that
   promises to stay in sync with code it cannot observe, which `AGENTS.md` names by name.
2. **Progress is not a property of a dataset.** It belongs to the latest attempt of the job
   building it. What the dataset itself records is `status`, and `num_samples` once the
   build finishes.
3. **Polling.** `GET /api/v2/dataset` is unpaged and grows without bound; polling it every
   few seconds to watch one row move re-fetches every saved dataset. This route answers
   only about work in flight, and answers `[]` — at which point the screen stops polling.

**Rejected — a `build` field on `GET /api/v2/dataset`.** One request rather than two, and
the completion transition (`status` → `ready`, `num_samples` filled) would arrive in the
same payload as the last progress report. Rejected for 1 and 3 above.

**Rejected — asking the existing jobs route.** `GET /api/v2/gpu/jobs` carries no progress
at all: it is on the attempt, and only `GET /api/v2/gpu/jobs/:id` returns attempts. That is
one detail request per building row, which is the request-per-row-to-draw-one-page this app
rejected on the Models screen for the same reason.

## Open assumptions

- [x] **P-A1 · product/UI · non-blocking** — **The Status pill shows the phase while a
  build runs**, rather than a generic *Building* with the phase elsewhere. The filter still
  keys on `building`, so filtering is unchanged. Taken because the pill is the row's one
  piece of prose and *Extracting* is strictly more useful there than *Building*.
- [x] **P-A2 · product/UI · non-blocking** — **Five seconds between polls.** Progress is
  reported once per video, and a video is minutes; a faster poll would redraw a table that
  has not changed.

## Acceptance criteria

- A dataset whose build is `leased` shows `done / total` and the phase; one whose build is
  `queued` shows neither and says *Queued*.
- With nothing building, no timer is running and the cards read nothing building / nothing
  waiting.
- `node frontend/apps/ml-dashboard/tools/markup-check.mjs` reports no more than the 129 it
  reported before.

## Status

G1 — written, both assumptions answered as non-blocking.
