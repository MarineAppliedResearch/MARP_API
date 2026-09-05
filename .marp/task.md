---
task: MarineAppliedResearch/MARP_API#71
repos: [MARP_API]
status: design
needs: []
---

# A confirmation before a permanent delete

## Goal

A reviewer cannot destroy observations without being told exactly what is about to be
destroyed and saying yes to that. Today `Delete Marked` commits straight through: one click
sends a permanent, unrecoverable delete. #68 calls this the most consequential gap in the
client, and it is the last thing in Phase 1 that can hurt somebody.

## What is already true

Read from the code, not assumed:

- `store.commitPage()` calls `MarpData.commitPage(...)` immediately. There is no gate of
  any kind between the button and the request.
- `modes.commitCount({mode, rows, marks})` already returns exactly how many records a
  commit will act on — for Delete, the marked tiles whose `thumbnail_status` is `ready`.
  The confirmation does not need to count anything itself.
- `modes.existingState(mode, row)` gives a row's `review_status` or
  `training_disposition`, so "three of these are already promoted training samples" is
  computable from what the page already holds.
- Delete Mode is the only mode that reads both status dimensions, deliberately, because
  anything already on the record is a reason to stop.
- `MODES.delete.note` already reads *"Commit permanently deletes the marked tiles —
  unmarked tiles are untouched."*

## Requirements

- **R1** — Committing in Delete Mode does not send the request until the reviewer has
  confirmed. Cancelling sends nothing and leaves every mark exactly as it was.
- **R2** — The confirmation names the exact number of observations that will be destroyed,
  and that number is the number actually acted on.
- **R3** — The confirmation says the deletion is permanent and cannot be undone.
- **R4** — No other mode is gated. Scientific review and Training review commit as today.
- **R5** — The confirmation is dismissible by keyboard, and Escape cancels. Deletion is
  never what happens by default.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-05: a confirm button, no typing. Clearing a bad detection run is a real workflow and typing a count twenty times would push people to find a way around it. The breakdown in A3 carries the weight instead: the dialog is worth reading, not just worth clicking.

- [x] **A2 · product/UI · blocking** — answered 2026-09-05: every time, with no way to switch it off. Deletion is permanent and has no recovery path, so the friction is the feature.

- [x] **A3 · scientific/data-meaning · blocking** — answered 2026-09-05: yes, break it down — "10 observations, 3 reviewed, 2 promoted as training samples". This is the line that would actually stop somebody, and it is why Delete Mode reads both status dimensions at all.

- [x] **A4 · product/UI · blocking** — answered 2026-09-05: the count and the permanence, not the filter context. Correct however the page was built, and it does not depend on a page never spanning filters.

- [ ] **A5 · product/UI · non-blocking** — With nothing marked, `Delete Marked` commits zero
      rows today. Should the button be disabled instead, so a confirmation never appears for
      an empty delete?

## Decisions

- **2026-09-05** — Fixture-backed. `src/data.js` stays the seam; no API work in this task.
- **2026-09-05** — The count comes from `modes.commitCount`, which already exists and is
  already what the commit acts on. Recomputing it in the dialog would let the two disagree.
- **2026-09-05** — A5 decided here rather than asked: with nothing marked the commit button
  does nothing, so no dialog appears. Confirming a deletion of zero records would teach
  people to dismiss the dialog without reading it, which defeats A3.

## Plan

A1-A4 answered. The steps:

1. The rule in `model/` — what a delete commit is about to do, and what must be true before
   it may proceed. Unit-testable, no DOM.
2. The gate in `store.commitPage` — refuse to send until confirmed.
3. The dialog in `ui/`, keyboard-dismissible, cancel by default.
4. Tests at all three tiers, then a narrated walkthrough.

## Acceptance criteria

- Committing ten marked tiles in Delete Mode shows a confirmation naming ten, and nothing is
  sent until it is accepted.
- Cancelling leaves all ten still marked and the page unchanged.
- Scientific and Training commits are unaffected.
- `npm run test:unit` and `npm run test:e2e` pass; a walkthrough shows both the confirmed and
  the cancelled path.

## Test plan

Filled in at G3, before anything runs. Expected to span all three tiers, which is why this
task was chosen to go first — the rule belongs in `model/`, "did it actually send" belongs in
the contract tier, and whether the dialog is on screen and dismissible is only observable in
Playwright.

## Status

- **Gate:** implementing — A1-A4 answered 2026-09-05, G1 cleared
- **Notes:** nothing implemented.
