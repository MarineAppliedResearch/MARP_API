# Verification — MarineAppliedResearch/MARP_API#136

This is the G3 plan. The fast model checks used during implementation are development
feedback, not the approved G4 record. Do not run the browser verification below until the
human approves this plan.

## What each test proves

| Requirements | Evidence | Tier | What it proves |
| --- | --- | --- | --- |
| R3–R4 | `tests/unit/drag-selection.test.mjs` | pure model | Rectangles normalize in every direction, edge contact counts as intersection, a drag sets rather than toggles marks, same-kind exception details survive, and changing kind clears exception-only detail. |
| R1, R3, R7, R10 | `tests/api/drag-marking.spec.mjs` in `api` | real desktop Chromium against the testing API | A mouse sweep shows the selection band and prospective tiles, selects the touched tiles, and Escape removes all transient UI without applying partial marks. |
| R2, R4, R6, R8 | The same desktop browser test | real desktop Chromium plus store observation | Left and right drags apply the requested kind, repeated right drag is idempotent, the follow-up browser event changes no extra tile, and each completed drag emits one action and one store notification. |
| R4–R5 | The same desktop browser test, beginning from a committed acceptance | browser plus testing API write | Dragging stages the requested exception directly over a recorded acceptance, never TAKING BACK; the existing Commit Marked route remains the write path. |
| R8 | The same desktop browser test's ordinary left/right clicks, plus existing `render-marks.spec.mjs` gesture coverage | real desktop Chromium | Below-threshold left and right gestures retain their existing one-tile toggle behavior. |
| R2, R9, R12 | Existing `render-marks.spec.mjs`, `decision-details.spec.mjs`, and `popup-drag.spec.mjs` | real browser | Delete right-click remains inert; badge/detail/popup interactions keep their established behavior; mark creation does not open detail panels. |
| R11 | `tests/api/drag-marking.spec.mjs` in `api-phone` | real Chromium with Pixel touch emulation | A touch sweep creates no selection band or group marks, while an ordinary tap still marks exactly one tile. |
| R13 | The named unit and desktop/phone browser files above | model and real browser | The feature has coverage at the tiers capable of seeing both its pure rules and rendered pointer behavior. |

## Requirements with no complete automated test

- R7's exact visual polish is asserted structurally—band visible, prospective tiles marked,
  transient state removed—but not by pixel comparison. The human should judge its look in
  the already-running test application.
- The compact skipped-imagery message reuses the established `#skipNote` surface and the
  existing tested `acceptRefusal` rule. The focused browser test uses ready imagery, so it
  does not create a second seeded page solely to photograph that sentence.

## Commands, in order

1. Run `git fetch origin`, then confirm this branch contains current `origin/develop`.
   - If `develop` moved, integrate it before collecting evidence.
2. Run `git diff --check` and `marp spec check` from the umbrella.
   - Expected: no whitespace/conflict errors; all thirteen requirements and six assumptions
     are accepted at the verification gate.
3. From `frontend/apps/marp-mosaic-review`, run `npm run test:unit`.
   - Expected: syntax and the complete fast model group pass with no failures.
4. Against the existing API server and existing testing database, run
   `npx playwright test tests/api/drag-marking.spec.mjs --project=api --project=api-phone`.
   - Expected: the named #136 test passes once at desktop and once at phone size. Do not
     provision another database or start another server for this run.
5. In the already-running test application, manually sweep several rows left-to-right and
   right-to-left with each mouse button, then press Commit Marked only if you intend to
   inspect the existing testing write path.
   - Expected: the band and tile previews are clear; left drag uses the mode exception
     colour, right drag uses the acceptance colour, release stages the whole group, and no
     tile shows TAKING BACK because of a drag.
6. Run final `git diff --check` and record every real result below, including failures.

## Edge cases

- Reverse-direction drags normalize before intersection is evaluated.
- Merely touching a tile edge includes it.
- Same-kind marks stay marked; opposite-kind marks become the later requested kind.
- A committed reviewed/promoted tile is directly restaged and never routed through the
  single-click take-back rule.
- Escape, leaving the grid, pointer cancellation, and lost pointer capture remove the band
  without applying the partial group.
- Right drag is inert in Delete Mode and missing imagery is skipped in one batched action.
- Touch pointers never enter rectangle-selection state.

## Regression coverage

- The browser check explicitly guards the user's correction that drag must never produce
  TAKING BACK, even over an already committed decision.
- It counts store notifications so a many-tile gesture cannot regress into one full render
  per tile.
- It exercises the follow-up click/context-menu boundary so release cannot mark one extra
  tile after the batch is applied.

## Known gaps

- No migration, schema, production database, Jellyfin service, video player, thumbnail
  extractor, or phone-native browser is involved.
- The focused test does not commit a large real corpus selection. It commits only a row
  created and removed by the API test seeder, then verifies group staging around it.
- No narrated walkthrough is requested or planned.

---

## Results

<!-- Appended after approval. Real output, including failures, goes here verbatim. -->
