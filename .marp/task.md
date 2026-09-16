---
task: MarineAppliedResearch/MARP_API#192
repos: [MARP_API]
status: design
needs: []
---

## Goal

A person signing in from a very small or keyboard-constrained phone can reach and operate
every part of the landing-page login dialog, including the submit and close controls,
without the underlying page stealing the gesture.

## Requirements

- **R1** — The open login dialog and its operable surface stay within the currently visible
  viewport on desktop, ordinary phones, very small phones, and short-height layouts.
- **R2** — When the form is taller than the available height, the login surface scrolls
  vertically and every field, option, status message, submit control, and close control is
  reachable by touch and keyboard.
- **R3** — Focusing and typing in the username or password field under a reduced effective
  viewport does not strand the submit control; the reviewer can scroll to it and submit.
- **R4** — Scrolling inside the dialog is contained there and does not scroll or dismiss the
  landing page underneath it.
- **R5** — The dialog retains a sensible edge margin whenever space permits, but uses the
  available width and height before clipping any required control.
- **R6** — Existing dialog behavior remains intact: initial username focus, password
  visibility, validation, server error status, backdrop/close dismissal, and successful
  redirect are not changed by the layout correction.
- **R7** — The normal desktop and ordinary portrait-phone dialog retain their present
  two-panel and stacked visual presentation respectively.
- **R8** — A real-browser regression test at a deliberately small phone viewport opens the
  dialog, types both credentials, scrolls to every required control, and submits a mocked
  login request.
- **R9** — The browser test also reduces the phone viewport height after an input is focused
  to represent an on-screen keyboard, then proves the submit and close controls remain
  reachable without background scroll.
- **R10** — Existing desktop, ordinary phone, and phone-landscape render checks continue to
  pass without horizontal overflow or page errors.

## Open assumptions

- [ ] **A1 · product/UI · blocking** — On a narrow screen whose visible height is too short
  to show both the decorative diver panel and a useful portion of the form, should the
  decorative panel disappear so sign-in controls get the space, while remaining unchanged
  on ordinary phones?
- [x] **A2 · behavioural · blocking** — answered 2026-09-15 by #192: vertical scrolling
  belongs to the modal or its content, while the underlying landing page remains fixed.
- [x] **A3 · architectural · blocking** — answered 2026-09-15 by the existing entry-app
  boundary: this is a landing-page HTML/CSS/browser-test correction with no API, database,
  authentication-contract, or Mosaic Viewer change.

## Decisions

- **2026-09-15** — Treat the visible viewport height, not phone width alone, as the failing
  dimension; ordinary phone width already has a responsive dialog but no usable overflow
  path when height contracts.
- **2026-09-15** — Cover the defect at the entry app's Playwright render tier because markup
  and unit checks cannot observe clipped controls, internal scrolling, or background motion.

## Plan

1. Resolve whether the decorative panel is retained or removed in genuinely short phone
   layouts.
2. Add a height-constrained phone project or named test setup that reproduces the clipping
   and keyboard-reduced viewport.
3. Correct the dialog's height, overflow, overscroll, and short-height presentation without
   changing the normal desktop or phone appearance.
4. Assert field entry, internal scrolling, reachable close and submit controls, contained
   background scroll, request submission, and normal-viewport regressions.
5. Write the G3 verification plan and stop for human review before running it.

## Acceptance criteria

- A user can sign in from the smallest covered phone layout even after the viewport height
  contracts around a focused input.
- No required login control is clipped beyond the dialog's scrollable area.
- Touch-scrolling the dialog never moves the underlying page.
- Normal desktop and ordinary-phone dialogs retain their current visual structure.

## Test plan

To be written at G3 after A1 is answered. It will name the entry app's focused Playwright
test and the existing desktop, phone, and phone-landscape render projects; no API database
or production authentication is required because the login response is intercepted.

## Status

- **Gate:** design; implementation blocked on A1
- **Notes:** The current dialog is viewport-capped but `overflow: hidden`; its mobile stacked
  layout can exceed that cap while the nominal content scroller has no constrained height.
  No implementation has begun. The port-3002 issue #183 server remains untouched.
