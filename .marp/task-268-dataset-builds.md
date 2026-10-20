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
