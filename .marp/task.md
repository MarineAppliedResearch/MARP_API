---
task: MarineAppliedResearch/MARP_API#271
repos: [MARP_API]
status: implementing
needs: []
---

# Review a built dataset in the Mosaic

Issue: MarineAppliedResearch/MARP_API#271 · Branch: `271-dataset-review` from `develop`

## Goal

A reviewer can open any built dataset in the Mosaic and check exactly the pictures a model
was trained on. Pick a species and see every Bat star picture the dataset holds, say, then
flag the 17 that are wrong. Each flagged picture is recorded on the observation it came
from: the next dataset built leaves that picture out and keeps the rest of the track, and it
waits in the Mosaic to be fixed. This is needed before the first habitat model is trained
entirely in MARP (#287).

## What the investigation found (2026-11-24)

- **The model mostly trains on pictures between keyframes.** Since #296 a build takes 10
  frames per object, spread along the track (`service/dataset-build-plan.js`,
  `DEFAULT_FRAMES_PER_OBJECT`). Most of them fall between keyframes, where the box is a
  straight line from one keyframe to the next. Reviewing the dataset's own pictures is
  therefore how the in-between frames get reviewed.
- **A built dataset is frozen.** It is one archive named for its own hash, so a training run
  can be traced to exactly what it learned from. Review changes what the *next* build takes,
  never an existing dataset.
- **The dataset's pictures exist only inside its archive**, named `<video>_<frame>.jpg`. A
  YOLO label line says class and box, not which observation the box came from, so the archive
  alone cannot give "this track's pictures".
- **Reviews today are per observation** (`observation_reviews`, purpose `training`:
  promoted, excluded, withdrawn). Keyframes carry no review state.
- **The video page can already fix a line that has drifted off the animal.** Dragging an
  in-between box and double-clicking pins it as a new keyframe, as in the annotation GUI
  (`src/model/box-edit.js`).
- **The Mosaic fits**, with additions. Its grid, paging, filters, page-at-a-time commit and
  link to the video page carry over. It needs a dataset filter, a new kind of tile, and
  pictures for that tile.

## Decisions

- **2026-11-24** (Isaac) — It lives in the Mosaic.
- **2026-11-24** (Isaac) — One tile is one track (one stretch for habitat). It flips through
  the pictures the dataset took from that track, one after another, with the box drawn on
  each. Opening a tile shows its pictures side by side, and single pictures are marked there.
- **2026-11-24** (Isaac) — Draw only what is in the dataset itself: its own boxes, not the
  other animals annotated in the same picture.
- **2026-11-24** (Isaac) — The ROV does not move in a straight line, but the box between two
  keyframes does, so the line can drift off the animal. That is why the in-between pictures
  are checked, on every interpolated track, a model's or a person's.
- **2026-11-24** (Isaac) — Review writes to the source observation, so a dataset built
  afterwards does not take what was marked wrong.
- **2026-11-24** (Isaac, A1) — **The unit is the picture.** A picture flagged wrong is that
  one frame of that track, and only that frame is left out of new datasets. The rest of the
  track is still used.
- **2026-11-24** (Isaac, A2) — **No new state.** A picture is promoted or flagged, and a flag
  carries a reason from the existing list, saying what is wrong ("the box is off the animal"),
  never "needs fixing". Fixing the box does not clear a flag, and nothing returns to promoted
  by itself: a reviewer promotes the picture again once it is right.
- **2026-11-24** (Isaac, A3) — Habitat: a wrong habitat picture means the substrate is wrong
  at that moment. It is flagged like any other picture, and new datasets leave that picture
  out until it is promoted again.
- **2026-11-24** (Isaac) — Both ways of fixing: find now and fix later in a batch from the
  Mosaic, or fix one straight away on the video page.

- **2026-11-24** (Isaac) — **The pictures must be big enough to judge.** A Bat star was a
  few pixels in a 320-pixel whole frame. The tile is zoomed in on the track's box; the opened
  tile shows each picture large.
- **2026-11-24** (Isaac) — **Every animal of the dataset's species in a picture must be
  boxed.** YOLO reads an unboxed animal as background, so a frame with three starfish and two
  boxes teaches the model wrong. Reviewing a picture is also checking that nothing of the
  dataset's species is left without a box.

## Open assumptions

- [x] **A1 · scientific or data-meaning · blocking** — answered 2026-11-24: the picture is the
  unit; only the flagged frame is left out. See Decisions.
- [x] **A2 · behavioural · blocking** — answered 2026-11-24: promoted or flagged with a reason,
  no "needs fixing" state; a reviewer promotes it again once fixed. See Decisions.
- [x] **A3 · scientific or data-meaning · blocking** — answered 2026-11-24: a habitat picture
  is flagged like any other. See Decisions.
- [ ] **A4 · behavioural · non-blocking** — Committing a page promotes the pictures nobody
  marked, as the Mosaic's page commit does for observations, so a dataset can say how much of
  it has been checked. Default: yes.
- [ ] **A5 · product/UI · non-blocking** — Which reasons a picture can be flagged with.
  Default: the Training Data Review list as it is (Bounding box too loose, Occluded, Too
  small, Ambiguous ID, Other / unsure), since this is training data. "The box is off the
  animal" is missing from it and is the commonest case here; adding it is one word in two
  places, and is Isaac's call.
- [ ] **A6 · architectural · non-blocking** — Pictures for the tiles: a small copy of every
  picture is saved when a dataset is built, with a record per picture of its dataset,
  observation, video, frame, split and the box or labels drawn on it. Saving them must never
  fail a build. Datasets built before this get theirs once, by a script, as a later step.
- [x] **A8 · scientific or data-meaning · blocking** — answered 2026-11-24: "if something is
  not reviewed, it shouldn't end up in the data set at all." The build leaves out any picture
  another annotation of the dataset's species covers. An animal of the dataset's species can
  be annotated in MARP and still left out of the dataset, because only promoted tracks are
  taken; the build then cuts a picture showing it with no box. In dataset 382, 54% of the
  California sea cucumber pictures had one. Does the build leave such a picture out by itself,
  or put it in and leave it to review?
- [x] **A9 · product/UI · non-blocking** — answered 2026-11-24: add both. The flag reasons. "Box off the animal" and "An
  animal has no box" are the two this review is for and neither is in the training list. Add
  both?
- [ ] **A7 · database/schema · non-blocking** — A picture's review is kept like an
  observation's: a log of every decision and a current one per observation and frame, so the
  last commit wins and nothing is lost.

## Requirements

- **R1** — The Mosaic can be pointed at one built dataset. Its tiles are then that dataset's
  tracks (stretches for habitat), filterable as now by species, and by the dataset's split.
- **R2** — A dataset tile flips through the pictures the dataset took from that track, with
  exactly the dataset's box drawn on each (its substrate labels, for habitat). Nothing loads
  from Jellyfin to show it.
- **R3** — Opening a tile shows its pictures side by side, and any of them can be flagged,
  with a reason.
- **R4** — Committing a page records each picture's decision on its source observation and
  frame. Existing datasets are not changed.
- **R5** — A new build leaves out every flagged picture and still takes the rest of its
  track. Detection and habitat both.
- **R6** — Flagged pictures can be found again in the Mosaic, and promoted once fixed.
- **R7** — From a picture, one action opens the video page at that exact frame to fix it.
- **R8** — A build saves the small pictures and their records, and a failure to save them
  never fails the build.
- **R9** — A tile shows each picture zoomed in on its track's box; an opened tile shows each
  picture large enough to judge.
- **R10** — An opened picture draws every box the dataset put on it, of every species, the
  track's own picked out, so a missing box can be seen and flagged.

## Plan

Each step is verified before the next.

1. **Schema.** `dataset_pictures`: one row per dataset, observation and frame, with the
   split, what is drawn and the small picture's file. `picture_reviews`: the log of
   decisions per observation and frame, with a view of the current one. (R4, R8)
2. **Builds save the pictures.** The detection build writes a small copy and a record of
   every picture it cuts, per observation; the habitat build the same per stretch. (R8)
3. **Builds leave out flagged pictures.** Both builds skip a frame whose current decision for
   that observation is flagged, and the detection build samples from what is left. (R5)
4. **API.** The Mosaic's query takes a dataset and returns each track with its pictures and
   their decisions; the small pictures are served; a commit records picture decisions. (R1,
   R4, R6)
5. **The Mosaic.** A Dataset Review mode and dataset filter, the flipbook tile, the opened
   tile with its pictures side by side and flagging with a reason, the page commit, a filter
   for flagged pictures, and a Fix button opening the video page at that frame. (R1-R3, R6,
   R7)
6. **Existing datasets** get their pictures, by a script. (A6)

## Acceptance criteria

- A dataset built on this branch opens in the Mosaic, one tile per track, each flipping
  through exactly the pictures in its archive with exactly its boxes.
- A picture flagged there is left out of the next build from the same choices, and the rest
  of its track is in it.
- A flagged picture is found again from the Mosaic, its Fix opens the video page at that
  frame, and promoting it puts it back into the next build.

## Test plan

Filled in at G3.

## Status

- **Gate:** implementing
- **Notes:** Steps 1-5 built 2026-11-24 (schema, builds, API, Mosaic). Mode id is
  `datasetReview`, not `dataset`, because `dataset` is the filter's name. Step 6 (pictures
  for datasets built before this) not started. Tested: `tests/dataset-review-build.test.js`,
  the build tests it touches, `npm run test:mosaic`, and the app's unit tests. Not yet: the
  Mosaic's browser tier.
