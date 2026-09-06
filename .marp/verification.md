---
task: MarineAppliedResearch/MARP_API#77
repos: [MARP_API]
status: plan
---

# Verification plan — filter rail: the remaining dimensions, and multi-select

**This is the plan, not the results.** G4 fills in what actually happened, verbatim,
failures included.

## What each requirement is proved by, and where

The tier matters more than the count. A rule about *meaning* is proved in `model/`; a
claim about what a reviewer can *see* is proved in the browser, because the store was
correct every time a rendering defect shipped here.

| Req | Claim | Tier | Named test |
| --- | --- | --- | --- |
| R1 | session, session type and processor are filterable | render | `every declared dimension actually reaches the rail` |
| R2 | confidence filters on both ends | unit | `R2: confidence filters on both ends` |
| R2 | the slider actually narrows the mosaic | render | **to add** — `R2: the confidence slider narrows the mosaic` |
| R3 | time of day works on every observation, dated or not | unit | `R3: time of day works on every observation, dated or not` |
| R4 | `tc` is read with its day group, exactly as `db/timecode.js` reads it | unit | `R4: tc is read with its day group, exactly as db/timecode.js reads it` |
| R4 | a window may wrap past midnight, and both sides are one night | unit | `R4: a time window may wrap past midnight, and both sides are one night` |
| R4 | an ordinary window does not wrap | unit | `R4: an ordinary window does not wrap` |
| R5 | a row whose `tc` carries no date cannot answer a date filter | unit | `R5: a row whose tc carries no date cannot answer a date filter` |
| R5 | the excluded rows are counted, not silently dropped | unit | `R5: the excluded rows are counted, not silently dropped` |
| R5 | **the reviewer is told the number** | render | **to add** — `R5: the date filter says how many it could not see` |
| R6 | several values of one dimension are an OR | unit | `R6: several values of one dimension are an OR` |
| R6 | the rail is whatever the declaration says, in its order | unit | `R6: the rail is whatever the declaration says, in its order` |
| R7 | removing a project keeps the dives that still apply | unit | `R7: removing a project keeps the dives that still apply` |
| R7 | a dependent with nothing left over stops filtering | unit | `R7: a dependent with nothing left over falls back to not filtering` |
| R7 | with no reachability known, the old blunt rule still applies | unit | `R7: with no reachability known, the old blunt rule still applies` |
| R7 | it behaves that way in the browser | render | `R7: changing the dive drops only the lines that no longer apply` |
| R8 | an empty selection means the dimension is not filtering | unit | `R8: an empty selection means the dimension is not filtering` |
| R9 | the line list is scoped to the chosen dive | render | `the line list is scoped to the chosen dive` |
| A4 | the rail is grouped by the question each answers | render | `the rail is grouped by the question each filter answers` |

Plus the architectural claim the whole refactor is judged by (A5, and the decision of
2026-09-05):

| Claim | Tier | Named test |
| --- | --- | --- |
| adding a dimension is one entry and nothing else | unit | `every dimension records where its data really comes from` |
| dependents are found through the whole chain | unit | `dependents are found through the whole chain` |
| nothing the interface looks up is undrawn | unit | `every id the interface looks up is drawn by something` |

## Three tests this plan adds before it runs

They are the ones where the tier that can observe the claim is not yet the tier that
tests it:

1. **`R2: the confidence slider narrows the mosaic`** — drag the lower handle up and
   assert the total falls. Proved in `model/` today; nobody has proved the slider is
   wired to it.
2. **`R5: the date filter says how many it could not see`** — set a date range and assert
   `[data-note="date"]` is visible and names a number. R5's whole point is that the
   reviewer is *told*, and a hidden note satisfies the unit test perfectly.
3. **`R4: a wrapped time window returns both sides of midnight`** — set 22:00–02:00 in the
   rail itself and assert a non-zero total. The arithmetic is unit-tested; that the two
   `<input type="time">` ends reach it in that order is not.

## What will be run

```
npm run test:unit     parse + 69 unit tests          ~1s
npm run test:e2e      desktop + phone, 112 tests     ~90s
```

The narrated walkthroughs are **not** part of this and are not run unless asked for. They
are a review surface, recorded on request. `playwright.config.mjs` now leaves that project
out unless something names it — a bare `playwright test` used to pull it in, which is why
a routine run was taking four and a half minutes.

## What this does NOT cover, and why

- **Nothing is proved against a real database or a real API.** This app runs entirely on
  `src/data.js`'s fixture. Every claim here is a claim about the client's rules and the
  fixture's data; Phase 8 of #68 is where they meet a server.
- **The `model` dimension filters simulated data.** The fixture generates `model_name`
  because a control nobody can exercise is a control nobody can judge — but no column
  links an observation to a model in the real schema. That is Phase 3 of #68.
- **The date dimension is proved on fixture dates, not production ones.** Production's
  `tc` carries dates only where the clock was synced; the exclusion count is exactly the
  mechanism for that, and #76 is where recovering the missing ones is decided.
- **No performance claim.** The fixture is small and paging is client-side here.
- **Nothing verifies the phone rail is usable**, only that it renders and the filters
  work at that width. Judging a ten-control rail on a phone needs a person.

## A defect found on the way, and it is not this task's

`tests/walkthrough/scenarios.mjs` asserted that three marks survive a species correction.
It fails on `origin/develop` too — verified by stashing this branch and running it — because
the page filters to one predicted species, so a corrected tile leaves the page. The scene's
narration claimed the opposite of what the app does, which is the exact failure the testing
doctrine warns about. Fixed here rather than left broken: it now asserts that the corrected
tile leaves and the other two marks stay.

## Results

Filled in at G4, after this plan is approved.
