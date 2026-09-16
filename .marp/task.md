---
task: MarineAppliedResearch/MARP_API#136
repos: [MARP_API]
status: verifying
needs: []
---

## Goal

A desktop reviewer can sweep a mouse rectangle across many Mosaic tiles and give every
eligible tile the left-click or right-click mark in one gesture, then use the existing
Commit Marked workflow instead of clicking dozens of tiles individually.

## Requirements

- **R1** — Pressing and dragging the left mouse button over the Mosaic draws a visible
  selection rectangle; releasing applies the active mode's exception mark to every tile
  the rectangle touches.
- **R2** — Pressing and dragging the right mouse button draws the same rectangle; releasing
  applies the active mode's accepted mark in Scientific and Training modes and remains inert
  in Delete Mode, matching the existing right-click vocabulary.
- **R3** — Rectangle membership is geometric intersection: a tile is included when any part
  of its rendered box touches the normalized drag rectangle, whichever direction the mouse
  travels.
- **R4** — The gesture adds to the current work and sets every included tile to the requested
  kind. It does not toggle same-kind marks off; an opposite pending mark becomes the later
  requested kind.
- **R5** — Marks remain staged only. Releasing the drag never commits, corrects, deletes, or
  writes any observation; the existing Commit Marked button remains the only bulk write.
- **R6** — One completed drag updates the whole group through one store action and one render,
  not one full application render per tile.
- **R7** — During a drag, the band and prospective tiles provide clear visual feedback. The
  feedback disappears on release or cancellation and is not confused with committed state.
- **R8** — An ordinary click or right click below the movement threshold retains its exact
  current single-tile behavior. The synthetic click/context-menu event after a completed
  drag must not alter one additional tile.
- **R9** — A gesture beginning on a badge, reason/detail control, changed-species chip, popup,
  or other interactive control retains that control's existing behavior and does not begin
  group selection.
- **R10** — Pointer cancellation, Escape during an active drag, leaving the usable grid, or
  losing capture cancels cleanly without applying partial marks or leaving a band behind.
- **R11** — The phone supports both normal scrolling and touch rectangle multi-selection.
  Selection release stages the requested exception or acceptance for every intersected tile;
  the phone interaction for distinguishing scrolling from selection is settled with the human
  before implementation.
- **R12** — Left-dragging creates exception marks without opening dozens of detail popups;
  reasons and notes remain optional per-tile edits through the existing popup.
- **R13** — Pure model tests cover rectangle normalization/intersection and the bulk mark
  rule; real-browser tests cover mouse drag, right drag, cancellation, click preservation,
  one-render performance, Commit Marked compatibility, and phone gesture regression.

## Open assumptions

- [x] **A7 · product/UI · blocking** — Answered 2026-09-16: immediate swipes scroll;
  holding briefly and then dragging draws the touch selection rectangle. Releasing opens a
  compact workflow choice (science: Flag/Reviewed; training: Exclude/Promote), and choosing
  applies that kind to the intersected tiles. No Select toggle. Mouse behavior is unchanged.

- [x] **A1 · product/UI · blocking** — answered 2026-09-15 by the user's description: “a
  specific group” means the existing mark kind, not bulk species correction. Left drag is
  exception; right drag is accepted.
- [x] **A2 · behavioural · blocking** — answered 2026-09-15 by “it marks all those”: a drag
  is additive and sets one kind; overlapping an existing same-kind mark leaves it marked
  rather than toggling it off.
- [x] **A3 · product/UI · blocking** — answered 2026-09-15: a right drag accepts every
  eligible tile, skips tiles with missing/unusable imagery, and shows one compact skipped
  count rather than simultaneous per-tile refusal messages.
- [x] **A4 · behavioural · blocking** — answered 2026-09-15 against the recommendation:
  drag marking must never stage “Taking Back.” It directly stages the requested mark on
  every eligible touched tile, including a tile already committed as reviewed/promoted.
  Taking Back remains exclusive to the existing single-click gesture.
- [x] **A5 · product/UI · blocking** — answered by the explicit left/right mouse-button
  request and the existing phone contract: rectangle selection is mouse-only. Touch keeps
  scrolling, tap marking, and double-tap acceptance.
  **Superseded 2026-09-16:** the user explicitly requires scrolling and multi-selection on
  the phone; R11 and A7 replace the mouse-only limitation.
- [x] **A6 · product/UI · non-blocking** — no separate drag-undo command is added. All marks
  remain uncommitted and reversible through the existing tile gestures and Clear Marks.

## Decisions

- **2026-09-15** — This is a multiplier on the existing two mark kinds, not a new selection
  state, new commit route, species operation, or database concept.
- **2026-09-15** — Geometry is a pure model rule; pointer capture and the rubber band belong
  to UI wiring; the store applies the settled group exactly once.
- **2026-09-15** — Use a small movement threshold to distinguish a click from a drag, and
  suppress the browser's follow-up click/context-menu only after the threshold is crossed.
- **2026-09-15** — A drag sets marks directly and never routes through the single-click
  take-back rule. A later Commit Marked may replace the recorded decision; the drag itself
  still writes nothing.
- **2026-09-15** — A right drag partially succeeds across missing imagery: usable tiles are
  marked accepted and one group summary reports how many unusable tiles were skipped.

## Plan

1. Add pure rectangle normalization, intersection, and bulk-mark planning rules.
2. Add one store action that applies the planned ids, touched state, refusal summary, log
   entry, and notification as a single transaction.
3. Wire mouse pointer capture, movement threshold, prospective-tile preview, release,
   cancellation, and suppression of the follow-up click/context menu.
4. Style the selection band and preview so they remain legible across all Mosaic modes.
5. Add focused unit and API-backed desktop/phone browser coverage.
6. Write the G3 verification plan and stop for human review before running it.

## Acceptance criteria

- One left or right mouse sweep marks a large contiguous group without extra single-tile
  changes when the button is released.
- The selected group can be committed through Commit Marked without a special backend path.
- Existing single-click, right-click, popup, keyboard, and phone gestures behave as before.
- A cancelled or accidental sub-threshold movement changes no more than the ordinary click
  would have changed.
- A large drag causes one application rerender, not one rerender per tile.

## Test plan

Written in `.marp/verification.md`. It names focused pure-model coverage and one API-backed
browser file running the desktop mouse behavior plus phone regression; no walkthrough,
migration, production database, or live service is required.

## Status

- **Gate:** implementation complete; mouse and real-touch browser evidence recorded
- **Notes:** The pure rectangle/bulk-mark model, single store action, mouse pointer wiring,
  cancellation, visuals, compact imagery-skip acknowledgement, and focused model/browser
  tests are implemented. Hold-then-drag touch selection and the release-time science/training
  choice are implemented. Fast parsing/model checks and the focused desktop/phone browser
  evidence passed. The actual iPhone behavior remains for the human to confirm.
