# Verification — MarineAppliedResearch/MARP_API#136

This is the G3 plan. The fast model checks used during implementation are development
feedback, not the approved G4 record. Do not run the browser verification below until the
human approves this plan. On 2026-09-16 the human explicitly directed investigation and
actual browser interaction testing of the reported drag defects. The focused plan now also
includes `#136 rectangles mark exactly their 2x2 and 3x2 intersections`: real mouse drags
starting on images, reverse-direction corner and middle selections, exact resulting marked
ids, no surviving previews, and no native image-drag event. Use the existing server/database.

## What each test proves

Phone extension approved 2026-09-16: `#136 real touch swipes scroll and hold-drag offers
both workflow decisions` uses Chromium's real touch input. It verifies immediate swipe
scrolling without group selection, stationary hold then drag without native pan, exact
selected ids, science Flag/Reviewed choices, training Exclude/Promote choices, and Cancel
without marks. It runs against the existing assigned server and test database. The previous
mouse-only phone limitation is superseded; actual iOS Safari behavior remains a manual gap.

| Requirements | Evidence | Tier | What it proves |
| --- | --- | --- | --- |
| R3–R4 | `tests/unit/drag-selection.test.mjs` | pure model | Rectangles normalize in every direction, edge contact counts as intersection, a drag sets rather than toggles marks, same-kind exception details survive, and changing kind clears exception-only detail. |
| R1, R3, R7, R10 | `tests/api/drag-marking.spec.mjs` in `api` | real desktop Chromium against the testing API | A mouse sweep shows the selection band and prospective tiles, selects the touched tiles, and Escape removes all transient UI without applying partial marks. |
| R2, R4, R6, R8 | The same desktop browser test | real desktop Chromium plus store observation | Left and right drags apply the requested kind, repeated right drag is idempotent, the follow-up browser event changes no extra tile, and each completed drag emits one action and one store notification. |
| R4–R5 | The same desktop browser test, beginning from a committed acceptance | browser plus testing API write | Dragging stages the requested exception directly over a recorded acceptance, never TAKING BACK; the existing Commit Marked route remains the write path. |
| R8 | The same desktop browser test's ordinary left/right clicks, plus existing `render-marks.spec.mjs` gesture coverage | real desktop Chromium | Below-threshold left and right gestures retain their existing one-tile toggle behavior. |
| R2, R9, R12 | Existing `render-marks.spec.mjs`, `decision-details.spec.mjs`, and `popup-drag.spec.mjs` | real browser | Delete right-click remains inert; badge/detail/popup interactions keep their established behavior; mark creation does not open detail panels. |
| R11 | `tests/api/drag-marking.spec.mjs`, including the real-touch regression | real Chromium with touch input at narrow size | Immediate swipes scroll; hold-drag creates a rectangle; release offers science Flag/Reviewed and training Exclude/Promote; each choice marks only the intersected tiles. Cancel stages nothing, and ordinary taps remain intact. |
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
   - Expected: no whitespace/conflict errors; all thirteen requirements and seven assumptions
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
- Touch enters rectangle selection only after a stationary hold; an immediate swipe scrolls.

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

### Desktop correction evidence — 2026-09-16

The existing assigned server was serving the old issue-183 checkout, not this branch.
It was restarted on its assigned port from this checkout using its existing testing database
and existing thumbnail storage. No database was provisioned. The server remains running.

Failed attempts before correction:

```text
401 Invalid username or password.
Error: connect ECONNREFUSED 127.0.0.1:5432
Expected substring: "FLAGGED"
Error: element(s) not found
TypeError: Cannot read properties of null (reading 'x')
```

The first two failures were incorrect test-environment selection. The missing FLAGGED
badge exposed pointer capture retargeting ordinary clicks to the grid; capture now starts
only after the drag threshold. The null rectangle exposed a test racing the asynchronous
commit; the test now waits for the commit acknowledgement and a settled grid.

Final focused browser result:

```text
ok 1 [api] #136 rectangle marking is batched, direct, and mouse-only
ok 2 [api] #136 rectangles mark exactly their 2x2 and 3x2 intersections
ok 3 [api-phone] #136 rectangle marking is batched, direct, and mouse-only
ok 4 [api-phone] #136 rectangles mark exactly their 2x2 and 3x2 intersections
4 passed (6.1s)
```

Fast group result:

```text
✓ 80 files parse
tests 296
pass 296
fail 0
skipped 0
```

`git fetch origin` succeeded; the branch is zero commits behind `origin/develop`.
`git diff --check` passed.

**Phone scope correction:** these results prove mouse rectangle behavior and preservation
of tapping under touch emulation, not finger-drag rectangle selection. The user now explicitly
requires scrolling and rectangle multi-selection on the phone. That scope was settled in A7
and implemented below; the initial four-pass record alone did not prove that phone feature.

### Touch extension evidence — 2026-09-16

The approved interaction is a stationary hold followed by rectangle dragging; an immediate
swipe remains native scrolling. On release the phone shows the active workflow's two choices.
There is no Select toggle, no automatic commit, and no pointer-path painting.

Initial real-touch regression failed:

```text
Locator: locator('.drag-select-band')
Expected: visible
Error: element(s) not found
```

Touch implicitly captures the initial tile. Transferring capture to the grid emits a bubbling
lost-capture event from the tile; the cancellation listener wrongly treated that as loss of
the grid's capture. The listener now cancels only when the grid itself loses capture.

Test-harness corrections were also required:

```text
locator.tap: The page does not support tap. Use hasTouch context option to enable touch support.
Locator: locator('.drag-select-band')
Expected: 0
Received: 1
```

The touch test now uses actual CDP touchStart/touchMove/touchEnd for both the gesture and
choice buttons, rather than synthetic pointer events or a desktop-context touchscreen shim.

Final assembled result:

```text
ok 1 [api] #136 mouse rectangle marking is batched and direct; touch taps remain intact
ok 2 [api] #136 rectangles mark exactly their 2x2 and 3x2 intersections
ok 3 [api] #136 real touch swipes scroll and hold-drag offers both workflow decisions
ok 4 [api-phone] #136 mouse rectangle marking is batched and direct; touch taps remain intact
ok 5 [api-phone] #136 rectangles mark exactly their 2x2 and 3x2 intersections
ok 6 [api-phone] #136 real touch swipes scroll and hold-drag offers both workflow decisions
6 passed (17.8s)
✓ 80 files parse
tests 296
pass 296
fail 0
skipped 0
```

Actual phone confirmation — PASS. The human tested the running application and reported
"It works!", then approved opening the PR, merging, and closing issue #136. This is manual
evidence, not a claimed automated Safari result. The assigned server remains running from
this checkout on the existing testing database.
