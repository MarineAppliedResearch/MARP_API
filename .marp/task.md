---
task: MarineAppliedResearch/MARP_API#104
repos: [MARP_API]
status: design
needs: []
---

## Goal

Make the ML Dashboard show MARP's own data. Today every figure on all eight screens comes
out of a seeded random generator in `mockups/api.js` — the file has twelve references to
`/api/v2/...` routes and all twelve are doc comments, with no `fetch()` anywhere. The API
those comments name now answers, so this replaces the generator with real requests and
leaves the screens reading from the same one place they already read from.

## What the investigation found

Written down because it changes the size of the job, and three of the four findings make it
smaller.

- **The whole public surface maps to routes that exist.** `window.MarpApi` has ten
  functions and every one has a route behind it: `listWorkers`, `listJobs`, `getJob`,
  `submitJob`, `cancelJob`, `renameWorker`, `listModels`, `listDatasets`, `listProjects`,
  `listUsers`.
- **Authentication is solved, and not by us.** `marp-mosaic-review` is served from this same
  origin by this same API and uses a seven-day session **cookie**:
  `credentials: 'same-origin'`, with `/api/v2/auth/me` answering 401 when there is no
  session. `middleware/resolve-principal.middleware.js` populates `req.principal` from the
  Passport session before it looks for a bearer token, and the cookie is `httpOnly` /
  `sameSite: 'lax'`. Nothing is stored by the client and no scheme is invented.
- **`DESIGN.md` item 16 is mostly already dealt with.** It warned that three shapes here
  were not the shapes of the tables they come from. The datasets fixture already carries
  `location`, `num_samples`, `num_classes`, `source` and `notes` — the real columns — and
  models are already generated as `parent_model_id` chains rather than a `versions` array.
  So this is far closer to a rename than to a mapping.
- **The charts are the exception, and they are fabricated in `mock.js`, not in the data
  layer.** `mock.js` says so itself: *"The Dashboard chart uses a deterministic moving
  fixture during design review."* Those are gaps 18 to 22 and no API produces them.

## Requirements

- **R1** — one transport, and only it knows `fetch`, a URL, a header and an HTTP status.
  Everything else in the dashboard asks it for JSON, the way `src/api/transport.js` is the
  only such place in the mosaic reviewer.
- **R2** — the ten functions on `window.MarpApi` fetch from MARP, keeping their current
  call signatures and answer shapes, so no screen has to change to get real data.
- **R3** — the session cookie carries the request and nothing is stored client-side.
- **R4** — a signed-out visitor is told to sign in rather than shown an empty dashboard,
  and a 403 names the permission it was about.
- **R5** — the loading, empty and error states built in #128 still work against a real API,
  including the retry.
- **R6** — a fault switch survives. `?mock=slow` and `?mock=fail:jobs` are how the states in
  R5 are demonstrated and tested, and a real API cannot be asked to fail on demand.
- **R7** — the checks that encode the fixture are rewritten rather than deleted, and what
  they can no longer assert is said out loud.
- **R8** — a region with no API behind it does not draw an invented number.

## Open assumptions

- [ ] **A1 · product/UI · blocking** — **what do the charts do?** The pool-utilization,
  inference-throughput, registry-trend, dataset-build and history graphs are gaps 18 to 22:
  no sampled series exists anywhere in MARP. In a design mockup a moving fixture is honest,
  because the whole page is a mockup. In a live dashboard it is a picture of data that does
  not exist, drawn next to real numbers and indistinguishable from them.

  My answer, unless you say otherwise: **draw the frame, the axes and a "not recorded yet"
  state, and keep the fixture only behind `?mock=`.** The doctrine here is emphatic that a
  thing which narrates a result without asserting it can lie, and a convincing fake chart
  beside a true table is the clearest case of that. The cost is five emptier-looking panels
  until somebody serves the series.
- [ ] **A2 · architectural · non-blocking** — the transport is a **copy** of the mosaic
  reviewer's reasoning, not a shared module. The two apps are built differently — the
  mosaic app is ESM under `src/`, this one is a plain browser script that reads `window` as
  it loads — and `frontend/shared/` currently holds assets and vendor code, not application
  modules. Sharing is a bigger change than this task, and a wrong one to make while only
  two apps exist.
- [ ] **A3 · behavioural · non-blocking** — `?mock=` keeps working and gains `?mock=all`,
  which serves the whole generated corpus as it does today. That keeps the design review
  reproducible and keeps `mock-shots.mjs` able to take screenshots without a database.
- [ ] **A4 · scope · blocking** — `data-layer-check.mjs` asserts things only a fixture can
  guarantee: 143 workers exactly, byte-identical answers on two loads, every job state
  present, a batch with mixed outcomes on the first page. **None of those can hold against a
  live database.** The check is rewritten to assert the *contract* — shapes, paging, that
  `total` exceeds the page, that failures surface — and the fixture assertions move behind
  `?mock=all`, where they still mean something. Deleting it instead would quietly drop the
  only thing testing the layer.
- [ ] **A5 · product/UI · non-blocking** — the Datasets screen's build progress, worker and
  ETA, and the Inference screen's output options, have no API either (gaps 13, 14, 19).
  Same treatment as A1: drawn as not-recorded rather than invented.
- [ ] **A6 · environment · non-blocking** — the dashboard is reached at
  `/apps/marp-ml-dashboard/mockups/<screen>.html`, which still says `mockups`. Renaming the
  directory is a bigger change than this task and would break every recorded link; it is
  worth doing and worth doing separately.

## Decisions

- **2026-10-15** — under **#104, *Design the MARP Machine Learning Dashboard***, like the
  three passes before it. No new issue.
- **2026-10-15** — branched from `develop` after #260 merged, so the routes this calls are
  on the base.

## Plan

After the gate, since A1 and A4 change what is built.

1. `mockups/transport.js` — one `request()`, the error taxonomy, the fault switch.
2. The ten functions, one at a time, each verified against the real route before the next.
3. The signed-out and forbidden states.
4. Whatever A1 settles for the chart regions.
5. Rewrite `data-layer-check.mjs` per A4; keep `api-contract-check.mjs`, which still holds.
6. `DESIGN.md`: the gap list stops saying the screens draw fabricated data, because they
   will not.

## Acceptance criteria

- With a session, every screen draws MARP's own rows, and the numbers match what the same
  query returns over `curl`.
- Signed out, the dashboard says so instead of showing an empty table.
- No screen shows a number that nothing in MARP recorded.
- `?mock=all` still produces the design corpus, so the screenshots and the review are
  reproducible.
- The dashboard's checks pass, and `data-layer-check.mjs` still tests something.

## Test plan

G3, after implementation. The tier that can see this is the browser against a real API, which
is what `screens-check.mjs` already is — it drives a real page. The fixture-only assertions
move behind `?mock=all`; the live assertions get their own pass against a seeded database.
