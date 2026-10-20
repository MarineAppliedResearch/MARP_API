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
- **R3** — The model records which species it was trained on, as `model_species` rows.
  The tracking engine refuses weights whose vocabulary disagrees with what MARP registered
  for them, so a model with no species is a model that cannot be run.
- **R4** — A failed or cancelled training job registers nothing. A model that exists
  because a run crashed is worse than no model.
- **R5** — Registering twice is not possible. A job that publishes, is re-ingested, or is
  reported again produces one model, not two.
- **R6** — Nothing about an existing model changes. Inference jobs naming a model
  registered by hand keep working exactly as they do.

## Open assumptions

- [ ] **A1 · product · blocking** — **What is a trained model called?** `ml_models.name` is
      NOT NULL and is what a person picks from. Three answers: the submitter names it when
      queuing the training job, the way they can already name the job; MARP composes one
      from the dataset and the date (`rockfish5-2026-10-20`); or the worker reports one.
      There is precedent for the first — `gpu_jobs.name` is nullable specifically because
      "a name MARP invented would be indistinguishable from one a person chose" — but a
      nullable job name is survivable and a nullable model name is not.
- [ ] **A2 · architectural · blocking** — **Where do the bytes live, and under which
      root?** The published weights are already stored, content-addressed, at
      `storage/gpu-artifacts/<sha256>`. But `ml_models.storage_path` is resolved by
      `model-artifact.service.js` under `MODEL_STORAGE_ROOT`, which defaults to
      `.marp/local` — a different tree entirely. So one of: copy the artifact into the
      model store (simple, doubles 136 MB per model); point `storage_path` at the artifact
      and teach the model route to resolve both roots; or make the model route serve
      artifacts by hash. The third is closest to #120 and the furthest from a quick fix.
- [ ] **A3 · scientific · blocking** — **How are the species worked out?** `model_species`
      needs species ids, and the class names live in the dataset archive's `data.yaml`,
      which MARP never reads — `datasets` records `num_classes` but not the names. Options:
      record the class names at packaging time (`scripts/package-dataset.js` already parses
      them, so this is cheap and honest); derive them from `dataset_observations` through
      `observations.comname`, which is empty for a legacy import like rockfish5; or have
      the worker report the loaded vocabulary with the weights, which it already knows.
      **The first two disagree for rockfish5 specifically**, which is the dataset we are
      testing with.
- [ ] **A4 · product · blocking** — **Is a newly trained model usable immediately?**
      `ml_models.status` and `preferred` both exist. A model nobody has evaluated becoming
      `preferred` would quietly change which weights the next inference job runs. Proposed:
      registered as not preferred, with a status that says it has not been assessed, and
      promoting it is a human act.
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

Written once A1 to A4 are answered; each of them changes what is written and where.

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
