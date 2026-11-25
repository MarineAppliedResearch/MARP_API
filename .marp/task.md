---
task: MarineAppliedResearch/MARP_API#271
repos: [MARP_API]
status: design
needs: []
---

# Review a built dataset in the Mosaic

Issue: MarineAppliedResearch/MARP_API#271 · Branch: `271-dataset-review` from `develop`

## Goal

A reviewer can open any built dataset in the Mosaic and check exactly the pictures a model
was trained on. Pick a species and see every Bat star picture the dataset holds, say, then
mark the 17 that are wrong. Each wrong picture is recorded on the observation it came from:
the next dataset built leaves it out and keeps the rest of the track, and it waits in the
Mosaic to be fixed. This is needed before the first habitat model is trained entirely in
MARP (#287).

## What the investigation found (2026-11-24)

- **The model mostly trains on pictures between keyframes.** Since #296 a build takes 10
  frames per object, spread along the track (`service/dataset-build-plan.js`,
  `DEFAULT_FRAMES_PER_OBJECT`). Most of them fall between keyframes, where the box is a
  straight line from one keyframe to the next. Reviewing only the keyframes would miss the
  very pictures this is for.
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
- **2026-11-24** (Isaac) — Only the bad pictures are kept out of new datasets. The good
  pictures of the same track are still used.
- **2026-11-24** (Isaac) — Something marked wrong is flagged and waits to be taken care of.
  Fixing it does not return it to promoted by itself.
- **2026-11-24** (Isaac) — Both ways of fixing: find now and fix later in a batch from the
  Mosaic, or fix one straight away on the video page.
- **2026-11-24** (Isaac) — The reason for checking: the ROV does not move in a straight line,
  but the box between two keyframes does, so the line can drift off the animal. This applies
  to every interpolated track, a model's or a person's.
- **2026-11-24** (Isaac) — Reviewing writes to the source observation or keyframe, so a new
  dataset built afterwards does not choose what was marked wrong.

## Open assumptions

- [ ] **A1 · scientific or data-meaning · blocking** — A wrong picture between two keyframes
  means the straight line between *those two keyframes* is off. Is it that whole stretch of
  the track between the two keyframes around it that new builds leave out until it is fixed?
  The alternative is leaving out only that one frame. That one is weaker: the next build
  takes its 10 frames afresh, and could pick a neighbouring frame on the same wrong line. A
  wrong picture that is itself a keyframe would leave out just that keyframe's frame.
- [ ] **A2 · behavioural · blocking** — How is a flag taken care of? Proposed: fixing the box
  on the video page does not clear it, as decided. The flag shows in the Mosaic under a new
  "Needs fixing" filter, a reviewer looks at it again there and marks it fixed, and only then
  can new builds take that stretch again. The track's own promotion is left as it is
  throughout, since its good pictures are still used.
- [ ] **A3 · scientific or data-meaning · blocking** — Habitat. A stretch has no keyframes in
  between and no box line to drift. A wrong habitat picture means the stretch's substrate, or
  one of its ends, is wrong at that moment. Proposed: the flag covers the 10 seconds that
  picture stands for, and new builds leave those out until it is fixed on the video page's
  habitat timeline.
- [ ] **A4 · behavioural · non-blocking** — A committed page records its unmarked pictures as
  looked at and fine, not only the bad ones. A dataset can then say how much of it has been
  checked. Proposed: yes.
- [ ] **A5 · architectural · non-blocking** — Pictures for the tiles: a small copy of every
  picture is saved when a dataset is built, with a record per picture of its dataset,
  observation, video, frame, split and the box or labels drawn on it. Datasets built before
  this get theirs once, by a script reading their archives. Proposed default, given on
  2026-11-24 without objection. It changes the build service, which must not become less
  reliable, so saving the copies must never fail a build.
- [ ] **A6 · database/schema · non-blocking** — A flag is stored as a frame range on the
  observation (from frame, to frame), not as a pair of keyframe ids. Fixing a track adds or
  moves keyframes, and a range still means the same thing afterwards.

## Requirements

- **R1** — The Mosaic can be pointed at one built dataset. Its tiles are then that dataset's
  tracks (stretches for habitat), filterable as now by species, and by the dataset's split.
- **R2** — A dataset tile flips through the pictures the dataset took from that track, with
  exactly the dataset's box drawn on each (its substrate labels, for habitat). Nothing loads
  from Jellyfin to show it.
- **R3** — Opening a tile shows its pictures side by side, and any of them can be marked wrong.
- **R4** — Committing a page records the marks on the source observations (A1-A4). Existing
  datasets are not changed.
- **R5** — A new build leaves out what is flagged and still takes the rest of the track.
- **R6** — A "Needs fixing" filter in the Mosaic lists what is flagged; it is cleared only by
  a reviewer (A2).
- **R7** — From a wrong picture, one action opens the video page at that exact frame to fix it.

## Plan

Written once A1-A3 are answered.

## Acceptance criteria

Written with the plan.

## Test plan

Filled in at G3.

## Status

- **Gate:** design
- **Notes:** A1-A3 block building. Nothing is implemented.
