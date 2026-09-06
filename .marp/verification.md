# Verification — MARP_API#81, the filter rail

## What each test proves

Every test names its requirement in its own title, so a failure says which item of #81 has
broken rather than which selector moved.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| B1 | `B1: choosing a project unticks "All projects" while the menu is open` | render | the "All …" entry restates itself the moment a specific value is picked, and ticks again when the last one is removed |
| B1 | `B1: the dive and line menus behave the same way` | render | the same, on the two other menus #81 names |
| B2 | `B2: clicking the button that opened a menu closes it` | render | a second click closes; a click on another button moves the menu rather than only dismissing |
| B2 | `B2: it still closes after a pick has redrawn the rail underneath it` | render | the menu remembers its control by name, so a full rail re-render between the two clicks does not break the toggle |
| B3 | `B3: a typed time becomes 24-hour, or nothing at all` | unit | `normaliseClock` — `930` is half nine, `9:30 PM` is not a time, `24:00` is not a time |
| B3 | `B3: the time controls are 24-hour, with no AM or PM anywhere` | render | what is actually drawn: a text field holding `13:30`, no AM/PM in the panel, and the rail button saying the same back |
| B4 | `B4: a status filter draws one control, not two` | render | the `::after` badge is gone from a status checkbox and still present on the commit button |
| D1 | `D1: the fixture uses the session types the database really holds` | unit | exactly the five real values, casing included |
| D1 | `D1: a session has one type, because sessions.type is one column on one row` | unit | the type is a property of the session, which is what makes L2's narrowing true |
| L1, L2, L3 | `L1, L2, L3: the rail is one list, in order, with no processor in it` | render | no group headings; all ten labels in the declared order; no processor control |
| L1 | `L1: the rail carries no group headings, and no field nobody reads` | unit | `group` and `dimensionGroups()` are gone from the declaration rather than left unused |
| L2 | `L2: session type comes before session, and session nests under it` | unit | the order, and the nesting that makes the narrowing follow the selection |
| L3 | `L3: there is no processor dimension anywhere` | unit | not in `DIMENSIONS`, not in `FILTER_KEYS`, not in `DEFAULT_FILTERS` — so not in the query and not in the address |
| L4 | `L4: confidence is one track carrying two handles` | render | both inputs share a top, a left and a width; one track element; the fill follows a handle that moves |
| L5 | `L5: time and date take one rail row each` | render | no span control in the rail itself, one button each, and both ends present in the popover |
| L6 | `L6: the reset is the first control in the rail, and costs almost nothing` | render | above every filter, no wider than the collapse button, and still named for a screen reader |
| L7 | `L7: nothing in the rail is drawn where it cannot be reached` | render | both ends of the status filters and the progress block are inside the rail's own box |
| M1 | `M1: the field and the direction are independent` | unit | eight orders where there were five |
| M1 | `M1: what is applied reads as both halves, not as one phrase` | unit | the sub-bar text, and that each field words its own directions |
| M1 | `M1: a sort nobody could have chosen falls back rather than throwing` | unit | an edited address does not blank the sub-bar |
| M1 | `M1: the field and the direction are chosen separately, and both are on screen` | render | the menu, the rewording, the sub-bar, and the address |
| M1 | `M1: the order actually applied changes when the direction does` | render | the mosaic really reorders — a menu that reordered nothing would pass every other M1 test |
| Q1 | `Q1: the model dimension stays, until Phase 3 gives it a column` | unit | left in place deliberately, so removing it is a decision somebody makes |
| P1 | `no file that draws the rail knows a dimension by name` | unit | no renderer special-cases a dimension key, which is how the #77 property decays |
| P1 | `every declared dimension actually reaches the rail` | render | and nothing declared is silently undrawn |

**Each of B1–B4 was shown to fail before it was fixed.** The defect was reintroduced from
a file copy, the test run, and the copy restored — never `git checkout --` on a file with
uncommitted work. The four failures are recorded under *Results*.

## Requirements with no test

None. Every id in #81 has at least one named test above.

## Edge cases

- **A pick that redraws the rail under an open menu.** The rail is re-rendered from state
  on every change, so the button that opened a menu is replaced while the menu is up. The
  menu therefore keys on the control's *name*, not the node. Covered by the second B2 test.
- **A typed time that is not a time.** `noon`, `24:00`, `12:60` all leave that end unset
  and clear the field, so nothing sits on screen looking as though it were applied.
- **A time typed and then clicked away from.** The popover is dismissed by that click and
  the element is removed, so `change` on blur never arrives. The panel listens for
  `focusout` and Enter as well, and `applySpan` ignores a pair it has already been given so
  the overlap costs nothing. Not separately tested — see *Known gaps*.
- **Two slider handles dragged past each other.** Swapped rather than refused; the
  pre-existing behaviour, kept.
- **An address naming a sort that no longer exists.** `isSort` rejects it and the default
  applies, which matters because #81 removed five sort labels and added an eighth order.

## Regression coverage

- **B4 was an attribute collision**, not a stray element: `data-key` meant the status
  dimension in `chrome.js` and the keyboard-shortcut badge in `app.css`. The test asserts
  the pseudo-element is absent on the checkbox *and* still present on the commit button, so
  a fix by deleting the badge feature would fail it.
- **The R4 wrapped-window test was reading the total too early.** Both windows return more
  than a page, so the tile count `ready()` watches is identical either side of the change.
  It now polls the number that actually moves. Found while regenerating the fixture.

## Known gaps

- **The click-away flush is not covered by a test.** The `focusout` path is exercised by
  every popover interaction in the suite, but no test asserts specifically that typing a
  time and clicking into the mosaic applies it.
- **The date ends are still native `<input type="date">`,** so they render in the
  browser's locale order — `mm/dd/yyyy` here. B3 is about the clock and nobody reported
  the date format, so this is deliberate and untested.
- **`state.excludedForNoDate` is still date-shaped.** The rail now finds the note through
  `reportsExclusions` rather than by name, but the count and its wording are the date's.
  A second dimension that could not always answer would need the store generalised too.
- **`model/match.js` and `model/query-url.js` still name the date dimension**, because a
  date range compares differently from a number range. Pre-existing, and out of scope here.
- **Nothing checks the rail at a viewport shorter than 900px.** The rail body scrolls now,
  so it should hold, but the assertion is written against the desktop and phone projects
  the suite already runs.

## Manual steps

None. Everything here is reachable from the two automated tiers.

## Walkthrough videos

Not recorded. They are a review surface the user asks for, and #81 did not. The existing
`verify-filters` scenario was updated so it still passes and still asserts: its first scene
now checks that there are no group headings and that the bottom of the rail is reachable,
and its `setEnd` helper opens the popover the time and date ends now live in.

## Results

Recorded verbatim, including what failed on the way.

### The four bugs, failing before they were fixed

```
✘ B4: a status filter draws one control, not two
  Error: expect(received).toBe(expected)   // a status checkbox draws no badge of any kind
  Expected: "none"   Received: "\"reviewStatus\""

✘ B1: choosing a project unticks "All projects" while the menu is open
  Error: expect(locator).not.toHaveClass(expected) failed
      18 × locator resolved to <button data-v="" class="on">…</button>
         - unexpected value "on"
✘ B1: the dive and line menus behave the same way
  Error: dive still claims All dives
✘ B2: clicking the button that opened a menu closes it
  Error: expect(locator).toHaveCount(expected) failed
      18 × locator resolved to 1 element   - unexpected value "1"
✘ B2: it still closes after a pick has redrawn the rail underneath it
  Error: expect(locator).toHaveCount(expected) failed
      18 × locator resolved to 1 element   - unexpected value "1"

✘ B3: the time controls are 24-hour, with no AM or PM anywhere
  Error: expect(locator).toHaveAttribute(expected) failed
  Expected: "text"   Received: "time"      // with lang="en-GB" set, which changes nothing

✘ D1: the fixture uses the session types the database really holds
  AssertionError: + 'Drop Cam', + 'ROV'
✘ D1: a session has one type, because sessions.type is one column on one row
  AssertionError: session 400 carries both ROV and Drop Cam
```

### Failures found and fixed during the work

```
✘ R4: a time window that wraps past midnight returns both sides of it
  Error: expect(received).toBeGreaterThan(expected)   Expected: > 88   Received: 88
```

Two causes, both real. `page.fill()` raises `input` and not `change`, so a value typed
into a text field was never committed until focus left it — which the app now handles
through `focusout` and Enter, and the test drives with Enter. And both windows return more
than a page, so `ready()` could not see the result change; the test polls the total.

### Two more failures, on the first full browser run

```
✘ [desktop] the line list is scoped to the chosen dive
✘ [phone]   the line list is scoped to the chosen dive
  Error: locator.click: Test timeout of 30000ms exceeded.
    - waiting for locator('[data-dim="line"]')
    - <button class="" data-v="">…</button> from <div class="menu">…</div> subtree
      intercepts pointer events
```

Real, and caused by this work rather than uncovered by it. A multi-select menu stays open
after a pick and hangs over the control below it. The dive menu used to open *upwards*,
because the taller rail left no room beneath it; the compact rail leaves room, so it opens
downwards and covers the line button. The test now dismisses the menu before reaching for
the next control, which is what a reviewer does.

```
✘ [desktop] R7: the banner offers to ask for the imagery again
  1074 | await expect(page.locator('#commit')).toBeEnabled();
```

A flake, not a defect: it passed alone immediately afterwards, and passed in both
subsequent full runs. It retries fifty thumbnails, each behind a simulated 900 ms latency,
against a seven-second expectation — six parallel workers are enough to push it over.
Not chased further; noted so that it is not a surprise if it recurs.

### The final run

```
$ npm run test:unit
ℹ tests 101
ℹ pass 101
ℹ fail 0
ℹ duration_ms 68.5716

$ npm run test:e2e          # desktop and phone
  1 skipped
  153 passed (1.1m)

$ npm run test:e2e          # again, to see whether the R7 flake recurs. It did not.
  1 skipped
  153 passed (1.1m)
```

The one skip is deliberate and pre-existing: `it survives on a phone, where the trailing
words do not` calls `test.skip(info.project.name !== 'phone')`, so it runs once, on the
phone project, and reports itself skipped on the desktop one.

