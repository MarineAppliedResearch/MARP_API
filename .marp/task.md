---
task: MarineAppliedResearch/MARP_API#203
repos: [marp-api]
status: implementing
needs: []
---

## Goal

A reviewer in training mode can ask for a different crop of a tile without leaving
training mode. Today **Request replacement image** is on the detail popup in scientific
mode only, so somebody deciding whether a tile is usable training data has to switch to
scientific mode, request the image, and switch back — a mode change made to obtain a
picture rather than to record a decision.

## Requirements

- **R1** — The **Request replacement image** button appears on the detail popup in
  training mode, under the same condition it appears in scientific mode: the tile is
  marked as an exception (excluded in training, flagged in scientific).
- **R2** — Pressing it in training mode does what it does in scientific mode — clears the
  pending mark, queues a replacement, and leaves the tile ready to be judged again.
- **R3** — A refusal in training mode is reported the same way it is in scientific mode:
  the pending mark and the open popup come back, and the reason is shown.
- **R4** — The button's title text says what it clears in the mode it is shown in. It
  currently names the scientific mark ("Clear this pending flag") in a mode whose mark is
  an exclusion.
- **R5** — `delete` mode does not get the button. It never had it, the popup itself does
  not render in that mode, and nothing asked for it.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-18: which button. Isaac described
  "the request different frame ... that goes and finds a different thumbnail", which is
  **Request replacement image**, not the **Request full frame** button that #203's title
  names. The full-frame block at `picker.js:266-274` has no mode condition on it at all;
  the replacement-image button at `picker.js:296` does. #203 is therefore about the
  replacement-image button and its title is a mis-diagnosis. → recorded on the issue.
- [x] **A2 · behavioural · blocking** — answered 2026-09-18: the store guard at
  `store.js:1702` (`if (state.mode !== 'scientific') return;`) is a second gate on the same
  rule, not a safety check about something else. Removing only the render gate would leave
  a button that does nothing. Both come out.
- [x] **A3 · behavioural** — answered 2026-09-18 from the code: the action is mode-agnostic
  below the guard. It clears `state.marks`, `state.touched` and `state.takenBack` for the
  id and calls one endpoint that takes an observation id and no mode. Nothing in the
  request or the rollback reads the mode, so R2 and R3 need no per-mode branch.

## Decisions

- **2026-09-18** — The gate is removed rather than widened to a two-mode list. There are
  three modes and `delete` cannot reach this code at all: `renderPicker` returns early for
  it (`picker.js:212`), so the popup this button lives on is never drawn. A list naming two
  of the three modes would encode that fact twice, in a place that does not own it.

## Plan

1. Prove it red: a browser check that opens the popup on an excluded tile in training mode
   and expects the button. It is the tier that can see which buttons render.
2. Drop `&& state.mode === 'scientific'` from the render condition in `picker.js`.
3. Drop the guard from `requestThumbnailReplacement` in `store.js`.
4. Make the button's title name the current mode's mark (R4).
5. Add the training-mode refusal check (R3).

## Acceptance criteria

- The button is on the popup of an excluded tile in training mode, and pressing it queues
  a replacement.
- A refused request in training mode restores the mark, reopens the popup, and shows the
  reason.
- The scientific-mode behaviour is unchanged — its existing checks still pass untouched.

## Test plan

Filled in at G3 in `.marp/verification.md`.

## Status

- **Gate:** implementing
- **Notes:** —
