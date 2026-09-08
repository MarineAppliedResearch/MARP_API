---
task: MarineAppliedResearch/MARP_API#89
repos: [MARP_API]
status: verified
---

# Verification — every mode filters on both workflow statuses

Run from `frontend/apps/marp-mosaic-review`. Branch `89-status-filters-everywhere`, from
`89-per-mode-session-work`.

## What was tested, and which requirement it proves

| Tier | Test | Proves |
| --- | --- | --- |
| unit | `R3: the default question carries no training-disposition narrowing` | R3 (the rule) |
| unit | `R1: every mode filters on both dimensions, its own first` | R1 |
| unit | `R2: a borrowed dimension arrives not filtering; an owned one at its default` | R2 |
| unit | `R2: entering a mode gives its own dimension a default and clears the borrowed one` | R2, A3 |
| unit | `R4: every mode sends both status dimensions, and drops neither` | R4 |
| unit | `R4: a borrowed dimension nobody touched sends nothing at all` | R4, R3 |
| unit | `R4/R8: the query keeps every dimension the reviewer narrowed, in every mode` | R4, R8 |
| unit | `R6: the collapsed rail badge counts a borrowed dimension only when it narrows` | R6 |
| unit | `R9: filtering on a borrowed dimension changes nothing about the mark or the commit` | R9 |
| unit | `R7: a borrowed status filter round-trips, and absence means not filtering` | R7 |
| unit | `R3/R7: a bare address is still the default question, with nothing borrowed applied` | R7, R3 |
| render | `R3: Scientific opens with no training narrowing, and its total does not move` | **R3 (the count)** |
| render | `R1: Scientific's rail draws both dimensions, its own first` | R1, R5 |
| render | `R1: Training's rail leads on its own dimension and borrows review status` | R1 |
| render | `R9: ticking Excluded in Scientific narrows to excluded observations` | R9 |
| render | `R7: a borrowed filter arrives from the address and stays in it` | R7 |
| render | `R6: the collapsed rail badge counts a borrowed dimension only once it narrows` | R6 |
| render | `R8: Delete Mode is unchanged — both dimensions, both defaults` | R8 |
| render | `L7: nothing in the rail is drawn where it cannot be reached` (rewritten) | the rail still reaches every control, in every mode |
| contract | `Delete Mode shows what the scientific record already says` (adjusted) | R8 |

R10 is a documentation change and carries no test; `frontend/apps/marp-mosaic-review/CLAUDE.md`
was rewritten in the same commit as the tests.

## The measured default result count

Through the app's own code path — `defaultQuery()` → `queryFilters()` → `MarpData.query()`
against the fixture.

| | `filters.trainingDisposition` | default result total |
| --- | --- | --- |
| before, on `89-per-mode-session-work` | `["undecided"]` (dropped by `queryFilters`) | **1083** |
| after | `[]` | **1083** |
| after, with the trap injected | `["undecided"]` (sent) | **932** |

Under the default question the fixture holds 932 undecided, 66 promoted and 85 excluded
Bat Star observations — so the trap costs 151 rows, silently.

## Real results

```
npm run test:unit
✓ 32 files parse
ℹ tests 127
ℹ pass 127
ℹ fail 0
ℹ duration_ms 88.7

npm run test:e2e          (desktop + phone)
4 skipped
206 passed (1.3m)
```

The 4 skips are pre-existing and viewport-conditional, unchanged by this work: the
unavailable-thumbnail test at both viewports (no failed thumbnail on page 1) and two
`test.skip(info.project.name !== ...)` guards.

## What failed on the way

The first full browser run failed 4 (2 tests × 2 viewports), and both were real:

1. **`Delete Mode shows the scientific record › it offers both status dimensions, and only
   Delete does`** — an existing render test asserting `#statusFilters .lbl.sub` has count 0
   in the review modes. That is the rule #89 reverses, so the test was rewritten to assert
   what is still Delete's own: the *default*, not the dimension.

2. **`the filter rail, cleaned up › L7: nothing in the rail is drawn where it cannot be
   reached`** — a real consequence of the change, not a stale assertion. Six status boxes
   plus a sub-heading make Scientific's rail taller than its container, so `.prog` is below
   the fold; on the phone by 94px. `.rail-body` scrolls, so it is reachable, but L7's
   assertion was the stricter "fits without scrolling", which held only while a review mode
   had three boxes. Rewritten to assert what its own comment says — that the container is
   scrollable whenever its content overflows — and now run in all three modes, which closes
   the gap that let Delete Mode's two-dimension rail go unasked since #71.

## Proving each test catches its bug

Each bug was injected into a `cp` copy of the file and restored from that copy.

**Trap A — a borrowed dimension takes the owning mode's default** (in `statusDimensions`):

```
✖ R4: a borrowed dimension nobody touched sends nothing at all
✖ R3: the default question carries no training-disposition narrowing
✖ R2: a borrowed dimension arrives not filtering; an owned one at its default
✖ R2: entering a mode gives its own dimension a default and clears the borrowed one
✖ R6: the collapsed rail badge counts a borrowed dimension only when it narrows
✖ R7: a borrowed status filter round-trips, and absence means not filtering
✖ R3/R7: a bare address is still the default question, with nothing borrowed applied
ℹ pass 120  ℹ fail 7
```

And the render tier, with the count assertion moved ahead of the others so it is the one
that fires — the point being that the *number* catches it, not just the filter shape:

```
Error: TEMP the default result set must not move: 151 rows are at stake
Expected: 1083
Received: 932
2 failed  (desktop and phone)
```

**Trap B — `queryFilters` still drops the dimension the mode does not own:**

```
✖ R4: every mode sends both status dimensions, and drops neither
✖ R4: a borrowed dimension nobody touched sends nothing at all
✖ R4/R8: the query keeps every dimension the reviewer narrowed, in every mode
ℹ pass 124  ℹ fail 3

render, R9: expect(locator).toHaveCount(expected) failed
  Expected: 50   Received: 3     (desktop)
  Expected: 7    Received: 0     (phone)
```

**Trap C — `.rail-body { overflow-y: hidden }`, the original #81 L7 bug:**

```
Error: the rail overflows in Scientific Data Review and must scroll
Expected value: "hidden"
Received array: ["auto", "scroll"]
2 failed  (desktop and phone)
```

An earlier draft of the rewritten L7 used `scrollIntoViewIfNeeded` and **passed with this
bug in place** — `overflow: hidden` is still scrollable programmatically, so scrolling
proves nothing about what a person can reach. That draft was discarded; the note is in the
test so nobody writes it again.

## Flake found and fixed

The rewritten L7 failed once in three desktop runs while measuring the rail's box and the
control's box in separate Playwright calls — the rail was measured from before a mode
switch redrew it. Both are read in one `page.evaluate` now, and it ran three times clean.

## Not covered

- **Nothing was run against MARP_API.** The app is still on its fixture; `src/data.js` is
  the seam. The claim that the API will filter on both status dimensions the same way is
  untested, as every claim about that seam is.
- **No walkthrough was recorded.** They are on request, and this change has no scene.
- **The rail's height is now tighter in every mode, and that is not asserted as a
  design property**, only as reachability. Whether a reviewer minds scrolling for the
  progress bar in Scientific is a question for use, not for a test.
- **The counts beside a borrowed status can exceed the result total** — they already could
  in Delete, and A1 records why that is the answer rather than a defect. No test asserts a
  relationship between the two numbers, because there is deliberately none.
