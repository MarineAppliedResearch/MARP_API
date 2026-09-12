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
