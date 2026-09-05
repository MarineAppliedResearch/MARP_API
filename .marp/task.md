---
task: MarineAppliedResearch/MARP_API#74
repos: [MARP_API]
status: design
needs: []
---

# Keyboard shortcuts for the page-level actions

## Goal

A reviewer keeps one hand on the keyboard and one on the pointer, and stops reaching for a
button to turn the page or commit it. The pointer keeps doing the selecting, because that
is what it is faster at.

## What is already true

- **There is one `keydown` listener**, in `ui/mount.js`, and it handles Escape only.
  `ui/confirm.js` adds a second for the delete dialog, which already takes Escape while it
  is open.
- **`ui/menus.js` binds keys on the species search input**, so typing there is already a
  context where document-level shortcuts must not fire.
- **`goToPage` clamps** to the page count and returns early when the page does not change,
  so paging past the end is already harmless.
- **Every control already carries a `title`** explaining what it does — the natural place
  to put a shortcut hint, and reachable by keyboard focus rather than hover alone.
- `setMode`, `clearMarks` and `commitPage` are ordinary actions with no key bindings.

## Requirements

- **R1** — `→`/`N` and `←`/`P` move between pages.
- **R2** — `C` clears the page's marks.
- **R3** — `1`, `2`, `3` select scientific, training and delete.
- **R4** — `Ctrl`+`Enter` commits. A bare key never commits.
- **R5** — No shortcut fires while typing in a text field, or while the delete
  confirmation is open. Typing "n" into the species search pages nowhere.
- **R6** — Each shortcut is discoverable from the control it duplicates, in a way that
  works without hover, because touch has none.
- **R7** — `Ctrl`+`Enter` on a page that cannot be committed does not silently do nothing.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-05: leave all three bare. Switching mode marks nothing on arrival, Delete has its confirmation, and since #72 a commit refuses to act on a page where it would do nothing. The active mode is also named large on screen, so a wrong mode is visible before the first click rather than after it.

- [x] **A2 · product/UI · blocking** — answered 2026-09-05: flash the disabled commit button and show its reason. Points at the explanation already sitting there rather than inventing a second message surface. A shortcut that appears to do nothing reads as broken and gets pressed again.

- [x] **A3 · product/UI · non-blocking** — decided 2026-09-05: append to the existing `title`, and draw a small key badge on the four controls that have one. The title alone is invisible on touch and slow to appear; the badge is always visible and is the thing that makes a shortcut discoverable at all.

## Decisions

- **2026-09-05** — Settled before this task opened, and recorded in #68: the pointer
  selects, the keyboard commands. No arrow-key cursor through the grid, no keyboard
  marking, no keyboard species correction. Keyboard operation remains an accessibility
  requirement — every action reachable, focus visible — but it is the floor, not the
  speed path.
- **2026-09-05** — Commit is a chord. It is the one irreversible action that is not
  already gated: Delete Mode has its confirmation, scientific commit has nothing.

## Plan

A1-A3 answered. The steps:

1. A `model/` rule mapping a key event to an action, or to nothing. Pure, so the "does
   this fire while typing" question is unit-testable with no DOM.
2. One listener in `ui/mount.js` that consults it. Not several scattered ones — the
   existing Escape handling shows how quickly that spreads.
3. Hints on the controls.
4. Tests at all three tiers.

## Acceptance criteria

- Every shortcut works, and none fires while typing or while the confirmation is open.
- No bare key ever commits.
- The hints are visible without a pointer.
- `marp verify run` green.

## Test plan

Filled in at G3. The key-to-action mapping belongs in `model/` as unit tests; whether the
action actually ran belongs in the contract tier; whether the hints are on screen and
focus is visible belongs in Playwright.

## Status

- **Gate:** implementing — A1-A3 answered 2026-09-05, G1 cleared
- **Notes:** nothing implemented.
