# Automated habitat classification: research plan

Refs MarineAppliedResearch/MARP_API#287.

## Goal

Give MARP a dive. It classifies the seabed once per second and writes Habitat observations:
one per substrate stretch, with a start (`tc`) and end (`etc`). Mixed substrate shows up as
overlapping stretches, and no stretch is too short to make sense. Done means it meets a pass
mark, agreed before training, on dives it has never seen.

## The approach, and why

| Choice | Why (evidence) |
| --- | --- |
| Classify single frames, then turn the scores into stretches | No published substrate work uses a model that reads several frames at once. All of them classify frames and post-process. |
| One yes/no output per substrate, not one class per frame | Mixed substrate is real. On ROV video, one yes/no per substrate beat one class per frame (DUSIA 2022, test mAP 0.692 vs 0.663). |
| Fine-tune the whole network, not frozen features | On substrate, fine-tuning gave 88.3% accuracy and F1 69.5, against 82–84% and F1 57 frozen (BenthicNet 2025). |
| Two candidate backbones: ResNet-50 and DINOv2 ViT-B/14 | ResNet-50 is the architecture with published substrate results. DINOv2 has the best evidence for holding up at new sites and cameras (reef benchmark 2026, JAMBO 2024). No study compares them on substrate, so Phase 5 does. |
| Expect to merge classes | Every study confuses boulder with cobble, and mud with sand (Geisz 2024, BenthicNet, DUSIA). |
| Split by dive, never by frame | Neighbouring frames are near-identical. A random split scores the model on pictures it has effectively seen. |

---

## Phase 0: decisions (Isaac)

- [ ] Which projects and dives are in scope.
- [ ] Who runs the read-only production queries, and when.
- [ ] The pass mark for "automated" (Phase 7). Set it before any model is trained.

## Phase 1: get a copy of production

**Do:** Isaac provides a `pg_dump` of production. It's restored into its own local
PostgreSQL (its own port and data directory, so the dev corpus is untouched), migrated to
`develop`, and used as the database for all of this work. Nothing touches production again.

**Rules for the copy:**
- It holds **real** accounts, unlike the test fixture. Never `marp db publish` it, never
  commit it, and keep the dump file in `.marp/local/`.
- Disk: about 500 GB free here; check the dump size before restoring.

**Check:** row counts per table match the dump; the migrations apply cleanly.

## Phase 2: audit the existing annotation

**Question:** are the habitat intervals usable as training labels, and how much is there?

**Do** (against the local copy):
1. List every substrate name used in Habitat sessions, with counts and total seconds.
2. Interval length per substrate: shortest, median, longest, and the 5th percentile. This
   sets the minimum stretch length in Phase 6.
3. How often intervals overlap (mixed substrate), and which pairs overlap.
4. How much of each dive is covered by intervals, and how much is gaps.
5. How `PCTcover` is filled in: always, sometimes, never, and its typical values.
6. Dives per project, ROV and annotator.
7. Whether any dive was annotated twice. This gives the human agreement ceiling.
8. Which dives still have playable video in Jellyfin.

**Build:** `scripts/audit-habitat.js`, a checked-in, read-only query script that prints the
tables above.

**Output:**
- the class list and how each name maps onto it, decided with Isaac;
- how many dives and hours each class has;
- a candidate dive list.

**Stop if** a class has too little footage to train. Merge it or drop it. Don't build on it.

## Phase 3: build the training data

**Question:** can we produce a clean, labelled, dive-split set of frames?

**Build:**
1. **A migration** adding `multilabel` to the `datasets.task` check constraint. Today it
   allows `detection` and `classification`.
2. **Habitat dataset builder** (`service/dataset-build*`), reusing `extractFrames` and the
   packaging that already exist:
   - takes one frame per second inside each interval;
   - labels each frame with every substrate active at that moment;
   - skips gaps, Stop, Pull, Off Transect, and ±2 s around every boundary;
   - splits by dive: about 70% train, 15% tuning, 15% benchmark, balanced by
     substrate and project;
   - packages the frames in a folder with a `labels.csv`: frame, dive, project, ROV, then one
     0/1 column per substrate.

**Test:**
- *Unit (`npm run test:ml`):*
  - one interval produces the right frame times;
  - overlapping intervals give a frame two labels;
  - gaps and Stop/Pull/Off Transect produce no frames;
  - boundary margins are applied;
  - no dive appears in two splits;
  - the split is the same every run.
- *Migration:* `multilabel` is accepted, any other value is still refused, and `down` restores
  the original constraint.
- *By eye:* 50 random frames per class, labels checked against the picture by Isaac.

## Phase 4: can frames tell the substrates apart at all?

**Question:** is there enough in a single frame to separate the classes? And which classes
have to merge?

**Do:** quick and cheap. Freeze both backbones and train only a final layer on a subset of
the training dives. Score on the tuning dives.

**Measure:** precision, recall and F1 per substrate, plus which classes each substrate is
mistaken for.

**Compare against:** always predicting the most common substrate.

**Output:** the final class list, with merges decided by these errors. And a go or no-go:
if a class is no better than chance, it isn't learnable from frames and is merged or
dropped.

## Phase 5: find the best model

**Question:** which model gives the best per-substrate F1 on dives it has never seen?

**Build:** a **substrate trainer** in `marp-inference-worker`, as a new job engine. The
current one is Ultralytics-only and gives one class per frame.
- Backbone chosen by a setting: `resnet50` (torchvision) or `dinov2_vitb14` (torch.hub).
  Both use the PyTorch already installed.
- One yes/no output per substrate, with each class's loss weighted so sand doesn't swamp the
  rare ones.
- The BenthicNet recipe: train the final layer first, then unfreeze everything at a tenth of
  the learning rate.
- Frames at 224 pixels; flips and colour changes during training; mixed precision so it
  fits the 8 GB GPU.
- Each epoch it reports precision, recall and F1 per substrate. It keeps the best
  checkpoint by tuning-dive F1, and picks the score above which each substrate counts as
  present, on the tuning dives.
- Publishes the weights, the class list and those cut-off scores.

**Experiments.** Each one changes a single thing, and all are scored on the same tuning dives:

| # | Change | Why |
| --- | --- | --- |
| E1 | ResNet-50, fine-tuned | The baseline with published substrate numbers |
| E2 | DINOv2 ViT-B/14, fine-tuned | Best evidence for new sites and cameras |
| E3 | The winner, with Phase 4's class merges against without | How much merging buys |
| E4 | The winner, on the lower part of the frame against the whole frame | Water column and ROV parts in view may add noise |
| E5 | The winner, trained on 25 / 50 / 100% of the training dives | Whether more annotation would help |

**Pick** by mean per-substrate F1, the worst single substrate, and the gap between projects and ROVs.

**Test (worker, `pytest`):**
- *Unit:*
  - the label file is read into the right yes/no rows;
  - the loss weights are computed correctly;
  - the cut-off score chosen per substrate maximises F1 on a small known example;
  - a run that is told to stop actually stops;
  - every artifact is published.
- *GPU tier (Isaac's call, end of phase):* a real two-epoch run on a tiny dataset finishes and
  publishes weights that load again.

## Phase 6: turn frame scores into stretches

**Question:** what settings make the model's stretches look like the annotators'?

**Method**, per substrate and on its own track, so stretches can overlap:
1. Smooth the per-second scores over a window of a few seconds.
2. Start a stretch when the smoothed score rises above a high cut-off; end it when it falls
   below a lower one.
3. Close gaps shorter than G seconds between two stretches of the same substrate.
4. Drop or absorb any stretch shorter than the minimum length L. Start L from Phase 2's
   5th percentile.

**Tune** the window, both cut-offs, G and L on the tuning dives. Optimise for boundary error
and for the number of stretches matching the annotator's.

**Fallback:** if smoothing still flickers, a Viterbi pass that charges for every change of
substrate.

**Test (unit):**
- one noisy frame does not start a stretch;
- a stretch shorter than L never appears;
- a short gap is closed;
- two substrates can overlap;
- a score sitting on the cut-off doesn't flip back and forth;
- the output times are valid `tc`/`etc` text written by `db/timecode.js`.

## Phase 7: benchmark

**Question:** is it good enough to run without review?

**On the benchmark dives**, which nothing has been tuned on, scoring only seconds inside
annotated intervals:

| Measure | What it tells you |
| --- | --- |
| Per-substrate precision, recall and F1, second by second | Is each substrate found, and is it right |
| Which substrate each is mistaken for | What it confuses |
| Boundary error in seconds (median and 90th percentile) | Are starts and ends in the right place |
| Number of model stretches against annotator stretches | Does it fragment |
| Share of each dive per substrate, model against annotator | Are dive summaries right |
| Every measure split by project and ROV | Is one setup weak |
| Against always predicting the commonest substrate | Is it better than nothing |
| Against two annotators on the same dive, if any exist | The realistic ceiling |

**Build:** `scripts/benchmark-habitat.js`. It writes the table above, plus one timeline strip per dive:
the annotator above the model, for Isaac to review by eye.

**Test (unit):** the scoring on hand-made intervals with known answers (perfect match, shifted by
2 s, split in two, missing). Gaps are excluded from scoring.

**Pass:** the mark set in Phase 0. If it passes on some projects and not others, automate
those only.

## Phase 8: put it into MARP

**Build:**
1. **`marp_habitat` engine** (worker): reads the video one frame per second through the
   existing frame reader, scores frames, applies Phase 6, and publishes a results file of
   substrate, `tc` and `etc`.
2. **Interval ingest** (MARP_API): `observation-ingest.service.js` writes `tc` only today. It
   needs to write Habitat observations with `tc` and `etc`, recorded as made by the model,
   in the session decided by Isaac.
3. **Model registration** so a habitat job can name the trained model, like detection jobs do.

**Test:**
- *Worker unit:* the engine refuses a job it can't run, reports progress, stops when told,
  publishes the right file shape. The model is faked; no GPU needed.
- *API (`npm run test:gpu` / `test:observations`):*
  - a results file becomes Habitat observations with `tc` and `etc`, and an unknown substrate
    name is refused;
  - re-ingesting the same file doesn't duplicate rows;
  - the test seeds its own session and removes what it creates.
- *End to end (Isaac's call):* one benchmark dive through the real pipeline. Its rows match
  the benchmark script's output for that dive.

---

## Summary: what gets built

| Component | Where | Phase |
| --- | --- | --- |
| Audit script | MARP_API `scripts/` | 2 |
| `multilabel` dataset migration | MARP_API | 3 |
| Habitat dataset builder | MARP_API `service/` | 3 |
| Substrate trainer engine | marp-inference-worker | 4–5 |
| Frames-to-stretches step | marp-inference-worker | 6 |
| Benchmark script | MARP_API `scripts/` | 7 |
| `marp_habitat` engine | marp-inference-worker | 8 |
| Interval ingest | MARP_API | 8 |

## Risks

- **Boulder vs cobble and mud vs sand** may not separate. Plan for merges (Phase 4).
- **New sites and cameras** are the weak point in every study. That's why scores are split by
  project and ROV, and DINOv2 is a candidate.
- **The labels are stretch-level, not frame-level.** A frame inside a "cobble" stretch may
  show mostly sand. The boundary margins help; the tuning-dive F1 will show how much it costs.
- **Camera height changes apparent size.** Expect it to show up as boulder/cobble errors.
- **Annotators disagree.** Without a twice-annotated dive there's no ceiling to compare against.

## Sources

- BenthicNet (2025): https://arxiv.org/html/2405.05241v3
- DUSIA (2022): https://arxiv.org/html/2206.00718
- Geisz et al. (2024): https://www.mdpi.com/2072-4292/16/7/1264
- Reef benchmark, frozen DINOv2 (2026): https://arxiv.org/abs/2607.02559
- JAMBO (2024): https://mlanthology.org/eccvw/2024/humblotrenaux2024eccvw-underwater
- Jackett et al. (2023), paywalled, not checked: https://besjournals.onlinelibrary.wiley.com/doi/full/10.1111/1365-2664.14408
- Mohamed & Nadaoka (2026): https://www.civilejournal.org/index.php/cej/article/download/6258/2059/18584
