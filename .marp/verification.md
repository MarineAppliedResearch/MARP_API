# Verification — MARP_API#265, registering the model a training run produced

The suite covers the decisions; the thing that proves it is a real run on real hardware,
recorded at the bottom.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 — a succeeded job registers a model | `gpu-trained-model-registration` · *a model exists…* | API + database | Driven through submit, lease, hand-off and publish, because registration happens inside the publish transaction. |
| R1 — parented to what it started from | same test | API + database | `parent_model_id` is the model the run began with, which is what makes a lineage readable. |
| R2 — fetchable by a worker | same file · *its weights are where the model route serves from* | API + database | The bytes are fetched back through `/api/v2/model/:id/artifact` and compared. A row naming bytes nobody can fetch is the state this replaces. |
| R3 — it says which species it knows | same file · *it says which species it knows* | API + database | `model_species` resolved from the dataset's recorded class names. Without these the tracking engine refuses the weights. |
| R4 — a failed job registers nothing | — | — | **Not covered.** See below. |
| R5 — registering twice is not possible | same file · *re-reporting the same job…* | API + database | A second result for the same job leaves one model. |
| R6 — existing models are untouched | `gpu-training-submit` · *still queues an inference job exactly as before* | API + database | The inference path is unchanged by any of this. |
| A1 — MARP composes the name | same file | API + database | `<dataset>-<date>`, asserted by pattern rather than by value. |
| A4 — usable but not preferred | same file | API + database | `status` active, `preferred` false, so a new model never silently becomes the default. |

## Requirements with no test

- **R4 — a failed or cancelled training job registers nothing.** The code returns early
  without weights to register, and nothing asserts it. A test would queue a job, report it
  failed, and check no model appeared. Worth adding; it is the case where a bug would
  create a model from a run that crashed, which is worse than no model.

## Edge cases

- A dataset with no recorded `class_names` fails registration loudly rather than
  registering a model with an unstated vocabulary.
- A class name matching zero or two species fails the same way. Common names are not
  unique across the catalogue, so two matches is a real case.
- A run that published no weights registers nothing and is not an error — a job stopped
  before its first improvement is a real outcome.

## Known gaps

- **Nothing has trained on a second machine.** Everything below ran on ABYSS, which also
  held the API, the dataset and the weights, so no fetch crossed a network.
- **No inference job has yet named a registered model.** The vocabulary check that gates
  one is shown to pass (below), but the job itself has not been run.
- `metrics_summary` and `metrics_curves` are still unwritten by the job path.

## Results

### The whole loop, 2026-10-20, ABYSS (RTX 4080 SUPER)

A worker enrolled against a local API, leased a queued training job, trained, published,
and MARP registered the result. Nothing was stubbed.

```
22:42:03  state=leased     phase=training    0/1 epochs
22:51:44  state=leased     phase=training    1/1 epochs
22:52:04  state=succeeded  phase=publishing  1/1 epochs

TRAINING RUN      id 199 · total_epochs 1 · 22:51:40 → 22:52:00
REGISTERED MODEL  id 412 · rockfish5-2026-10-20 · parent 197 · active · preferred false
                  models/rockfish5-2026-10-20/weights/rockfish5-2026-10-20.pt
SPECIES (11)      Blue/Deacon, Brown, Canary, Copper, Gopher, Kelp Greenling,
                  Lingcod, Olive/Yellowtail, Quillback, Rosy, Vermilion
```

And the model is genuinely usable, not merely recorded: the file on disk hashes to
`5e5aaa5a…`, exactly what MARP stored against it, and loading it with Ultralytics gives
**11 classes matching the 11 registered species exactly**. That is the comparison the
tracking engine makes before it will run a model, so an inference job naming 412 passes
the gate.

### The run found a defect, which is why it was worth running

The first attempt (job 21541) failed at `fetching_dataset` with a 404. The dataset storage
root was hardcoded relative to the checkout, unlike `MODEL_STORAGE_ROOT` and
`THUMBNAIL_STORAGE_DIR`, so an API serving that database from any other tree could not
find the archives its own rows named. The symptom was a worker failing minutes into a job,
a long way from the cause.

`DATASET_DIRECTORY` is now configurable through `DATASET_STORAGE_DIR`, with one definition
shared by the packaging script that writes archives and the route that serves them.
`ARTIFACT_DIRECTORY` beside it had the same shape and is now configurable too.

### A false failure worth recording

While the real job was running, the suite began failing with "changed the database" —
`gpu_job_attempts`, `gpu_workers`, `gpu_worker_samples` and `service_tokens`, all
**modified, counts unchanged**. That was the live worker heartbeating, not a leaking test.

**The corpus guard cannot tell a real worker from a misbehaving test**, so the suite is not
trustworthy against the development database while a job is in flight. Re-run with nothing
live: 16 suites, all passing.
