# MARP Mosaic Review

An interactive prototype of the MARP Picture Mosaic Reviewer, built against the design
record in [MARP_API#68](https://github.com/MarineAppliedResearch/MARP_API/issues/68).

**This is a prototype, not the finished application.** It runs entirely against a fake
data fixture, has no build step and no dependencies, and exists so the interactions can
be used rather than looked at. It may be rewritten — possibly in a different stack, and
possibly as its own repository — once the design settles.

What it is good for: proving the review workflow actually works, feeling the pace of
scanning and committing pages, and giving the requirements something concrete to be
tested against.

## Running it

It uses ES modules and `fetch`, so it needs to be served rather than opened from disk.
From `frontend/`:

```bash
npm run serve                  # or: python -m http.server 8123 from frontend/
```

- Prototype — <http://localhost:8123/apps/marp-mosaic-review/>
- Requirement checks — <http://localhost:8123/apps/marp-mosaic-review/tests.html>

Opening `index.html` directly will show an explanatory error rather than a blank page.

## What works

Tap a tile to mark it; the meaning follows the active mode. Pick an optional reason;
choosing **Wrong species** reveals the taxonomy chooser. Change a species and watch the
tile update without moving. Switch modes and see the commit change what it does. Page
through, commit pages, and watch committed pages mark themselves in the pager. Collapse
the filter rail and gain a column. Mark or clear a whole page.

Queued thumbnails resolve in place after a moment, without reordering the mosaic.

**Deliberately not implemented:** the video drill-down, real filtering controls, the
data table, live multi-reviewer updates. `openVideo` fires its action and does nothing
else, on purpose.

### The action log

Every gesture fires a **named action**, listed in the *Action log* panel at the bottom
right and logged to the console. These are the seams: each one is a thing that will
later become an API call. Watching the log while clicking is the quickest way to see
the contract the real implementation has to satisfy.

`window.MARP` exposes `{ state, actions }` for poking at from the console.

## Layout

```
index.html              the page
tests.html              contract checks, in the browser

src/model/              the rules. No DOM, no network.
  modes.js                what a mark means, what a commit does per mode
  page.js                 marks, page membership, commit outcomes, paging
  filters.js              the query each mode asks for
src/data.js             the data seam — fixture today, MARP_API later
src/store.js            state and named actions; orchestrates model and data
src/render.js           state in, DOM out; never mutates state

styles/app.css          appearance; palette from shared/assets/css/tokens.css
fixtures/               fabricated observations, and placeholder crops
tools/make-fixture.mjs  regenerates the fixture deterministically
tests/unit/             model unit tests — Node, no browser, no database
tests/requirements.js   contract checks, each naming the requirement it holds us to
```

**`src/model/` touches neither the DOM nor the network.** That is what makes the
rules testable in milliseconds, and it is where most of the defects found so far
actually lived — what a mark means per mode, the inverted commit in Delete Mode,
what a committed page holds afterwards.

**`src/data.js` is the only place that knows where data comes from.** Everything else
goes through `MarpData.query()`, `MarpData.commitPage()`, `MarpData.setSpecies()` and
friends, which already return the shapes the API is expected to return — including the
per-observation `reviewed` / `skipped` results that bulk operations require. Swapping
the fixture for real endpoints should not require touching the UI.

## The fixture

540 fabricated observations carrying the real column names from `observations` and the
tables it joins to. Regenerate with:

```bash
node tools/make-fixture.mjs
```

Deterministic — the same seed produces the same file, so the checks stay stable.

The organism crops in `fixtures/thumbs/` are placeholders sliced from the earlier
concept art. They carry no scientific meaning, and are only varied enough to make
outlier-spotting realistic.

## Tests

This application owns its own suite, so it can be extracted from MARP_API without
untangling anything. From this folder:

```bash
npm install                    # once
npx playwright install chromium # once
npm test                       # both tiers
```

From the repository root, `npm run test:app:mosaic-review` delegates here.

**Unit — the model, in Node.** No browser, no server, no database; ~50 ms.

```bash
npm run test:unit
```

**Render — the DOM, in a real browser.** Playwright, run against desktop and a
phone viewport. This is the tier that catches what the others structurally cannot:
that a badge is actually drawn, that a panel is not positioned off-screen, that the
grid settles instead of re-querying itself, and that no console errors occur during
a full flow. Every one of those was a real defect that the store-level checks passed
straight through.

```bash
npm run test:e2e
npm run test:e2e:headed        # watch it happen
```

**Contract — the workflow, in the browser.** `tests.html` runs a set of behavioural checks, each naming the requirement from #68 it
holds the prototype to — that a tap toggles, that a reason stays optional, that a
scientific commit acts on the *unmarked* tiles while a delete commit acts on the
*marked* ones, that unavailable imagery is skipped without blocking the batch, that
committing does not advance the page, and that saving a correction does not clear the
flag.

They drive the same actions the interface drives, so they test behaviour rather than
markup. They need the server running.

## Known gaps

- No keyboard model yet, though #68 makes keyboard a first-class speed path
- The filter rail is presentational; only the fixed default query is applied
- Marking a tile with unavailable imagery gives no visual feedback
- Nothing is persisted; reloading resets everything
