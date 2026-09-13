# Verification — MARP_API#151, the mosaic reviewer's top chrome

Part 1 of three applications. The ML Dashboard and the public landing page are not covered
here and are not started.

## What each test proves

All eight are in `frontend/apps/marp-mosaic-review/tests/e2e/render.spec.mjs`, under
`#151 the top chrome`. Every one was proved red against the code before the change and is
green after it.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `R1: the control takes the header and the sub-bar away, and the field gets the pixels` | render (phone) | Both bars measure 0 afterwards, and the field grows by **exactly** their combined height — chrome that hides without giving the space away would still pass a visibility check |
| R2 | `R2: the control is still reachable once the chrome it hides is gone` | render (phone) | The control is visible with the chrome hidden, says `aria-expanded=false`, and brings both bars back to their original heights |
| R3 | `R3: the footer and both commit buttons are untouched` | render (phone) | The footer's height is unchanged and `#commit` and `#commitMarked` are both still visible — the scope guard for the question the issue left open |
| R4 | `R4: a mark made before the chrome is hidden is still there after` | render (phone) | A marked tile is still marked after the toggle re-pages the mosaic |
| R5 | `R5: on a landscape phone the chrome starts out of the way` | render (landscape context, 915×412) | The reported viewport starts hidden, and showing the chrome costs the field exactly the two bars' height |
| R6 | `R6: a desktop has no such control, because it has no such problem` | render (desktop) | The control exists in the markup (`toHaveCount(1)`) and is not displayed |
| R7 | `R7: the rail overlay follows the chrome rather than hanging below where it was` | render (phone) | The rail overlay's top comes up with the chrome, and `document.documentElement` gains no horizontal overflow |
| R8 | `R8: the state is on the body, the way the rail already says its own` | render (phone) | `body.top-hidden` is absent, then present — the handle every other test and any future one reads |

**Why every one of these is in the browser tier.** Whether a bar is on screen, how tall the
field is and whether the rail overlay is in the right place are rendering facts. The store
knows only that a flag was flipped, so a store-level check would pass against a stylesheet
that does nothing at all. The one thing that *is* checkable without a browser — that the
control is wired to something that draws it — is covered by the existing
`tests/unit/wiring.test.mjs`, which picked the new id up with no edit.

## Requirements with no test

None. R1 to R8 each have a named test above.

## Edge cases

- **A landscape phone is 915px wide.** Every narrow rule in this app is behind
  `@media (max-width: 760px)`, so the viewport the issue was reported from was invisible to
  every existing test in the file. R5 builds its own 915×412 context for that reason, and
  the feature is keyed on `max-height: 600px` as well as the existing width query.
- **Hidden, not zero-height.** `display: none` rather than a 0px track, because a 0px `.hdr`
  with `overflow: hidden` still answers `isVisible()` and still takes the tab key — focus
  could land on a control nobody can see. R1 asserts the measured height is 0.
- **The toggle re-pages the mosaic.** Page size follows the field, so growing the field
  re-queries. R4 is the guard that this costs the reviewer no marks.
- **The rail overlay is positioned against the viewport**, not against `.body` — nothing
  between them is positioned — so its `70px` top was the two bars measured by hand. R7 is
  the test for the trap that created.

## Regression coverage

- R6 was written as `toBeHidden()` alone and **passed against the code before the change**,
  because `toBeHidden` is also true of an element that does not exist. It now asserts
  `toHaveCount(1)` first and fails red as it should. A test that cannot go red is not a test.

## Known gaps

- **Two phone shapes, not phones in general.** 412×915 and 915×412. A tablet, a fold and a
  desktop window that is merely short all now match `max-height: 600px` and none was tried.
- **No real-device run.** Chromium at a phone viewport with touch emulated, which is what
  this tier is.
- **The API tier is untouched.** Nothing here writes, reads or changes a request, so there
  was nothing for `--project=api` to see.
- **Not a narrated walkthrough**, deliberately: none was asked for.

## Results, as run

`npm run test:unit` — 283 pass, 0 fail (about 0.9 s), including the wiring check that now
sees `#chromebtn`.

Red first, against the pre-change sources restored from a file copy (never `git checkout
--`), `npx playwright test --project=phone --project=desktop -g "#151"`:

```
  7 failed
    [phone] › #151 the top chrome › R1: the control takes the header and the sub-bar away, and the field gets the pixels
    [phone] › #151 the top chrome › R8: the state is on the body, the way the rail already says its own
    [phone] › #151 the top chrome › R2: the control is still reachable once the chrome it hides is gone
    [phone] › #151 the top chrome › R3: the footer and both commit buttons are untouched
    [phone] › #151 the top chrome › R4: a mark made before the chrome is hidden is still there after
    [phone] › #151 the top chrome › R5: on a landscape phone the chrome starts out of the way
    [phone] › #151 the top chrome › R7: the rail overlay follows the chrome rather than hanging below where it was
  8 skipped
  1 passed (44.0s)
```

The failure in each case was `Error: locator.click: Test timeout of 30000ms exceeded.
Call log: - waiting for locator('#chromebtn')` — the control did not exist. The one that
passed was R6, which is why it was strengthened; proved red separately afterwards:

```
  1 failed
    [desktop] › #151 the top chrome › R6: a desktop has no such control, because it has no such problem
  7 skipped
```

Green, same command, after restoring the implementation from the copy:

```
  8 skipped
  8 passed (4.7s)
```

Whole render tier, `npm run test:e2e` (desktop and phone projects), run twice:

```
run 1:  1 failed / 13 skipped / 302 passed (2.1m)
          [phone] › the filter rail, cleaned up › L4: confidence is one track carrying two handles
run 2:  0 failed / 13 skipped / 303 passed (2.1m)
```

**The L4 failure is not this change.** It passes alone, it passed in the second full run,
and the geometry it is sensitive to is identical with and without the change — the rail,
the rail head and the confidence control measure `0,70 190x801`, `10,78 169x20` and
`10,454 159x20` in the phone overlay in both cases. It is reported rather than chased: it
is an instability in a test another agent's branch also touches.

---

# Part 2 — the ML Dashboard's top bar

A different mechanism on purpose. The mosaic reviewer does not scroll, so its chrome
needs a control; this app scrolls, so the scroll is the gesture and there is no control.

## What each test proves

All of them are in `frontend/apps/marp-ml-dashboard/tools/scroll-check.mjs`, run by
`npm run check:scroll` and as part of that app's `npm test`. It is a script that collects
problems and exits 1, which is this app's existing idiom for a check — `mock-shots.mjs` is
the same shape. The whole set was proved red against the shell before the change.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R9 | the gesture itself | browser | A wheel down hides the bar and puts its bottom edge off the top of the screen; a wheel up brings it back |
| R10 | noise does nothing | browser | Three pixels does nothing, five does nothing, seven is heard — so jitter cannot flap it and a slow drag still works |
| R11 | at the top | browser | After a jump down and back, the bar is on screen at `scrollTop` 0 |
| R12 | nothing to scroll | browser | With the bar hidden, the content is emptied until it no longer scrolls, and the bar comes back on its own |
| R13 | the space goes to the content | browser | `.content`'s `clientHeight` grows when the bar hides |
| R14 | reduced motion | browser | The transition is non-zero ordinarily and zero under `prefers-reduced-motion`, **and the behaviour still works** |
| R15 | authored once | browser | Every screen that scrolls at 941px hides its bar — 5 of 8, asserted to be at least 4 so the check cannot pass vacuously |

## Edge cases

- **The clamp cascade at the bottom of a page, which is the defect this design is most
  likely to have had.** Hiding the bar hands its height to the content, which *shrinks*
  the scroller's maximum scroll position — so a reader near the bottom is clamped upward,
  and an upward move is the signal that brings the bar back. Instrumenting the real page
  showed the clamp arriving as a cascade of eleven scroll events walking from 368 to 306,
  every one of them reading as *up*. The 180ms settle window absorbs it and the state
  stays `hidden` throughout. Without it, the bottom of every long page would flap.
- **A measurement of zero is how the animation could have flapped at 60fps.** The bar is
  offset by its own measured height; stretched to a collapsed grid row it would measure 0,
  the offset would come back to 0 and the row would open again. `align-self: start` on the
  bar and a refusal to record a zero height are the two guards, and both carry a comment.
- **Content can stop being scrollable with nobody scrolling** — a tab switch, a filter, a
  drawer. No scroll event ever arrives to put the bar back, so a MutationObserver on the
  content watches for it. R12 is that case.

## Known gaps

- **One assertion inside R10 cannot go red**: that seven pixels *shows* the bar passes
  trivially against code where the bar is always shown. The block around it goes red, and
  the threshold it measures only exists once the feature does.
- **The `dashboard` screen does not scroll at 1672×941 and neither do `jobs` or
  `training`.** Three of the eight screens cannot exercise this at desktop height, which
  is why the check names how many did.
- **Desktop width only.** The behaviour is not width-dependent — it is the same listener
  on the same scroller at every breakpoint — but it was only driven at 1672×941.
- **No touch-momentum run.** A real phone's rubber-band bounce is the case the threshold
  is for, and Chromium's wheel is not that gesture.

## Results, as run

Red first, with `mock.js` and `mock.css` restored from a file copy — 15 problems, the
whole set:

```
[x] R9: scrolling down should hide the bar, got "shown"
[x] R9: the bar should be off the top, its bottom edge is at 62px
[x] R13: the content should gain the bar's height, 879 -> 879
[x] R9: a jump down should hide it
[x] R10: setup -- the bar should be hidden at 400px
[x] R10: three pixels of movement should not bring the bar back
[x] R10: five pixels is still noise
[x] R12: setup -- the bar should be hidden
[x] R14: the bar should animate ordinarily, duration is "0s"
[x] R14: reduced motion removes the animation, not the behaviour
[x] R15: datasets scrolls but its bar does not hide
[x] R15: history scrolls but its bar does not hide
[x] R15: inference scrolls but its bar does not hide
[x] R15: models scrolls but its bar does not hide
[x] R15: workers scrolls but its bar does not hide
```

Green after restoring the implementation, and the app's whole check suite with it:

```
    5 of 8 screens scroll at 941px, and each hides its bar
ok  the top bar hides on the way down, comes back on the way up, and cannot get stuck
ok  6 files parse
ok  no raw colours, no states outside the vocabulary
ok  32 shots, nothing clipped, no console errors
```

**Two of those failures were the check being wrong rather than the code.** The first run
was driven on `dashboard`, which does not scroll at all at that height, so every check
passed while proving nothing — the `room > 200` assertion is what said so out loud, and it
is an assertion rather than a skip for that reason. The second run was driven on `models`,
whose 368px of room put the pixel-exact checks at the bottom of the page, where they
measured the clamp instead of the threshold. Both are recorded in the file.

---

# Part 3 - the public landing page

Two things in one header: it follows the reading, and it knows who is reading. The
gesture is the ML Dashboard's, because this is a scrolling document; the argument for
that over the mosaic's button is in `.marp/task.md`.

## What each test proves

Thirteen checks in `frontend/apps/entry/tests/e2e/render.spec.mjs` under `#151 the
header`, run at all three of that app's projects - `desktop`, `phone`, and
`phone-landscape`, which is the viewport this whole issue is about. All were proved red.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R16 | it leaves on the way down and comes back on the way up | render x3 | The header's bottom edge goes off the top of the screen and returns |
| R16 | a few pixels of noise does not flap it | render x3 | Three and five pixels do nothing, seven is heard |
| R17 | at the top of the page the header is always there | render x3 | After going down and back, it is on screen at scrollTop 0 |
| R17 | it does not slide out from under an open sheet | render x2 | The same scroll hides it with the sheet shut and does not with it open |
| R18 | signed out, the invitation stays | render x3 | The account control exists, is hidden, and the Login button is reachable |
| R19 | signed in, the account menu instead | render x3 | Initials drawn from the name, the Login button gone, the menu opens and Escape closes it |
| R19 | signing out tells the server | render x3 | The POST to `/api/v2/auth/logout` actually happens |
| R21 | a probe that fails still draws the signed-out header | render x3 | A 500 from the session endpoint reads as *not signed in* |
| R22 | reduced motion | render x3 | No perceptible transition, and the behaviour still works |
| R20 | the menu is loaded from one shared file | text tier | `tests/landing-copy.test.js`: both pages load `assets/js/account-menu.js` and carry `data-account` |

## Edge cases, each of which was a real failure first

- **`hidden` did not hide, twice.** The attribute is only the user agent's
  `display: none`, so any rule setting `display` outranks it. `.primary-nav .button` left
  the *Login* button on screen beside the avatar that had just replaced it, and
  `.account__menu`'s own `display: grid` left the dropdown open before anybody clicked.
  Both are now stated at a specificity that wins, without `!important`.
- **On a landscape phone the menu opened into nothing.** The navigation sheet fills a
  340px screen, so a dropdown hanging below the avatar put *Sign out* at y=468: 128px
  past the bottom, unreachable by any gesture. The sheet is now bounded to the screen and
  scrolls, and inside it the menu is part of the list rather than a dropdown off it.
  **This was a defect in this work, found by a test at the viewport the issue is about.**
- **The probe's 401 is not a bad response.** The render tier fails a page that produces
  one, and for a visitor `GET /api/v2/auth/me` answers 401 by design - 404 in this tier,
  where there is no API at all. The check now excludes exactly that URL with exactly
  those two statuses; a 500 from it still fails, and R21 proves the page copes anyway.

## A pre-existing flake, made worse and then fixed

`the landing page hero > puts the headline, the copy and both buttons on the first
screen` at `phone-landscape` failed intermittently. Measured rather than guessed:

```
before #151:  2 failures in 8 runs
after  #151:  4 failures in 8 runs
the failure:  "buttons: 298..342 of 340"
settled page: actions 276..320 of 340, identical on three consecutive runs
```

`.hero__copy` is a `data-reveal` element: it starts 22px low and animates up over 650ms,
and 320 + 22 = 342. The test was catching the animation in flight. It is not a layout
difference - the page measures the same with and without this work - but adding a script
and a request to the page's load changed which frame the measurement landed on. The test
now waits for the reveal to finish and passes **8 runs in 8**.

Fonts were the first hypothesis and were wrong: `document.fonts.ready` changed nothing,
and the failure stayed at exactly 342.

## Known gaps

- **The signed-in state is tested against an intercepted route, not a real session.**
  The render tier runs on a static server with no API. What is proved is that the header
  draws correctly given each answer, not that the server gives that answer - though the
  endpoint's own behaviour is covered by the API suite, and two applications already
  depend on it.
- **The two in-page Login buttons are untouched** (A6), so a signed-in visitor still
  meets them further down the page.
- **The Mosaic Reviewer and the ML Dashboard still carry their own menus.** Adopting the
  shared one is the human's call and is not done here.

## Results, as run

Red first, with the four page files restored from a copy and `account-menu.js` moved
aside: **13 failed, 2 passed**. Those two were the R17 sheet check at two viewports,
which asserted only that the header does *not* move and so passed against a page whose
header never moved at all; it now proves the contrast first and fails red.

Green, the whole entry tier at all three viewports:

```
  1 skipped
  59 passed (27.3s)
```

The skip is the sheet check at desktop, where the hamburger does not exist.

And the text tier that owns this page's markup:

```
Test: landing page copy > uses no class landing.css has no rule for ......... PASS
Test: landing page copy > contains no em dash in the account menu script .... PASS
Test: landing page copy > loads the shared account menu on both pages ....... PASS
  Test Suites : 1 passed, 0 failed, 1 total
  Result: ALL TESTS PASSED
```

---

# Part 4 - one account menu, drawn by one component

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R23 | `#151 the account menu` R23 x3, mosaic `tests/e2e/render.spec.mjs` | render | The header draws one control, on the component's own hooks, and it opens and shuts |
| R23 | mosaic `R23: it draws whoever the backing says is signed in, not a literal` | render | The initials are **derived from `window.MARP.state.me`**, so a hard-coded avatar fails even when the letters would have matched |
| R24 | mosaic `R24: it survives a re-render` | render | After marking a tile - a full chrome redraw - the control is still there, still says the same thing, and still opens |
| R23 | ML `tools/account-check.mjs` | browser | All 8 screens draw exactly one shared control; signed in it shows that session's initials |
| R25 | ML `account-check`: no person named in the top bar | browser | Asserted against the **rendered** top bar, so a literal anywhere in the shell fails |
| R26 | ML `account-check`: signed out | browser | Nobody, `Not signed in`, and Sign out not offered - against a real 404 from the probe |
| R25 | landing `R19` (part 3) | render | Unchanged and still green after the component moved |

## A bug this work introduced, and the check that caught it the first time it ran

`mount()` already had a local `show(open)` for opening the dropdown. The new
`show(root, user)` that paints the identity is declared at module level, so **inside
`mount` the local one shadowed it** - and the paint call was toggling the menu with a DOM
node for its argument. Every application drew nobody, for ever, and the landing page's
signed-in path would have gone with it.

`tools/account-check.mjs` failed on it the first time it was run. The local is now
`setOpen`, and the comment says why.

## Two harness changes, both narrow, both stated

- **`tests/landing-copy.test.js` now reads the stylesheets a page links** instead of only
  `landing.css`. The component's rules moved to `account-menu.css`, which all three apps
  link, and the alternatives were duplicating those rules - the drift this conversion
  exists to end - or letting the classes through unstyled. **Changed, not weakened, and
  demonstrated:** an unstyled class added to `index.html` still fails the check, on that
  page only.
- **The ML Dashboard's harnesses answer the session probe as nobody** (a 200 carrying no
  user). That tier serves files and has no API, so the probe 404s, and a failed request
  is a console error - which those checks fail on, for reasons that have nothing to do
  with this. The 404 path is not skipped: `account-check.mjs` lets it happen and asserts
  the signed-out state.

## Known gaps

- **The mosaic's render tier runs on the fixture**, whose `me` is `I. Travers` - so what
  is proved there is that the avatar follows the backing's identity, not that a real
  session reaches it. The API tier and the real server cover the endpoint.
- **The fixture still names a real person** (`src/data.js`, `tools/make-fixture.mjs`).
  That is test data rather than application chrome, and it is deliberately a person so
  `decidedByMe` can be exercised. Named for a decision rather than changed here.
- **The signed-in state of the ML Dashboard is tested through an intercepted route.**
  It is not gated, so a real session there is a person signing in elsewhere first.

## Results, as run

Red first for the mosaic's four, against the pre-conversion files restored from a copy:

```
  4 failed
    R23: the header draws one shared account control, and it is the shared one
    R23: it draws whoever the backing says is signed in, not a literal
    R23: it opens, and it shuts
    R24: it survives a re-render
```

Then green, everywhere:

```
mosaic     303 unit pass, 0 fail
mosaic     14 skipped, 316 passed (2.1m)          render, phone and desktop
ML         ok  7 files parse
ML         ok  no raw colours, no states outside the vocabulary
ML         ok  the top bar hides on the way down, comes back on the way up
ML         ok  the account menu is the shared one, and it names nobody it has not been told about
ML         ok  32 shots, nothing clipped, no console errors
entry      1 skipped, 59 passed (26.9s)           three viewports
API        Test Suites : 1 passed, 0 failed       tests/landing-copy.test.js
```

---

# Part 5 - the legacy dashboard, roughly

## What was judged sufficient, and why

**A file-reading check, and no browser tier.** `tests/dashboard-shell.test.js` holds that
all four pages link the shared component, are given the palette, ask Bootstrap for its dark
mode, carry the logo and the account markup, state no colour of their own, define no second
account menu, and **name nobody**. It is in `core` beside `landing-copy` and `docs-branding`,
which are the same kind of invariant.

Building a render tier for an application that is about to be redesigned would cost more
than the restyle did, which is the whole instruction. What a browser draws was checked once,
by hand, below.

## The one-off browser check

All four pages rendered through a scratch server mirroring `app.js`'s static mounts, with
the session probe answered:

```
index.html           bg rgb(1,5,13)  text rgb(199,212,221)  avatar AL  Signed in as Ada Lovelace  logo loaded  sideways 0  errors none
admin.html           bg rgb(1,5,13)  text rgb(199,212,221)  avatar AL  Signed in as Ada Lovelace  logo loaded  sideways 0
user-activity.html   bg rgb(1,5,13)  text rgb(199,212,221)  avatar AL  Signed in as Ada Lovelace  logo loaded  sideways 0
user-hours.html      bg rgb(1,5,13)  text rgb(199,212,221)  avatar AL  Signed in as Ada Lovelace  logo loaded  sideways 0
```

`rgb(1, 5, 13)` is `--navy-1000` and `rgb(199, 212, 221)` is `--text`, so the palette
reaches the body on every page. The errors on the three pages other than `index.html` are
404s from the scratch server, which has no API for them to fetch their data from.

## Two things the first attempt got wrong

- **Bootstrap paints the ground too, and it was winning.** `shell.css` was linked before
  Bootstrap, so the body came out `rgb(33, 37, 41)` -- Bootstrap's dark grey, not MARP's
  navy. The shell now loads after it on those two pages.
- **The account menu mounted before its own markup existed.** `user-activity.html` and
  `user-hours.html` draw their header from a partial fetched by `partials.js`, which lands
  well after `DOMContentLoaded` -- so the component looked, found nothing, and those two
  headers drew nobody permanently. `partials.js` now asks it to mount again once a partial
  is in, which is safe because mounting is idempotent.

## Known gaps

- **Nothing here is proved by an automated browser check**, by choice. A palette that stops
  reaching a page would pass this file-reading tier as long as the links are present.
- **`frontend/apps/entry/old_index.html` also links `shell.css`** and therefore changed
  colour. It is the page the landing page replaced, kept for reference and not served.
- **The pages' own content is untouched**, including anything about it that looks wrong.
