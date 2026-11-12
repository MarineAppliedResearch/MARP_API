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
- **Crop:** the habitat crop, x 0.25-0.75, y 0.5-1.0 of the frame. Kept by Isaac on 2026-11-10
  after the retrain on it: one model, test F1 0.728 (0.751 on the old crop), Boulder 0.55
  (0.62). Recorded on #287.
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
- **R9** — The ML Dashboard carries the Mud and Sand rule as part of building a habitat model,
  not only inside inference. Isaac, 2026-11-10: *"our ml dashboard will need to put a rule in
  about mud and sand when it's building this dashboard"*; Mud, Sand and Gravel never overlap,
  and no annotated frame has Mud with Sand (0 of 32,636). Today the rule exists only as a
  stretch rule applied after the model (`exclusive` in `db/habitat-rules.js`, shown on the
  Models screen as "Never together"). Where else it applies is A15-A18. Tested at the tier of
  each place it is applied: the dataset build (API jest), the rules a trained model is
  registered with (API jest), the stretches a run makes (worker pytest), and what the
  dashboard shows (dashboard unit).

## Open assumptions

- [x] **A1 · architectural · blocking** — answered 2026-11-10 by Isaac: the API writes it. The
  worker sends its result and the API's ingest writes the session, observations and keyframes
  as the ordinary endpoints do, in one transaction. — **Who writes the habitat session.** The settled
  output says "through the ordinary session and observation endpoints". In the product the
  worker never calls them: it publishes a result file and the API's ingest writes the rows,
  which keeps a worker's token to "report a job". Proposed: the ingest gets a habitat path
  that writes exactly what the ordinary endpoints write (session, observations with `etc`,
  keyframes), in one transaction. Or should the worker post to the ordinary endpoints itself?
- [x] **A2 · architectural · blocking** — answered 2026-11-10 by Isaac: on the worker, which
  sends the stretches and every frame's raw scores beside them. — **Where frame scores become
  stretches.** Proposed:
  on the worker, as a registered reduction rule (`habitat_stretches`, version 1), which also
  publishes every frame's scores, so new cut-offs could be re-applied later without the GPU.
  The other way is the worker sending only scores and the API making stretches.
- [x] **A3 · database/schema · blocking** — answered 2026-11-10 by Isaac: stored with the
  model in MARP, shown on the Models screen, sent to the worker with each run. — **Where a
  model's cut-offs and stretch rules live.** They are chosen per model on its tuning dives, and inference needs them. Proposed: a
  JSON column on `ml_models` (`decision_rules`: per-substrate cut-off, Mud raise, averaging,
  minimum, bridging, one of Mud/Sand), filled from a file the trainer publishes, and handed to
  the worker in the job spec. Or kept inside the weights file only.
- [x] **A4 · database/schema · blocking** — answered 2026-11-10 by Isaac: a new model type,
  `habitat`. — **What a habitat model is called.**
  `ml_models.model_type` is `detection` or `classification` today. Proposed: a new value
  `habitat` (multi-label substrate classifier), so every screen and check that filters by type
  keeps working and habitat models stay out of species inference. Or `classification` with a
  multi-label flag.
- [x] **A5 · environment · blocking** — answered 2026-11-10 by Isaac: approved, add `timm`
  and `safetensors`. — **Adding `timm` (and `safetensors`) to the worker.**
  The settled model is timm's. Adding a dependency is Isaac's approval, and it means the five
  packaging lock files and the installer. Approve?
- [x] **A6 · architectural · blocking** — answered 2026-11-10 by Isaac: registered in MARP as
  a base model with its checksum and served from MARP; workers need no internet. — **How the
  DINOv2 starting weights reach a worker.**
  Proposed: registered in MARP as a base model, served from MARP with its sha256 like the
  classification base models, so workers stay offline. Or downloaded from Hugging Face by the
  worker (the pinned revision and checksum `fetch_pretrained.py` uses).
- [x] **A7 · behavioural · blocking** — answered 2026-11-10 by Isaac: one training job trains
  one model; averaging several comes later. — **One trained model, or five averaged.** Five seeds
  averaged scored best (0.755 against about 0.74 for one), and costs five trainings and five
  times the inference. Proposed: one training job trains one seed and registers one model;
  averaging is a later step. Or one job trains five and the model is the five.
- [x] **A8 · data-meaning · blocking** — answered 2026-11-10 by Isaac: *"just like our current
  dataset builder, we'll be able to build and query datasets"*. The person chooses the
  stretches with a query in the dashboard, as species builds are chosen, including which
  annotators and sessions. As there, what goes in is what the query selects and is promoted for
  training, so a model's habitat stretches can be used once reviewed and promoted. One automatic
  check stays: a session whose clock-to-video gap moves by more than 2 s within one file is left
  out and listed in the build report. — **Which habitat sessions a dataset learns from.**
  Proposed, as the feasibility plan did: never automated sessions; where several people
  annotated a line, the first session only (so a line is not counted twice); a session whose
  video files' offsets disagree by more than 2 s is left out.
- [x] **A9 · data-meaning · blocking** — answered 2026-11-10 by Isaac: the feasibility rule,
  with the example screens kept in the repository and every rejected frame listed on the
  dataset with its reason, *"then the biologist will be able to review it in the mosaic viewer
  as well"*: a habitat dataset's frames are reviewable in the Mosaic, as #342's first comment
  says (thumbnails saved to the file server and served through the same pipeline). — **How
  non-seabed frames are recognised.** The
  feasibility build compared each frame, shrunk to 32 x 18, against two example screens picked
  by eye from CAMPA video ("Device Unplugged", the End Line card), and treated a nearly flat
  frame as blank. Proposed: the same rule with the example screens checked into the repository
  as data, and every rejection listed on the dataset. Is that right for the product?
- [x] **A10 · database/schema · blocking** — answered 2026-11-10 by Isaac: the same workflow
  as the Mosaic and species builds, no new table. A habitat dataset is chosen from Mosaic
  habitat segments (#342), reviewed and promoted; frames are cut every 10 s inside each
  segment, 2 s from its ends, and a frame's labels are its segment's combination of substrates.
  The stretches used are recorded in `dataset_observations`, and the frames go in the archive.
  So the dataset build comes after #342's segments. — **Where a habitat frame's labels are
  recorded.**
  A species dataset records observations; a habitat frame is a moment covered by several
  stretches with five yes/no labels. Proposed: a new `dataset_frames` table (dataset, split,
  video_source, position, project, dive, line, the five labels as an array in the dataset's
  class order, the stretches that covered it), and `dataset_observations` rows for the
  stretches used.
- [x] **A11 · product/UI · blocking** — answered 2026-11-10 by Isaac: approving a segment
  approves every stretch under it whole, as a flag lands on a whole stretch; reviews stay per
  observation. — **Habitat review in the Mosaic, approving a segment.**
  #342 says a wrong substrate is flagged by tapping it, and the flag lands on that substrate's
  stretch. When a segment is approved as is, is every stretch under it approved whole, even
  where a stretch runs past the segment? Only #342's piece waits on this.
- [x] **A15 · data-meaning · blocking** — answered 2026-11-10 by Isaac: let it through, as
  labelled. — **A dataset frame labelled both Mud and Sand.** None
  is today, but a future annotation or a reviewed model stretch could make one. Proposed: the
  frame is left out of the dataset and listed in the build report with its reason, as rejected
  non-seabed frames are. Or the whole build is refused, or the frame goes in as labelled.
- [x] **A16 · scientific · blocking** — answered 2026-11-10 by Isaac: not yet; keep applying it
  after the model, the surer one stays. — **Whether the model is taught the rule.** Today it is
  only applied after the model: where both pass their cut-offs, the surer stays. Proposed:
  keep it that way for the first trainer, which is the recipe that was measured. The other
  way is training Mud and Sand as one choice of three (Mud, Sand, neither) so the model can
  never answer both, which changes the model and needs its own measurement first.
- [x] **A17 · product/UI · blocking** — answered 2026-11-10 by Isaac: an editable setting a
  person can change, not a fixed one. At which level is A19. — **How the rule shows in the
  dashboard, and who can change it.** Proposed: the habitat dataset builder and the training form both state it
  ("Mud and Sand are never together"), it is copied into each model's rules when the model is
  registered and shown there as now, and it is not editable on screen at first. Or it is a
  setting a person can change per dataset or per model.
- [x] **A18 · data-meaning · blocking** — answered 2026-11-10 by Isaac: one group, Mud + Sand +
  Gravel, applied to whichever of them a model or dataset has. — **Gravel.** Isaac named Mud, Sand and Gravel as never
  overlapping; the model has no Gravel class (the five are Rock, Mud, Sand, Cobble, Boulder).
  Proposed: the rule is stored as one group, Mud, Sand and Gravel, applied to whichever of
  them a model or dataset has, so Gravel is covered the day it is added. Or Mud and Sand only.
- [x] **A19 · database/schema · blocking** — answered 2026-11-10 by Isaac: per model, kept in
  each model's rules and editable on the Models screen. — **Where the editable Mud/Sand/Gravel
  setting lives: per model, per dataset, or both.** With A15 and A16 answered, the rule changes nothing
  in a dataset or in training; it acts only when a model's scores become stretches. Proposed:
  **per model**. It is already stored in each model's rules (no new column), editing it on the
  Models screen changes that model's later runs, and runs already made keep what they were made
  with. Per dataset would need a new column on `datasets` that is only copied into the model at
  registration; both would mean a dataset default that the model can then override.
- [x] **A20 · product/UI · blocking** — **Approving a segment whose stretches have no picture.**
  Found 2026-11-10 while building #342. The Mosaic's review route records an approval only for
  an observation with a ready picture (a reviewer may not approve what they were not shown); it
  waives that for an approval made on the video page. A model's stretches get pictures from
  their keyframes, but an annotator's habitat stretches have no keyframes and never will. So
  approving an annotated segment is refused as `no-imagery`. Proposed: the segment's own
  picture counts, as the video page does -- an approval sent from a segment that showed one is
  accepted for every stretch under it. Flagging needs no picture and works now. Only approving
  annotated segments waits on this, and on A21.
  **Answered by Isaac on 2026-11-12, relayed by the feasibility session** -- not the proposal:
  *"the mosaic needs to be adapted to understand a first and last keyframe of each habitat
  observation. since we know the size of the boxes were using, we should use that for the
  mosaic."* So every habitat observation, an annotator's as well as a model's, has a first
  keyframe at its start and a last at its end, with the habitat crop (x 0.25-0.75,
  y 0.5-1.0) as the box; an annotator's stretch then has a picture and is approved like any
  other. A model's stretches already get these two keyframes at ingest. How an annotator's
  get them is A22.
- [x] **A21 · architectural · blocking** — **Where a segment's picture comes from.** #342 says
  the segment's middle frame with the habitat crop. A segment is worked out when the query runs
  and has no row, so its picture cannot be an observation thumbnail. Proposed: cut on request
  from the middle frame (the segment query already says which video and how far in), stored by
  video, position and crop, and served like a thumbnail. Or the first stretch's own picture,
  which annotated stretches do not have.
  **Answered by Isaac on 2026-11-12, relayed by the feasibility session:** as proposed -- cut
  on request from the segment's middle frame with the habitat crop, kept like a thumbnail.
- [x] **A22 · database/schema · blocking** — **How an annotator's habitat stretch gets its two
  keyframes** (from A20). Either (a) **written** into `keyframes`, as ingest already does for a
  model's: a migration adds them to every existing habitat observation without keyframes, and
  anything that saves a habitat observation later adds them too -- the data changes, and
  production would get them when it is promoted; or (b) **derived** when the Mosaic asks: no
  rows are written, and the Mosaic and the thumbnail extractor treat a habitat observation
  with no keyframes as having those two. Asked of Isaac 2026-11-12.
  **Answered by Isaac in this session, 2026-11-12: (b), derived.** Nothing is written to
  `keyframes` for an annotator's stretch.
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
7. **#342 Mosaic segments** (A11, R8). Before the dataset build, which is chosen from them (A10).
8. **Dataset build from the dashboard** (A8, A9, A10, R2).
9. **Dashboard screens**: build, train, run, read a habitat model.

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

- **Gate:** implementing (G2). A1-A19 answered by Isaac on 2026-11-10; A20 and A21, found that
  night building #342, are open and are what the rest waits on.
- **Also from the feasibility session, 2026-11-10:** one model on the habitat crop scored test
  F1 0.728 against 0.751 on the old crop; Boulder fell from 0.62 to 0.55. The crop stays
  settled, the numbers provisional. So the crop a model was trained on is stored with the model
  beside its cut-offs (A3), and a later change of crop cannot break an older model.
- **Done, 2026-11-10:**
  - Step 1, #347 (R1): the keyframe trigger re-queues a no-keyframes failure, and the retry
    route accepts one once it has keyframes. `tests/thumbnails.test.js`; `test:mosaic` 366
    passed.
  - Step 2: the API frame planner (`service/habitat-dataset-plan.js`, 9 tests in `ml`), and
    the worker's sampler and crop (`media/habitat_frames.py`, 8 tests).
  - Step 3 (R4): `model_type = 'habitat'`; `ml_models.decision_rules` and a `habitat` dataset
    task (migration 20261110140000); `db/habitat-rules.js` holds the settled stretch rules and
    validates what a trainer publishes (artifact role `decision_rules`: substrates, cut-offs,
    crop, input size); registration takes a habitat model's substrates by species id from the
    Habitat list and stores its rules; a lease sends them with the cut-offs to apply; a habitat
    model runs only on the `marp_habitat` engine and that engine only runs habitat models; the
    Models screen shows the rules; the species Inference picker leaves habitat models out.
    `tests/habitat-model-registration.test.js` 11 passed; `test:gpu` 435 passed; dashboard
    unit 242 passed plus the picker test (shown failing without its filter).
  - R9's setting (A17-A19): Mud, Sand and Gravel are one stored group, narrowed to the
    model's substrates for a run; `PUT /api/v2/model/:id/never-together` changes a habitat
    model's groups and nothing else in its rules; the Models screen edits it with a box per
    substrate and Gravel. 15 passed in `habitat-model-registration`; dashboard unit passed.
  - Step 4 (R3), built and tested on a CPU; the GPU run is not done:
    - worker: `timm` 1.0.30 and `safetensors` 0.8.0 added, pinned, all five locks regenerated;
      `training/habitat_training.py` (archive reader, scoring, the two-stage recipe) and the
      `marp_habitat_training` engine, which publishes `weights`, `decision_rules` and a
      `multilabel` `final_metrics`; job processes keep Hugging Face offline. 13 new tests;
      the contract, registry, import and status tests pass with it (56).
    - API: the habitat trainer takes only a habitat dataset and a habitat starting model, the
      species trainer neither; `multilabel` is a known final-metrics family;
      `seed-base-models.js --only dinov2-vitb14` registers DINOv2 (dry run checked; not
      applied). `test:gpu` 454 passed.
    - The habitat dataset archive the trainer reads: `classes.json` (substrates in label
      order), and `train/`, `val/`, `test/`, each with `labels.csv` (`image`, then a 0/1
      column per substrate) and its images. Whole frames; the trainer cuts the crop. The
      dataset build (step 8) writes this.
    - Not done: resuming a stopped habitat training from a checkpoint; a stop is a
      cancellation and the run starts again.
    - **GPU run, 2026-11-10** (worker `.marp/verification.md`): on the feasibility session's
      own frames, packed read-only into a habitat archive, test macro F1 **0.734** against the
      feasibility run's 0.728 on the same crop and seed; Boulder 0.556 against 0.55. The kept
      weights are the best tuning pass's (pass 4 of 10).
  - Step 5 (R5): the worker's `marp_habitat` engine scores 3 frames a second on the model's
    crop and turns the scores into stretches by the settled rules (`habitat_stretches`,
    checked against the feasibility `sample_output.py`); it publishes the stretches and the
    raw scores (A2). Not yet run over real video on a GPU.
  - Step 6 (R6): ingest writes a habitat run's stretches into its Habitat session: one
    observation per stretch with `tc` and `etc` on the video's clock where it is set, start
    and end keyframes with a box from the model's crop. `tests/habitat-ingest.test.js`.
    R7 follows from the keyframes (the thumbnail extractor picks them up); not checked in a
    browser.
  - Step 7 (R8, API half): `POST /api/v2/mosaic/habitat/segments` cuts a session's stretches
    into segments of one combination each, with the Mosaic's filters, "alone" or "with"
    matching, and each segment's review state; reviewing a segment through the existing
    review route lands on every stretch under it (A11). **The Mosaic screen for segments is
    not built**: it needs a picture per segment (A21), and approving an annotated segment
    waits on A20.
  - Step 8 (R2): a habitat dataset build, `task: 'habitat'` on `POST /dataset/build`, and a
    *Habitat substrates* tick box on the Datasets screen. It takes the queries' habitat
    sessions, cuts a frame every 10 s where every stretch over it is promoted, splits whole
    dives 70/15/15, throws out blank screens and the two stored example screens
    (`db/habitat-reject-screens.json`, cut from real video; on 301 real seabed frames none
    was thrown out), leaves out sessions whose times drift by more than 2 s within a file,
    and lists both in `habitat-report.json` in the archive. Only substrates some frame holds
    become classes. `tests/habitat-dataset-select.test.js`, `tests/habitat-dataset-build.test.js`
    (the archive unpacked and read), dashboard `build-habitat.test.mjs`.
  - Step 9 (dashboard): a Habitat tab on Training, a habitat pipeline on Inference, the rules
    and the never-together editor on Models, and the Datasets tick box.
  - The habitat tests seed Rock, Mud, Sand, Cobble and Boulder on the Habitat list where a
    database lacks them (`tests/fixtures/habitat-substrates.js`): a baseline database has
    none, so on CI the segments and ingest tests would otherwise have found nothing.
- **Last run, 2026-11-10:** `test:gpu` 459 passed; `test:mosaic` 381 passed; `test:ml` 437
  passed and 1 failed, `dataset-build-resume` (below); dashboard unit 249 passed; worker
  habitat tests 31 passed, contract and import tests 45 passed.
- **Found, left alone:** `tests/dataset-build-resume.test.js` fails about two runs in three on
  `develop` as well (a resumed build's archive checksum differs from the reference).
- **Not done, and why:**
  - The Mosaic segments screen (R8's second half): waits on A20 and A21.
  - A habitat run over real video on a GPU, and the Mosaic showing its stretches (R5-R7 end
    to end): needs a trained model registered through MARP and a video to run on.
  - A habitat build from real annotations: annotated stretches can be flagged now, but
    promoting them by their segment waits on A20, so a build from annotations today selects
    only stretches promoted some other way.
