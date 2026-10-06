---
task: MarineAppliedResearch/MARP_API#<issue needed>
repos: [MARP_API]
status: design
needs: []
---

## Goal

The Mosaic's video page becomes a place to annotate, not only to review: a reviewer can add an
observation by drawing a box and picking its species, rename an observation's species
everywhere at once, merge two observations into one, correct an observation's count when the
model missed individuals, and choose the frame the Mosaic's picture is cut from. Adding has to
be as easy as it can be made (Isaac, 2026-10-06: "focus on usability and making this as easy as
possible"). Stacked on #181 (`181-video-review`, pull request #246), which built the boxes and
their GUI-style editing.

## What investigation found

- **Adding.** The GUI draws a box, then a species button creates the observation (count 1)
  with `POST /observation`, then its `start` keyframe with `POST /keyframe` -- two calls, not
  atomic; the end is set later. The API's create route leaves `project_id`, `species_id` and
  `user_id` NULL, recomputes `obsID` as the session's max + 1 (and gives `-1` in an empty
  session), and answers `{}` on failure. No V2 route creates an observation properly.
- **Renaming.** Two incompatible paths. The GUI sends `taxserial` and `comname` through
  `PUT /observation`, which also renames `keyframes.comname` but leaves `species_id` stale.
  The Mosaic's correction (`POST /mosaic/observations/species`) sets only `species_id`,
  deliberately keeps `comname` frozen, does not rename keyframes, records the change in
  `observation_reviews` and clears `observation_review_current`.
- **Merging.** Nothing merges, in the GUI or the API. The keyframe `PUT` refuses to change
  `observation_id` or `subset`; deleting an observation cascades to its keyframes.
- **Count.** `observations.count`. The GUI's count route is a `GET` that matches `obsID` rather
  than the primary key and reports success when nothing matched. GPU rows default to 1.
- **The Mosaic's picture.** Chosen automatically: `thumbnailCandidates()` builds a list from the
  lowest subset around `mediaPosition`, and `observation_thumbnails.candidate_index` picks from
  it. A person can only ask for "the next candidate". No column records a chosen frame.
- **Sessions.** 264 of 461 videos hold observations from more than one session (up to 12), so
  a new observation's session is not implied by its video.

## Requirements

- **R1** — **Add.** Dragging out a box on the picture where there is no box opens a species search
  beside it, recently used species first; one click or Enter creates the observation. It has a
  `start` keyframe on that frame and no end until one is set (as the GUI). Its session is
  chosen in the same popup from the sessions with observations in this video, defaulting to
  the opened observation's; `project_id`, `species_id`, `comname`, `taxserial`, the timecode
  columns, `obsID` and the reviewer's `user_id` are filled. Count 1. One request, atomic.
- **R2** — **Extend.** With an observation selected, a box drawn before its first keyframe becomes
  its `start` (the old start a `middle`), and one after its `end` becomes the `end`; elsewhere a
  `middle`. The GUI's "Add To Obs".
- **R3** — **Rename.** Changing an observation's species changes `species_id`, `comname`,
  `taxserial` and every keyframe's `comname`, and the box label shows the new name. The
  Mosaic's correction does the same (A1), and still records the change in the review history.
- **R4** — **Merge.** Merging B into A moves B's keyframes onto A's track and deletes B. A keeps its
  id, species and count. Where both have a keyframe on one frame, A's box is kept. The merged
  track has exactly one `start` (the earliest) and one `end` (the latest, if either had an end);
  every other keyframe is a `middle`; every keyframe carries A's name.
- **R5** — **Count.** The count of an observation can be changed; it stays one observation with one
  set of boxes. For the science data, when the model detected fewer individuals than there were.
- **R6** — **Mosaic picture.** "Use for Mosaic picture" on a box makes the Mosaic's thumbnail be cut
  from that frame with that box. On a frame between keyframes, the box there is pinned as a
  keyframe first. The choice survives later automatic extraction.
- **R7** — **The panel.** Selecting a box opens a panel for its observation: species (changeable),
  count (changeable), obs ID, session, its keyframes, Merge, and Use for Mosaic picture.
- **R8** — Every change is saved as it is made, through the API, and what the page shows
  afterwards is what the database holds. Thumbnails are extracted again where the box changed.

## Open assumptions

- [x] **A1 · data-meaning · blocking** — answered 2026-10-06: rename fully everywhere,
  including the Mosaic's correction, which until now kept `comname` frozen for auditing. The
  old species stays in `observation_reviews`. `marp-mosaic-review/CLAUDE.md`'s *Two names for a
  species* changes with it.
- [x] **A2 · data-meaning · blocking** — answered 2026-10-06: a merge keeps A's species and A's
  count; B's count is dropped with B.
- [x] **A3 · data-meaning · blocking** — answered 2026-10-06: on a frame where both have a
  keyframe, A's box is kept.
- [x] **A4 · behavioural · blocking** — answered 2026-10-06: a new observation is a `start`
  only; the end is set later, as in the GUI.
- [x] **A5 · product/UI · blocking** — answered 2026-10-06: the Mosaic picture may be any frame,
  from the box on it, pinned as a keyframe if it is between keyframes.
- [x] **A6 · product/UI · blocking** — answered 2026-10-06: draw, then pick from a popup.
- [x] **A7 · product/UI · blocking** — answered 2026-10-06: a panel for the selected box.
- [x] **A8 · data-meaning · blocking** — answered 2026-10-06: the reviewer picks the session from
  this video's sessions, defaulting to the opened observation's.
- [ ] **A9 · database/schema · non-blocking** — where the chosen Mosaic picture is recorded.
  Proposed: two nullable columns on `observation_thumbnails` (`chosen_framenum`,
  `chosen_subset`), read by the extraction before its candidate list; a migration with a `down`.
- [ ] **A10 · data-meaning · non-blocking** — a new observation's timecode columns (`tc`,
  `actualPosition`, `frame`) come from its `mediaPosition` by the GPU ingest's own derivation
  (`service/observation-ingest.service.js`), at 25 frames per second as GUI rows are.
- [ ] **A11 · product/UI · non-blocking** — merging is started from A's panel ("Merge another
  observation into this one"), then a click on B's box, then a confirmation naming both, since
  B is deleted. Only observations in the same video.
- [ ] **A12 · behavioural · non-blocking** — B's keyframes join A's track with the lowest subset.
  Every observation today has one track.
- [ ] **A13 · security/permissions · non-blocking** — adding, renaming, merging and counting
  need `observations:write`; boxes need `keyframes:write`. No new permission keys.
- [ ] **A14 · data-meaning · non-blocking** — a count is a whole number of at least 1.
- [ ] **A15 · product/UI · non-blocking** — the species search offers the session type's
  species list, as the Mosaic's correction panel does.

## Decisions

- **2026-10-06** — A1-A8 above, from Isaac.

## Plan

1. API: create (R1), extend (R2), rename (R3, the Mosaic route too), merge (R4), count (R5),
   chosen picture (R6, migration). Each atomic, each with Jest tests that seed and remove.
2. Page: drawing a new box and the species popup; the observation panel; merge picking; Use for
   Mosaic picture.
3. Browser tests over real video at desktop and phone width; unit tests for the rules.

## Acceptance criteria

- A reviewer adds an observation with one drag and one click, and it is in the database with
  every column the GUI's rows carry.
- After a rename, a merge or a count change, the page, the Mosaic and the database agree.
- The Mosaic shows the picture the reviewer chose.

## Test plan

- Unit: extension type rules; merge planning (same-frame, start/end); popup and panel rules.
- API (`npm run test:mosaic`): each route, refusals, atomicity, and rows restored.
- Browser (`npm run test:app:mosaic-review:api`): add, rename, merge, count and Mosaic picture
  over real video, desktop and phone width.
