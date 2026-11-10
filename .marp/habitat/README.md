# Habitat classification — feasibility work

Refs MarineAppliedResearch/MARP_API#287. Can an image model tell the CAMPA substrates
(Rock, Mud, Sand, Cobble, Boulder) apart, frame by frame? Not product code: the scripts
that answered that question, so the work can carry on on another machine.

- `research-plan.md` — the whole plan, phases 0–8.
- `audit/` — the audit of the habitat annotations in production, and its findings.
- `experiment/` — the dataset, frame extraction and training.

## What it needs

- A database restored from a production dump and migrated (the audit and `plan.js` read
  `observations`). Run everything from the `MARP_API` root, so `.env` resolves.
- Jellyfin reachable from `.env`. `HABITAT_JELLYFIN_URL` overrides it for `extract_full.js`
  only — the LAN address was 16x faster than the public one here.
- The inference worker's Python (torch, torchvision, OpenCV, Pillow).
  `HABITAT_PYTHON` overrides where `extract_full.js` looks for it.
- For the BenthicNet and DINOv2 starting points, their weights: `python -I
  experiment/fetch_pretrained.py` downloads them once per machine, checks them, and prints
  where they are. They are kept outside every checkout, so all working copies and agent
  workspaces share one copy, with a `README.md` beside them on how to load them.

## The pipeline

`plan.json`, `intervals.json` and `dataset.csv` are committed, so a new machine can start at
step 4. The frames, the trained weights and the logs are not: gigabytes, and regenerated.

1. `node .marp/habitat/audit/jellyfin-check.js` — which videos Jellyfin has (`jellyfin-check.json`).
2. `node .marp/habitat/experiment/plan.js` — frames every 10 s inside annotated stretches,
   2 s clear of any change, dives split 70/15/15 per project → `plan.json`.
3. `node .marp/habitat/experiment/extract.js`, then `build_dataset.py` — trickplay thumbnails,
   with blank / "Device Unplugged" / "End Line" frames rejected → `dataset.csv`.
4. `node .marp/habitat/experiment/extract_full.js` — the same frames at full resolution
   from the video, into `experiment/frames_full/`. Resumable.
5. `python -I build_dataset_full.py` — `dataset_full.csv` (and the thumbnails of the same
   frames, for a fair comparison).
6. `python -I train.py convnext_tiny dataset_full.csv full 384` — arch, dataset,
   crop (`full` or `bottom_middle`), input size. Writes `runs/`.
   Archs: `resnet50`, `convnext_tiny`, `convnext_small`, `vit_b16_swag` (ImageNet, from
   torchvision), `benthicnet_rn50`, `benthicnet_vits` (seabed-trained) and `dinov2_vitb`
   (the last three need `fetch_pretrained.py` first).

## Results so far

Average F1 over the five substrates, on dives the model never saw. "Present on every
frame" scores about 0.39–0.41.

| Run | Data | Average F1 |
| --- | --- | --- |
| ResNet-50, thumbnails | all CAMPA | 0.625 |
| ConvNeXt-Tiny, thumbnails | all CAMPA | 0.637 |
| ViT-B/16, thumbnails | all CAMPA | 0.579 |
| ConvNeXt, thumbnails, labels moved +5 s | all CAMPA | 0.694 |

The last row is the thumbnail timing fix: trickplay thumbnail *k* shows about 5 s after
*k*·10 s, so its labels were late. Full frames are cut at their exact position and need no
shift.

Full frames, on the 19,133 frames that downloaded (CAMPA 2024, 2025 and part of 2026; the
test dives are 2024 and 2025 only, so these do not compare with the table above):

| ConvNeXt-Tiny on | Average F1 | Rock | Mud | Sand | Cobble | Boulder |
| --- | --- | --- | --- | --- | --- | --- |
| thumbnails of the same frames | 0.581 | 0.94 | 0.45 | 0.53 | 0.45 | 0.53 |
| full frames, 224 px | 0.634 | 0.96 | 0.54 | 0.52 | 0.55 | 0.61 |
| full frames, bottom-middle crop, 224 px | 0.634 | 0.96 | 0.49 | 0.50 | 0.57 | 0.64 |
| **full frames, 384 px** | **0.671** | 0.97 | 0.53 | 0.61 | 0.59 | 0.66 |

### 2026-11-09/10: every frame downloaded, then other models

All 489 videos downloaded at full resolution, 30,711 frames, none failed (Jellyfin's LAN
address gave ~230 Mbit/s). `dataset_full_run1.csv` is the dataset at the point training
began: everything except CAMPA 2026's tuning and test dives. Its test dives are exactly the
2,698 of the table above, so these compare with it.

| Model, 384 px unless said | Average F1 | Rock | Mud | Sand | Cobble | Boulder |
| --- | --- | --- | --- | --- | --- | --- |
| ConvNeXt-Tiny, with 2026's training dives added | 0.692 | 0.97 | 0.53 | 0.68 | 0.62 | 0.67 |
| BenthicNet ResNet-50 (seabed-trained) | 0.628 | 0.96 | 0.47 | 0.65 | 0.48 | 0.58 |
| BenthicNet ViT-S (seabed-trained) | 0.583 | 0.96 | 0.47 | 0.43 | 0.49 | 0.56 |
| DINOv2 ViT-B, whole model at `1e-5` | 0.707 | 0.97 | 0.59 | 0.68 | 0.60 | 0.69 |
| **DINOv2, 518 px, five seeds averaged** (below) | **0.718** | 0.97 | 0.58 | 0.66 | 0.70 | 0.68 |

- **The seabed-trained BenthicNet models did worse** than everyday-photo ones, at least
  with this recipe. Their images are mostly downward stills; ours is forward-looking video.
- **DINOv2 needs a gentle second stage.** At the default `1e-4` it lost what it knew (tuning
  F1 fell from 0.74 to 0.55); at `1e-5` it became the best model.
- **Labels are not shifted in time** in either year (`diag_lag_by_year.py`: both fit best at
  no shift). **Mud in 2025 is a Mud-vs-Sand question:** whole 2025 lines labelled Sand are
  called Mud by the model (dive 11 line 920, dive 14 line 1890), next to lines labelled Mud
  that it gets right (dive 14 line 2200). Annotators' Mud rates range 8-39% in 2024 and
  2025 and are all near 30% in 2026. Needs a person to look; not settled.
- **Smoothing along the video hurts** at 10 s spacing (`smooth.py`: 0.707 alone, 0.691 over
  3 frames, 0.650 over 7). Stretches are often shorter than 20 s.

**The overnight queue** (`overnight.py`, full tables in `results/overnight-summary.md`)
tried five settings at 384 px, then trained the winner at 518 px on the full dataset with
five seeds and averaged them.

- **Settings could not be told apart.** Tuning F1 ranged 0.792-0.810 and test F1 0.664-0.714,
  and the two orderings disagreed: the tuning winner (layer-wise speeds) was below the
  baseline on test. The tuning dives (8) are too few to separate settings this close.
- **Seed alone moves a run's test F1 by 0.02** (0.733-0.755 at 518 px on the full dataset).
  Differences smaller than that are not evidence.
- **Final model: five DINOv2 runs averaged, 518 px, full dataset.** Test F1 **0.755 over all
  three years** (6,016 frames; 2024 0.72, 2025 0.67, 2026 0.77) and **0.718 on the earlier
  2024+2025 test dives**. Rock 0.95, Mud 0.65, Sand 0.85, Cobble 0.70, Boulder 0.63 over all
  three. Averaging two seeds scored 0.764; five were planned beforehand, so 0.755 is the result.

`experiment/results/` holds every run's full scores, per substrate and per year.

### 2026-11-10: the model on whole lines, as habitat records

`audit/agreement.js` scores two annotators against each other the way the model is scored.
On the 7 CAMPA lines several people annotated, people agree at average F1 0.81 (Rock 0.94,
Sand 0.90, Cobble 0.75, Mud 0.75, Boulder 0.72); Mud in 2025 only 0.64. The habitat
protocols (Protocol_Habitat 02.2024, MARE Substrate Annotation) define Mud and Sand by how the
sediment behaves when disturbed, which a still frame often cannot show.

The sample-output scripts run the final model over whole lines and turn its answers into
stretches the way the protocol has annotators record them (each substrate a layer, a minimum
length, short breaks bridged), then compare them with every annotator of the line:

1. `sample_lines.js`: the lines, every annotator's stretches, and frames from Jellyfin
   (`grab_every.py` reads each video straight through). Leaves out automated sessions, so a
   model session posted earlier is never counted as an annotator.
2. `sample_output.py`: the model on every frame, stretches, scores. Settings as `key=value`
   (frame rate, running average, cut-off raises, minimum length, Mud/Sand never together).
3. `sample_sheet.py`: each line's timeline, people above model, in `sheets/sample-output/`.
4. `post_sample.js`: the stretches into MARP through the API as automated Habitat sessions
   (owned by MARP Inference), beside the annotators' sessions, for the GUI's Compare Habitat.
5. `keyframe_sample.js`: a start and end keyframe per stretch with the fixed habitat crop,
   so the Mosaic can cut a picture.

Lines: 3 tuning lines set the rules; 5 test lines are scored, two of them annotated by several
people (CAMPA-2025 dive 23 line 2180 by 3, CAMPA 2026 dive 13 line 2100 by 7). F1 against
the annotators, second by second:

| Run | Rules | L2180 | L2100 | L600 | L1890 | L570 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 frame/s, tuned cut-offs, min 2 s | 0.65 | 0.61 | 0.62 | 0.52 | 0.94 |
| 2 | 3 frames/s, 2 s average, every cut-off +0.1, min 4 s, Mud/Sand exclusive | 0.68 | 0.56 | 0.48 | 0.32 | 0.86 |
| **3** | 3 frames/s, 1 s average, Mud cut-off +0.2 only, min 2 s, Mud/Sand exclusive | **0.78** | **0.61** | 0.61 | 0.54 | **0.95** |
| people | each annotator against the others | 0.80 | 0.77 | | | |

Run 3's rules were chosen on the tuning lines. Raising every cut-off (run 2) loses the short
Cobble and Boulder patches; the false alarms were Mud's alone. Annotators never label Mud and
Sand on the same frame (0 of 32,636), so the model is now told so after the fact. Full
results in `results/sample-output/`.

`results/sample-output/` and the three runs' sessions in the restored production copy are
evidence for review, not product: the GUI review used this workspace's own API and database.

## Where it stands

- Every frame is downloaded and `dataset_full.csv` covers all three years.
- **Best: five DINOv2 ViT-B runs at 518 px, averaged: 0.755 on all three years' test dives.**
- What moved the score: label timing (+0.06), picture size (+0.04), more data (+0.02),
  DINOv2 (+0.015). Model settings did not, within run-to-run noise.
- Weakest: Mud (many false alarms; precision 0.50) and the CAMPA-2025 dives, which look
  like inconsistent Mud/Sand labelling rather than the model.
- Annotators agree at 0.81 on the lines several of them annotated; run 3 reaches 0.78
  against them on one such line (people 0.80) and 0.61 on the other (people 0.77).
- **Next, decided by Isaac: rebuild and retrain on the fixed habitat crop, the bottom-middle
  box.** Every model above was trained on the full width below the overlay, while the habitat
  crop and the Mosaic's pictures use the bottom-middle box. The dataset keeps whole frames, so
  this is `train.py ... bottom_middle`, no new download.
- The model could learn that Mud and Sand never occur together, instead of being told after.
- How habitat is queried and reviewed in the Mosaic is decided on #342 (segments of one
  combination of substrates, reviewed by tapping the wrong substrate).
