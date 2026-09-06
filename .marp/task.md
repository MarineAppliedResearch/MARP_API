---
task: MarineAppliedResearch/MARP_API#81
repos: [MARP_API]
status: verifying
needs: []
---

# The filter rail: the reported bugs, and the crowding

## Goal

A reviewer opens the rail and can see all of it. The dropdowns behave the way every other
dropdown on every other platform behaves — a second click on the button closes the menu,
and choosing a specific project stops "All projects" claiming to be selected. Times read
in 24-hour, the way MARP writes them everywhere else. The rail carries ten filters in one
row each, rather than eleven plus four headings and three rows spent on time and date, so
the status filters and the progress bar are on screen instead of clipped off the bottom.
Sorting can be steered by field and by direction independently, and says which is applied.

## What is already true

Read from the code on `79-resumability`, not assumed:

- **A dimension is one entry in `src/model/dimensions.js`.** The rail, the query, the
  counts, the collapsed-rail badge and the address all read that declaration. #77 built
  that property and #79 extended it to the URL; protecting it is a constraint on this
  work, not a goal of it.
- **`ui/` never writes state.** Every gesture calls a named action on `store.js`.
- **The rail clips.** `.rail` is `overflow: hidden` and `.rail-body` does not scroll, so at
  a 1600x900 desktop viewport the review-status filters and the progress bar are drawn
  below the fold and cannot be reached at all. This was not reported as its own item but
  it is the sharpest form of L7.
- **`renderStatusFilters()` writes `data-key="${dim.key}"`** on each status checkbox, and
  `styles/app.css` has `[data-key]::after { content: attr(data-key) }` for the keyboard
  shortcut badges added by #74. The two meanings of `data-key` collide, so every status
  checkbox draws a grey pill reading `reviewStatus` beside its label. **That is B4.**
- **A native `<input type="time">` cannot be forced to 24-hour.** Chrome renders it from
  the browser locale; `lang="en-GB"` was tried in a real Chromium and still drew
  `01:30 PM`. So B3 cannot be fixed with an attribute.
- **The rail dimension buttons are wired in `ui/rail.js`, not in `ui/mount.js`.**
  `mount.js`'s `anchor()` helper already closes an open menu on a second click; the rail's
  own handler calls `dimensionMenu()` unconditionally, which closes and immediately
  reopens. **That is B2.**
- **A multi-select menu item redraws only its own tick.** `menus.js` toggles the clicked
  button's tick in place and never restates the others, so the "All …" entry keeps the
  tick it was built with. **That is B1.**
- **`session_type` in the fixture is `pick(['ROV','ROV','Drop Cam'])` per observation**, so
  it is both wrong (D1) and uncorrelated with `session_id`, which makes "the type narrows
  which sessions are available" (L2) untrue in the fixture.
- **Sorting is `SORTS`, five fixed `{field, dir, label}` rows** in `model/filters.js`, read
  by the sub-bar label, the menu and `query-url.js`.

## Requirements

Numbered so tests can name them. The ids follow #81.

- **B1** — Choosing a specific value in a set menu clears the menu's "All …" entry
  immediately, while the menu is still open. Removing the last specific value ticks it
  again.
- **B2** — Clicking the button that opened a menu closes that menu. Clicking a different
  button moves the menu to it.
- **B3** — Every time-of-day control renders 24-hour. No AM/PM appears anywhere in the rail.
- **B4** — A status filter draws one control: a checkbox and its label. No second pill, no
  shortcut badge, nothing whose purpose has to be guessed at.
- **D1** — The fixture's `session_type` values are exactly `Fish`, `Fish_GULF`, `Inverts`,
  `INVERTS_GULF`, `Habitat`, spelled as the database spells them, and each session has one
  type rather than one per observation.
- **L1** — The rail draws no group headings.
- **L2** — Session type is drawn above Session, and choosing a type narrows the sessions
  offered.
- **L3** — There is no Processor filter, anywhere: not in the rail, not in the query, not
  in the address.
- **L4** — Confidence is one track carrying two handles.
- **L5** — Time of day and date each occupy one row of the rail.
- **L6** — The reset control is the first control in the rail, above every filter, and
  costs no more room than the collapse button beside it.
- **L7** — Every part of the rail is reachable at a 1600x900 desktop viewport: nothing is
  clipped off the bottom.
- **M1** — The sort field and the sort direction are chosen independently, and what is
  applied is legible without opening the menu.
- **Q1** — The Model filter stays. Left in place deliberately; see the assumptions.
- **P1** — The property #77 built survives: adding, removing or reordering a dimension is
  one edit in `src/model/dimensions.js` and nothing else.

## Open assumptions

None blocking. Everything below is a choice #81 left open, with the default that is being
implemented and why. Each is one sentence to overrule.

- [x] **A1 · product/UI · non-blocking** — answered 2026-09-06 by the issue itself (Q1):
  the Model filter stays. It filters simulated data until Phase 3 of #68.
- [x] **A2 · product/UI · non-blocking** — decided 2026-09-06: **L5 becomes a summary
  button per dimension, opening a small popover holding the two ends.** Both the time pair
  and the date pair drop from two or three rail rows to one, the rail reads as one list of
  identical controls rather than a list with two odd ones in it, and the popover has the
  width the controls actually need — which a 137px rail column does not. The alternative
  considered was shrinking the native inputs to fit side by side: a date pair cannot be
  made to fit, and it would have left time and date looking different from each other.
- [x] **A3 · product/UI · non-blocking** — decided 2026-09-06: **the time ends become
  24-hour text fields (`HH:MM`), not native time inputs.** Verified in real Chromium that
  a native time input renders 12-hour regardless of `lang`; there is no attribute for
  this. The date ends stay native `<input type="date">`, because the calendar picker is
  worth keeping and nobody reported the date format. If the US `mm/dd/yyyy` order is also
  wrong, say so and both ends become `YYYY-MM-DD` text.
- [x] **A4 · product/UI · non-blocking** — decided 2026-09-06: **M1 is a field list plus a
  direction pair in one menu, with the direction phrased for the chosen field** ("low
  first" / "high first" for confidence, "shortest" / "longest" for track length). The
  sub-bar shows `Confidence · low first` with an arrow, so what is applied is readable
  without opening anything. A sort *stack* (secondary keys) was considered and rejected:
  nothing asked for it, and the deterministic `observation_id` tie-breaker already makes
  the order stable.
- [x] **A5 · behavioural · non-blocking** — decided 2026-09-06: **Session nests under
  Session type** (`nestsUnder: 'sessionType'`), so changing the type drops sessions that
  no longer apply, the way a dive drops its lines. L2's stated reason is that the type
  narrows which sessions are available, and the offered list already narrows; this makes
  the selection follow.
- [x] **A6 · product/UI · non-blocking** — decided 2026-09-06: **the rail body scrolls.**
  L7 says to say so if something has to give. Nothing had to give in the end — the ten
  filters fit at 1600x900 — but the rail was clipping its own status filters before this
  work, and a rail that silently hides controls at a shorter viewport is the same bug
  waiting for a smaller screen.

## Decisions

- **2026-09-06** — `data-key` on a status checkbox is renamed to `data-statuskey`.
  `data-key` belongs to the keyboard-shortcut badge (#74) and is claimed by a CSS rule
  that draws its value on screen; two meanings for one attribute is what produced B4.
- **2026-09-06** — `group` leaves `dimensions.js` entirely rather than being kept and
  ignored. A field the declaration carries and nothing reads is a trap for the next
  person; the order of the array is the only ordering the rail needs.

## Plan

1. `.marp/task.md` (this file).
2. **D1** — fixture generator: session type per session, real values; regenerate.
3. **B4** — rename the colliding attribute; test the badge is gone.
4. **B2** — menus remember their anchor; a second click on it closes.
5. **B1** — a multi-select pick restates the whole menu rather than one tick.
6. **L1 · L2 · L3 · Q1 · A5** — the declaration: drop `group`, drop `processor`, reorder,
   nest session under session type. Delete `dimensionGroups()` and the group markup.
7. **L4** — confidence on one track with two handles.
8. **B3 · L5** — time and date as one-row summary buttons over a popover, 24-hour.
9. **L6** — the reset control as an icon.
10. **L7** — the rail body scrolls; confirm nothing is clipped.
11. **M1** — field and direction, independently.
12. Unit tier after every step; browser tier once at the end.

## Acceptance criteria

- Every requirement above has a named test at a tier that can observe it: a rule in
  `tests/unit/`, anything drawn in `tests/e2e/render.spec.mjs`.
- Each of B1–B4 has a test that was shown to fail against the current behaviour before
  the fix.
- `npm run test:unit` and `npm run test:e2e` both green, at desktop and phone.
- `src/model/dimensions.js` is still the only place a dimension is declared.

## Test plan

See `.marp/verification.md`.

## Status

- **Gate:** verifying
- **Notes:** branched from `79-resumability`, not from `develop`, per #81.
