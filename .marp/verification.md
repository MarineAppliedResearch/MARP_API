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
