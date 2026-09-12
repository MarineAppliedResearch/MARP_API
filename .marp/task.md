---
task: MarineAppliedResearch/MARP_API#151
repos: [marp-api]
status: verifying
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

### Part 2 -- the ML Dashboard, where the gesture is the scroll

The mosaic reviewer does not scroll, so a deliberate control is right for it. The ML
Dashboard does scroll, so **the scroll is the gesture and there is no button** -- the
human, 2026-09-12: *"when you scroll down, you start scrolling down in the page, the
header disappears. But as soon as you start scrolling up again, the header reappears."*

- **R9** -- Scrolling down in the content hides the top bar; scrolling up brings it back.
- **R10** -- A small movement does nothing. Jitter, a trackpad's noise and a momentum
  bounce must not flap the bar, and a slow deliberate drag must still work.
- **R11** -- The bar is always on screen at the top of the content, whatever happened
  on the way there.
- **R12** -- The bar is always on screen when the content is too short to scroll, and it
  comes back if the content becomes too short while it is hidden. A bar that can be
  stuck hidden is a defect.
- **R13** -- The space the bar gives up goes to the content, and taking it back does not
  shift what the reader is looking at.
- **R14** -- `prefers-reduced-motion: reduce` gets the same behaviour with no animation.
- **R15** -- It is authored once, in the shell (`mockups/mock.js` and `mock.css`), so
  every screen has it and no screen declares it. DESIGN.md rule 3.

### Part 3 -- the public landing page, where the header has two states

`frontend/apps/entry`, served at `/` and `/how-it-works`. It is the only surface a person
reaches **without being signed in**, so its header has to serve a visitor and a member of
the project at once.

- **R16** -- The header gets out of the way as the reader moves down the page, and comes
  back as soon as they move back up. Same gesture as the ML Dashboard, because this is a
  scrolling document; the argument for it over the mosaic's button is in the decisions.
- **R17** -- The header is on screen at the top of the page, and while the mobile
  navigation sheet or the login dialog is open -- a header that hides with its own menu
  open takes the menu with it.
- **R18** -- Signed out, the header carries the *Sign in* control it carries today and the
  login dialog still opens and closes. Nothing about the signed-out page changes.
- **R19** -- Signed in, the header carries the avatar menu the Mosaic Reviewer and the ML
  Dashboard carry, rather than inviting somebody to sign in again.
- **R20** -- The avatar and its menu are written once, in `frontend/shared/`, so the third
  copy of this component is also the last one.
- **R21** -- A page that cannot reach the API draws the signed-out header. The render tier
  runs against a static server with no API at all, and a probe that fails must read as
  *not signed in* rather than as an error on the page.
- **R22** -- `prefers-reduced-motion: reduce` gets the behaviour with no animation.

### Part 4 -- one menu, drawn by one component

The human, 2026-09-12: *"We need to go ahead and convert the Mosaic reviewer and machine
learning dashboard menu to the shared one. So it's always the same menu."*

- **R23** -- All three applications draw the account menu from
  `frontend/shared/assets/js/account-menu.js` and its stylesheet. One component, one
  place to change it, and each app states only how big the avatar is.
- **R24** -- It survives a re-render. The Mosaic Reviewer redraws its chrome from state
  on every notify, so a control that mounted itself once has to still be there, and still
  work, after the next thing a reviewer does.
- **R25** -- **No human identity is a literal in any of the three applications.** Where
  something renders before a session has answered, or where nobody is signed in, it
  renders as nobody -- never as a name, and never as somebody's initials.
- **R26** -- The ML Dashboard is not session-gated, so signed out is a state it really
  has. It says so plainly rather than drawing a plausible stranger.

## Open assumptions

- [x] **A1 | product/UI | non-blocking** -- answered 2026-09-12: **the footer stays as it
  is, and nothing collapses it.** The issue said this was a question and not an assumption
  to build on, so nothing here depended on the
  answer and the mechanism extends to it in one rule if the answer is yes. Measured, so the
  answer can be an informed one: on a landscape phone hiding the footer as well adds **no**
  tiles, because a row is 150px there and the whole footer is 46px -- so the footer question
  is about reachability, not about room. In portrait the top chrome alone already buys a
  row (18 tiles -> 21, measured). **I want the answer before this pattern is replicated to
  the ML Dashboard and the landing page.** It came back with the approval of the mosaic.
- [ ] **A2 | product/UI | non-blocking** -- the control is a chevron in the **rail head**,
  beside the rail's own collapse button, because that strip is the only chrome that is
  always on screen in both layouts and it costs no tile area. The alternative was a handle
  floating over the top edge of the field, which is more discoverable and covers part of a
  tile. Reversible in CSS if the placement is wrong.
- [ ] **A3 | behavioural | non-blocking** -- "short" is `max-height: 600px` and "narrow" is
  the app's existing `max-width: 760px`. A landscape phone is **915px wide**, so every
  width-keyed rule in this app misses it (see the finding below); height is the only signal
  that sees it.
- [ ] **A5 | product/UI | non-blocking** -- what the landing page's avatar menu offers.
  The other two carry *Preferences* and *Keyboard shortcuts*, both of which are dead stubs
  there and would be meaningless here, so this one carries the name it is signed in as, a
  way into the dashboard, and *Sign out* -- which is the one item that really acts. Say so
  if it should mirror the other two item for item instead.
- [ ] **A6 | product/UI | non-blocking** -- the two **in-page** *Login* buttons, mid-page
  and in the closing call to action, still say *Login* to somebody already signed in. Only
  the header was asked for and only the header is changed; those two are named here rather
  than quietly rewritten.
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
What it does buy is that the two rows stop overflowing a 292px field (2 x 150 = 300), so
the field stops scrolling, and the mosaic band grows from 71% to 89% of the screen.

**Portrait is the better case, and measured rather than predicted: 18 tiles become 21.**
A row there is about 118px against the 66px recovered, which this arithmetic said would
not reach a row and the browser says does -- the estimate was wrong and the measurement
stands. The field goes from 88% to 95% of the screen.

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
- **2026-09-12** -- The menu is **the same four rows in all three applications**: who is
  signed in, the three doors into MARP, and Sign out. The Mosaic Reviewer's old menu
  offered *Preferences*, *Keyboard shortcuts* and *Tile density*, and the ML Dashboard's
  offered *Worker service tokens*; every one of them did nothing at all. "Always the same
  menu" is not served by keeping per-app dead stubs, and a real item can now be added in
  one place. The cost is that each app lists itself, which is one wasted row and the
  price of the menu being identical everywhere.
- **2026-09-12** -- The Mosaic Reviewer is told who is signed in rather than asking:
  `data-account-probe="no"`, and `ui/chrome.js` passes `state.me` on each render pass.
  Its store already reads `/api/v2/auth/me` at start-up for `decidedByMe`, and one answer
  should cost one request. The ML Dashboard and the landing page ask for themselves,
  because neither has already asked.
- **2026-09-12** -- The Mosaic Reviewer still hides the account control at phone width,
  as it did before this conversion -- `.hdr .right` is hidden below 760px because the
  width belongs to the mosaic. The conversion does not revisit a decision part 1 kept and
  the human approved; the render tier asserts it rather than skipping past it.
- **2026-09-12** -- Part 3 uses **the ML Dashboard's gesture, not the mosaic's button**.
  The landing page is a scrolling document, so the gesture is already in the reader's
  hand and a chrome control on a page somebody is reading for the first time is a control
  asking to be understood before the page is. The reservation raised with this part -- that
  a header sliding over a hero reads differently from one over a data table -- is answered
  by R17 rather than by a different mechanism: at the top of the page, which is the whole
  of a first impression, the header is always there. It leaves only once the reader has
  decided to go down the page, and returns the moment they turn round.
- **2026-09-12** -- Part 3 needs **no settle window**, and that is a real difference rather
  than an oversight. The landing header is `position: fixed`, so hiding it changes no
  scroll metric at all -- there is no maximum scroll position to shrink and therefore no
  clamp to absorb, which is the whole reason part 2 has one. The 6px threshold is kept,
  because trackpad noise and a momentum bounce are the same everywhere.
- **2026-09-12** -- The page learns whether it is signed in from **`GET /api/v2/auth/me`**,
  which is not an invention: the route documents itself as *"Session introspection endpoint
  used by clients to confirm auth state"*, answers 401 without a session and `{user}` with
  one, requires no permission beyond having a session, and **two applications already ask
  it exactly this question** -- `frontend/apps/dashboard/index.html` reads it to decide
  whether to show its Admin link, and the Mosaic Reviewer reads it for the reviewer's
  identity. So no new endpoint, no cookie reading, and no auth surface invented.
- **2026-09-12** -- Part 2's threshold is **6px of accumulated movement**, and a delta
  under it is ignored *without* resetting the reference point -- so noise does nothing
  and a slow drag still adds up to a decision. Chosen over a per-event delta, which
  makes a slow scroll unable to move the bar at all.
- **2026-09-12** -- A **180ms cooldown after each toggle**, because hiding the bar grows
  the scroller and shrinks its maximum scroll position: a reader pinned to the bottom is
  clamped upward by the bar's own height, which reads as scrolling up and shows the bar
  again. Found by reasoning about the clamp before building it, and the cooldown is what
  stops it being a flap at the bottom of every long page.
- **2026-09-12** -- The bar hides by a **negative top margin of its own measured height**,
  not a transform. Its grid row is `auto`, so a transform inside a collapsed row has a
  0px box to translate and moves nothing; a negative margin collapses the row, gives the
  pixels to the content, and animates.
- **2026-09-12** -- `body[data-topbar]`, matching the shell's existing `body.dataset.rail`.
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

- **Gate:** verifying
- **Notes:** No blocking assumption. A1 is the issue's own open question and nothing built
  here depends on it; it needs an answer before the pattern is copied to the other two apps.
