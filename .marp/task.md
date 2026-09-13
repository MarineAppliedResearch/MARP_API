---
task: MarineAppliedResearch/MARP_API#157
repos: [marp-api]
status: verifying
needs: []
---

## Goal

The mosaic reviewer's browser tests stop grading a fixture. 231 checks currently run
against `src/data.js`, which is not a small version of the API but a **different** one --
it writes the observation's own status column in place when a page is committed, and the
endpoint never does. Everything living in the gap between what a commit recorded and what
the row still says is therefore invisible to them by construction, which is why #130,
#124's F6 and F8 and #135's R7 all shipped green. After this, every browser check runs
against a real MARP API on a testing database built from a copy of the corpus, and
`src/data.js` and the `?backing=fixture` flag are gone so it cannot come back.

#132 built the mechanism and proved it on five checks. This is the rest of it.

## Requirements

- **R1** -- Every check in `tests/e2e/render.spec.mjs` (148, across 33 describes) runs in
  the API project against the testing database, asserting what it asserted before.
- **R2** -- Every check in `tests/requirements.js` (80) does the same.
- **R3** -- Both viewports, as before. The narrow layout is its own set of defects and the
  checks that see them keep the width that makes them visible. Coverage is never traded
  for speed.
- **R4** -- `src/data.js` is deleted, and so is `?backing=fixture` and everything that
  existed only to select between two backings.
- **R5** -- The unit tier keeps working and keeps its coverage. Where a unit check was
  about a rule in `model/`, it survives; where it was about `src/data.js` itself, it goes
  with its subject, and the report says which.
- **R6** -- Nothing a test writes is left behind. After a run the testing database holds
  exactly the decisions it held before, and a restore that did not apply fails the test
  rather than being inherited by the next run.
- **R7** -- No check deletes an observation it did not create. A delete reaching the real
  endpoint from a test that did not seed the row is a failure, not a surprise.
- **R8** -- The application's own documentation says what is true: `CLAUDE.md`'s *The two
  backings*, *The test tiers* and *Where a new test goes* stop describing a fixture.

## Open assumptions

- [x] **A1 · behavioural · non-blocking** -- The migrated render checks open on
  `?reviewStatus=unreviewed` rather than on the bare default address, except the ones that
  are *about* the default question or about a flagged row. **Settled by what the checks
  already assumed.** Scientific's default question shows flagged rows beside unreviewed
  ones and `page.seedMarks` marks them on arrival, so on a real corpus a click on the
  first tile is frequently a take-back rather than a mark -- and every inherited check of
  the form "mark a tile, assert one tile is marked" was written against a page where that
  could not happen. Dropping `flagged` reproduces that page on any corpus without
  pretending the default is something else. `undecided()` in `support.mjs`.
- [x] **A2 · architectural · non-blocking** -- Restoration is generic rather than
  per-test. `tests/api/journal.mjs` listens to the page's own traffic -- every row the
  application was served, and every observation it committed or corrected -- and puts
  those back through the API afterwards, checking its own work. 43 bespoke `finally`
  blocks would have been 43 chances to miss one. It is **passive** (`page.on`, not
  `page.route`) because the prefetching checks count requests and assert their order, and
  an interception layer over the page query changes the thing they are about.
- [x] **A3 · behavioural · non-blocking** -- `breakThumbnails` becomes a real row whose
  extraction failed wherever one row is enough -- the corpus has fifteen -- and a seeded
  row where the state does not exist in the corpus at all (`queued`, `permanent`) or where
  a whole page of them is needed. Seeding is the sanctioned pattern: a test may create
  rows and must remove them. Rewriting the endpoint's own answer with `page.route` was
  considered and rejected for the page-wide cases: it is a fake in the one place this
  issue exists to remove one.
- [x] **A4 · destructive · non-blocking** -- The one check that confirms a deletion
  destroys observations **it seeded**. The journal refuses any other delete: nothing can
  un-delete a row, so a test reaching that route without having said `allowDeletes` fails
  naming the ids rather than quietly eating a corpus somebody else's checks read.
- [x] **A5 · architectural · non-blocking** -- `tests/requirements.js` becomes Playwright
  tests rather than staying a bespoke runner in `tests.html`. Its `reset()` called
  `MarpData.reload()`, which has no equivalent against a server; a fresh page load per
  check is the only reliable reset, and Playwright already gives each test one. It also
  reports each check by name, which `contract.spec.mjs` was straining to do by scraping
  `li.fail`. `tests.html` and `contract.spec.mjs` go with the fixture they installed.
- [x] **A6 · environment · non-blocking** -- The static file server (`tools/serve.mjs`)
  and the `desktop`/`phone` Playwright projects go too. They served the application with
  no `/api` behind it, which was only ever usable with the fixture in front of it; without
  one they serve an application that cannot load. `MARP_API_BASE` stops being an opt-in
  and becomes required, with a refusal that names the command supplying it.

No blocking assumption was open. Each of the six is a choice between workable options,
made and written down here rather than asked, per the brief.

## Decisions

- **2026-09-12** -- #132's decision that the fixture stays is reversed, which is what this
  issue is. Speed is not worth a tier that cannot see the defect, and "it can break a
  commit on purpose" is answered by `page.route()`, which exercises the client's real
  error path rather than a simulation of it.
- **2026-09-13** -- The API project runs one worker, and now that every browser check is
  in it that is no longer conditional. There is one testing database and two tests that
  each isolate "the species with exactly one observation" isolate the same observation.
- **2026-09-13** -- `observation_reviews` growing across a run is not damage. It is the
  decision log and it keeps its rows by design; `observation_review_current` is the
  projection, and that is what the journal restores and what a digest before and after a
  run compares.
