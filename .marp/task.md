---
task: MarineAppliedResearch/MARP_API#79
repos: [MARP_API]
status: implementing
needs: []
---

# Resumability: the question survives a reload

## Goal

A reviewer can close the tab and come back to the work they were doing, without
reassembling ten filters from memory — and can send somebody else exactly what they are
looking at.

## What is already true

Read from the code and from #68, not assumed:

- **Nothing persists.** `grep -rn "localStorage\|sessionStorage\|location.search"
  frontend/apps/marp-mosaic-review/src/` returns nothing. Mode, filters, sort, page, marks
  and outcomes are all fields on the in-memory `state` object in `src/store.js`.
- **#68 already ruled out session restoration.** Resumability there comes from durable
  observation-level decisions: the commit writes them, the default status filter excludes
  completed work, and re-running the query returns what is left. It says explicitly that
  the exact page, the scroll position and an open video need *not* be restored.
- **#68 accepts losing uncommitted marks.** "If the application closes before a page is
  committed, undecided items from that page may appear again. This is acceptable."
- **The filter state is already serialisable.** After #77 every dimension is declared in
  `model/dimensions.js` with a `kind`, and a value is an array, a `{from,to}`, or null.
  Nothing in `state.filters` is a function, a Map or a DOM reference.
- **`state.railCollapsed` is derived from a media query**, not a preference, so it is not
  part of this.
- **Two status dimensions are mode-scoped.** `reviewStatus` and `trainingDisposition` both
  live in `state.filters`, and `queryFilters` drops whichever the mode does not own.

## Requirements

Numbered so tests can name them.

- **R1** — The mode, the filters, the sort and the page live in the URL, and a reload asks
  the same question.
- **R2** — Nothing transient survives: marks, outcomes, pinned pages and committed-page
  counts all start clean. #68 says losing them is acceptable, and pretending otherwise
  would show a reviewer decisions the record does not have.
- **R3** — Restoring must never produce a state the rail could not have produced. A stored
  value naming a dimension that no longer exists, or a value outside a dimension's bounds,
  is discarded rather than applied.
- **R4** — Opening the application with a bare address behaves exactly as it does today.
- **R5** — A reviewer can get back to the default question in one gesture, without clearing
  ten filters by hand.
- **R6** — The address is a link. Sending it to somebody else puts them on the same
  question, in the same mode, on the same page.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-06: **the URL, and only the URL.**
      No local storage. The address is the whole of the persistence, which makes a filter
      shareable and the back button meaningful, and means there is exactly one place the
      question can live rather than two that can disagree.

- [x] **A2 · product/UI · blocking** — answered 2026-09-06: **yes, restore the page**, and
      keep it in the URL along with everything else. Once the address carries the question,
      carrying the page too costs nothing and makes a link land where the sender was.

- [x] **A3 · behavioural · blocking** — answered 2026-09-06: **do what #68 said.** Marks
      are not persisted. Undecided items from an uncommitted page may appear again, and
      that is accepted.

- [x] **A4 · destructive operations · blocking** — answered 2026-09-06: **Delete Mode
      resumes like any other mode**, and a link into it is fine. The reasoning is that
      deletion is already permanent: something deleted stays deleted, so returning to a
      Delete Mode address cannot re-destroy anything or show a decision that has not
      already happened. No special guard.

- [x] **A5 · security/permissions · non-blocking** — answered 2026-09-06: a restored filter
      naming something the viewer cannot see simply returns nothing for it. The filter is
      applied as written; the rows do not come back. No error, no special case. Nothing to
      build now — there is no user in the fixture — recorded so phase 8 does not meet it as
      a surprise.

- [x] **A6 · architectural · non-blocking** — decided rather than asked: persistence is a
      client concern and does not touch `src/data.js`. The seam where the API arrives stays
      exactly as it is.

## Decisions

- **2026-09-06** — Fixture-backed. Nothing here needs the API.
- **2026-09-06** — This is not session restoration. #68 settled that resumability comes
  from durable decisions; this task only makes *re-running the same query* something a
  person can do without rebuilding it from memory.
- **2026-09-06** — The URL is the single source of the question. There is no second store,
  deliberately: two places that can disagree about where the reviewer was is a bug waiting
  to be written.
- **2026-09-06** — Deletion being permanent is what makes resuming Delete Mode safe. That
  is the load-bearing half of A4, and it is why no guard is needed.

## Plan

A1-A6 answered. The steps:

1. `src/model/query-url.js`, pure — read and write the address from the `DIMENSIONS`
   declaration and the mode's own status dimensions, so adding a dimension is still one
   entry and nothing else. Rejecting an impossible stored state is arithmetic and string
   handling, so it is unit-testable without a browser.
2. `store.js` — read the address at `init()`, write it with `replaceState` whenever the
   question changes, and listen for `popstate` so the back button works.
3. R5's reset gesture, if the existing clear-filters control does not already cover it.
4. Tests: the round trip and every rejection rule in `tests/unit/`; the reload itself in
   the render tier, because reloading is the one thing a unit test cannot do.

## Acceptance criteria

- Set several filters, reload, and the same question is being asked.
- Copy the address into a fresh tab and land on the same page of the same question.
- A stored value that no longer makes sense is dropped, not applied.
- Opening the application on a bare address is unchanged.
- Marks do not come back.

## Test plan

Filled in at G3.

## Status

- **Gate:** G4 — implemented and verified 2026-09-06; awaiting review of the evidence
- **Notes:** see `.marp/verification.md`. Three pre-existing checks were found asserting a data shape #77 retired.
