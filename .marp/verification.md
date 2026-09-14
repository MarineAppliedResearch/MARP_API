# Verification — MARP_API #172: persisted Mosaic decision details

Issue: https://github.com/MarineAppliedResearch/MARP_API/issues/172

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1/R2 | `tests/observation-review-schema.test.js`: optional note columns | database schema | History and current projection each carry a nullable PostgreSQL `text` note while the structured reason remains its existing bounded field. |
| R2/R8 | `tests/observation-review-current.test.js`: projection equals newest rebuild definition | database integration | A note appended to review history survives the canonical last-write-wins derivation and reaches the current projection without mutating older history. |
| R1/R3/R8/R10 | `tests/mosaic-commit.test.js`: notes on all four decisions | HTTP plus database | Reviewed, flagged, promoted, and excluded commits write notes; exception reasons remain separate; scientific and training writes use their own purpose. |
| R3 | `tests/mosaic-commit.test.js`: note normalization and refusal | HTTP plus database | Whitespace is trimmed, blank becomes null, non-text is refused, and 1,001 Unicode code points are refused while emoji are counted as one code point each. |
| R3/Delete regression | `tests/mosaic-commit.test.js`: delete note refusal | HTTP plus database | Delete Mode gains no decision-detail behavior and does not accept or persist notes. |
| R3/R9/R10 | `tests/mosaic-query.test.js`: exact row shape and projected details | HTTP plus database | Page rows return `review_note` and `training_note` independently with their matching decision and reason fields. |
| R3/R6/R7 | `frontend/apps/marp-mosaic-review/tests/unit/api-requests.test.mjs`: note serialization | unit | Both accepted and exception marks serialize a note in the existing marks array used by either commit control. |
| R1/R5 | `frontend/apps/marp-mosaic-review/tests/unit/model.test.mjs`: reason/note independence | unit | Changing a structured exception reason preserves its free-text note, and new marks initialize note explicitly. |
| R4/R5/R6/R7/R9/R10/R11 | `frontend/apps/marp-mosaic-review/tests/api/decision-details.spec.mjs`: four decision cases | real-API browser | Each badge opens details; exception choices and positive note-only panels differ correctly; typing stages the tile; both commit controls save; the note indicator and full editor value survive reload; textarea property assignment renders note text inertly. |
| R4/R6/R7 | Existing `frontend/apps/marp-mosaic-review/tests/api/decision-state.spec.mjs` | real-API browser | Adding badge detail targets does not change tile mark/take-back gestures, pending borders, committed borders, or selective commit behavior at desktop and phone sizes. |
| R3/R9/R11 | `frontend/apps/marp-mosaic-review/tests/unit/row-shape.test.mjs` | source contract | Generated OpenAPI and generated fixture both carry the two note fields, and the client reads no fixture-only detail field. |
| R13 | `frontend/apps/marp-mosaic-review/tests/e2e/render.spec.mjs`: mobile details viewport | browser rendering | A keyboard-sized visual viewport keeps the focused note editor inside the visible panel, the panel remains touch-scrollable, and the mosaic permits overscroll chaining needed for pull-to-refresh. |
| R14 | `tests/mosaic-query.test.js`: projected reviewer initials | HTTP plus database | An `observations:read` caller receives initials derived from each current author's existing username for both purposes, null for undecided rows, and no username field. |
| R14 | `frontend/apps/marp-mosaic-review/tests/e2e/render.spec.mjs`: decision attribution | browser rendering | Reviewed, flagged, promoted, and excluded primary badges plus borrowed tags render their purpose-specific author initials in the same circular treatment; seeded current exceptions do not lose attribution by also appearing in the mark map, and pending decisions remain unattributed until committed. |
| R15 | `frontend/apps/marp-mosaic-review/tests/e2e/render.spec.mjs`: translucent image overlays | browser rendering | Decision badges, borrowed tags, chips, and the species caption use translucent backgrounds while their foreground text remains present; Delete Mode keeps its established badge surface. |
| R16 | `frontend/apps/marp-mosaic-review/tests/e2e/render.spec.mjs`: confidence chip | browser rendering | Numeric confidence renders as a rounded, zero-padded percentage in the lower-right image area without overlapping the species caption; null confidence renders no chip. |

## Requirements with no test

None.

## Edge cases

- A note containing only whitespace becomes null at the API boundary.
- A 1,001-character note made from astral Unicode characters is refused by code-point
  count rather than being miscounted as 2,002 UTF-16 units.
- A reason change on an already committed flag/exclusion becomes eligible for `Commit
  Marked`; this is the original disappearing-reason defect.
- Editing an already committed reviewed/promoted badge creates an explicit accepted mark
  only after input changes, so opening and closing details does not reauthor the decision.
- A page sweep carries a staged accepted or exception note while retaining its established
  treatment of every other row.
- A refused commit leaves the mark and its details in client state; the existing conflict
  and failure behavior remains observable in the focused Mosaic application group.
- Scientific and training notes on one observation use separate projection columns.
- Delete Mode neither exposes the details editor nor accepts a note sent directly.
- The panel is constrained to the available field width so the note editor remains usable
  at the existing phone viewport.
- A phone keyboard can reduce and offset the visual viewport after focus; the panel follows
  both changes without being rebuilt on every subsequent character.
- The mosaic's phone-only overscroll rule allows a top-edge drag to reach the browser while
  the details panel contains its own scrolling.

## Regression coverage

- The original bug changed `marks[id].reason` without adding the id to `touched`, so
  `Commit Marked` omitted it and reload restored the old reason. The store and real-API
  browser cases require a reason edit to become pending, commit, and rehydrate.
- Reviewed and promoted badges previously lacked `data-badge`, and the picker rejected
  accepted decisions. The four browser cases require every decision badge to open.
- The client previously had no free-text decision field. Exact row-shape, wire-shape,
  schema, projection, and reload assertions prevent any layer from silently dropping it.
- Issue #167 established pending versus recorded border weights. Its real-API browser file
  is rerun because staging positive details now creates an accepted mark and uses that same
  visual state.

## Commands, in order

Run from the isolated issue workspace after this plan is approved:

1. Run `npm run docs:api:build` and `npm --prefix frontend/apps/marp-mosaic-review run fixture`.
   - Regenerates the OpenAPI document and fixture from their changed sources before any
     contract or browser check reads them.
2. `npm run test:mosaic`
   - Runs the repository's focused Mosaic group, including schema, current-projection,
     commit-contract, query-hydration, and generated-contract checks against the disposable
     testing database.
3. `npm run test:app:mosaic-review:unit`
   - Runs the Mosaic client syntax check and unit tests, including mark staging, request
   serialization, exact row shape, and safe client field usage.
4. From `frontend/apps/marp-mosaic-review`, run `npx playwright test tests/e2e/render.spec.mjs --project=desktop --project=phone --grep "mobile details viewport|decision author initials|translucent image overlays|confidence chip"`.
   - Exercises the phone layout with a reduced visual viewport and checks the focused note
     editor, panel scrolling, and phone overscroll policy.
5. `npm run test:app:mosaic-review:api -- decision-details.spec.mjs decision-state.spec.mjs`
   - Uses the repository's private real-API runner and disposable copied corpus, starts its
     own dynamically assigned server, runs the new four-state persistence cases plus the
     #167 gesture/border regression at desktop and phone sizes, then stops that server.
6. Re-run both generators and require an empty generated-artifact diff.
7. Run `git diff --check`, then run `marp spec check` and `marp harness check` through the
   umbrella harness.

No command adopts or stops the populated review server the human is currently using.

## Known gaps

- The API browser test edits one isolated corpus row at a time and restores its current
  decision, reason, and note through the API. The append-only history correctly retains
  the test decisions; the runner uses only its disposable copied corpus.
- The 1,000-character client clamp is covered by the browser path and the authoritative
  over-limit refusal by the HTTP/database tier. The plan does not add screenshot comparison;
  visibility, panel bounds, values, and interactive selectors provide stable assertions.
- Species correction still saves immediately under its existing workflow. This issue does
  not change or re-test the correction transaction beyond the focused Mosaic regressions.
- No whole repository suite or narrated walkthrough is planned. The targeted Mosaic groups
  cover the changed backend and application surfaces; the end-of-phase suite remains the
  human's call.

## Manual steps

After automated evidence passes, start this issue workspace at the address reported by
`marp agent list`. In Scientific and Training modes, open one badge of each decision type,
type a note, close the panel, and confirm the pending border and compact note dot are clear
without obscuring the thumbnail. Commit and reload; the saved note should reappear in the
panel. This is visual review, not automated evidence.

---

## Results

Approved by the human after manual testing on 2026-09-13.

- Generators: `npm run docs:api:build` produced 127 paths and the fixture generator
  produced 3,000 observations (2,892 ready, 71 queued, 37 failed). A second run left both
  generated files byte-for-byte stable (`OpenApiStable : True`, `FixtureStable : True`).
- Backend: with `DB_NAME=marp_test`, `npm run test:mosaic` passed 7 suites and 248 tests in
  9.2 seconds. The first run accidentally used the checkout's default database and failed
  repeatedly with `column "note" of relation "observation_reviews" does not exist`; it
  was discarded and rerun against the disposable testing database. The next run exposed
  one expected-key ordering error and then a corpus-guard failure caused by rows left by
  the interrupted run. After correcting the expectation and confirming the focused file
  cleaned up, the named group passed cleanly.
- Review schema: after CI exposed that the schema helper omitted
  `character_maximum_length`, the focused file passed 34 tests and `npm run test:review`
  passed 3 suites and 49 tests. Both duplicate CI API jobs had failed with `Expected: 64`
  and `Received: undefined`; adding the missing information-schema selection corrected the
  assertion without changing the schema.
- Client unit: `npm run test:app:mosaic-review:unit` passed syntax checking for 57 files
  and all 308 unit tests. Its first sandboxed invocation reported `57 files will not
  parse.` because Node child processes were refused without stderr; the same command with
  subprocess permission passed, proving this was the runner environment rather than a
  parse failure.
- Browser rendering: the focused direct Playwright command passed 7 applicable tests with
  1 intentional desktop skip for the phone-only viewport case. Earlier runs revealed and
  corrected three false assertions (modern computed-color syntax, browser overflow
  propagation, and a fixture snapshot with no flagged rows) plus one real defect: state
  redraws replaced the focused note editor. `renderPicker` now preserves that active DOM
  node, and the phone scenario passed against the fix.
- Real API: `npm run test:app:mosaic-review:api -- decision-details.spec.mjs
  decision-state.spec.mjs` passed all 12 tests in 15.1 seconds against the disposable
  testing database. The first exception runs timed out because the test asked for
  `data-reason="undefined"`; correcting the test's reason lookup made both focused
  exception cases pass before the final 12-case run.
- Repository checks: `git diff --check` passed; the checked-in harness reported the spec
  clear to implement and `everything the harness can verify is consistent`. Its first
  sandboxed run could not spawn the hook-gate probes and reported all 23 as `unparseable`;
  the permitted rerun passed every spec-gate and danger-gate assertion.
- Manual: the human reported that the application behavior is working well and approved
  proceeding to pull request and merge.
