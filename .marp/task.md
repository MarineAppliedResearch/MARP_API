---
task: MarineAppliedResearch/MARP_API#268
repos: [marp-api]
status: design
needs: []
---

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

## Open assumptions

- [ ] **A1 · environment · blocking** — which branch is the base? The brief says
  `develop`, but `develop` does not carry `db/epoch-metrics.js`, the `epochs` loss /
  duration / offset columns, or `GET /training_run/:id/epochs` — those are on
  `104-dashboard-reads-marp`, 81 commits ahead and still moving, and it rewrote the three
  files this task edits. Asked 2026-10-26.
- [ ] **A2 · cross-repository · blocking** — can the worker send the confusion matrix as
  **numbers**, and in which orientation, with or without the background row/column?
  Ultralytics' own `matrix[i][j]` is predicted *i* / true *j*, the transpose of how a
  reader reads one. Storage shape depends on the answer, and getting the orientation
  wrong would be a confident lie rather than a gap. Asked 2026-10-26
  (`local_3689d8f0-ee48-4e59-854b-eca2ad1dbb23`). R5 is conditional on it.
- [ ] **A3 · cross-repository · blocking** — can per-class AP ride along keyed by **class
  name** rather than class index? `validator.metrics.box` has per-class `p`, `r`, `ap50`,
  `ap` with `ap_class_index`; an index without the vocabulary is unreadable here. Asked
  with A2. R3 and R4 depend on it.
- [ ] **A4 · environment · blocking** — this worktree has no `node_modules` and no `.env`,
  and the task forbids migrating 5432. Nothing can be run or verified until there is an
  install and a database of this task's own. Asked 2026-10-26.
- [ ] **A5 · scientific / data-meaning · non-blocking** — when a reported class name resolves to more
  than one species, or to none, R4 records it under the reported name with a null
  `species_id`. Confirming that is the wanted behaviour rather than a refusal. (#265
  resolves 11 of 11 for rockfish5 against `species.comname`, which is one dataset's good
  luck rather than a guarantee; `Red sea urchin` is already known to be on two lists.)
  Not blocking: recording more than MARP can resolve loses nothing either way.
- [ ] **A6 · database/schema · non-blocking** — `metrics_summary`'s eight `*_path` columns are left
  unwritten and commented as superseded rather than dropped. Dropping a published column
  on a scientific record is the human's call. Not blocking.

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

- **Gate:** design
- **Notes:** Survey done; the central question is answered above with its alternatives.
  Blocked on A1–A4 — two are the worker's answer, two are this workspace having an
  install and a database. Nothing is implemented.
