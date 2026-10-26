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
- [ ] **A4 · environment · non-blocking** — retagged 2026-10-26, because it was
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
- [ ] **A7 · product/UI · non-blocking** — `metrics.box.curves_results` carries the PR, P,
  R and F1 curves as numbers over ~1000 confidence points, and MARP's empty
  `metrics_curves` table is exactly that shape. It is **not** in this task's stated scope
  (the brief named `PR_curve.png`, the image) and 20 classes × 1000 points is 20k rows per
  run, which is a performance decision rather than an agent's. Asked the worker whether
  the door is open; raised with the managing session as a scope question. Deliberately not
  built, and `metrics_curves` stays empty.

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

- **Gate:** implementing
- **Notes:** A1–A3 answered; the design is settled and the worker has confirmed every
  piece of transport against Ultralytics 8.4.145 rather than from memory.

  **Not verified, and will not be until A4 is resolved.** This workspace has its
  dependencies but no database of its own, so no test in this branch has been run and
  none of the claims below have been executed. `agent.mjs adopt` refuses the worktree's
  directory name. Nothing here should be read as passing.

  `metrics_curves` is deliberately left empty (A7) — the curve numbers are available and
  out of this task's stated scope, which is a scope decision rather than an omission.
