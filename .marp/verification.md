# Verification — MARP_API#93, a committed page in Delete Mode is coloured as if accepted

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `R1/R2/R5: Delete is red, and nowhere near the green or the violet` | render | The committed-page chip's own computed colour in Delete Mode has red dominant, and is more than 120 in RGB distance from both Scientific's and Training's chips |
| R2 | the same test | render | The legend swatch is read in all three modes and carries the same hue family as the chip it explains |
| R3 | `R3: the progress bar fills with the hue of the mode filling it` | render | The far end of the progress gradient is green in Scientific and red in Delete |
| R4 | `R4: the commit button says the delete succeeded without saying it was accepted`, and `the commit button follows the mode that owns the decision` extended to Delete | render | The commit button and its success state are red in Delete Mode — a regression guard, since both were already correct |
| R5 | `R1/R2/R5: …` | render | Scientific's chip and swatch stay green, Training's stay violet |
| R6 | read by hand over the diff | — | No hex added to `styles/app.css`; Delete's values are `var(--red-500)`, `var(--red-400)`, `var(--white)` and two `rgba()` of the existing red, matching how `:root`, Training and `--mode-line` are already written |
| R7 | read by hand | — | The stylesheet comment, the variable names and the app's `CLAUDE.md` section agree |

Colour is a rendering claim, so every automated assertion is at the render tier. The unit
tier structurally cannot see a computed style, and no rule in `model/` changed.

## Requirements with no test

R6 and R7 are properties of the source text, not of a running application; both were read
by hand over the diff. Nothing else is untested.

## Edge cases

- **The page you are standing on has no chip.** `renderPager` draws an `<input>` for the
  current page, so `.pg.done` only exists after paging away — which is also the moment a
  reviewer sees it. The test pages forward before reading. The first draft did not, and
  failed with "element(s) not found" rather than saying anything about colour.
- **Colours are polled, never read once.** Rendering is a full re-render, so a handle taken
  the instant an element appears can be detached before `getComputedStyle` runs and returns
  an empty string. `readColour` polls until the value parses, following `commitAndReadBadge`.
- **The rail overlays the mosaic on a phone.** The progress-bar test opens the rail to read
  it and closes it again before switching mode and touching a tile.
- **Far apart, not merely different.** The chip assertions require an RGB distance over 120
  from each of the other two modes, because the property that matters to a person glancing
  at a pager is telling the three apart, not that the numbers differ.

## Regression coverage

- `.commit` and `.commit.ok` in Delete Mode were **already** red, by a specificity accident:
  `body[data-mode="delete"] .commit` (0,2,1) outranked both. Nothing asserted it, so the
  accept family could be renamed out from under them silently. Both are now asserted.
- Scientific green and Training violet are asserted in the same test as Delete's red, so a
  shared variable cannot move one of them without a failure.

## Known gaps

- **The success and failure states of the commit button are the same red in Delete Mode.**
  `--commit` is `--red-500` and `.commit.bad` is `--red-500`, so a delete that succeeded and
  one that failed differ only by the tick or cross glyph and the label. This is unchanged by
  this task — it was already true — and no state is encoded by colour alone, so it is
  recorded rather than fixed here.
- Nothing checks that a mode declaring `--mode` also declares the commit family. That is the
  shape of the original defect and it is currently a sentence in `CLAUDE.md`, not a check.

## Manual steps

None. Everything here runs in the browser tier.

## Walkthrough videos

None recorded — the user did not ask for one, and every claim above is asserted at the
render tier, which runs constantly.

---

## Results

`npm run test:unit` — after every change, and last run on the finished branch:

```
ℹ tests 127
ℹ suites 0
ℹ pass 127
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 95.5769
```

`npm run test:e2e` — once, on the finished branch (208 passing and 2 skipped before this
task; the six new cases are three tests across the desktop and phone projects):

```
  2 skipped
  214 passed (1.4m)
```

### Proving the tests catch the defect

`styles/app.css` was restored from a copy taken before the edit — a file copy, not
`git checkout` — and the four colour tests re-run against it:

```
  ✘ [desktop] R1/R2/R5: Delete is red, and nowhere near the green or the violet
  ✘ [phone]   R1/R2/R5: Delete is red, and nowhere near the green or the violet
  ✘ [desktop] R3: the progress bar fills with the hue of the mode filling it
  ✘ [phone]   R3: the progress bar fills with the hue of the mode filling it
  ✓ [desktop] R4: the commit button says the delete succeeded without saying it was accepted
  ✓ [phone]   R4: the commit button says the delete succeeded without saying it was accepted
  ✓ [desktop] the commit button follows the mode that owns the decision
  ✓ [phone]   the commit button follows the mode that owns the decision
  4 failed
  4 passed (7.1s)
```

The two failures name the defect exactly:

```
Error: the chip should be red, got rgb(199,255,98)
Error: deleting does not fill a bar with green, got rgb(167,236,53)
```

`rgb(199,255,98)` is `--green-300` and `rgb(167,236,53)` is `--green-400` — the root
values Delete Mode was inheriting.

The two that passed against the old stylesheet are the honest result: `.commit` and
`.commit.ok` were already red in Delete Mode, and those assertions are regression guards
rather than proof of a fix.

### Also run

Nothing else. No walkthrough was recorded and no bare `playwright test` was run.
