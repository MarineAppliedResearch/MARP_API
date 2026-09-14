# Verification — MarineAppliedResearch/MARP_API#183

This is the G3 plan. Unit runs made during implementation are feedback, not the approved
G4 record. Do not run the API-backed browser or human interaction steps until the human
approves this plan.

## What each test proves

| Requirements | Evidence | Tier | What it proves |
| --- | --- | --- | --- |
| R2, R3, R4, R6 | `tests/unit/picker-position.test.mjs` | pure unit | Pointer deltas are applied exactly, ordinary coordinates are retained, and every edge or an oversized panel clamps deterministically. |
| R1–R11 | `tests/api/popup-drag.spec.mjs` in both `api` and `api-phone` projects | real browser + API + disposable PostgreSQL | The visible handle accepts mouse and touch pointer paths; the popup moves, survives a reason-driven rerender, retains editor focus, leaves its mark unchanged, remains inside resized bounds, resets after closing, and still closes with Escape. |
| R7–R10 | Existing Mosaic unit suite plus the named browser test | unit + real browser | Existing controls remain wired and selectable, drag completion is a named action, and review state changes only when an existing review control is deliberately used. |

## Requirements with no automated test

- Whether the compact grip looks professional and whether movement feels natural rather
  than merely changing coordinates require a person to use it. The final supervised check
  covers those judgements at desktop and phone sizes.

## Commands, in order

1. Run `git fetch origin`, then confirm this branch contains current `origin/develop`.
   - If `develop` moved, integrate it before collecting evidence.
2. Copy the newest existing git-ignored local corpus dump into this isolated workspace's
   `.marp/local/corpus/`, then run `npm run testing-db` using the database assigned by
   `marp agent list`.
   - This prepares a disposable browser database without touching the port-3001 testing
     server the human is currently using. The dump remains local credential material and
     is never staged or committed.
3. Run `git diff --check` and the umbrella `marp spec check`.
   - Expected: no whitespace/conflict errors; all 11 requirements and five assumptions are
     accepted at the verification gate.
4. Run `npm run test:app:mosaic-review:unit`.
   - Expected: all syntax, geometry, model, store, and wiring tests pass with no skips.
5. Run `npm run test:app:mosaic-review:api -- popup-drag.spec.mjs`.
   - Expected: the focused test passes once in the desktop project and once in the Pixel 7
     project against the real temporary API; the runner stops only its own API.
6. Start this isolated branch's API on the port reported by `marp agent list`, pointed at
   its disposable testing database, while leaving port 3001 running.
   - The human drags a flagged-details popup with a mouse and a phone gesture, chooses a
     reason, types in the note, resizes or rotates, presses Escape, and opens it again.
   - Expected: the handle and movement look professional; the popup follows naturally,
     stays usable, preserves the mark and controls, remains on-screen, and resets after it
     closes. Stop this isolated API after the human finishes; do not stop port 3001.
7. Run final `git diff --check` and record every command's real result below, including any
   failed attempt before its correction.

The full Mosaic browser suite and the repository suite are not part of this focused package.
The change has no backend, route, storage, migration, Jellyfin, or scientific-data surface.

## Edge cases and regression coverage

- Dragging toward each edge clamps the entire panel; an oversized panel uses the available
  area's top-left and its existing internal scrolling.
- Phone movement uses a touch pointer and the live visual viewport rather than assuming
  desktop mouse geometry.
- A reason click forces the normal full render after the panel moves and cannot reset it.
- Focusing the note before dragging proves the handle does not steal editor focus.
- The staged mark is compared before and after dragging, before any review control is used.
- Shrinking the viewport after a drag proves the remembered position cannot strand the
  panel off-screen.
- Escape closes the moved panel; reopening starts with no remembered position while the
  underlying mark remains.

## Known gaps

- Position intentionally lasts only for the currently open observation. It is not saved
  across closing, reloads, routes, browsers, or users.
- This makes the flagged-observation details popup draggable. It does not change the
  full-frame viewer, confirmation dialog, rail menus, or the future video-player surface.
- Dragging is an optional pointer convenience, not a keyboard movement command. Keyboard
  users retain all existing controls and Escape behavior without needing to move the panel.

---

## Results

<!-- Appended only during the approved G4 run. -->
