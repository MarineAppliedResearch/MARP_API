---
task: MarineAppliedResearch/MARP_API#124
repos: [marp-api]
status: design
needs: [jellyfin-dev]
---

# Phase 8 — replace the fixture

Design specification for MARP_API#124, Phase 8 of #68 — **the join**. `src/data.js` stops
being a fixture and becomes `src/api/`, talking to the endpoints Phases 3–7 built.

**G1 only. Nothing is implemented while a `blocking` assumption below is open.** No
`src/api/`, no route change, no test change, no `app.js` edit.

**This branch is stacked.** It is cut from `118-thumbnails`, not from `develop`, because
Phase 8 needs Phase 6 and Phase 6 is in open PR #122, unmerged. Phase 6's own spec has been
renamed to `.marp/task-118-thumbnails.md` and `.marp/verification-118-thumbnails.md` so it
survives on this branch and in that pull request — it is evidence belonging to an open PR —
and so `marp spec check` reads *this* phase's spec rather than the previous one's.

`needs: [jellyfin-dev]` is **contingent on A15**. If the browser tier's seeded database has
to carry real extracted thumbnails, every verification in this phase reads video from the one
development Jellyfin, which does not parallelise. If A15 is answered with synthetic bytes, the
`needs:` line comes out.

## Goal

A reviewer opens the mosaic against the real MARP database and reviews real observations. The
same page, the same gestures, the same badges — but the tiles are the animals in the survey
this API holds, the flags land in `observation_reviews`, a corrected species edits the
observation, and a deletion destroys a row. Nothing on screen is standing in for something
else. When their session expires, when they are not allowed to do something, and when the
network drops, they are told which of the three happened rather than being shown one
indistinguishable failure. And nothing they do waits on a query over 440,000 rows that a page
change has already made pointless.

## The basis, and what each claim rests on

Every factual claim below names the file and line, or the query, it came from. This phase is
entirely a seam between two halves, and an unchecked assertion about either half is how the
seam gets built wrong.

- **The client's own source**, read on this branch: `frontend/apps/marp-mosaic-review/src/`
  and `tests/`. Cited as `src/…` throughout, relative to that app.
- **The endpoint's published contract**, read from `docs/openapi.js` (the schemas), the four
  route files, and `tests/mosaic-query.test.js`'s row-shape tripwire. The contract, not the
  repository internals, is what the client is joining to.
- **The live development database, read only.** Queried 2026-09-10 through Sequelize for row
  counts and column lists. It is the database `marp db status` reports; nothing was written.
- **The middleware**, for how a request comes to be allowed: `resolve-principal`,
  `require-permission`, `require-authenticated-session`, `auth/auth.setup.js`.
- **The unit tier, run as a baseline**: `npm run test:unit` in the app — **216 tests, 0
  failures, 841 ms**, on this branch with nothing changed. *"Nothing above `api/` changes"* is
  only measurable against a before, so the before is recorded here rather than reconstructed
  later.

## What is settled before this phase starts

Given, not decided here.

- **The endpoint's names follow the schema; the fixture's are what change.** #68, *Three
  known incompatibilities*.
- **`species_id` is `species.id`.** The foreign-key naming, not a second key. Confirmed by the
  human 2026-09-10 after an earlier note here read it as a discrepancy. There is nothing to
  reconcile: incompatibility 1 is that **the client sends a name where the endpoint takes the
  key**, and no wider than that.
- **The mosaic row shape is a published contract with an exact-key tripwire.**
  `tests/mosaic-query.test.js:1009-1046` lists the 18 keys. A field is **moved into** that
  list, never admitted by loosening it. This phase adds nothing to the row without saying so.
- **Every route is `/api/v2/…` behind `requirePermission`**, and `requirePermission` reads
  `req.principal` only (`middleware/require-permission.middleware.js:30-40`): 401 with no
  principal, 403 without the key.
- **A session and a bearer token are interchangeable, and the session wins.**
  `middleware/resolve-principal.middleware.js:52-60` populates `req.principal` from the
  Passport session first and only then looks for `Authorization: Bearer`.
- **`app.js` already gates a static app behind a session.** `app.js:494-501`:
  `requirePermissionSession('admin')` on one page, `requireAuthenticatedSession` on
  `/apps/dashboard`, both registered *before* the static mount.
- **The last commit wins.** #68's *Concurrent review* was corrected: nothing is refused for
  being second. `conflicted` exists only for a moved `version`
  (`docs/openapi.js` `MosaicCommitResult.conflicted`).
- **Phase 6's client work is this phase's.** Nothing under `frontend/` reads
  `thumbnail_status`, the thumbnail route, or the retry route yet — deferred to here
  deliberately (#122's *Known gaps*).

## Findings — the seam, field by field

The endpoint is substitutable for the fixture **on the request and response envelope, and not
on the field names inside a row**. #68 records three. There are **seventeen**, and five of the
extra fourteen fail *silently* — the code runs and shows the wrong thing.

### The three that are already recorded

- **F1 — the species filter is a name, and the endpoint takes the key.**
  `src/model/dimensions.js:76-79` declares `key: 'species', field: 'comname'`;
  `src/model/filters.js:26` sets `species: ['Bat Star']`. The endpoint's filter is
  `observations.species_id`, "and only species_id" — because it finds the organism, where
  `comname` finds rows whose label text matches a name that may since have moved
  (`docs/openapi.js:2821`). The fix is the client sending a key.
  **And the default question matches nothing in this database**: read-only query, all 6
  observations are `species_id` 775, `comname` "California sea cucumber". There is no Bat
  Star row among them.

- **F2 — `excludeIds` is a `Set`, and `JSON.stringify` turns it into `{}` in silence.**
  `src/model/filters.js:162-166` — `queryFilters` puts the pinned ids in as a `Set`;
  `src/store.js:359` and `src/store.js:480` hand that object to the seam. The endpoint's field
  is `exclude`, an array of integers (`routes/mosaic.routes.js:112-117`). Nothing fails,
  nothing logs, and committed pages reappear. #68 calls this the one that costs an afternoon.

- **F3 — the status fields are named for a column that no longer exists.**
  `src/model/modes.js:272` declares `column: 'review_status'` and `:283`
  `column: 'training_disposition'`; the row carries `review_decision` and
  `training_decision` (`tests/mosaic-query.test.js:1018,1044`). **And the vocabulary differs
  too, not only the name**: the client's neutral values are the strings `'unreviewed'` and
  `'undecided'` (`src/model/modes.js:273,285`), where the endpoint sends **null** — "the
  absence of a record" (`docs/openapi.js` `MosaicRow.review_decision`). `dimensionState`
  (`src/model/modes.js:293-299`) happens to handle null correctly; the *filter* vocabulary is
  already right, because the endpoint accepts `reviewStatus: ['unreviewed', …]`
  (`docs/openapi.js:2835-2846`). So only the row-side names and the neutral comparison move.

### The fourteen that are not recorded, and should be

- **F4 — the commit request cannot be built from what the client sends.**
  `src/store.js:791` calls `commitPage({ mode, observationIds, marks })`: ids and a `Map`. The
  endpoint requires `observations: [{ observation_id, version }]` with **`version` mandatory
  — "a missing version is a 400, never an implicit overwrite"** (`docs/openapi.js`
  `MosaicCommitRequest`), `marks` as an array of `{ observation_id, reason }`, and an optional
  `withdraw`. The store holds the rows and their versions; it passes neither. See A7.

- **F5 — the commit result is read by the wrong key, and reads as "nothing happened".**
  `src/model/page.js:60-61` — `applyCommit` does `next.set(r.id, r.outcome)`. Every entry in
  `MosaicCommitResult` is keyed `observation_id`. So `r.id` is `undefined`, one map entry is
  written under `undefined`, and **every tile on a committed page shows no outcome at all**.
  No error, no log. The same applies to `skipped` (`src/store.js:838` counts it, so that one
  is only a wrong number).

- **F6 — the "was Bat Star" indicator would report the new name as the old one.**
  `src/store.js:598` and `:627` read `res.observation.comname` as the corrected name. The
  contract says `comname` is **unchanged by a correction, always** — the annotator's frozen
  label — and the current name is `species_comname` (`docs/openapi.js`
  `MosaicCorrectionResult.observation.comname` and `.species_comname`). So `to:` is the *old*
  name, `from` and `to` are equal, and the indicator says the species changed from X to X. The
  tile's own label has the mirror of the same problem: `src/ui/tile.js:117` uses `row.comname`,
  which after a correction shows the old animal for ever. `src/ui/tile.js:94-95` reads
  `row.previous_comname`, which the row does not carry.

- **F7 — the tile's image URL is a fixture path.** `src/ui/tile.js:117`:
  `<img src="./fixtures/thumbs/${row.thumb}">`. The row deliberately carries no `thumb` —
  "the address is derivable from a key this row already carries, so no second field repeats a
  URL 45 times a page" (`docs/openapi.js` `MosaicRow.thumbnail_status`), and the tripwire test
  asserts the absence. The picture is at `GET /api/v2/observations/:observationId/thumbnail`
  (`routes/thumbnail.routes.js:301`).

- **F8 — nothing tells the client who decided anything.** `src/model/modes.js:279,289` declare
  `byColumns: ['reviewed_by','flagged_by']` and `['training_approved_by','excluded_by']`;
  `:353` `decidedBy` reads all four; `src/ui/tile.js:45` draws `row.reviewed_by || 'REVIEWED'`
  and the tile computes `byMe = decidedBy(row) === ME`. **The row carries none of the four**,
  and `ME` is the literal `'I. Travers'` (`src/data.js:13`, `src/ui/dom.js:24`). So the
  "REVIEWED by you" badge, the borrowed tag's tooltip attribution, and `byMe` all silently
  become nothing. `observation_review_current` does hold `reviewer_id` and `decided_at`
  (`migrations/20260909120200-create-observation-review-current.js:209,218`). See A13.

- **F9 — a `queued` thumbnail never resolves.** `src/store.js:513-521`
  `_chaseQueuedThumbnails` calls `MarpData.awaitThumbnail(id)` **once per queued row** and
  `notify()`s **once per resolution**. `awaitThumbnail` (`src/data.js:810`) has no endpoint at
  all — it is the fixture pretending a worker finished. And a page of 45 queued tiles would be
  45 requests and 45 full re-renders, which is precisely the cost the contract check added
  after #118 forbids for the retry path.

- **F10 — the retry endpoint takes a page; the client asks one tile at a time.**
  `src/store.js:725` maps `MarpData.retryThumbnail(r.observation_id)` over the failed rows.
  `POST /api/v2/observations/thumbnails/retry` takes `observationIds` and answers per
  observation, explicitly so that "a page-level retry is one round trip and two paints"
  (`routes/thumbnail.routes.js:232-236`). It also answers **`queued`, never a synchronous
  `ready`** — "only the fixture's shortcut" — where `src/store.js:699` assigns the returned
  status straight onto the row. So a retry leaves the tile at PREPARING and F9 is what has to
  clear it.

- **F11 — `thumbnail_permanent` is read and never set.** `src/data.js:494` short-circuits a
  retry on `current.thumbnail_permanent`; **no fixture row carries the key** (grep: one hit,
  in `data.js` itself). The endpoint returns `permanent: true` per entry
  (`docs/openapi.js` `ThumbnailRetryResult`), and a permanent failure is refused rather than
  re-queued. So *permanent* is a state the client has code for and has never rendered.

- **F12 — two seam methods are synchronous and have no endpoint behind them.**
  `MarpData.optionsFor(key, filters)` (`src/data.js:531`) is called synchronously in a render
  path (`src/ui/menus.js:196`) and `MarpData.reachableUnder(filters)` (`src/data.js:552`)
  synchronously inside two actions (`src/store.js:890,901`). Both scan the whole fixture. There
  is **no endpoint that returns the distinct values of a dimension under a filter set** — the
  full route list carries nothing of the kind. Making them async changes `ui/menus.js` and
  `store.js`, which is above `api/`. See A6.

- **F13 — a committed page cannot be re-read.** `src/store.js:352` calls
  `MarpData.byIds(pinned)` (`src/data.js:577`) so a committed page shows what was submitted
  rather than what the filter now matches — the app's `CLAUDE.md` calls this an invariant, and
  it is why `byIds` exists. **There is no by-ids endpoint**, and `MosaicQueryFilters` has no id
  field. See A5.

- **F14 — the correction picker cannot open.** `src/ui/picker.js:75` calls
  `MarpData.searchSpecies('')` to show six entries before anything is typed.
  `GET /api/v2/species/list/:list/search` **rejects an empty `q` with 400**, deliberately —
  "an empty search returning all 224 entries reads as a working search"
  (`routes/species.routes.js:384-386`) — requires a **list**, and needs `species:read`
  (`:345`), which is a different permission from the mosaic's `observations:read`.

- **F15 — a common name is only unique inside a list.** `db/species-lists.js:1-21`: values
  below 10000 are local codes invented per list and reused, and "the only thing that implies
  which list was in use is the owning session's `type`". `SESSION_TYPE_TO_SPECIES_LIST`
  (`:33-42`) maps eight types; `Other` maps to null. The mosaic row carries `session_type`, so
  a tile can name its own list — but a species *filter* over a mosaic spanning session types
  can offer two different organisms under one label.

- **F16 — three rail dimensions have nothing to draw from.** `date`
  (`src/model/dimensions.js:98-101`) is **rejected** by the endpoint rather than served — "no
  column holds the date an observation was made, and a filter that silently omits is worse
  than no filter", #76 (`docs/openapi.js:2814`) — so using it is a 400, and
  `excludedForNoDate` is always 0. `model` (`:112-115`) already says "NOTHING YET" and the row
  carries no model name, so the endpoint's `model` filter (`ml_model_id`) has no labels.
  `session` (`:69-72`) filters on `session_id`, which the row does not carry, so its option
  list cannot be derived from results.

- **F17 — the test-only affordances have no counterpart, and one of them is load-bearing.**
  `failNextCommit` (`src/data.js:396`), `slowNextCommit` (`:406`), `setScale` (`:419`),
  `withoutLatency` (`:454`), `breakThumbnails` (`:471`), `reload` (`:499`). `withoutLatency`
  **refuses to act when `window` is defined** (`:455`) so that no browser tier can ever get an
  instant backend and pass a no-spinner assertion vacuously. `setScale` and
  `tests/unit/data-scale.test.mjs` are *entirely* about the fixture's simulated depth. The 58
  contract checks in `tests/requirements.js` all begin with `reset()`, which calls
  `MarpData.reload()` (`:32`) and re-asks a throwaway question to empty the page cache. None
  of that is expressible against a real API. See A2.

### What the real database actually holds

Read-only, 2026-09-10, through Sequelize against the database `marp db status` reports:

| | |
| --- | --- |
| `observations` | **6** |
| `keyframes` | **78**, of which **0** carry `confidence` |
| `observation_thumbnails` | **0** |
| `observation_review_current` | **0** |
| distinct species among the 6 | **1** (`species_id` 775, "California sea cucumber") |
| projects / dives / lines / session types | **1 each** — CAMPA2024, "Dive 8", 1000, `Invert` |
| `species` | **854** rows |

So: the default question returns nothing, there is one page, no paging, no prefetch to
exercise, no thumbnail to draw, no existing review to seed a mark from, and nothing to sort by
`keyframe_count` meaningfully. **The browser tier cannot be repointed at this database as it
stands.** `Invert` maps to the `Inverts` species list (`db/species-lists.js:37`), which is the
list a correction picker would search.

## Requirements

- **R1** — `src/api/` is the only file in the application that knows a URL, a header, an HTTP
  status or a JSON body shape. Nothing above it contains one.
- **R2** — `src/api/` presents the same method set the client already calls, so that
  `src/store.js`, `src/ui/` and `src/model/` continue to call the seam and not the network.
- **R3** — a visible page is one call to `POST /api/v2/mosaic/observations/pages` with
  `includeTotal: true`; a prefetch is one call with `includeTotal` absent.
- **R4** — the exclusion set reaches the wire as an array of integers. **A `Set` must be
  impossible to send**: the request builder converts or rejects it, and a named test asserts
  the serialised body rather than the argument.
- **R5** — the species filter is sent as the species key, never as a name.
- **R6** — the row's two status fields are read under the names the row actually carries, and
  a null decision means *unreviewed* / *undecided* rather than an unrecognised value.
- **R7** — a commit sends the `version` the reviewer saw, per observation. A commit request
  with a missing version is not constructible.
- **R8** — commit outcomes are matched by `observation_id`, never by position, and a committed
  page shows an outcome on every tile the commit acted on.
- **R9** — a `conflicted` outcome is shown to the reviewer as its own state, and the marks on
  those tiles are kept so the page can be re-committed after a re-read.
- **R10** — a tile's picture is requested from `/api/v2/observations/:observationId/thumbnail`
  with the session's credentials, and a 404 on a row that reported `ready` degrades to the
  no-image state rather than a broken-image glyph.
- **R11** — a page-level retry is **one** request and **two** paints, and it uses the retry
  endpoint's page form.
- **R12** — a retry answers `queued`, and the tile reaches `ready` by whatever A8 settles —
  without one request per tile and without one re-render per tile.
- **R13** — a `permanent` failure renders as permanent: no retry offered, and the reason shown.
- **R14** — a committed page is re-read by id, so returning to it shows what was submitted.
- **R15** — the rail's option lists are the values still reachable under the filters already
  chosen, taken from the server rather than from the rows on screen.
- **R16** — a rail dimension with nothing behind it is not offered at all, rather than offered
  and answering 400 or empty.
- **R17** — the correction picker searches the species list the observation belongs to, sends
  the species key, and shows something sensible before anything is typed without sending an
  empty query.
- **R18** — after a correction the tile shows the species the observation now is, and the
  "was" indicator shows what it was.
- **R19** — the reviewer's identity comes from the server. No hard-coded name remains in the
  application (`src/data.js:13`, `src/ui/dom.js:24`).
- **R20** — **401, 403 and a transport failure are three distinct states on screen.** None of
  them silently discards the reviewer's marks, and none of them is presented as one of the
  others.
- **R21** — a request the reviewer has already superseded is **cancelled**, not merely ignored
  on arrival.
- **R22** — the app is served at `/apps/marp-mosaic-review` and gated in `app.js` before the
  static mount, as A3 settles.
- **R23** — the browser tier runs against a real API and a database built by a **checked-in,
  idempotent seeder**. No row is typed in by hand, and no id from a hand-made database is
  quoted anywhere.
- **R24** — every existing unit and contract check either passes untouched or is listed, with
  the rule that leaked out of the fixture and the tier the replacement test sits at. **The
  list is a deliverable of this phase, not an inconvenience.** Baseline to beat, measured on
  this branch before anything changed: **216 unit tests in 841 ms**, 58 contract checks, ~126
  render tests at two viewports.
- **R25** — nothing this phase adds is admitted to the mosaic row by loosening
  `tests/mosaic-query.test.js`'s exact-key list. A field is moved into it, or it does not go.

## Open assumptions

Listed in the order they block work: A1 and A2 shape everything under them.

- [x] **A1 · architectural · blocking** — **Where does the vocabulary translation live?**
  Option (i) **`src/api/` adapts**: it renames `review_decision` → `review_status`, maps null →
  `'unreviewed'`, rewrites `observation_id` → `id` in commit results, and synthesises a `thumb`
  URL. Nothing above `api/` changes and #68's claim holds literally — but the client keeps a
  private vocabulary that exists nowhere else in MARP, so a person reading `review_status` in
  the client cannot grep for it in the API, and the adapter has to be kept in step with a row
  shape it cannot observe. Option (ii) **the client adopts the schema's vocabulary**: three
  declarations move (`src/model/modes.js:272,283`, `src/model/page.js:60-61`) plus
  `src/ui/tile.js` and the fixture's generator. One vocabulary across the platform, and the
  leaks are then *counted* rather than absorbed — which is what #68 says this phase is for.
  **Recommendation: (ii).** The claim "nothing above `api/` changes" is a *measurement*, and
  an adapter that makes it true by hiding the differences destroys the measurement. Cost of
  (ii): `fixtures/observations.json` is generated (`tools/make-fixture.mjs`) so the rename is a
  generator change plus a regeneration, and the diff is large but mechanical.

- [x] **A2 · architectural · blocking** — **Does `src/data.js` survive, and what backs each
  test tier?** F17 is the problem: the 216 unit tests, the 58 contract checks and
  `data-scale.test.mjs` all depend on a fixture that can be reloaded, slowed, failed, broken
  and scaled ×147 in memory. Option (i) **delete it** — `src/api/` is the seam, and those
  tiers are rewritten against a seeded database, which turns a 60 ms loop into a
  database-dependent one. Option (ii) **both, chosen by a runtime flag** — a flag reachable
  from a browser is how a render test comes to grade a fixture and report it as the API.
  Option (iii) **both, and the fixture is test-only**: `src/api/` is what the app imports;
  `src/data.js` stays as the fixture backing, selected by one small module the app never
  points at the fixture.
  **Recommendation: (iii).** It keeps the working loop at 60 ms, keeps `withoutLatency`'s
  `typeof window` guard meaningful, and keeps the fixture as the thing the *rules* are tested
  against — while the real seam is tested against the real server. The cost is that two
  implementations of one seam can drift; the answer to that is a shared shape check, which
  R24's list makes visible.

- [x] **A3 · security/permissions · blocking** — **How does the app authenticate, and how does
  an `<img>` request authenticate?** Grounded recommendation, not a guess:
  `middleware/resolve-principal.middleware.js:52-60` prefers the Passport session over a
  bearer token, `requirePermission` reads only `req.principal`, and the cookie is `httpOnly`,
  `sameSite: 'lax'`, 7-day rolling (`auth/auth.setup.js:77-85`). So a **same-origin
  `<img src="/api/v2/observations/:id/thumbnail">` carries the session cookie and is
  authorised with no scheme invented** — no signed URL, no token in a query string, no blob
  fetch per tile. `fetch` uses `credentials: 'same-origin'`. **This is the open question in
  #120 and this is the recommended answer to it.**
  What is genuinely undecided: **which gate**. `requireAuthenticatedSession` (as
  `/apps/dashboard` uses, `app.js:499`) admits any logged-in user, whose every request then
  403s — a working page where nothing works. `requirePermissionSession('observations:read')`
  refuses at the door. And the reviewer needs **three** permissions, not one:
  `observations:read` (pages, counts, thumbnails, retry), `observations:write` (commit,
  correct, delete — to be confirmed against `routes/mosaic-commit.routes.js`), and
  `species:read` (the correction picker, `routes/species.routes.js:345`). The thumbnail
  *control* surface needs `admin` (`routes/thumbnail.routes.js:173`) and is presumably not part
  of this app. **Recommendation: gate on `observations:read` and degrade the correction panel
  and the commit buttons when the other two are absent** — but which permission the door
  checks, and whether a read-only reviewer is a supported state, are the human's call.

- [x] **A4 · behavioural · blocking** — **What does a reviewer see for 401, for 403, and for a
  dropped connection?** #68 names this explicitly and the fixture cannot model any of it. The
  three are genuinely different: a 401 means the seven-day cookie lapsed and re-logging in
  fixes it; a 403 means it will never work and retrying is cruel; a 5xx or a dropped socket
  means try again. Marks are deliberately not persisted (the app's `CLAUDE.md`, *The question
  persists; the work in progress does not*), so **a reload after a session expiry loses the
  reviewer's uncommitted page**.
  **Recommendation:** 401 → an interrupting panel that says the session expired and offers
  re-authentication *without* navigating away, so the marks survive; 403 → a permanent
  explanation naming the missing permission, no retry; transport failure → the existing
  failed-commit treatment, which already leaves the marks alone (`src/store.js:789-800`),
  extended to queries. The part to confirm: whether re-authenticating in place is acceptable,
  or whether a redirect to `/` losing the page is preferred for being simpler and more
  obviously correct.

- [x] **A5 · API contract · blocking** — **How is a committed page re-read?** F13: `byIds` has
  no endpoint. Option (i) a new route, `POST /api/v2/mosaic/observations/by-ids`, returning the
  same `MosaicRow` shape **in the order asked for**. Option (ii) add an `observationIds` field
  to `MosaicQueryFilters` and reuse the pages route — one serialiser, but "pages of a question"
  and "these exact rows in this order" are different questions sharing a validator. Option
  (iii) serve a pinned page from the rows already in memory and never re-read — which loses
  the reason `refresh()` re-reads at all: another reviewer's correction, or the reviewer's own
  species change, should be visible on return.
  **Recommendation: (i).** It is a new published contract surface, so it is an *ask-first* item
  under `AGENTS.md`'s permissions — which is why it is here and not in the plan.

- [x] **A6 · API contract · blocking** — **Where do the rail's option lists come from?** F12:
  `optionsFor` and `reachableUnder` scan the whole fixture, synchronously, and no endpoint
  answers "the distinct dives still reachable under these filters". Option (i) a **facets**
  route that answers every set dimension's reachable values for one question in one call —
  preserves the stated property that "offering a dive that returns nothing is worse than not
  offering it", and is one round trip per question. Option (ii) build the lists from
  `/api/v2/projects` and `/api/v2/sessions/project/:projectID`, which #68 notes "can support
  hierarchical selection" — no new endpoint, but the lists stop being narrowed by species,
  confidence or status, so the rail will offer combinations that return nothing, and `session`
  and `model` still have no source. Option (iii) derive from the rows on the current page —
  wrong at any scale, and silently so.
  **Recommendation: (i).** Note the consequence either way: `optionsFor` becomes async, so
  `src/ui/menus.js:196` and `src/store.js:890,901` change. That is a leak, and it gets counted
  under R24 rather than hidden.

- [x] **A7 · API contract · blocking** — **How does the version reach the commit, and what does
  the reviewer see when one has moved?** F4. Option (i) `src/api/` remembers the version it
  served for each observation. **Rejected on reasoning, not preference**: a prefetch or a poll
  would refresh that map to a version the reviewer never saw, which defeats the entire point of
  the check — a stale decision would be applied silently, which is the failure mode the
  mandatory `version` exists to prevent. Option (ii) `store.commitPage` sends the rows it is
  holding, so the version travels with the thing the reviewer looked at; the seam's signature
  changes and `src/store.js:791` changes with it.
  **Recommendation: (ii).** Then: `conflicted` (R9) is a state nothing in the client renders
  today. **Recommendation:** a distinct tile state meaning *the annotation moved under you,
  nothing was written*, the mark kept, and a page-level prompt to re-read. What that looks like
  is a product decision.

- [x] **A8 · behavioural · blocking** — **How does a `queued` thumbnail become `ready` on
  screen?** F9 and F10: the fixture's `awaitThumbnail` has no endpoint, the retry route answers
  `queued` and never `ready`, and extraction runs at 3 concurrent Jellyfin streams (#118's A7),
  so a page of 45 missing pictures takes many seconds to fill. Option (i) **poll for the
  visible page**, one request for all queued ids (A5's by-ids route), on an interval with
  backoff, stopping when the page changes or nothing is queued — one request and one
  `notify()` per round, which is what R12 needs. Option (ii) poll
  `GET /api/v2/observations/thumbnails/status` — cheap, but it reports the extractor's global
  counts, not *these* tiles. Option (iii) server-sent events — no precedent in this API.
  Option (iv) do nothing; the picture appears on the next page visit.
  **Recommendation: (i)**, with the interval and the backoff named in the spec so they are
  testable. The undecided part is what the reviewer should be told while waiting, and whether
  polling should stop after a bounded number of rounds and say "still preparing".

- [x] **A9 · behavioural · blocking** — **Does the seam gain a page-level retry, or does
  `api/` coalesce?** F10. Option (i) add `retryThumbnails(ids)` and change
  `src/store.js:717-741` to call it once — honest, matches the endpoint, and the store already
  has the page in hand. Option (ii) keep `retryThumbnail(id)` and coalesce N calls inside
  `api/` within a microtask — nothing above changes, but a round trip is then hidden behind
  machinery, and the existing contract check only asserts the *render* count, so a regression
  to 45 requests would pass.
  **Recommendation: (i)**, and the contract check gains a request count beside its render
  count.

- [x] **A10 · product/UI + scientific · blocking** — **The species filter: what is its value,
  what is its label, and what is the default question?** Three parts, from F1 and F15.
  (a) The wire value becomes the species key, so the rail must carry `(key, label)` pairs where
  it carries bare values today — `DIMENSION.species.one(v)` renders the value itself
  (`src/model/dimensions.js:78`), so a key would be drawn as "775".
  (b) `['Bat Star']` matches nothing in this database. Candidates: no species filter by default
  — which #68 rejects on its own premise, that a page holds one predicted species; the species
  with the most matching observations under the rest of the default question, taken from A6's
  facets call — no literal, always non-empty, but the opening page then differs between
  databases; or a configured name, which is a literal that goes stale exactly as `'Bat Star'`
  has.
  (c) A comname identifies a species only *within a list*, and a mosaic can span session types,
  so one label can mean two organisms. **Recommendation: (a) pairs; (b) the most numerous
  species from the facets call; (c) qualify a label with its list when the current question
  spans more than one.** (c) especially is a data-meaning question and I should not settle it —
  whether two rows with the same comname from two lists are one thing or two is answerable by
  the person who recorded them.

- [x] **A11 · API contract · blocking** — **How does the correction picker work against a real
  taxonomy?** F14 and F15. `searchSpecies('')` 400s; the route needs a list.
  **Recommendation:** the list comes from the tile's own `session_type` through
  `db/species-lists.js`'s map — which means either a small endpoint exposing that map or a
  second copy of it in the client, and a copy of a mapping that governs scientific meaning is
  the worse of the two; show nothing until two characters are typed, rather than a default six.
  Undecided and material: **may a correction go off the observation's own list?** `Other` maps
  to null (`db/species-lists.js:19-21`), so some observations have no list at all, and the
  contract already contemplates an off-list correction — "after an off-list correction
  `taxserial` and `species_id` name different organisms — deliberately, and auditably"
  (`docs/openapi.js` `MosaicCorrectionResult`). Whether the *picker* should offer that is a
  scientific call.

- [x] **A12 · product/UI · blocking** — **Which name does a tile show?** F6. The row carries
  both the annotator's frozen `comname` and the current `species_comname`.
  **Recommendation:** the tile's primary label is `species_comname` falling back to `comname`;
  the "was" indicator draws `comname` whenever it differs from `species_comname`, which
  replaces the fixture's `previous_comname` and makes the drift visible on **every** row that
  has ever drifted — the contract notes roughly 50,000 production observations already
  disagree with their list. **That is a behaviour change, not a port**: today the indicator
  appears only after a correction made in this session, and this would make it appear on rows
  nobody in this session touched. Which is right is the human's call, and it changes what a
  page looks like.

- [x] **A13 · product/UI + security/permissions · blocking** — **What happens to "by you" and
  "by whom"?** F8. Option (i) accept the loss: the badge reads `REVIEWED`, tooltips lose the
  attribution, `byMe` is always false. Option (ii) the row gains `review_reviewer_id` and
  `training_reviewer_id` — ids, not names — and the client compares them with
  `/api/v2/auth/me`, giving "by you" while exposing nobody's name. Option (iii) the row carries
  names, which #118's A10 argues turns this into something other than an `observations:read`
  route: the permission catalog separates `reports:read` because it exposes who did how much
  work, and the row's freedom from `processor_name` is what keeps the two decisions consistent.
  **Recommendation: (ii)**, and the two keys are **moved into** the row-shape tripwire's list
  (R25), never appended by loosening it. This is a published contract change, so it is
  ask-first and it is here.

- [x] **A14 · product/UI · blocking** — **What happens to the dimensions with nothing behind
  them?**

  **This assumption was written on two wrong facts and is corrected.** It claimed `date`,
  `model` and `session` all have nothing behind them. The human challenged it — *"the api does
  have endpoints for those though?"* — and checking the code says he is right about two of the
  three. Recorded rather than quietly amended, because the wrong version recommended deleting
  two working controls.

  **What is actually true, read from `repository/mosaic.repository.js:417-427`** — the
  complete set of filters the mosaic query accepts is `project`, `dive`, `line`, `sessionType`,
  `session`, `species`, `model`:

  - **`session` is filterable and always was** — `set('session', 'o.session_id', 'int[]')`, and
    the client already declares `field: 'session_id'` (`model/dimensions.js:69`), so it already
    sends the right *kind* of value. All 6 observations carry a `session_id`. It lacks only an
    **option list**, which is exactly what A6's facets route is for. Nothing to withdraw.
  - **`model` is filterable and is now populated** — `set('model', 'o.ml_model_id', 'int[]')`.
    The "no column populated" claim was true when Phase 3 was written and is **stale**: the GPU
    pipeline ran on 2026-09-09 and all 6 observations carry `ml_model_id`. What `model` really
    has is **the same defect as `species`**: the client declares `field: 'model_name'`
    (`model/dimensions.js:112`) and sends a name where the filter takes an `int[]` key. So it
    is A10's problem again, not a dead control.
  - **`date` is the only one with genuinely nothing behind it.** There is no filter for it, and
    there is no column to build one from: `observations` carries `tc`, `etc` and `timelog` as
    `varchar` TimeSpans — a time of day, not a date — plus `createdAt`/`updatedAt`, which are
    when the *row* was written and not when the observation was made. #76 is open for exactly
    this. The client meanwhile declares `key: 'date', field: 'tc'`
    (`model/dimensions.js:98`), i.e. a date filter pointed at a time-of-day string.

  **Recommendation, revised:** withdraw **`date` only**, and say on the rail that it is waiting
  on #76 — it also carries the `excludedForNoDate` reporting that #76 built so a date filter
  could never silently omit rows, and that reporting has nothing to report until the column
  exists. Give `session` its option list from A6's facets. Fix `model` the way A10 fixes
  `species`: send the key, render the label.
  **What is left for the human:** whether withdrawing `date` is acceptable at all, given it is
  a control a reviewer may have been using against the fixture.

- [x] **A15 · environment · blocking** — **What seeds the database the browser tier runs
  against, and does it hold real thumbnails?** The measured state above is 6 observations, one
  species, one project, one dive, 0 thumbnails — so ~126 render tests × 2 viewports and 58
  contract checks have nothing to run against. `AGENTS.md` is unambiguous: *"'Seed it' means
  write a seeder, not type SQL."* The precedent is `scripts/seed-inference-context.js` —
  pinned ids, idempotent, `--apply` before it writes, "only ever pointed at a local disposable
  database" — **which is on the unmerged branch `seed-inference-context` (commit `a2e23ef`) and
  is not on `develop` or on this branch.** So this phase either depends on that merging or
  writes its seeder alongside it.
  Undecided and material: **the corpus's shape and size** (enough for several pages, several
  dives, several species, some already reviewed, some flagged, some without imagery — how
  many?); **whether observations are inserted by the same route the annotation GUI uses**,
  given `observation_id` is assigned by hand as `max+1` and the sequence has drifted (#62);
  and **where the thumbnails come from** — a real extraction, which needs the one development
  Jellyfin and makes this a `needs: [jellyfin-dev]` task, or synthetic JPEGs written into
  `storage/`, which is a fake frame and #118 was explicit about not faking one, though a fake
  *picture* to test an `<img>` tag is not the same thing as a fake frame to judge a crop by.
  **Recommendation:** a seeder producing roughly the fixture's shape at a few hundred rows;
  thumbnails written as synthetic bytes for the tiers that only need an image to exist, with
  the real-extraction path exercised separately against Jellyfin. Leaving it open because the
  size, and the fake-picture question, both change what the tier proves.

- [x] **A16 · performance/concurrency · blocking** — **Is a superseded request cancelled?**
  `src/store.js` already guards correctness with a sequencing token
  (`const token = ++reqSeq; … if (token !== reqSeq) return;`), so a late response cannot land
  on screen. But #99's prefetcher issues adjacent-page requests that a page change invalidates,
  and against a real endpoint each of those is a full pass over the matching set. Option (i)
  every `api/` method takes an `AbortSignal` and `api/` owns one controller per question, so a
  new question aborts the old one's in-flight work. Option (ii) leave the token alone and let
  the server finish work nobody wants.
  **Recommendation: (i).** It is a shape decision on every method in the seam and is painful to
  retrofit, which is why it belongs at G1 rather than being discovered in G2. The cost: an
  aborted `fetch` rejects, so every call site needs an abort to be distinguishable from a
  failure — otherwise a page change would report a transport error to the reviewer, which is
  exactly the confusion A4 exists to remove.

## Decisions

Nothing is decided until the assumptions above are answered. Recorded here so they are not
re-litigated:

- **2026-09-10 · A1-A9, A13-A16** — **Taken as recommended, on the human's direction:**
  *"I want to work on the issue."* Each recommendation and its costs are written out at the
  assumption above; this records that they were accepted rather than individually argued.

  - **A1** — the client adopts the schema's names; no translation adapter. #68's claim that
    nothing above `api/` changes is a *measurement*, and an adapter would make it pass by
    destroying what it measures.
  - **A2** — `src/data.js` survives as a fixture used by tests only, so the 60 ms loop and
    `withoutLatency`'s `typeof window` guard stay meaningful.
  - **A3** — the session cookie authenticates, including an `<img>`. Grounded, not invented:
    `resolve-principal` already prefers the session over a bearer token, and the cookie is
    `httpOnly` / `sameSite: lax`, so a same-origin tile request is authorised with no new
    scheme. This is also #120's browser question answered for this case.
  - **A4** — refused, failed and expired are three distinct states; a 401 re-authenticates in
    place so a reviewer's marks survive it.
  - **A5** — a by-ids route, so a committed page can be re-read. **Adds published API
    surface**, which is normally ask-first; taken under the same direction.
  - **A6** — a facets route for the rail's option lists. The only option that preserves "never
    offer a dive that returns nothing", and it is what gives `session` its list (A14).
  - **A7** — the store sends rows carrying their `version`. An `api/`-side version cache is
    **rejected on reasoning**: a prefetch would substitute a version the reviewer never saw,
    which defeats the whole point of the check.
  - **A8** — a page-level poll turns `queued` into `ready`: one request and one notify per
    round, not one per tile.
  - **A9** — the page retry is a seam method taking ids. Coalescing it into the page fetch
    would hide a round trip the contract tier cannot see.
  - **A13** — the row gains reviewer *ids*, not names, and the client compares them with the
    authenticated principal. Keeps #118's `observations:read` reasoning intact: "by you"
    without exposing anybody's name.
  - **A14** — **withdraw `date` only**, and say on the rail it is waiting on #76. `session` and
    `model` are not withdrawn: both are filterable, and the corrected text above says why.
    There is no column a date filter could read, so this is not a preference.
  - **A15** — a seeder at a few hundred rows for the browser tier. **Depends on
    `scripts/seed-inference-context.js`**, which is not on `develop` yet — it is in PR #123 —
    so either that merges first or this phase writes its own alongside. The database holds six
    observations of one species in one dive, so the tier cannot run against it as it stands.
  - **A16** — `AbortSignal` on every seam method. A shape decision, and painful to retrofit
    once callers exist.

- **2026-09-10 · A12** — **The tile's "was X" indicator keeps today's behaviour: it appears
  only after a correction made in the current session.** Answered by the human, against the
  recommendation. So legacy drift between `comname` and `species_comname` stays invisible,
  and this phase is a port rather than a behaviour change. The tile's primary label is still
  the current species. **Note the reasoning that was offered and not accepted:** the drift
  figure cited (*"roughly 50,000 production observations"*) comes from a migration comment
  measured against production by somebody else — it is **not** verified here, and this
  database holds six observations, so nobody working locally can see the effect either way.
  Do not repeat that number as though this project had measured it.

- **2026-09-10 · A11** — **The correction picker offers the observation's own species list,
  with an explicit action to widen to the full catalogue.** Answered by the human. So an
  off-list correction stays possible — which the contract already contemplates, *"after an
  off-list correction `taxserial` and `species_id` name different organisms — deliberately,
  and auditably"* — but it is a decision the reviewer makes knowingly rather than by
  accident. This also answers the `Other` session type, which maps to no list
  (`db/species-lists.js:19-21`): widening is how those observations get a picker at all.

- **2026-09-10 · A10** — **(a) the rail carries `(key, label)` pairs; (b) the default species
  is the most numerous under the rest of the question, from A6's facets; (c) a label is
  qualified with its list only when the current question spans more than one list.** Answered
  by the human, taking the recommendation on all three parts. (c) keeps the common
  single-list page clean and is explicit exactly when a common name could stand for two
  organisms.

- **2026-09-10** — **`species_id` is `species.id`**, the foreign-key naming and not a second
  key. Answered by the human after an earlier draft of this spec read it as a discrepancy.
  Incompatibility 1 of #68 stands exactly as written and no wider: the client sends a *name*
  where the endpoint takes the key.
- **2026-09-10** — This branch is stacked on `118-thumbnails`, not `develop`, because Phase 8
  needs Phase 6 (#122, open). Given in the task, not decided here.
- **2026-09-10** — Phase 6's spec pair was renamed to `.marp/task-118-thumbnails.md` and
  `.marp/verification-118-thumbnails.md`, following the convention already on `develop`
  (`task-103-…`, `task-105-…`, `task-106-…`), so this phase's spec is the one the gate reads
  and Phase 6's evidence stays with its open pull request.
- **2026-09-09, inherited from #118** — the client's fixture simulates a thumbnail lifecycle
  and fakes `retryFailedThumbnails`; `thumbnail_permanent` is read by no fixture row;
  `keyframes.confidence` is NULL on every real row, so nothing may rank on it. Recorded in
  `.marp/task-118-thumbnails.md`'s *Decisions*.

## Plan

Written for after the gate. Each step is small enough to verify on its own.

1. **The transport core** — one module owning `fetch`, `credentials: 'same-origin'`, the error
   taxonomy A4 settles, and the cancellation shape A16 settles. Nothing else in `api/` handles
   a status code.
2. **The request builders and the row mapper** — the exclusion set as an array (R4), the
   species filter as a key (R5), the row's field names per A1 (R6). A named test asserts the
   *serialised body*, not the argument.
3. **The read path** — pages, counts, and whichever of A5's options answers by-ids. Wire
   `src/store.js`'s three read call sites.
4. **The write path** — review, training, delete, correction. Versions per A7, outcomes keyed
   by `observation_id` (R8), `conflicted` rendered (R9).
5. **Thumbnails** — the URL on the tile (R10), the page-level retry per A9 (R11), the resolve
   path per A8 (R12), `permanent` rendered (R13).
6. **The rail** — option lists per A6, dimensions withdrawn per A14, species per A10.
7. **Identity and the picker** — `/api/v2/auth/me` (R19), the picker per A11.
8. **Mounting and gating** — `app.js`, before the static mount, per A3 (R22).
9. **The seeder** — per A15 (R23), checked in and idempotent, run twice to prove it.
10. **Repoint the browser tier** — a real API, a seeded database, and the leak list (R24).
11. **The leak list** — every test that had to change, the rule that leaked, and the tier its
    replacement sits at. Written up as the phase's headline finding.

## Acceptance criteria

- A reviewer can log in, open `/apps/marp-mosaic-review`, see real observations with real
  pictures, mark, flag with a reason, correct a species, commit, page away, come back, and see
  exactly what they submitted.
- A 401, a 403 and a dropped connection each produce a different thing on screen, and none of
  them loses uncommitted marks.
- `grep` over `src/` outside `src/api/` finds no URL, no HTTP status and no header.
- Every unit and contract check passes, or appears on the leak list with its reason and its
  replacement.
- The browser tier passes against a real API and a database a checked-in seeder built, run
  from scratch twice.
- `tests/mosaic-query.test.js`'s exact-key list is unchanged, or a key was **moved into** it.

## Test plan

Filled in at G3, after the gate, in `.marp/verification.md`. The tiers are fixed by the app's
`CLAUDE.md`: parse and unit after every change; contract and render once, at the end; the
walkthroughs only when asked, and never as the only witness to a behaviour. Two things this
phase must not do: verify a transport behaviour at the unit tier, which cannot see a request;
or verify a rendering at the store tier, which cannot see what was drawn.

## Status

- **Gate:** design
- **Notes:** G1 investigation complete. 17 findings, 16 blocking assumptions, 25 requirements.
  #68 records three incompatibilities; there are **seventeen**, and **five of them fail
  silently** — F2 (the `Set`), F5 (`r.id`, which blanks every outcome on a committed page), F6
  (the "was X" indicator reporting the new name as the old), F8 (attribution quietly becoming
  nothing) and F11 (a state the client renders and no row reaches). Nothing implemented.
