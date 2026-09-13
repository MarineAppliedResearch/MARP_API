---
task: MarineAppliedResearch/MARP_API#167
repos: [marp-api]
status: ready-for-pr
needs: []
---

## Goal

Make every pending Scientific or Training decision visibly different from one that has reached the record, without obscuring the image being reviewed.

## Requirements

- **R1** — Every pending decision in Scientific and Training has a strong 3px outline in the decision's established color and pattern: flag, review, exclude, promote, and taking back.
- **R2** — After a successful Commit Marked or page commit, every recorded Scientific or Training decision has a lighter 1px outline in that same color and pattern. This applies equally to flags, reviews, exclusions, and promotions.
- **R3** — A recorded decision already present when the page loads has the same 1px treatment as one saved in the current sitting.
- **R4** — Scientific and Training images retain normal brightness and color in pending and committed states. The decision state must not make evidence harder to inspect.
- **R5** — A failed or conflicted commit retains the pending treatment. Taking back a committed decision uses the strong pending outline until the withdrawal succeeds; canceling the take-back restores the committed treatment.
- **R6** — The primary badge remains exactly one element and keeps the established mark > outcome > record precedence. The visual treatment does not introduce a second status or let a record tag outrank a pending choice.
- **R7** — Scientific and Training behave consistently at desktop and phone viewports. Delete Mode retains its existing destructive treatment.

## Open assumptions

- [x] **A1 · product/UI · blocking** — Settled by the user: do not dim Scientific or Training imagery; distinguish state with border thickness instead.
- [x] **A2 · product/UI · blocking** — Settled by the user: the distinction applies to every decision, including flagged, reviewed, excluded, promoted, and taking back, rather than exceptions alone.
- [x] **A3 · product/UI · non-blocking** — Settled by the user's example: pending uses a slightly thicker border and committed uses a slightly thinner border. Use 3px and 1px so the difference remains visible over the mosaic at desktop and phone sizes.
- [x] **A4 · behavioural · non-blocking** — Settled by the existing tile contract: a committed exception remains marked and editable; this change adds a rendering distinction without changing the gestures or commit behavior.
- [x] **A5 · product/UI · non-blocking** — Settled by the earlier direction: leave Delete Mode alone, including its existing destructive dimming.

## Decisions

- **2026-09-12** — Derive one recorded class for both decision kinds rather than encode flags and accepts separately. Outcomes identify a successful current commit; the row identifies a decision from an earlier sitting.
- **2026-09-12** — Keep each decision's existing hue and solid/dashed pattern. Thickness alone carries pending versus recorded, so the vocabulary remains consistent and image pixels stay unchanged.
- **2026-09-12** — Canceling a take-back clears the tile's touched state. The reviewer has restored the recorded decision, so the border and Commit Marked must both say that nothing is pending.
- **2026-09-12** — Test the distinction in the real-API browser tier because the fixture writes status columns in place and cannot faithfully represent the gap between a commit outcome and the row loaded before it.

## Plan

1. Derive one committed-decision class in `src/ui/tile.js` for exceptions and acceptances without changing badge precedence.
2. Clear the pending touch when a reviewer cancels a take-back so the rendered state and Commit Marked agree.
3. Apply strong pending and light committed outlines in `styles/app.css`, and remove Scientific/Training decision dimming.
4. Add focused real-API browser coverage for both decision kinds, taking back, successful reload, and refused states in both modes and viewports.
4. Write the issue-specific verification plan for human review before running it.

## Acceptance criteria

A reviewer can distinguish any unsaved Scientific or Training decision from a saved one by border thickness before and after committing and after reloading, while the evidence image stays fully visible. A refused save and a pending take-back never look recorded. Existing badge, reason, gesture, and Delete behavior remain unchanged.

## Test plan

Filled in at G3 in `.marp/verification.md` after implementation, before tests are run.

## Status

- **Gate:** ready-for-pr
- **Notes:** The approved G3 plan passed: 8 decision-state browser cases and 2 failure-path browser cases against the real API and disposable database. Setup refusals and passing output are recorded verbatim in `.marp/verification.md`. The human accepted the visual result and G4 evidence and authorized the pull request and merge.
