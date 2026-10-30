# Verification: frames per object and class balancing (#296)

Spec: `.marp/task-296-frames-per-object.md`. Branch `288-inference-findings`.

## What each requirement is tested by

| Req | What it says | Tested by | Result |
| --- | --- | --- | --- |
| R1 | At most N picked frames per object; a short track gives all it has | `dataset-build-plan`: *takes at most N…*, *a track shorter than N…*; `dataset-build-sampling`: *at most five frames per object* | pass |
| R2 | One random frame from each of N equal stretches | `dataset-build-plan`: *takes at most N… one from each of N equal stretches*, *the picks are random within a stretch* | pass |
| R3 | Seeded and reproducible; Duplicate carries the seed | `dataset-build-plan`: *the same seed picks the same frames*, *an object picks the same frames whatever else is in the build*; `dataset-build-sampling`: *the spec records the sampling, and Duplicate setup carries it*, *a seed is chosen and recorded*; dashboard `build-sampling`: *Duplicate carries the setting and its seed* | pass |
| R4 | Balancing: each class, per split, reaches its largest class's count at N | `dataset-build-plan`: *balancing gives every class…*, *balancing stops at what the tracks hold…*, *balancing is per split…*; `dataset-build-sampling`: *balancing evens the classes out in the estimate* | pass |
| R5 | A picked frame carries every selected box in it | `dataset-build-plan`: *a frame picked for one object carries the box of every selected object in it*; `dataset-build-sampling`: same, through the runner | pass |
| R6 | Splits decided before sampling and unchanged by it | `dataset-build-plan`: *sampling never moves an observation between splits* | pass |
| R7 | The dataset's counts describe the archive | `dataset-build-sampling`: *the estimate is what the build cut* (`num_samples` equals the frames cut) | pass |
| R8 | A live estimate that equals the plan | `dataset-build-plan`: *the estimate counts what the plan cuts*; `dataset-build-sampling`: *the estimate is what the build cut*; dashboard `build-sampling`: estimate shown and re-asked on change | pass |
| R9 | The dataset shows its sampling | dashboard `build-sampling`: *an opened dataset says how its frames were chosen* | pass |
| — | No sampling is every frame, exactly as before | `dataset-build-plan`: *without sampling the plan is every frame*; `dataset-build-sampling`: *no sampling is every frame*; the existing runner suites unchanged and green | pass |

## Runs

- `npm run test:ml` on the testing database: 22 suites, **399 passed**, 0 failed.
- `npm run test:app:ml-dashboard`: **191 passed**, 0 failed.
- `npm run docs:build`: the new route is in `docs/openapi.generated.json`.

## On real data (development database, 2026-10-29)

The estimate run against dataset 391's own queries, before anything was built:

| Setting | Images | Train |
| --- | --- | --- |
| Every frame | 155,258 | 98,692 |
| 10 per object | 16,237 | 10,193 |
| 10 per object, balanced | 19,421 | 12,245 |

The every-frame figure equals what the original build of dataset 391 cut, image for image.

**The rebuild.** Dataset 392, *WP - FE - CUC (10 per object)*, built by job 21955 from 391's
query at 10 per object, seed 1530591093. Planned 16,239, cut **16,239** (train 10,179,
validation 3,712, test 2,348), 1,683 observations, in about 40 minutes over 298 videos.

**The training.** Job 21956, the same model and parameters as job 21954, on dataset 392:

| Epoch | 21954 (every frame) | 21956 (10 per object) |
| --- | --- | --- |
| 1 | 6,143 s, mAP@50 0.538 | 657 s, mAP@50 0.611 |
| 2 | 6,041 s, 0.534 | 628 s, 0.578 |
| 3 | 6,002 s, 0.548 | 621 s, 0.563 |

**About 9.6 times faster per epoch**, against the issue's 5 to 10. mAP@50 is in the same
range; the two validation sets are the same animals but not the same images, so the
numbers are close rather than identical measures. Both runs fell over their first epochs,
which is the warm-up of a fine-tune from a trained model.

## Not covered

- Whether the final model is as good or better: job 21956 is at epoch 3 of 250. The
  comparison above is the first three epochs only.
- The build flow seen in a real browser. The control, estimate and Build record are
  tested in jsdom against the real `screens.js`, not by eye.
- Classification builds ignore sampling by design, and no test covers that they do.
