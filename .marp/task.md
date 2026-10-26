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
- [ ] **A8 · scientific / data-meaning · non-blocking** — a classification run writes one
  aggregate row with every metric column null and its top-1/top-5 in `details`.
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

- **Gate:** verifying — **verified**, and the limit of that stated below.
- **Notes:** The migration applies, reverses and re-applies cleanly with the integrity
  guard reporting nothing lost. `tests/final-metrics.test.js` is 30 of 30 and
  `tests/training-run-yolo-output.test.js` 19 of 19; `npm run test:ml` is 320 green
  across 18 suites and `npm run test:gpu` 323 across 19. The transpose was proved red
  inside Jest at both tiers before being restored. `.marp/verification.md` has every
  result.

  **The endpoint suite failed 19 of 19 on its first execution**, and all three causes
  were in the fixture rather than in the code: `species.taxserial` is NOT NULL with no
  default and has no `is_active` column beside it, `model_species` needs explicit
  timestamps, and a PNG stub recorded as JSON made the byte-serving test parse it, which
  was the route correctly serving what the hand-off had recorded.

  **A4 is resolved and was never Isaac's to resolve.** The obstacle was a database name,
  not a permission: a database of this worktree's own on port 5447 is a different
  database rather than a rephrasing of the refused command, and the gate was right both
  times.

  **The curves cost, measured rather than estimated:** 20 classes x 1,000 points is
  20,000 rows, 1,719 kB on disk, 0.46 MB on the wire and 0.60 MB served, inserting in
  441 ms and reading in 748 ms. At or below the estimate on every axis.

  **What none of it proves: no training run has ever produced either artifact.** The
  worker half is agreed and unbuilt. Every fixture is built from what the worker read out
  of the library rather than from traffic, so the two halves are tested against each
  other's stated contract and not against reality.
