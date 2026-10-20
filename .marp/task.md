---
task: MarineAppliedResearch/MARP_API#265
repos: [MARP_API]
status: design
needs: []
---

## Goal

A finished training run produces a model MARP can then run inference with. Today it
produces a 136 MB file recorded as an artifact against a job, and nothing else: the pool
can train a model and cannot use one. Somebody wanting to run the thing they just trained
has no row to name in a job spec. When this is done, a run that succeeds ends with an
`ml_models` row, its species, and bytes an inference job can fetch.

## Requirements

- **R1** — A successful training job registers an `ml_models` row pointing at the weights
  it published, with the model it started from recorded as its parent.
- **R2** — The registered model is fetchable by a worker through the same route an
  inference job already uses to get its weights. A row naming bytes nobody can fetch is
  the state we are leaving, not arriving at.
- **R3** — The model records which species it was trained on, as `model_species` rows,
  resolved from the class names the dataset was packaged with. A name that resolves to
  no species, or to more than one, fails the registration loudly rather than quietly
  registering a model with a hole in its vocabulary.
  The tracking engine refuses weights whose vocabulary disagrees with what MARP registered
  for them, so a model with no species is a model that cannot be run.
- **R4** — A failed or cancelled training job registers nothing. A model that exists
  because a run crashed is worse than no model.
- **R5** — Registering twice is not possible. A job that publishes, is re-ingested, or is
  reported again produces one model, not two.
- **R6** — Nothing about an existing model changes. Inference jobs naming a model
  registered by hand keep working exactly as they do.

## Open assumptions

- [x] **A1 · product · blocking** — answered 2026-10-20: MARP composes the name. Proposed
      shape `<dataset>-<date>`, e.g. `rockfish5-2026-10-20`, with a suffix when that is
      already taken. Isaac raised letting a person nickname it from the dashboard later;
      that is a separate piece of work and not in this issue.
- [x] **A2 · architectural · blocking** — answered 2026-10-20: the bytes go where the API
      already serves model files from — `MODEL_STORAGE_ROOT`, which the existing
      `/api/v2/model/:id/artifact` route resolves. So registration copies the published
      artifact into the model store and `storage_path` names it there. The duplicate 136 MB
      is accepted deliberately: it keeps one serving path rather than two, and the file
      server in #120 is what later takes both over.
- [x] **A3 · scientific · blocking** — answered 2026-10-20, **and the assumed route does
      not work.** The design is `datasets` → `dataset_observations` → `observations` →
      species, and that join is correct in the schema. It is also empty:
      `dataset_observations` holds **0 rows for 0 datasets**. Nothing has ever written to
      it — the legacy builder's code for it is commented out in
      `model_training_live.py`. So it cannot be the source today, for rockfish5 or for
      anything else.

      What does work, checked against the catalogue: the class names in the archive's
      `data.yaml` resolve against `species.comname` **11 of 11 exactly, with no
      ambiguity**, for rockfish5. So the dataset records the class names it was packaged
      with, and registration resolves those to species ids.

      This adds `datasets.class_names`; `scripts/package-dataset.js` already parses the
      names out of the YAML, so recording them is nearly free. Populating
      `dataset_observations` properly belongs with dataset *building*, which is a
      different piece of work.
- [x] **A4 · product · blocking** — answered 2026-10-20: a freshly trained model is usable
      immediately, so it registers with an active status and can be named by an inference
      job at once. **`preferred` is read narrowly and left alone**: it decides which model
      is picked by default, and a new model quietly becoming the default would change what
      the next job runs before anybody had looked at it. Say so if that reading is wrong.
- [ ] **A5 · behavioural · non-blocking** — Should the metrics from the final validation
      land on `model_species` (`precision_mean`, `recall_mean`, `f1_mean`) or only on
      `metrics_summary`? Both exist and the columns are per species, which the per-class
      table Ultralytics prints would fill exactly.

## Decisions

- **2026-10-20** — Registration happens where the run is closed, in the same transaction
  as `closeTrainingRun`. A model that exists while its run is still open, or that is
  missing after a run that succeeded, are both states somebody would have to reconcile by
  hand.

## Plan

1. `datasets.class_names`, and `package-dataset.js` recording them. Backfill rockfish5.
2. Compose the name, copy the artifact into the model store, write `ml_models`.
3. Resolve the class names to species and write `model_species`.
4. Wire it into `closeTrainingRun`, so it happens in the same transaction.
5. Tests at the API tier, including that a failed job registers nothing and that
   re-reporting does not register twice.

## Acceptance criteria

- A succeeded training job leaves exactly one `ml_models` row, with its parent, its
  species, and a `storage_path` a worker can fetch.
- An inference job naming that model leases and runs.
- A failed training job leaves none.
- Re-reporting a finished job does not produce a second model.

## Test plan

Filled in at G3.

## Status

- **Gate:** design
- **Notes:** G1. Four blocking assumptions with Isaac. The worker half of training merged
  as `marp-inference-worker#68`; this is the piece that makes what it produces usable.
