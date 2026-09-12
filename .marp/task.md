---
task: MarineAppliedResearch/MARP_API#138
repos: [marp-api]
status: verifying
needs: []
---

## Goal

Once the reviewer commits a delete, the observation is gone from the database — no
provenance row, and its keyframes and whole review history went with it. The tile stays on
screen so the reviewer can see what they just destroyed, but it stops being something they
can act on: no marking, no accept gesture, no correction panel, no double tap. Today every
one of those still works on a tile whose row no longer exists, and a decision committed
about it comes back as a `not-found` skip whose stated meaning is *"somebody else deleted
this while you were working"* — when in fact the reviewer deleted it themselves a moment
ago.

## Requirements

- **R1** — Whether an observation has been destroyed in this sitting is a rule in `model/`,
  not a condition written into a click handler. One predicate, so every caller asks the
  same question.
- **R2** — A destroyed tile refuses the exception gesture (left click / first tap):
  `toggleMark` changes nothing and fires nothing. Not *"the id is absent from
  `state.touched`"* — it is already there, because the reviewer marked the tile before
  deleting it; what has to hold is that the dead click changes nothing.
- **R3** — A destroyed tile refuses the accept gesture (right click on a pointer, double
  tap on touch): `acceptMark` changes nothing and fires nothing. It is **not** the A4
  refusal shape — no per-tile refusal message; a destroyed tile stops being a target rather
  than explaining itself on each click.
- **R4** — A destroyed tile refuses the correction panel by either route: `openPicker`
  (the badge) and `openCorrection` (the "was X" chip) leave `state.picker` null. This
  matters even though the `DELETED` badge carries no `data-badge`, because `openCorrection`
  creates a mark of its own on the way in.
- **R5** — A page-level mark does not reach a destroyed tile: `markAllOnPage` skips it, so
  the next commit cannot be handed a row the server will answer `not-found` for.
- **R6** — The tile says why it is inert. Its tooltip states that the observation was
  removed from the database and nothing more can be recorded about it, instead of the
  ordinary confidence/dive/timecode line.
- **R7** — The tile keeps its picture and stays visible. The cascade deletes database rows
  only; the JPEG is still there, and seeing what was destroyed for the rest of the sitting
  is the point. It disappears on the next query, which is existing behaviour and correct.
- **R8** — Assistive technology is told: the tile carries `aria-disabled="true"`. It stays
  a real `<button>` in the DOM and a real click still reaches the store, which is what makes
  "the click does nothing" observable at the render tier rather than swallowed by CSS.

## Open assumptions

- [ ] **A1 · architectural · non-blocking** — *Destroyed is derived from the commit
  outcome (`state.outcomes.get(id) === 'deleted'`), not from a new session-wide set of
  destroyed ids.* Proposed, with the reasoning: that map has exactly the lifetime of the
  `DELETED` badge the tile already draws, so inert and DELETED are the same fact rather
  than two facts that can disagree. The alternative buys nothing reachable — outcomes are
  parked per mode, but `cache.keyFor` includes the mode, so a mode switch empties the cache
  and re-queries, and the deleted row does not come back from the server; a filter change
  clears the outcomes *and* the cache for the same reason. A session-wide set would only
  differ if a destroyed row could return to the screen, and no path found does that.
- [ ] **A2 · product/UI · non-blocking** — *The tooltip wording is the issue's own:
  "Removed from the database — nothing more can be recorded about it."* Proposed as
  written, prefixed with the species name the tooltip already leads with.
- [ ] **A3 · product/UI · non-blocking** — *The picture stays exactly as it is drawn
  today* — greyscale, darkened and hatched by `.tile.out-deleted`, which already exists.
  The issue asks whether it still shows its picture; it does, and this changes nothing.
- [ ] **A4 · behavioural · non-blocking** — *`retryFailedThumbnails` is left alone.* A
  page-level retry can still name a destroyed row whose thumbnail had failed, and the
  endpoint would answer for a row that is gone. It is not one of the gestures #138 names,
  it costs a request rather than a record, and widening the change to cover it is scope
  this task did not ask for. Named here rather than fixed.

## Decisions

- **2026-09-12** — The guard goes in the store actions, reading one rule from `model/`,
  rather than in `ui/mount.js`. The issue is explicit about this: a guard in the click
  handler alone leaves `toggleMark`, `acceptMark` and `openCorrection` each reachable by
  another path (the picker's own controls, the keyboard, the console).
- **2026-09-12** — Two of the five refusals are unreachable today and are kept anyway.
  `acceptMark` (R3) cannot be reached because destroyed tiles exist only in Delete Mode and
  Delete Mode has no accepted value (#126 A2); `openPicker` (R4) needs an exception mark,
  which a destroyed tile can no longer have. `openCorrection` and `toggleMark` and
  `markAllOnPage` are all reachable. The guards are one named question asked in five
  places rather than four correct paths and a fifth that depends on an unrelated rule
  staying true.
- **2026-09-12** — The tile is not `disabled` and does not get `pointer-events: none`.
  Either would make a click at the render tier a Playwright error rather than a click that
  does nothing, which is the behaviour actually being asserted. `aria-disabled` says the
  same thing to assistive technology without hiding the defect from its own test.

## Plan

1. `model/page.js`: one predicate, `isDestroyed(outcomes, id)`, beside the other outcome
   rules. Unit test it.
2. `store.js`: guard `toggleMark`, `acceptMark`, `openPicker`, `openCorrection`; skip
   destroyed rows in `markAllOnPage`.
3. `ui/tile.js`: the tooltip and `aria-disabled` on a destroyed tile.
4. Unit test the rule (R1); contract-tier checks that the store refuses each gesture
   (R2–R5); render-tier check that clicking a committed-deleted tile changes nothing on
   screen (R2, R6, R8).

## Acceptance criteria

- In Delete Mode, marking two tiles and committing leaves both showing `DELETED`; clicking
  either one afterwards adds no `marked` class, no mark badge and no entry in
  `state.marks`.
- Right-clicking one of them does nothing; the correction chip and the badge open no panel.
- "Flag all on page" after a delete commit leaves the destroyed tiles unmarked.
- Hovering a destroyed tile explains that nothing more can be recorded about it.
- `npm run test:unit` green; `npm run test:e2e` green at both viewports.

## Test plan

- **R1** — `tests/unit/model.test.mjs`, *"R1: an observation a commit destroyed is
  destroyed, and nothing else is"*. Proved red first: `page.isDestroyed is not a function`.
- **R2–R5** — `tests/requirements.js`, four checks under *Delete mode*, each driving a real
  commit through the confirmation rather than writing an outcome by hand. Three went red
  against the old store; R3 is a pin rather than a tripwire and says so in its comment.
- **R2, R3, R4, R5, R6, R7, R8** — `tests/e2e/render.spec.mjs`, *"a tile whose row has been
  destroyed"*, five tests. Red against the old files, on `class="tile marked"` drawn over a
  destroyed observation. R5 is desktop-only: `.markall` is `display: none` under the phone
  media query, so the page-level mark is not a gesture that exists there.
- **Not covered** — the API tier. Nothing here is in the gap between what a commit
  recorded and what the row still says: the refusal reads the commit's own answer, and both
  backings put the same `deleted` outcome there (`data.js:1145`,
  `repository/mosaic-commit.repository.js:942`). A `tests/api/` case would destroy a real
  observation from the corpus to assert a client-side refusal, and there is nothing to
  restore it with.

## Status

- **Gate:** verifying
- **Notes:** Implemented and verified at the unit, contract and render tiers. Four
  assumptions are still open and none blocked implementation — each carries the answer it
  was built on, so a one-line "yes" settles all four and a different answer is a small
  change in each case. One thing found and left alone: `retryFailedThumbnails` (A4) can
  still name a destroyed row.
