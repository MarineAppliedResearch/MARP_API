# Verification — MarineAppliedResearch/MARP_API#124

Phase 8, replacing the fixture. The plan below is for review **before** it is accepted as this
phase's evidence.

**Say plainly what has already happened.** The suites exist and have run — 44 API suites / 593
tests, client unit 244, contract passing, browser 244 passed / 4 skipped — because G2 ran them
to know the implementation worked. What has *not* happened is anybody agreeing they are the
right tests, or that the gaps below are acceptable. That is what this file is for, and
*"that test does not actually prove the requirement"* is the sentence worth saying now.

`## Results` is empty and stays empty until this plan is approved and run.

#103, #105, #106 and #118 each renamed their verification when the next phase arrived. This
file follows that convention.

## The tiers, and why each requirement sits where it does

Five tiers, and the choice between them is the only decision here that can invalidate the
whole package.

- **wire** — `tests/unit/api-requests.test.mjs`, 21 tests, no DOM and no network. **Every
  assertion goes through `JSON.parse(JSON.stringify(body))`**, and that is the reason the file
  exists rather than pedantry: `deepEqual` on a request object passes for a `Set`, a `Map` and
  a `Date` alike. Three of this phase's seventeen findings are exactly that shape and **none
  of them failed anything** before this tier existed.
- **unit** — `tests/unit/{model,cache,query-url,data-scale,wiring,schedule}.test.mjs`, 244
  tests, ~0.9 s. Rules, vocabulary and the row mapper.
- **contract** — `tests/requirements.js` through `tests.html`. Runs the real store against the
  fixture, which is what keeps it fast and hermetic.
- **render** — Playwright, desktop and phone. **The only tier that can see what was drawn.**
  Two of this phase's defects were invisible to every other tier: a `display: flex` rule
  beating the `hidden` attribute, and a trimmed import throwing on every layout pass.
- **http+db** — Jest against the real development PostgreSQL, for the facets route, the row
  shape and the `app.js` gate.

`npm test`, never `npx jest` — the suite shares one PostgreSQL and `--runInBand` is passed for
that reason.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `wiring`: *no file that draws the rail knows a dimension by name* | unit | Plus a source sweep: `grep -nE "'/api/\|fetch\(\|status === [0-9]{3}" src/` outside `src/api/` returns only comments. |
| R2 | `src/backend.js` writes its method set out rather than proxying | review | A method either backing lacks fails **by name**, not as `undefined is not a function`. |
| R3 | *a visible page asks for the total; a prefetch does not* · *the pages asked for are de-duplicated and ascending* | wire | The visible page and the prefetch are distinguishable on the serialised body. |
| R4 | four tests: *a Set of pinned ids reaches the wire as an array* · *a Set that somehow reached the request is still not sent as one* · *an exclusion set nested in the filters is lifted out* · *nothing pinned sends no exclusion field* | wire | **F2, the expensive one.** `JSON.stringify(new Set([1,2,3]))` is `{}` — the endpoint excluded nothing and the arithmetic on screen stayed plausible throughout. |
| R5 | *the species filter is sent as the key, never as a name* · *a species name is refused rather than quietly matching nothing* · *model and session are keys too* | wire | A name **throws** rather than 400ing, so the failure is at the call site. |
| R6 | `model`: the row helper's `review_decision`/`training_decision` and null-as-neutral | unit | Reconciled once, in `dimensionState`. |
| R7 | *a commit sends the version the reviewer saw, per observation* · *a commit request with a missing version is not constructible* | wire | Not "is rejected" — **not constructible**. The 400 can never be reached. |
| R8 | `model`: `applyCommit` keyed on `observation_id`; contract asserts an outcome for **each** acted row | unit + contract | **F5**: `r.id` was `undefined`, so every tile on a committed page lost its outcome. |
| R9 | contract: the `conflicted` tile state, marks kept | contract | Its own state, not folded into flagged. |
| R10 | render: tiles carry an `<img>` on the thumbnail route, `credentials: 'same-origin'`, `onerror` degrades | render | Only a browser can say the image **decoded**. |
| R11 | *a page retry sends the whole page in one request* | wire + contract | One request, two paints. |
| R12 | contract: retry answers `queued`, never a synthetic `ready`, **with a request count** | contract | #68 warned a render-count-only check would miss a regression to 45 requests. |
| R13 | contract + render: a `permanent` failure offers no retry and shows the reason | contract + render | Rule named as `retryablePage` in `model/modes.js`. |
| R14 | contract: a committed page returns with no request | contract | Served from `state.pinnedRows`. **The one place striking A5 had a consequence** — `cache.use()` empties on any change of question and `pageSize` is part of it. |
| R15, R16 | `tests/mosaic-facets.test.js`, 17 tests, seeding everything it asserts · *the date range is sent, and is not silently dropped* | http+db + wire | Reachable values only; no dimension withdrawn; `date` served as a `tc` range. |
| R17, R18 | render: the picker needs two typed characters; the tile shows the current species | render | **F6**: `comname` never moves on a correction; the current name is `species_comname`. |
| R19 | render + contract: identity from `/api/v2/auth/me`; no name literal remains | render + review | **F8**: four attribution fields the row does not carry. |
| R20 | render: 401, 403 and a transport failure as three panels, none discarding marks | render | A 401 re-authenticates in place. |
| R21 | contract: a superseded request is cancelled | contract | `AbortSignal` on every seam method. |
| R22 | http+db: anonymous GET of the page **and of a source file** both 302 | http+db | Gating the page and leaving the JS readable is the classic half-fix. |
| R23 | — | — | **Unmet. See *Known gaps*.** |
| R24 | this document's *tests that had to change* section | review | The list is the deliverable, not a footnote. |
| R25 | `tests/mosaic-query.test.js`: the exact-key tripwire | http+db | Two reviewer-id keys **moved into** the list, never admitted by loosening it. |

## Requirements with no test

- **R23** — the browser tier against a real API and a seeded database. Deliberate; reasons in
  *Known gaps*. It is the only one.

## The tests that had to change, and the rule that leaked

**This is R24, and it is the point of the phase rather than housekeeping.** In almost every
case the leaked rule was the same: **the tests spelled the fixture's private vocabulary**, so
nothing could tell them the schema disagreed.

- `model.test.mjs` — `review_status`/`training_disposition` → `review_decision`/
  `training_decision` with null as neutral (F3); `commitResult` keyed `id` → `observation_id`
  (F5); `tag.by` → `tag.reviewerId` (F8); date bounds → clocks (A17). **And
  `queryFilters(...).excludeIds.size === 2` → an array plus a serialised-body assertion — that
  test was asserting the defect** (F2).
- `data-scale.test.mjs` — **the reference implementation duplicated the fixture's neutral
  string, so both agreed and both were wrong.** `commitPage({observationIds})` → rows with
  versions (F4); `back.comname` → `species_comname` moved and `comname` frozen (F6).
- `cache.test.mjs`, `query-url.test.mjs` — species names → keys; the comma test moved to
  `project`, since species can no longer hold one.
- `requirements.js` — the renames, plus: **retry-then-`every(status === 'ready')` → `'queued'`
  with a request count added** (F10); **the no-imagery check hunted for an incidentally-queued
  row and returned `'skipped'` when it found none — a skipped check looks green**, so it now
  breaks one deliberately.
- `mosaic-query.test.js` — the tripwire gained two keys **moved in**; *rejects an active date
  filter with 400* → asserts what it serves (A17). That one is a **decision changing**, not a
  leak.
- `render.spec.mjs` — the renames; the picker's two-character minimum; and the retry test that
  asserted the commit was enabled the instant the click returned, which was only true because
  the fixture invented the picture.

**Five tests fixed here that have nothing to do with Phase 8**, and they are the same defect
twice: three read the **whole** `observation_review_current` table and asserted it held two
rows; two counted rows and asserted zero. All five asserted that *the database was otherwise
empty*. They passed for months and failed the moment real review data existed. Scoped to each
test's own seeded observation, and the two `ships empty` tests now read the migration, which is
where the property lives.

## Edge cases

Each traces to a defect or a measurement.

- **A `Set`, a `Map` and a `Date` in a request body** — the three shapes `deepEqual` cannot
  tell from their serialisation.
- **A mark left over from another page**, and a withdrawal for an id not on the page.
- **A species name where a key is required** — refused at the call site, not at the endpoint.
- **A commit with a missing version** — not constructible.
- **`?backing=fixture` in the query string** — the query string *is* the question, so a
  backing parameter made every address non-bare and the app lost its default question. Ten
  tests said 2,755 where 1,083 was expected. Moved to the hash.
- **A fixture extraction faster than a retry round trip** — at 220 ms it beat the 900 ms retry
  and reported `ready`, reintroducing F10's shortcut *intermittently*.

## Regression coverage

- **The five silent findings each have a test proved to fail by reintroducing the defect via
  file copy** — F1, F2, F5, F6, F11. Not believed to cover; demonstrated.
- **`#failure { display: flex }` beat the `hidden` attribute.** `hidden` works through
  `display: none` in the browser's own stylesheet, so an author rule carrying `display` wins —
  leaving a fixed, full-viewport, *invisible* panel swallowing every tile click. Twenty-six
  render tests reported it as tiles being broken.
- **`grid.js` lost the `actions` import** it still needs for `setPageSize`, throwing on every
  layout pass. An import trimmed to what the file *appeared* to use.
- **`createObservation` never advances the `observations` sequence** (#62), so later tests
  collided with a sequence-default insert. The suite helper now assigns `max+1`.

## Known gaps

Written down deliberately. A recorded gap is a decision; an omitted one is a surprise.

- **R23 is unmet.** The browser tier grades the fixture, not a real API with a seeded database.
  It **says so on screen and asserts which backing it graded**, so it cannot pass while
  testing the wrong thing — but two claims that are inherently about a real server are
  unwatched between recordings: that the tiles are the endpoint's own page **in its order**,
  and that a commit lands in `observation_reviews`. A local-only dump (#125) does not close
  this: CI builds an empty database, so a checked-in seeder at a smaller volume is what R23
  actually needs.
- **Both of the visible defects above are now fixed** (`bc1083ea`), and one of them turned
  out to be deeper than a placeholder:
  - **The default no longer carries a species literal.** It was the fixture's Bat Star key,
    which matches nothing real, so the app opened on an empty mosaic reading *"nothing to
    do"*. It narrows nothing now — a bare question returns **1,009 rows over 21 pages**
    against this database, with five species on page one.
  - **The dive label no longer prefixes a value that already carries the word** — it was
    wrong against *both* datasets, `"Dive Dive 12"` real and `"Dive D04"` fixture.
- **A10(b)'s facets-derived default is still not built, and now has a stated reason.** It
  was attempted and reverted. With no literal in the default, *"the reviewer chose to see
  everything"* and *"the reviewer has not chosen yet"* become the same question and write
  the same address — so seeding a species onto a bare address hands back the filter a
  reviewer deliberately cleared. `query-url`'s *clearing every filter comes back narrowing
  nothing* is the test that catches it, and it names this as the thing to revisit first.
  **Building it needs a decision about what a bare address means**, which is a design
  question rather than a line of code.
- **No throughput measurement.** Nothing here is benchmarked, and the corpus is 1,062
  observations rather than 440,000.
- **`npm run docs:build` exits 1** on four pre-existing jsdoc errors in `schedule.js`,
  unchanged by this branch and identical on `develop`.
- **CI runs the fast tiers only.** A green pipeline is not this package.

## Manual steps

1. **Log in as the walkthrough user and open the mosaic** at
   `/apps/marp-mosaic-review/?mode=scientific&reviewStatus=unreviewed,flagged,reviewed`.
   *Expected:* 1,062 observations, 22 pages, real pictures. **Use that URL, not the bare one** —
   the placeholder species filter opens an empty mosaic and reads as a broken app.
2. **Judge the tiles.** No assertion can tell a correctly cropped animal from a correctly
   cropped patch of seabed. **Partly done** — the human reviewed the crops and the
   centre-origin control on 2026-09-09 and accepted them.
3. **Exercise the three failure states** — expire the session, call with a principal lacking
   `observations:write`, and stop the API mid-page. *Expected:* three distinct panels, and
   marks surviving all three. **Not yet done by hand; the render tier covers the drawing but
   not a real expired session.**

## Walkthrough videos

**`verify-real-database`, recorded 2026-09-10, 60.3 s, 10 scenes.** It is on the API and
asserts it. Every spoken number is asserted **exactly**, so a changed corpus fails the run and
writes **no video** rather than narrating a stale figure.

Each scene and its assertion: on the API not the fixture (`backing === 'api'`, no fixture in
the page, `/auth/me` names the principal) · 1,062 across three dives and 15,230 keyframes
(read in two calls, `keyframe_count` summed) · every tile a decoded frame from the thumbnail
route · the dive filter offering exactly the endpoint's three values · Dive 12 narrowing to 410
· five of seven species reachable under that dive · 83 short red gorgonians, ids matching in
order · a page change with `window.__waits === 0` via a MutationObserver, **not** a millisecond
budget · a commit, asserted on `state.outcomes` rather than the badge, because *a badge could
survive an earlier take and an outcome cannot* · read back from the database by reviewer id.

**It is not the only witness to anything** except the two R23 claims above.

---

## Results

Plan approved by the human on 2026-09-10 (*"I think this is a good plan"*) and run against it.
Real output, including what went wrong.

### The automated tiers

**API, `npm test`:**
```
  Test Suites : 44 passed, 0 failed, 44 total
  Tests       : 593 passed, 0 failed, 0 skipped, 593 total
  Duration    : 42.7s

  Result: ALL TESTS PASSED
```

**Client unit and wire tiers, `npm run test:unit`** (lint plus `tests/unit/*.test.mjs`, so the
21 wire tests are inside this figure):
```
ℹ pass 244
ℹ fail 0
ℹ duration_ms 890.6629
```

**Contract and render tiers, `npm run test:e2e`** (desktop and phone):
```
  4 skipped
  244 passed (1.8m)
```
The 4 skips are the pre-existing viewport-conditional cases — phone-only tests in the desktop
project and the reverse.

### Manual step 3 — the three failure states, which the plan recorded as not done

Now done, against the running API. **All three are distinguishable**, which is R20's premise:

```
--- 1. no credential (expect 401) ---
{"error":{"code":"UNAUTHORIZED","message":"Authentication is required.","status":401,
          "requestId":"req_mtvw83qx_mgwi9g3i"}}
[HTTP 401]

--- 2. read-only principal committing (expect 403) ---
{"error":{"code":"FORBIDDEN","message":"The \"observations:write\" permission is required.",
          "status":403,"requestId":"req_mtvw83rg_bmrd7tlk"}}
[HTTP 403]

--- 3. transport failure: a port with nothing on it ---
[HTTP 000] exit=7
```

The third is the one that matters for telling them apart: **no HTTP status at all** — curl
reports `000` and exit 7. A client cannot mistake it for either of the other two, which is
what lets `ui/failure.js` draw three panels rather than one generic error.

The 403 message names the missing permission, so *refused* is distinguishable from *not
signed in* without inspecting anything.

A read-only service client was created for check 2 and **revoked afterwards** (`removed 1
probe client`).

### A failure that was the operator's, not the code's

Recorded so nobody chases it. The first attempt at checks 1 and 2 returned **500
INTERNAL_ERROR** for both. That looked like a real defect in the permission middleware. It was
not:

```
[API Error] {
  code: 'INTERNAL_ERROR',
  status: 500,
  message: `Unexpected token 'L', ..."ation_id":Loading mo"... is not valid JSON`
}
```

`require('./model')` prints `Loading model: …` to **stdout**, and the shell substitution
building the request body captured it — so the body was malformed and the JSON parser answered
before any auth middleware ran. Reading the server log rather than reporting the 500 is what
caught it. Body written to a file instead, and both checks then answered correctly.

### Manual steps 1 and 2

- **Step 1, opening the mosaic:** done by the human, who logged in as the walkthrough user and
  reviewed the app against this corpus.
- **Step 2, judging the tiles:** done on 2026-09-09 for the crops and the centre-origin
  control, and again on 2026-09-10 against the larger corpus. The human's verdict on the
  species labelling was *"so far, this actually looks good"*, after checking whether tiles
  labelled *Fish-eating anemone* were misclassified fish — they are not; that is the common
  name of *Urticina piscivora*.

### Unchanged from the plan

- **R23 is still unmet.** Nothing in this run closes it.
- **`npm run docs:build` still exits 1** on the four pre-existing jsdoc errors in
  `schedule.js`. Identical on `develop`; not touched.
- **`DEFAULT_FILTERS.species` is still a placeholder**, and the bare address still opens on an
  empty mosaic.
- **The dive menu still reads "Dive Dive 12".**

### Corpus this ran against

1,062 observations, 15,230 keyframes, 3 dives, 7 species, 1,056 thumbnails ready — from three
GPU inference runs over real Jellyfin video. Larger than any figure quoted in `.marp/task.md`,
which was written when the database held six observations of one species.
