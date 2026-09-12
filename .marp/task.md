---
task: MarineAppliedResearch/MARP_API#151
repos: [marp-api]
status: implementing
needs: []
---

## Goal

On a phone the reviewer is trying to work on the mosaic, and the header, the sub-bar and
the footer are all on screen the whole time. On a landscape phone that is 120 of 412
pixels -- 29% of the screen -- and what is left for the tiles is a band 292px tall that the
grid already overflows, so the bottom row is clipped and the field scrolls. This gives the
reviewer one control that takes the **top** chrome away and brings it back, so the mosaic
has the screen while they work. The footer stays: it carries the commit buttons, which are
the point of the page (see A1).

## Requirements

- **R1** -- On a phone-sized viewport, one control hides the header and the sub-bar, and
  every pixel they occupied goes to the mosaic field.
- **R2** -- The same control brings them back. It is reachable while they are hidden, which
  means it does not live in the chrome it hides.
- **R3** -- Hiding the top chrome hides *only* the header and the sub-bar. The footer, its
  commit buttons, the pager and the filter rail are untouched -- this issue is about the top.
- **R4** -- Hiding or showing loses no work: marks made on the page survive the toggle.
- **R5** -- On a **short** viewport -- a landscape phone -- the top chrome starts hidden,
  because that is the case reported. Everywhere else it starts shown.
- **R6** -- The control does not exist on a desktop, where there is no problem to solve.
- **R7** -- Nothing gains a horizontal scroll and nothing is clipped: `.app` still clips
  rather than scrolls, and the rail overlay still starts below whatever chrome is left.
- **R8** -- The state is legible without a screenshot: `document.body` carries a class, the
  way `rail-collapsed` already does, so the render tier can assert it.

## Open assumptions

- [ ] **A1 | product/UI | non-blocking** -- should the **footer** collapse too? The issue
  says this is a question and not an assumption to build on, so nothing here depends on the
  answer and the mechanism extends to it in one rule if the answer is yes. Measured, so the
  answer can be an informed one: on a landscape phone hiding the footer as well adds **no**
  tiles (a row is 150px there and the whole footer is 46px); in portrait it would add one
  row, 18 tiles -> 21. **I want the answer before this pattern is replicated to the ML
  Dashboard and the entry page.**
- [ ] **A2 | product/UI | non-blocking** -- the control is a chevron in the **rail head**,
  beside the rail's own collapse button, because that strip is the only chrome that is
  always on screen in both layouts and it costs no tile area. The alternative was a handle
  floating over the top edge of the field, which is more discoverable and covers part of a
  tile. Reversible in CSS if the placement is wrong.
- [ ] **A3 | behavioural | non-blocking** -- "short" is `max-height: 600px` and "narrow" is
  the app's existing `max-width: 760px`. A landscape phone is **915px wide**, so every
  width-keyed rule in this app misses it (see the finding below); height is the only signal
  that sees it.
- [ ] **A4 | behavioural | non-blocking** -- toggling re-pages the mosaic, because page size
  follows the field. Marks survive (`setPageSize` calls `refresh`, not `resetForNewQuery`),
  but the ids on the page change, exactly as they already do when the rail is collapsed or
  the phone is rotated. Same pre-existing exposure for a page pinned as committed, whose
  pin is keyed by page number; this change does not make it worse but does make it easier
  to reach.

### A finding, not an assumption -- and it limits what this can promise

**The phone layout never applies on a landscape phone.** Every narrow-screen rule in
`styles/app.css` is behind `@media (max-width: 760px)`, and a Pixel 7 in landscape is
915 x 412 -- so landscape gets the *desktop* chrome (44 + 30 + 46 = 120px), the desktop
`--min-tile: 132px`, and a rail that defaults to open at 158px wide, because
`state.railCollapsed` is initialised from that same width query.

The consequence for this issue, measured rather than estimated: a tile is square and its
size follows the column width, so a row on a landscape phone is **150px tall**. Giving the
field the top chrome's 74px therefore buys **no extra row** -- 10 tiles before, 10 after.
What it does buy is that the two rows stop overflowing a 292px field (2 x 150 = 300) and
the mosaic band grows from 71% to 89% of the screen. In portrait the same is true for a
different reason: 66px against a 124px row.

**To turn that space into more mosaic rather than more slack, the landscape phone needs the
phone's smaller tiles -- and the issue puts tile sizing and column count explicitly out of
scope.** So it is named here and not built.

## Decisions

- **2026-09-12** -- The top chrome collapses to nothing rather than to a thin strip. A strip
  would keep the mode selector reachable but costs the pixels the issue is about.
- **2026-09-12** -- No keyboard shortcut. The rail's collapse has none either, and adding
  one to `model/keys.js` is scope this issue did not ask for.
- **2026-09-12** -- The same complaint is in the ML Dashboard and the public landing page,
  and those come after this one. "The front workspace" that is to gain the avatar menu is
  `frontend/apps/entry`, the public landing page -- the human, 2026-09-12: *"We weren't
  talking about the dashboard, we're talking about the public landing page."*
- **2026-09-12** -- `frontend/apps/dashboard` was deferred (*"I'm not worried about the
  unstyled dashboard, at this point"*) and then brought back the same day, deliberately
  small: the avatar menu, the logo, and the MARP look via `frontend/shared/assets/css/
  shell.css` recoloured from the tokens -- *"But I don't wanna spend a huge amount of time
  on it because we are gonna go through and refactor the whole admin dashboard page
  later."* The Bootstrap layout, the page structure and the content are left alone. The
  constraint is part of the instruction, not a caveat on it.
- **2026-09-12** -- The avatar menu will be in three applications, so it is written once,
  in `frontend/shared/`. Whether the two apps that already have their own adopt it is the
  human's call and is not done silently.
- **2026-09-12** -- `body.top-hidden`, not `chrome-hidden`: it names the half it hides and
  leaves the name free if A1 is answered yes.

## Plan

1. `src/store.js` -- one field (`topChromeHidden`, initialised from the short-viewport
   query) and one action (`toggleTopChrome`), beside `railCollapsed` and `toggleRail`.
2. `src/ui/chrome.js` -- **one line**, next to the `rail-collapsed` line. This file is
   contended (#135 / PR #158), so nothing else changes in it.
3. `index.html` -- the button in the rail head.
4. `src/ui/mount.js` -- one listener line.
5. `styles/app.css` -- the row heights become variables so one rule can drop the two top
   rows in either layout; the phone rail overlay's `inset` follows the chrome that is left.
6. Tests: render tier (it is a rendering fact) plus the unit tier for the wiring.

## Acceptance criteria

- At 915 x 412 the field is 292px tall today and about 366px with the chrome hidden, and the
  header and sub-bar are absent from layout rather than merely invisible.
- The control is visible and works in both states, at both phone viewports.
- A mark made before the toggle is still there after it.
- The footer and both commit buttons are visible throughout.
- Nothing at desktop size changes at all -- no control, no new rules that match.

## Test plan

Filled in at G3 in `.marp/verification.md`.

## Status

- **Gate:** implementing
- **Notes:** No blocking assumption. A1 is the issue's own open question and nothing built
  here depends on it; it needs an answer before the pattern is copied to the other two apps.
