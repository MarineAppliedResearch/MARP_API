---
task: MarineAppliedResearch/MARP_API#296
repos: [marp-api]
status: design
needs: []
---

# Frames per object and class balancing in the dataset builder

Issue: MarineAppliedResearch/MARP_API#296
Branch: `288-inference-findings` (the ML dashboard stream; one branch per stream)
Related: #268 (building datasets from the ML Dashboard), job 21954 (*WpFeCec*), dataset 391

## Goal

A detection build stops cutting every frame of every track. It takes a few frames from
each object, spread across its track, and can even out the classes. Dataset 391
(*WP - FE - CUC*) goes from 155,258 images to about 17,000–20,000, and an epoch from
1 h 40 min to a fraction of that. Before queueing, the build flow says how many images
the build will cut.

## Requirements

- **R1 — At most N picked frames per object.** *Frames per object* defaults to 10 on the
  build flow; *Every frame* is still available. A track shorter than N gives every frame
  it has.
- **R2 — Spread out, randomly.** The track is split into N equal stretches and one random
  frame is taken from each stretch.
- **R3 — Reproducible.** A seed is recorded with the build. The same selection, setting and
  seed pick the same frames. *Duplicate setup* carries the setting and the seed.
- **R4 — Class balancing, optional, off by default.** Every class aims for the image count
  the largest class gets at N per object. A smaller class takes more frames per object, up
  to its track lengths.
- **R5 — Every visible box on a chosen frame.** A frame picked for one object carries
  the box of every other selected object in it, as today.
- **R6 — Splits are decided before sampling, and are unchanged by it.** The same
  observations land in the same splits whatever N is. Validation and test are sampled the
  same way as train.
- **R7 — The counts describe the archive.** `num_samples`, the split images and the
  per-class images count what was cut, not what was available. They already do this,
  because they are counted from the written files. A test pins it.
- **R8 — A live estimate before queueing.** Images per class and in total, and how many
  times fewer than every frame. The API works it out with the same planning code the build
  runs, so the estimate is the plan.
- **R9 — The dataset shows its sampling**: frames per object, balancing on or off, and the
  seed.

## Open assumptions

- [x] **A1 · data-meaning · blocking** — answered 2026-10-29: each object picks its own N. — **Does a frame picked for a neighbour count
  toward an object's N?** Two objects in one stretch of video share frames. If each picks
  its own N, a crowded object also shows up in its neighbours' picks, so it is in more than
  N images (still every box labelled, per R5). The alternative is to count those shared
  frames toward its N and pick fewer of its own. That gives fewer images and per-object
  counts nearer N, but it makes the picks depend on which neighbours were selected.
  **Recommended: each object picks its own N.** N is "frames picked for this object". Simple,
  and adding a subset never changes another object's picks.
- [x] **A2 · scientific · blocking** — answered 2026-10-29: balance every split, each against its own largest class. — **Does balancing apply to validation and test, or
  only train?** Balanced validation scores every class equally. Natural validation scores
  the mix the model will meet in real video. **Recommended: balance every split the same
  way**, because #296 says validation and test are sampled the same way as train. Each split
  is balanced against its own largest class.
- [x] **A3 · database/schema · non-blocking** — **Where the setting is recorded.** In the
  build's `gpu_jobs.spec`, beside the filters and shares already there, as
  `sampling: {frames_per_object, balance_classes, seed}`. *Duplicate setup* already reads the
  spec through `GET /dataset/:id/build-setup`, and the dataset screen shows it from there.
  No migration. Decided, not asked: it follows the existing pattern, and a column on
  `datasets` would be a second copy.
- [x] **A4 · API contract · non-blocking** — **A spec without `sampling` means every
  frame.** Builds queued before this, retried or reclaimed, keep meaning what they meant,
  and *Duplicate setup* of an old dataset fills *Every frame*. That makes "rebuild 391 at
  10" one edit. The build flow sends 10 for a new build. Decided, not asked: changing what
  an old spec means would rewrite history.
- [x] **A5 · behavioural · non-blocking** — **The seed is chosen when the build is
  queued**, at random, unless the request names one. It is then recorded. Each object's
  picks come from the seed plus its `observation_id`, so the same object picks the same
  frames whichever other objects are in the build.
- [x] **A6 · behavioural · non-blocking** — **Balancing shares a class's target across its
  objects evenly.** Objects with short tracks give all their frames, and what they could not
  give goes to the longer ones. A class whose tracks cannot reach the target takes every
  frame it has.
- [x] **A7 · behavioural · non-blocking** — **Classification builds are not sampled.**
  They already cut one picture per observation (its mosaic tile), so the control is hidden
  for classification and the API ignores `sampling` there.
- [x] **A8 · API contract · non-blocking** — **The estimate is a new route**,
  `POST /api/v2/dataset/build/estimate`. It takes the build's own body and needs
  `datasets:read`. It runs the selection and the plan and cuts nothing. It counts distinct
  frames per split and video, which is what the build cuts. The build can still cut fewer,
  if a video turns out shorter than its keyframes say. The screen calls it after each change
  to the queries or the setting, debounced.

## Decisions

- **2026-10-29** — Settled with Isaac in #296: frames per object with default 10; spread
  out, randomly; seeded; balancing is equal frames per class and off by default.

## Plan

1. `dataset-build-plan.js`: `pickFrames(row, n, seed)` (stretches, seeded random per
   stretch), `framesPerObject(splits, sampling)` (N, or balanced per class per split), and
   `extractionPlan(splits, classes, sampling)`. The plan labels every selected box on each
   chosen frame. With no `sampling` the output is today's, exactly.
2. The runner passes `spec.sampling` through. `queueBuild` records it, with the seed it
   chose. The route validates it (N is an integer of 1 or more, or `null` for every frame).
3. `POST /dataset/build/estimate`, using the same selection and plan. Run `docs:build`.
4. Build flow: *Frames per object* and *Balance classes*, beside the image settings,
   detection only. Show the live estimate. *Duplicate setup* fills both.
5. Dataset detail: show the sampling line.
6. Tests: unit tests on the plan (cap, spread, seed, balancing, shared boxes, splits
   unchanged, no sampling equals today), an API test that the estimate equals the plan,
   and a dashboard unit test for the control and the estimate.

## Acceptance criteria

The *done when* list in #296, including the real run: *WP - FE - CUC* rebuilt at the
defaults trains at least 5 times faster per epoch than job 21954, with comparable mAP.
That run needs the GPU that job 21954 is using now. When to run it is Isaac's call.

## Test plan

Written at G3.

## Status

- **Gate:** implementing.
