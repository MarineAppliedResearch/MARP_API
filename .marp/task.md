---
task: MarineAppliedResearch/MARP_API#183
repos: [MARP_API]
status: verify
needs: []
---

## Goal

A reviewer can move the flagged-observation details popup out of the way without losing
their place, changing the pending review decision, or making any of its existing controls
harder to use.

## Requirements

- **R1** — The details popup has a visually clear drag handle in its header.
- **R2** — Mouse, pen, and single-touch dragging move the popup directly with the pointer.
- **R3** — Dragging is clamped inside the visible Mosaic work area: the field on desktop
  and the visual viewport on touch-sized layouts.
- **R4** — The chosen position survives ordinary full rerenders, note edits, status polls,
  and opening or closing the species-correction controls while the same popup remains open.
- **R5** — Opening a different observation, closing and reopening the popup, or changing
  review context starts again from the existing sensible tile-anchored position.
- **R6** — A resize, phone rotation, browser zoom, or visual-viewport change reclamps the
  remembered position so no part required to operate the popup becomes unreachable.
- **R7** — Only the header handle begins a drag. Buttons, chips, links, text, the observation
  ID, the note editor, and species controls retain their existing click, selection, scroll,
  and focus behavior.
- **R8** — Beginning, moving, or ending a drag does not stage, clear, resolve, commit, or
  otherwise alter a review decision, and it does not dismiss the popup.
- **R9** — Escape still closes the popup, all existing controls remain reachable by
  keyboard, and dragging is never required to reach or operate a control.
- **R10** — Focus remains on the control that held it across rerenders; dragging the header
  does not steal focus from an active note or species editor.
- **R11** — Pure geometry tests cover pointer deltas and clamping, and real-browser tests at
  desktop and phone sizes prove movement, persistence, controls, review-state isolation,
  viewport reclamping, Escape, and touch input.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-14 by #183: use a clear header or
  handle; this implementation adds a compact grip to the existing header so it does not
  consume another row of popup space.
- [x] **A2 · behavioural · blocking** — answered 2026-09-14 by #183: remember a position
  only while that popup remains open, and reset when a different observation is opened.
- [x] **A3 · product/UI · blocking** — answered 2026-09-14 by the existing responsive
  positioning contract: desktop popups stay inside the Mosaic field; phone popups stay
  inside the live visual viewport, including while its size changes.
- [x] **A4 · architectural · blocking** — answered 2026-09-14 by the Mosaic layering rule:
  pointer geometry is a pure model rule; wiring owns the gesture; the final remembered
  position belongs to `state.picker`, while transient pointer movement may update the
  current DOM directly to avoid a full application rerender for every pixel.
- [x] **A5 · API contract · blocking** — answered 2026-09-14 by #183 scope: dragging is
  presentation state only and adds no API, persistence, database, or review-record field.

## Decisions

- **2026-09-14** — Reuse the existing popup heading as the drag surface and add a visible
  grip; interactive content never starts a drag.
- **2026-09-14** — Preserve the final position in the open picker state and repaint only
  the panel during pointer movement; notify once when the gesture ends.
- **2026-09-14** — Reuse the existing desktop-field and phone-visual-viewport boundaries so
  dragging cannot contradict the popup's current resize and keyboard behavior.

## Plan

1. Add pure popup-position geometry for pointer deltas and boundary clamping.
2. Extend the picker state with one remembered position and actions that settle/reset it.
3. Draw and style the header handle, then wire pointer movement without intercepting any
   existing control.
4. Reapply or clamp the remembered position during rerenders and viewport changes.
5. Add the focused unit and real-browser coverage required by R11.
6. Write the G3 verification plan and stop for human review before its browser run.

## Acceptance criteria

- A reviewer can drag the details popup smoothly with a mouse, pen, or finger.
- The popup cannot be stranded outside the usable Mosaic viewport.
- The popup stays where the reviewer put it while its contents update.
- A different or reopened observation starts from the normal anchored position.
- Dragging never changes the marked observation or breaks an existing popup control.
- Keyboard focus and Escape behave exactly as before.

## Test plan

See `.marp/verification.md`. It names the focused geometry unit file, the desktop/phone
API-backed browser file, and the supervised interaction check; no walkthrough is requested.

## Status

- **Gate:** verifying
- **Notes:** Geometry, remembered picker position, pointer wiring, the visible handle, and
  focused unit/browser coverage are implemented. The G3 plan awaits human approval before
  its browser run. No database, API, backend, migration, or live-Jellyfin work is in scope.
