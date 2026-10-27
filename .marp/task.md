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

---

# YOLO's training output: the confusion matrix, per-class AP and the plots

Issue: MarineAppliedResearch/MARP_API#268, the training half.
Branch: `268-yolo-training-output`, stacked on `104-dashboard-reads-marp`.
Cross-repository: `marp-inference-worker` emits the two artifacts this reads.

## Goal

A person looking at a finished training run in the ML Dashboard can see everything YOLO
itself produced about it: the confusion matrix, per-class precision/recall/AP, and the
curve and sample images Ultralytics writes to every run directory — the PR, F1, P and R
curves, the label distribution and correlogram, and the validation prediction samples.
None of it is computed by MARP. All of it is carried from the worker, stored, and served.
Where MARP has nothing, the screen shows a gap rather than a number.

## Requirements

- **R1** — Every file a training attempt hands over is stored by content, addressable,
  and identifiable by what it is rather than being an anonymous `result`.
- **R2** — A training run's files can be listed and fetched by a browser through the API,
  including a file type MARP has never seen before.
- **R3** — Per-class quality — precision, recall, F1, AP50, AP50-95 — is recorded per
  class per split, and the all-classes aggregate is distinguishable from a per-class row.
- **R4** — A class the model reported that MARP cannot resolve to a species is recorded
  under the name the model used, not dropped and not merged into the aggregate.
- **R5** — The confusion matrix is stored as numbers as well as the rendered image, with
  its class order and its orientation recorded, so it can be read, compared and
  re-bucketed rather than only looked at. *(Conditional on A2.)*
- **R6** — Nothing is synthesised. A run that reported no confusion matrix and no
  per-class metrics serves nothing, and an absent measurement is served as null, never
  as zero.
- **R7** — `results.csv` is stored as the file the trainer wrote and does not produce a
  second set of epoch rows; `epochs` stays fed by the live metric events.
- **R8** — The record says which task's vocabulary a metric row is in, so a future
  classification or segmentation run is not misread as a detection run that failed to
  measure its mAP.
- **R9** — Precision, recall and F1 are stored at every confidence threshold the trainer
  evaluated, per class, so the PR curve can be drawn from numbers rather than only looked
  at as a white-background image.

## Open assumptions

- [x] **A1 · environment · blocking** — answered 2026-10-26: branch from
  `104-dashboard-reads-marp`, not `develop`. The brief was wrong, and it also matches a
  standing rule — **one branch per repository per work stream**, open until the stream is
  finished. `develop` carries neither `db/epoch-metrics.js` nor the epoch loss/duration/
  offset columns, so building on it would have reproduced the stale-ingest defect this
  stream just spent a day fixing. Rebased onto `55e82e82`.
- [x] **A2 · cross-repository · blocking** — answered 2026-10-26 by the worker session,
  read off Ultralytics 8.4.145 rather than recalled. Yes to numbers.
  `trainer.validator.confusion_matrix.matrix` is `(nc+1)²` for detect/segment/obb and
  `nc²` for classify/semantic. `metrics.py:400` is `self.matrix[p][t] += 1`, so **row =
  predicted, column = true** — the transpose of how a reader reads one, as suspected.
  Background is index `nc` on both axes: `matrix[nc][j]` is false negatives of true class
  *j*, `matrix[i][nc]` is false positives of predicted class *i*, and `matrix[nc][nc]` is
  never incremented. It travels self-describing, with its own `orientation` string. R5
  stands.
- [x] **A3 · cross-repository · blocking** — answered 2026-10-26: yes, per-class AP keyed
  by class name is a zip of `ap_class_index` against `names` and trivial on the worker's
  side. **With one gap that changes R4: `ap_class_index` contains only classes that
  appeared in the validation set.** A class with no validation instances gets no row at
  all, so a missing class means *never evaluated*, not *scored zero* — and on a species
  list where the rare classes are the point, conflating those is the worst available
  error. R3 and R4 stand, with D6 below.
- [x] **A4 · environment · non-blocking** — answered 2026-10-26: resolved, and it was never Isaac's to resolve. Retagged, because it was
  mis-tagged: whether this workspace has a database is an environment prerequisite, not a
  question whose different answer changes the behaviour, schema, interface or data. It is
  **still open and still real**: `npm ci` is done, but `agent.mjs adopt` refuses this
  worktree (`yolo-training-output-f030ed` does not start with a registry directory name,
  so it cannot tell which repository it is — the directory was made by the desktop app,
  not by the harness). Reported rather than improvised around. **Nothing here is verified
  until it is resolved**, and that limit is stated again under Status rather than left to
  be inferred from a green-looking spec.
- [ ] **A5 · scientific / data-meaning · non-blocking** — when a reported class name resolves to more
  than one species, or to none, R4 records it under the reported name with a null
  `species_id`. Confirming that is the wanted behaviour rather than a refusal. (#265
  resolves 11 of 11 for rockfish5 against `species.comname`, which is one dataset's good
  luck rather than a guarantee; `Red sea urchin` is already known to be on two lists.)
  Not blocking: recording more than MARP can resolve loses nothing either way.
- [ ] **A6 · database/schema · non-blocking** — `metrics_summary`'s eight `*_path` columns are left
  unwritten and commented as superseded rather than dropped. Dropping a published column
  on a scientific record is the human's call. Not blocking.
- [x] **A7 · product/UI · non-blocking** — answered 2026-10-26: **in scope, build it.**
  `metrics_curves` existing, empty and shaped exactly for per-threshold precision, recall
  and F1 is the table for this rather than a coincidence to work around, and an
  interactive curve beats a white-background PNG that cannot be read on a dark page. Two
  conditions attached: the image is kept as well, and the **real** row count and byte size
  are reported once measured rather than estimated — if it is far worse than ~20k rows
  the work stops and it becomes Isaac's call. Cheap on the worker's side: one property
  access, no computation.
- [x] **A8 · scientific / data-meaning · non-blocking** — answered 2026-10-27: **columns,
  not `details`.** A classification run writes one aggregate row with detection's metric
  columns null and its accuracies in `accuracy_top1` / `accuracy_top5`.
  `ClassifyMetrics` has no per-class array and no precision, recall or AP at all, so it
  cannot fill these columns; the rule is recorded and **nothing is built for it**, since
  this engine declares detection. Confirm the shape when classification is actually the
  task rather than designing it now against a model nobody has trained.

## Decisions

- **2026-10-26 · the plots do not go in `metrics_summary`'s path columns.** They go in
  `artifacts`, content-addressed, served by a new read route. Three reasons, in order of
  force. Ultralytics writes three `val_batch*_pred.jpg` files and there is **no column
  for any of them**, so a closed set of eight columns is structurally the wrong shape for
  an open set of files — it can only drop what it has no column for, and the frontend has
  asked for an open array keyed by the real filename stem precisely so an unanticipated
  plot appears instead of disappearing. A path is not a hash, and
  `ml_models.artifact_sha256` (2026-10-23) is this platform having already decided that
  immutable bytes are addressed by content; a second pathing scheme beside the weights'
  would be exactly the drift that decision avoided. And `artifacts`' own table comment
  already claims this job — "files and outputs produced during a training run, including
  weights, logs, and result visualizations".

  The alternatives considered and rejected: writing the eight columns (cannot hold the
  prediction samples, cannot hold an unknown plot); a new `training_run_plots` table
  (a second copy of `artifacts` with nothing to justify it).

- **2026-10-26 · the numbers do go in `metrics_summary`, plus two columns.** The catch
  the handoff note named is real — `map50`, `map5095`, `box_*` are detection's
  vocabulary and classification and segmentation are the next two tasks — but it is
  narrower than it looks: **`precision`, `recall`, `f1_score` and `fitness` are
  task-neutral; all three tasks report them.** Only the two mAP columns are not. And
  Ultralytics hands over the discriminator itself — `(B)` for box, `(M)` for mask, the
  same four metric names otherwise — so a segmentation run does not need new metric
  columns at all. It needs a second *row*.

  So: add **`metric_family`** (`box` | `mask` | `classify`) and **`class_name`**.
  Detection writes `box`. Segmentation will write a `box` row and a `mask` row per class,
  using the same four columns, because that is literally what it reports. Classification
  will write `classify`, leave the two mAP columns null, and carry top-1/top-5 in
  `details` until there is real data to justify columns for them.

  `metric_family` is not decoration. Without it, a classification row with a null `map50`
  is indistinguishable from a detection row that failed to measure one — the same
  "a gap that reads as a measurement" failure this stream has already fixed once, in a
  new place. `class_name` exists because `species_id` is nullable and already means "the
  all-classes aggregate"; an unresolved class landing as a second kind of null would make
  the aggregate ambiguous. With both columns: `class_name` null is the aggregate,
  `class_name` set with `species_id` null is a class MARP could not resolve, and that is
  a fact worth keeping.

  One migration today, none for segmentation, a small one or none for classification.
  Rejected: new per-task tables (speculative, for tasks nobody has trained, and #68's
  history is a record of what building to a line nobody decided costs); a metric
  name/value row shape (survives anything, but discards columns that already exist and
  are already right for the only task being trained, and makes every read a pivot).

- **2026-10-26 · `results.csv` is a file, not a second ingest.** `epochs` is fed from the
  live metric events, which is what makes a chart move while a run is going. The CSV is
  kept because it is what the trainer wrote; it is not re-read into epoch rows.

- **2026-10-26 · the existing hand-off is reused rather than extended.** Artifacts already
  reach `artifacts` rows with their sha256, size and content type through
  `POST /api/v2/gpu/artifacts/check` and `/upload/:sha256` — `recordJobArtifacts` runs for
  every attempt whatever the job kind, and `role` is validated as a non-empty string with
  no allow-list to extend. So no new event kind and no new upload route. The link to the
  run is the existing `training_runs.job_id` join (`20261020120000`), so
  `artifacts.training_run_id` staying null needs no backfill.

- **2026-10-26 · the numbers arrive as one JSON artifact, not as events.** The worker's
  recommendation, taken. A matrix is not a metric scalar and does not belong in the
  per-epoch stream; one self-describing file published at `on_train_end` is a single
  round trip and scales to a hundred classes without bloating an event. Role
  `final_metrics`, carrying the class vocabulary once, the confusion matrix with its own
  `orientation` string, and a metrics block per family with `overall` and `per_class`.
  Six fields were added to the worker's sketch, each because the alternative was MARP
  deriving a number: the family stated rather than inferred from the `(B)`/`(M)` suffix;
  `overall` explicitly, because mAP50 over all classes is not the mean of the per-class
  AP50s when support differs; `f1` from Ultralytics, because its `metrics.box.f1` is
  taken at the max-F1 confidence and is **not** `2PR/(P+R)` of the reported P and R, so a
  derived F1 would look like YOLO's and not be it; the split stated rather than assumed
  to be `val`; the task, which is what says whether a background index should exist at
  all; and a schema version, so a later change is detectable rather than silent.

- **2026-10-26 · the confusion matrix gets its own small table, and that is the one new
  table.** It has no home in `metrics_summary`: it is an N² measurement per run per
  split, not a scalar per class, and a `confusion_matrix jsonb` column would be
  meaningful on one row in N and null on the rest. Putting it in `details` would make a
  documented structure undocumented. Rejected also: serving the stored JSON artifact
  directly and keeping no column — tempting at zero schema cost, but it would make the
  worker's wire format MARP's public API contract, which is the one thing the API layer
  exists to prevent, and nothing could then be queried across runs.

  **Stored verbatim, in the trainer's own orientation, with the `orientation` string
  beside it.** Transposed once at the serving boundary, in a named function with a test,
  because the reader-facing contract is rows=true/cols=predicted and the trainer's array
  is the transpose. Storing it rotated would mean that if the worker ever changes
  orientation, everything already stored becomes a silent lie; storing it as sent with
  its own label means it stays interpretable either way.

- **2026-10-26 · a class the validator did not evaluate gets no row.** Not a row of
  zeros, not a row of nulls. `ap_class_index` omits any class with no validation
  instances (A3), so absence there means *never evaluated* — and a row of nulls would
  claim MARP looked and found nothing. The dashboard renders what it is given.

- **2026-10-26 · there is no backfill, and that is a fact about the world rather than a
  choice.** A job workspace is removed once MARP has the result (#65), and the worker
  confirmed nothing survives under `state/jobs` from the runs this machine has already
  done. Anything not published inside the attempt is gone permanently. So every training
  run completed before this lands has no confusion matrix, no per-class AP and no plots,
  and never will. A **stopped** run likewise produces none of it: the engine unwinds out
  of `model.train()` by exception, so `final_eval()` and `on_train_end` never execute.
  Both are absence, and neither is an error.

- **2026-10-26 · five corrections from the worker, read out of the library rather than
  recalled, and one of them was mine to own.**

  **I was wrong about F1.** I had written that deriving per-class F1 from the reported
  precision and recall would give a different number from Ultralytics'. It would not:
  `p`, `r` and `f1` are all sliced at the same index, so `f1[c]` is exactly
  `2·p[c]·r[c]/(p[c]+r[c])` for the very values being reported. The real subtlety is
  more useful and is now in the column comment and the route description: **that index
  is chosen to maximise F1 averaged across classes**, so every class is reported at one
  shared confidence threshold and a class whose own optimum lies elsewhere is reported
  off its peak. Comparing two classes here compares them at one operating point.

  **The segmentation family is `seg`, not `mask`.** `SegmentMetrics.seg` is the library's
  own attribute; `(M)` is only the metric-key suffix, which is where the wrong guess came
  from. Settled before either side built anything, because a string two halves disagree
  about is a silent bug six weeks later.

  **`fitness` is `map5095` exactly**, under weights `[0, 0, 0, 1]` in 8.4.145, so those
  two columns will always agree. Both kept, with the reason in the column comment:
  fitness is a different concept — what checkpoints are ranked by — and the weights are
  Ultralytics' to change, so a history holding only one could not be read afterwards.

  **There is no overall F1**, and the aggregate row's `f1_score` stays null.
  `mean_results()` returns `[mp, mr, map50, map]` and nothing else. `2·mp·mr/(mp+mr)` is
  a mean of ratios rather than a ratio of means — a third quantity the trainer never
  computes, which would sit in a column whose other rows hold a real measurement.

  **"Overall" means over the classes that were evaluated**, not over the species list:
  `mp` and `mr` are means over the arrays indexed by `ap_class_index`. A vocabulary whose
  rare classes never appeared in validation has an aggregate that does not describe it.

- **2026-10-26 · the curves are a second artifact, and the trainer's PR curve is not
  stored.** Separate role `metrics_curves` on the worker's advice: a consumer wanting
  only the headline numbers should not parse a megabyte to skip one. The three
  confidence-indexed curves share one x axis, so one row holds a class's precision,
  recall and F1 at a single threshold — a third of the rows for the same measurements.

  Ultralytics' fourth curve interpolates precision onto a fixed **recall** grid, and
  `metrics_curves.confidence_threshold` is NOT NULL and means confidence. Writing a
  recall value into it would make every row of that table unreadable without knowing
  which curve it came from — a column meaning two things, which is the defect this
  project keeps having to undo. Nothing is lost: a PR curve is the stored precision
  plotted against the stored recall, which is two measurements against each other rather
  than a derivation, and the rendering is kept as an image.

- **2026-10-26 · `support` and `image_count` are columns, and the worker resolves them
  rather than MARP joining them.** Without them the per-class metrics cannot be judged: a
  precision of 1.0 over three instances and over three thousand are not the same claim,
  and on a species list whose rare classes are the whole point that is the difference
  between a useful number and a misleading one. `image_count` is the second question —
  142 instances across 37 frames is a different survey from 142 across 140, which on
  transect video separates a shoal from a scatter.

  **The reason they arrive pre-attached is a trap the worker found and absorbed.**
  Ultralytics indexes `nt_per_class` by *class id* while the per-class metrics beside it
  are indexed by *evaluated position*, and its own validator reads both in one loop. They
  agree only while every class was evaluated. So zipping a raw top-level array against
  the metrics would silently attribute one species' instance count to another precisely
  when the evaluated set is smaller than the vocabulary — the rare-species case — and it
  would not throw. They come keyed by class name instead, and nothing on this side ever
  touches that dual index. Written into the column comments as well as here, because the
  obvious future "simplification" is to take the array.

- **2026-10-26 · a flat row of zeros in a curve is a measurement and is stored.** A class
  with labels but no predictions leaves its precision and recall at zero across every
  threshold. That is correct — nothing was predicted, so recall really is zero everywhere
  — and the array is full length, so it does not trip the short-curve refusal and must
  not. Discarding it would throw away the record of a class the model missed completely,
  which is among the more important things a reader can learn. The general rule in this
  work is that a gap must not read as a zero; this is the one place the converse needed
  saying, and it has its own test.

- **2026-10-26 · three curves, not four, and the worker confirmed why from the source.**
  `self.px` does double duty: `r_curve` and `p_curve` interpolate against confidence,
  while `prec_values` interpolates against recall, and `curves_results` labels them
  honestly ("Recall" on the first, "Confidence" on the other three). So a `prec_values`
  row in `confidence_threshold` would record a recall as a confidence. Curve rows are
  also indexed by evaluated class, not by the vocabulary — the same order as
  `ap_class_index` — and everything here matches by name, so the two cannot drift.

- **2026-10-27 · the confusion matrix carries its own class list, and there is no shared
  one.** The worker caught this before either side shipped, and it is the same shape as
  the `nt_per_class` trap: **`ConfusionMatrix.names` is the model's FULL vocabulary while
  `ap_class_index` is the evaluated classes only**, and the two differ exactly when a
  species had no instances in the validation split. A single top-level `classes` array
  made those look like one list. Labelling the matrix axes from the evaluated list would
  shift every label from the missing species onward and attribute confusions to the wrong
  animal — silently, and only in the rare-species case these metrics exist to serve.

  So each array is labelled where it is used: `confusion_matrix.classes` (vocabulary,
  axis labels), `per_class` rows which name themselves, and the curves artifact's own
  `classes` (evaluated, parallel to its arrays). The top-level list is gone.
  `background_index` is now exactly `classes.length`, which makes it checkable rather
  than taken on trust, and absent rather than null for classification.

  **What the old code would have done is worth recording**: the length check refused the
  matrix outright rather than mislabelling it, because the vocabulary no longer accounted
  for every index. A silent gap rather than a silent lie — better, and still wrong.

- **2026-10-27 · top-1 and top-5 are columns, and they are floats.** `details` jsonb
  would have been right for something incidental; for a classification model these two
  *are* the headline, the way mAP is for detection. The dashboard exists so models can be
  compared, and a number that cannot be sorted on, filtered by or charted across runs is
  not available for comparison — only for reading one run at a time.

  **They are `double precision`, not integers.** They are accuracies — fractions in
  [0, 1] — not counts. `support` and `image_count` are this table's integers; storing
  0.873 in an integer column would round it to 1 and report a perfect classifier.

  **A second migration rather than an edit to the first.** `20261026160000` has been
  applied — only to a disposable workspace database, but applied — and Sequelize records
  a migration by name once it has run. Amending it would leave any database that already
  holds it silently without these columns, which surfaces later as a column that exists
  on one machine and not another with nothing to explain it.

## Plan

1. Settle A1–A4. Nothing below starts while A1 and A4 are open.
2. Migration: `metrics_summary` gains `metric_family` and `class_name`, both nullable,
   both commented. Confusion-matrix storage added per A2's answer.
3. A shared mapping module for the final-metrics names, beside `db/epoch-metrics.js` and
   for the same reason — one copy, because two would drift.
4. Ingest: read the worker's end-of-run report into `metrics_summary` rows and the
   confusion matrix, inside the existing result transaction.
5. Role convention for the handed-over files, keyed off the real filename stem.
6. Read routes on the training run: its metrics, its confusion matrix, its artifact list,
   and one serving an artifact's bytes. `permission: 'models:read'`, following
   `/training_run/:id/epochs`.
7. Decision record for the two decisions above, since both constrain what classification
   and segmentation do next.

## Acceptance criteria

- A training attempt that hands over the eleven Ultralytics files produces eleven
  `artifacts` rows with distinguishable roles, and the dashboard can list and fetch every
  one of them, including one whose stem this code has never seen.
- Per-class rows exist for each class the run reported, the aggregate is tellable from
  them, and a class MARP cannot resolve is present under its reported name.
- A run that reported no confusion matrix serves no confusion matrix, and the endpoint
  says nothing rather than zero.
- No metric column is written from a value MARP computed.
- Every fixture in the new tests is built from a real stored event payload, not from this
  document.

## Test plan

Filled at G3.

## Status

- **Gate:** done — merged, and confirmed against a real run on the live server.
- **Notes:** Merged into `104-dashboard-reads-marp`; the server has run on it since
  2026-10-27 11:30. **Job 21787 is the first real artifact run and the whole chain
  worked**: 20 artifacts handed over, 2 `metrics_summary` rows, 1 confusion matrix,
  1,000 curve rows, the one class resolved to a species with none unresolved.

  **The orientation is proved by arithmetic rather than by reading the source.** The
  served matrix's first row sums to 710, exactly the `support` on the per-class row
  beside it; transposed it would sum to 922 and contradict its own response. That is the
  one thing no fixture could ever have settled.

  **The open set earned its keep on the first run.** Four plot stems are `Box`-prefixed
  (`BoxPR_curve`, `BoxF1_curve`, `BoxP_curve`, `BoxR_curve`) and four more arrived that
  nobody had named — 20 files, not the 12 documented. A closed allow-list would have
  dropped eight of them silently.

  **Measured on real output:** ~1,000 curve rows, ~91 kB stored and ~0.029 MB served per
  class. The row count matched the synthetic estimate exactly; the wire size did not, and
  the served form is smaller than either.

  **Getting there cost two mistakes worth keeping.** The endpoint suite failed 19 of 19
  on its first execution and all three causes were fixture faults, not code — a test
  nobody has run is a draft. And resolving a rebase with `git add -A` staged the whole
  working tree at every step, reverting 645 lines of another session's work and deleting
  a test file; it would have read as a deliberate revert with no conflict to warn anyone.
  The check that now runs after every rebase is any file where this branch *deletes*
  stream lines.

  **Left undone deliberately, and not ours:** every artifact is served
  `application/octet-stream`, including a file whose first bytes are a PNG signature. The
  upload route records what the uploader declares and documents that it does, so the
  `Content-Type` is the worker's to set. Reported, not worked around.

  **Still unproved:** no classification run has happened, so `classify`, `accuracy_top1`
  and `accuracy_top5` are exercised only against fixtures; and this run was single-class,
  so the unresolved-class path and a second metric family have not met real data.
