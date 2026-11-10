---
task: MarineAppliedResearch/MARP_API#287
repos: [MARP_API, marp-inference-worker]
status: design
needs: []
---

# Habitat substrate model in MARP: train it and run it from the ML Dashboard

Issue: MarineAppliedResearch/MARP_API#287. Related: #342 (habitat in the Mosaic), #347
(thumbnails after keyframes are added), the #268 work-stream checklist ("Later": habitat
datasets from the dashboard), #76 (observations carry the moment they were seen).
Branches: `287-habitat-model` in MARP_API and in marp-inference-worker, both from `develop`.
The feasibility work is on `287-habitat-classification` (`.marp/habitat/`): evidence and
settled numbers, not code to copy.

## Goal

A biologist can build a habitat dataset from the ML Dashboard out of the habitat stretches
annotators recorded, train a substrate model on a GPU worker, and run it over a dive's video.
The run produces an automated Habitat session that looks like an annotator's: one
observation per stretch of each substrate, on the video's clock, each with a picture the
Mosaic can show, so a person can review it in the Mosaic as #342 decided.

## Settled (relayed from Isaac on 2026-11-10; not reopened here)

- **Model:** DINOv2 ViT-B/14 (timm `vit_base_patch14_dinov2.lvd142m`), 518 px, one yes/no
  output per substrate: Rock, Mud, Sand, Cobble, Boulder, several at once. A frozen-backbone
  stage, then the whole model with layer-wise speeds (3e-5, decay 0.75, 1 warm-up pass, 10
  passes), keeping the best on the tuning dives. Five seeds averaged is the best so far.
- **Crop:** the habitat crop, x 0.25-0.75, y 0.5-1.0 of the frame. A retrain on it is running
  in the feasibility session; it may move the numbers, not the design.
- **Dataset:** a frame every 10 s inside annotated Habitat stretches, at least 2 s from any
  change of substrate. Whole dives split 70/15/15 within each project. Blank, "Device
  Unplugged" and "End Line" frames rejected. Labels are a yes/no per substrate. CAMPA 2024-2026
  only so far. Annotators never label Mud with Sand.
- **Output:** one automated Habitat session per run, owned by the "MARP Inference" user,
  written as the ordinary session and observation endpoints write them. The GPU ingest refuses
  Habitat and writes no `etc` today. Each observation carries the substrate (comname and its
  species row), tc and etc on the clock, actual and media positions, video_source and
  confidence, plus a start and an end keyframe whose box is the habitat crop (centre-origin,
  normalised).
- **Stretch rules:** 3 frames a second, scores averaged over 1 s, per-substrate cut-offs
  picked on the tuning dives with Mud's raised by 0.2, at most one of Mud and Sand at a time
  (the surer one stays), stretches at least 2 s, breaks of 2 s or less bridged.
- **Mosaic (#342, 2026-11-10):** a habitat tile is a segment of one combination of substrates,
  worked out when the query runs. Segments under 2 s are left out. The picture is the
  segment's middle frame with the habitat crop. Review: approve as is, or tap the wrong
  substrate and the flag lands on that substrate's stretch. Filters: includes all, exactly,
  or any of the chosen substrates, with the protocol's habitat types as presets.
- **Clock (#76, merged in #348):** machine-made observations carry clock time where their
  video's clock is set, and position time with no `observed_at` where it is not.

## Where each piece lives

| Piece | Repository | Where |
| --- | --- | --- |
| Choosing frames from habitat stretches, splitting by dive | MARP_API | a habitat planner beside `service/dataset-build-plan.js`. Builds run on the API, not a worker (#268 A1) |
| Cutting the frames, rejecting non-seabed ones, packaging the archive | MARP_API | `service/dataset-build.service.js`, a habitat branch beside `runOne` (detection, which already cuts frames from Jellyfin with `extraction.extractFrames`) and `runClassificationBuild` (Mosaic tiles). A new `task` value: the `datasets.task` check (migration `20261027160000`) and `BUILD_TASKS` in `routes/dataset.routes.js` |
| Recording what a habitat dataset holds | MARP_API | `recordBuild` in `repository/dataset-build.repository.js`: `datasets`, `dataset_classes`, `dataset_observations`, `dataset_splits`; per-frame labels need a home (A10) |
| The multi-label DINOv2 trainer | worker | a new `BaseEngine` in `engines/`, registered in `engines/engine_registry.py`; the loop in `training/`. The dataset arrives as now (`training/dataset.py`, content-addressed cache) |
| Recording a habitat training run | MARP_API | epochs through `db/epoch-metrics.js`; end-of-run scores through `db/final-metrics.js`, which has `box`, `seg` and `classify` families and needs a multi-label one (per-substrate F1, precision, recall) |
| Registering a trained habitat model | MARP_API | `registerTrainedModel` in `repository/trained-model.repository.js`: `model_type` from the dataset's task (`deriveModelType`), substrates from `dataset_classes` by exact name. Plus the cut-offs (A3, A4) |
| The habitat inference engine: 3 frames/s, crop, batched scoring | worker | a new `BaseEngine`; the sampler in `media/` beside `frame_range_reader.py`, which reads every frame and has no stride or batching |
| Frame scores to stretches | worker or MARP_API (A2) | a new rule in `reduction/` (every inference spec names a registered reduction; only `v3_dirpad` exists), or the ingest |
| Submitting a habitat run | MARP_API | `submitJobs` in `service/gpu.service.js`. Habitat is refused at submit (`validateSubmittedObservationTarget`) and at lease (`resolveDataTypeForLease`) by `ENGINE_DATA_TYPES`, because the species engine has no rule for when a habitat observation happens; a habitat engine is exempt from that check, not the check removed |
| Writing the habitat session, observations and keyframes | MARP_API | `service/observation-ingest.service.js` and its repository, a habitat path that writes `etc` (A1). Per-run sessions as now (`service/inference-session.service.js`), owned by MARP Inference |
| Thumbnails once keyframes exist (#347) | MARP_API | `repository/observation-thumbnail.repository.js` (`requeue`, `requestRefresh`), the keyframe insert trigger, `routes/thumbnail.routes.js` retry |
| Habitat segments in the Mosaic (#342) | MARP_API | `repository/mosaic.repository.js`: a tile is one observation row today and the species filter is `species_id = ANY`, so segments need their own query |
| Dashboard: build, train, run, read a habitat model | MARP_API | `frontend/apps/ml-dashboard`: the Datasets builder sends no `task` today; Training wires detection only; Inference offers only "Detection + ByteTrack" |

**Found while mapping, and changing the plan:**

- **A dataset build only takes observations that have keyframes** (`buildSelectionQuery`). Hand-entered habitat stretches have none, so a habitat build selects stretches its own way rather than through the Mosaic selection.
- **"Sand" is not unique in the catalogue.** The five substrates are on the Habitat list
  (Rock 666001, Boulder 666002, Cobble 666003, Sand 666004, Mud 666005), and the development
  database also has a "Sand" on `MBARI_315k`. Model registration matches class names across
  the whole catalogue and requires exactly one, so a habitat model would be refused. A14 covers
  it: substrates are resolved within the Habitat list.
- **A worker's downloaded models are cached per installed version**, so an upgrade fetches the DINOv2 weights again. Noted, not changed here.

## Requirements

- **R1** — #347: adding a keyframe to an observation whose thumbnail failed for having no
  keyframes makes that thumbnail requestable again, through the API's keyframe routes and the
  Mosaic's. The retry route accepts it once it has keyframes and still refuses it without.
  Other permanent failures are unchanged.
- **R2** — A habitat dataset is built from the dashboard: frames from the chosen projects'
  habitat stretches by the settled rule, whole dives per split, non-seabed frames rejected,
  and every frame's yes/no labels recorded.
- **R3** — A worker trains the settled DINOv2 multi-label model on such a dataset, reporting
  progress, per-pass losses and per-substrate scores as training jobs do now, and publishes the
  weights with the cut-offs chosen on the tuning dives.
- **R4** — The trained model is registered as a habitat model with its five substrates and its
  cut-offs, and shows on the Models screen with its per-substrate scores.
- **R5** — A worker runs a habitat model over a video at 3 frames a second on the habitat
  crop, and its result becomes stretches by the settled rules.
- **R6** — A habitat run's result becomes one automated Habitat session owned by MARP
  Inference, with an observation per stretch as specified under Output, start and end
  keyframes with the habitat crop, on the video's clock where it is set.
- **R7** — Its tiles get pictures in the Mosaic without anything done by hand (needs R1).
- **R8** — #342: habitat observations are shown and reviewed in the Mosaic as segments.

## Open assumptions

- [ ] **A1 · architectural · blocking** — **Who writes the habitat session.** The settled
  output says "through the ordinary session and observation endpoints". In the product the
  worker never calls them: it publishes a result file and the API's ingest writes the rows,
  which keeps a worker's token to "report a job". Proposed: the ingest gets a habitat path
  that writes exactly what the ordinary endpoints write (session, observations with `etc`,
  keyframes), in one transaction. Or should the worker post to the ordinary endpoints itself?
- [ ] **A2 · architectural · blocking** — **Where frame scores become stretches.** Proposed:
  on the worker, as a registered reduction rule (`habitat_stretches`, version 1), which also
  publishes every frame's scores, so new cut-offs could be re-applied later without the GPU.
  The other way is the worker sending only scores and the API making stretches.
- [ ] **A3 · database/schema · blocking** — **Where a model's cut-offs and stretch rules
  live.** They are chosen per model on its tuning dives, and inference needs them. Proposed: a
  JSON column on `ml_models` (`decision_rules`: per-substrate cut-off, Mud raise, averaging,
  minimum, bridging, one of Mud/Sand), filled from a file the trainer publishes, and handed to
  the worker in the job spec. Or kept inside the weights file only.
- [ ] **A4 · database/schema · blocking** — **What a habitat model is called.**
  `ml_models.model_type` is `detection` or `classification` today. Proposed: a new value
  `habitat` (multi-label substrate classifier), so every screen and check that filters by type
  keeps working and habitat models stay out of species inference. Or `classification` with a
  multi-label flag.
- [ ] **A5 · environment · blocking** — **Adding `timm` (and `safetensors`) to the worker.**
  The settled model is timm's. Adding a dependency is Isaac's approval, and it means the five
  packaging lock files and the installer. Approve?
- [ ] **A6 · architectural · blocking** — **How the DINOv2 starting weights reach a worker.**
  Proposed: registered in MARP as a base model, served from MARP with its sha256 like the
  classification base models, so workers stay offline. Or downloaded from Hugging Face by the
  worker (the pinned revision and checksum `fetch_pretrained.py` uses).
- [ ] **A7 · behavioural · blocking** — **One trained model, or five averaged.** Five seeds
  averaged scored best (0.755 against about 0.74 for one), and costs five trainings and five
  times the inference. Proposed: one training job trains one seed and registers one model;
  averaging is a later step. Or one job trains five and the model is the five.
- [ ] **A8 · data-meaning · blocking** — **Which habitat sessions a dataset learns from.**
  Proposed, as the feasibility plan did: never automated sessions; where several people
  annotated a line, the first session only (so a line is not counted twice); a session whose
  video files' offsets disagree by more than 2 s is left out.
- [ ] **A9 · data-meaning · blocking** — **How non-seabed frames are recognised.** The
  feasibility build compared each frame, shrunk to 32 x 18, against two example screens picked
  by eye from CAMPA video ("Device Unplugged", the End Line card), and treated a nearly flat
  frame as blank. Proposed: the same rule with the example screens checked into the repository
  as data, and every rejection listed on the dataset. Is that right for the product?
- [ ] **A10 · database/schema · blocking** — **Where a habitat frame's labels are recorded.**
  A species dataset records observations; a habitat frame is a moment covered by several
  stretches with five yes/no labels. Proposed: a new `dataset_frames` table (dataset, split,
  video_source, position, project, dive, line, the five labels as an array in the dataset's
  class order, the stretches that covered it), and `dataset_observations` rows for the
  stretches used.
- [ ] **A11 · product/UI · blocking** — **Habitat review in the Mosaic, approving a segment.**
  #342 says a wrong substrate is flagged by tapping it, and the flag lands on that substrate's
  stretch. When a segment is approved as is, is every stretch under it approved whole, even
  where a stretch runs past the segment? Only #342's piece waits on this.
- [ ] **A12 · behavioural · non-blocking** — A habitat run is per video, and sessions are made
  per run as inference runs are now (`session.per_run`, one submission per dive and model,
  #336). Followed, not asked.
- [ ] **A13 · behavioural · non-blocking** — 3 frames a second is taken by time (one frame
  each 1/3 s, nearest decoded frame), at any video frame rate.
- [ ] **A14 · data-meaning · non-blocking** — A substrate's species row is the Habitat list's
  row of that name, at registration and at ingest, and a name matching none or several there
  is refused, as the species ingest does. Needed because "Sand" also exists on `MBARI_315k`.

## Plan

Built in this order. Each step is merged only when Isaac says so.

1. **#347** (R1). Independent, small, needed before any automatic picture.
2. **Pure pieces nothing blocks.** In the worker: a frame sampler by time and the habitat crop
   (A13). In MARP_API: choosing frames from a set of stretches by the settled rule, with the
   seeded whole-dive split. Both tested in the fast tier.
3. **Model type, registration and cut-offs** (A3, A4, R4).
4. **Trainer engine** (A5, A6, A7, R3), with a GPU run recorded in `.marp/verification.md`.
5. **Inference engine and stretches** (A2, R5).
6. **Habitat ingest** (A1, R6), then the Mosaic pictures end to end (R7).
7. **Dataset build from the dashboard** (A8, A9, A10, R2).
8. **Dashboard screens**: build, train, run, read a habitat model.
9. **#342 Mosaic segments** (A11, R8).

## Test plan (draft; reviewed at G3 before anything slow runs)

| Tier | What | Covers |
| --- | --- | --- |
| API jest, `test:observations` / thumbnails | a keyframe added after a no-keyframes failure lets the thumbnail be made; the retry route refuses an observation still without keyframes | R1 |
| API jest | the frame planner: 10 s grid, 2 s margin, gaps unlabelled, whole dives per split, seeded | R2 |
| API jest, `test:gpu` | registering a habitat model with cut-offs; an inference spec for one; ingest of a habitat result into a session with `etc`, keyframes and the clock | R4, R6 |
| worker pytest | sampler and crop; stretch rules (averaging, cut-offs, Mud/Sand, minimum, bridging) on fixed score arrays; the engine contract and registry; trainer with the model faked | R3, R5 |
| GPU, manual, recorded | a short training run on a small habitat dataset; a habitat run over one real video; scores against the feasibility numbers | R3, R5 |
| Mosaic browser | habitat tiles get pictures; segments, filters and review | R7, R8 |

## Status

- **Gate:** design (G1). Blocking assumptions A1-A11 are with Isaac, through the feasibility
  session.
- **Notes:** step 1 (#347) and step 2 can be built now; nothing else starts before its
  assumptions are answered.
