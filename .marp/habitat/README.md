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

`experiment/results/` holds every run's full scores, per substrate and per year.

## Where it stands

- **206 CAMPA 2026 videos still need their full frames** (~13,500 frames). Jellyfin was
  serving ~3 Mbit/s to the machine this started on. Re-run step 4; it skips what exists.
- The bottom-middle crop at 384 px had not finished.
- Every run peaks after one or two fine-tuning epochs and then memorises: more data and
  more detail help, longer training does not.
- Weakest: Mud and Sand, and the CAMPA-2025 dives.
