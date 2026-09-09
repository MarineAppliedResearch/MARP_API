# Verification — MarineAppliedResearch/MARP_API#111

Phase 7: the species correction endpoint, the invalidation it causes, the last-write-wins
unwind of two merged phases, and the permission review. Written from the 18 requirements in
`.marp/task.md` **before anything was run**; the results are appended below verbatim,
including whatever failed on the way.

The three earlier phases' evidence is preserved beside this file as
`.marp/verification-103-review-state-schema.md`, `-105-mosaic-query.md` and
`-106-page-commit.md`. Nothing here renames or replaces them: this file did not exist on
this branch, so there was nothing to rename.

## The baseline this starts from

`npm test` on `abf00b9`, before any change:

```
  Test Suites : 35 passed, 0 failed, 35 total
  Tests       : 348 passed, 0 failed, 0 skipped, 348 total
  Duration    : 24.4s
```

That number matters more than usual this time. **This phase rewrites tests that are already
green**, because the rule they assert was overruled — not because they broke. Every test
that changes is listed under *Tests that change, and why* with which of the two it is, and
the final count has to be reconcilable from that list rather than merely larger.

## The migrations changed shape mid-implementation, and this records that

The plan below was written for **two new migrations superseding the two from #103**, on the
standing rule that an applied migration is never edited. That was reversed during G2, by the
human: *"we don't want extra migrations for no reason."*

So `20260909120500` and `20260909120600` were written, applied, proved in both directions,
and then **folded back into `20260909120100` and `20260909120200` and deleted.** The rule
they were obeying is the right rule when a migration has reached anywhere that matters —
these had not. Both were written the same day, both tables held **zero rows on every
database**, nothing had ever run against production, and the only database that had applied
them was the local disposable one. The cost of editing was a rebuild of a database with no
data in it; the benefit is that the next person reads one honest definition per table
instead of an archaeology of a design that was overruled the same day.

**What that costs in evidence, and how it was paid.** Editing applied files means the
files can no longer be trusted to match what ran, so the check is a rebuild from scratch:

- `marp db destroy` then `marp db up` — baseline plus every migration, from nothing.
- Structural snapshot before and after: columns, constraints, indexes and triggers, each
  hashed, plus row counts and the ledger.
- Then `db:migrate:undo` back past both edited files and `db:migrate` forward again, and a
  third snapshot.

All three snapshots are byte-identical. The evidence is under *Results*.

## The tier that matters, and why almost nothing here is a unit test

Jest against the real development PostgreSQL, through `npm test` — never `npx jest`, because
the suite shares one database and `package.json` passes `--runInBand` for that reason.

Six of this phase's requirements are observable at **no other tier**, and each names a thing
a unit test structurally cannot see:

- **R7/R8/R9/R11 — projection equals derivation.** The derivation is SQL read out of a
  committed migration file and executed. There is no in-process representation of it to
  assert against; a mock would be asserting the mock.
- **R6 — the two `CHECK`s.** A constraint refusing a value is a database event. A repository
  unit test sees a rejected promise and cannot tell a `CHECK` from a typo.
- **R10 — last-write-wins under genuine concurrency.** Two transactions racing is not
  simulable in one process.
- **R17 — the row lock.** Whether `FOR NO KEY UPDATE` is held is invisible above SQL.

The remaining tier is `http+db` through Supertest against the real Express app, and one
`source` assertion about committed file text.

## Seeding, because CI has an empty database

**CI builds `db/baseline/schema.sql` plus the migrations and holds no observations and no
sessions.** Every test here seeds its own project, session, observations, species and
reviewers, and removes exactly them afterwards. A test that borrows an existing row passes
on this machine and fails in CI — that happened on Phase 3, and it is the reason
`tests/observation-review-current.test.js`'s `twoReviewers()` is being fixed as part of R11
rather than left (see *Regression coverage*).

`observation_id` is assigned by hand as `max(observation_id) + 1` (#62), so observations are
inserted with SQL rather than `db.observations.create`.

**Species are seeded, not borrowed.** The correction needs two real `species` rows to move
between, and the 854 on this machine are import data that CI does not have.

## Line endings

Any comparison of file content against a template literal normalises `\r\n` to `\n` first.
**ECMAScript normalises CRLF inside a template literal and `readFileSync` does not**, so such
a test passes on Linux and fails on Windows. It already did, on `develop`, today —
`75dc718`. R11 inherits that normalisation and so does the new "find the current definition"
helper.

## What each test proves

`tests/mosaic-correction.test.js` is new. Other files are named where they differ.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | *answers at /api/v2/mosaic/observations/species and not at the declared path* | http+db | The route is registered by `registerVersionedRoute`, so the V2 prefix was derived rather than hand-mounted — which would have got the URL and silently lost `requirePermission`. The declared `/api/mosaic/...` path is `404`. |
| R2 | *changes species_id and nothing else on the observation* | http+db | Every other column is read before and after and compared byte for byte: `comname`, `taxserial`, `taxReview`, `sizereview`, `tc`, `etc`, `mediaPosition`, `actualPosition`, `frame`. Asserted, not assumed — this is #111's one irreversible rule. |
| R2 | *does not propagate a name to the keyframes* | db | `updateObservation` rewrites every keyframe's `comname` when the submitted one differs (`observation.repository.js:690-712`). The correction must not go through it. Keyframe `comname` is unchanged after a correction. |
| R3 | *refuses a stale version and writes nothing at all* | http+db | The refusal is `{ok: false, error: 'conflicted'}`, and **three** things are then checked: `species_id` unmoved, no `observation_reviews` row, no projection row removed. A refusal that half-applied would still pass a status-only assertion. |
| R3 | *refuses a request carrying no version* | http | An absent version is `400`, matching Phase 5's rule. Required, never optional: a correction destroys other people's decisions, and doing that from a stale view destroys approvals of a classification the corrector never saw. |
| R4 | *writes nothing when the correction names the species already recorded* | http+db | No log row, no projection change, and the version does not move. |
| R5 | *appends exactly one log row, and what it records* | db | One row: `purpose = 'scientific'`, `decision = 'corrected'`, `reviewer_id` the caller, `observation_version` the version it applied to, `previous_species_id` and `corrected_species_id` both set, `reason` null, `representative_keyframe_id` null, and the keyframe fingerprint computed server-side. |
| R5 | *records a null previous_species_id when the observation had no species* | db | About 4% of production rows have no `species_id`; "the species before the correction" is legitimately absent. The column is nullable and the correction still records. |
| R6 | `tests/observation-review-schema.test.js` *admits a corrected scientific decision* | db | The rebuilt vocabulary `CHECK` accepts `scientific` × `corrected` and still refuses everything outside the enumerated set. |
| R6 | `tests/observation-review-schema.test.js` *ties corrected_species_id to the corrected decision, both ways* | db | A `corrected` row without `corrected_species_id` is refused, **and** a `reviewed` row carrying one is refused. Both directions, because a one-way check lets an ordinary decision pretend to be a correction. |
| R7 | `tests/observation-review-current.test.js` *the definition of "current" exists once* | source | Exactly one migration carries a `-- rebuild:` block that is current, the test **finds** it rather than hard-coding a path, and the block in the file is the one the module exports and runs. |
| R7 | `tests/observation-review-schema.test.js` *the projection's column list* | db | `first_decided_at` is gone. Its purpose evaporated with first-wins, it was `NOT NULL`, and keeping it would force every writer to invent a value. |
| R8 | *a corrected observation is unreviewed for both purposes* | http+db | A `corrected` row never projects. The projection's `CHECK` does not name the value, so the rebuild would fail loudly rather than quietly if the derivation stopped excluding it — which is the point of D1. |
| R9 | *a correction clears another reviewer's approval, for both purposes* | http+db | **The decisive test for A5.** Alice reviews (scientific) and Bob promotes (training); Carol corrects; both projection rows are gone, regardless of `reviewer_id`, and **both log rows survive**. Retaining the audit history is half the requirement and is asserted separately from the removal. |
| R9, R17 | *invalidates in the same transaction as the write* | db | After a refused correction nothing is invalidated; after an accepted one everything is. The log row, the `species_id` update and the projection removal are one unit. |
| R10 | `tests/mosaic-commit.test.js` *gives the record to the second reviewer, and keeps the first in the log* | http+db | Last write wins. The second reviewer is **not** refused, the projection carries their decision, and the first reviewer's decision is still in the log. This is the inverse of what the same test asserted before. |
| R10 | `tests/mosaic-commit.test.js` *lets a reviewer revise their own decision* | http+db | Two log rows, one projection row. What survives from the deleted `first_decided_at` case. |
| R10 | `tests/mosaic-commit.test.js` *lets two reviewers hold the two purposes independently* | http+db | Unchanged. Purpose independence is unaffected by last-wins. |
| R10 | `tests/mosaic-commit.test.js` *both commits land when two arrive together, and the projection holds one of them* | http+db | Concurrency produces a consistent end state: two log rows, exactly one projection row, `reviewer_id` matching the review row the projection points at, and projection equal to derivation. It **cannot** assert which reviewer won without being flaky, and that is correct — under last-wins it is genuinely undetermined. |
| R10 | `tests/mosaic-commit.test.js` *lets any reviewer withdraw the current decision* | http+db | Inverted from *refuses to withdraw a decision another reviewer owns*. `releaseWithdrawn` is no longer reviewer-scoped. |
| R10 | *no outcome is ever reported as `claimed`* | source+http | `CONFLICT_CLAIMED` is gone from the repository text and no response emits it. A constant left behind reads as reachable. |
| R11 | `tests/observation-review-current.test.js` *agrees with the derivation through a decision, a correction, and a decision by somebody else* | db | **The one that catches a half-finished change months later.** A log with several reviewers deciding in sequence, with an invalidation in the middle: decide → correct → decide as a *different* reviewer, asserting projection equals derivation **at every step**, and that the second reviewer's decision is the current one. |
| R11 | `tests/observation-review-current.test.js` *is reproduced exactly by the committed rebuild SQL* | db | The recovery path lands on identical rows. |
| R12 | *each of the four mosaic write routes reads its own permission constant* | source | Review, training, delete and correction each name a separate constant. They hold the same value today; the assertion is that changing one does not move the others, which is #68's *Authorization* obligation. |
| R12 | *seeds no new permission key* | db | The catalog holds no key matching mosaic, correction or relabel. Phase 2 settled the existing model. |
| R13 | *refuses a service token with 403 and writes nothing* | http+db | The token is granted `observations:write` **first**, so the refusal is provably about the principal and not about the key. Nothing is written: no log row, no species change. `observation_reviews.reviewer_id` references `users(user_id)` while a bearer principal's id is a `service_clients.service_client_id`, and both sequences start at 1 — so the failure is not an error but a correction silently attributed to an unrelated person in the scientific record. |
| R14 | *refuses an anonymous caller with 401* | http | Every route is authenticated; there is no V1. |
| R14 | *refuses a caller without observations:write with 403* | http+db | A user holding nothing, built narrowly in the style of `tests/auth.test.js` and `tests/v2_users.test.js` rather than through the full-permission fixture agent. |
| R15 | *tells deniedObservationIds which operation is asking* | source+unit | The function takes the operation, and all four call sites pass it. It returns `[]` for every operation today; the requirement is the seam, not a rule. A per-project delete rule cannot be written inside it without knowing delete is the caller. |
| R16 | *returns the shape the fixture returns* | http | `{ok: true, observation, previous}` on success and `{ok: false, error}` on refusal, because `store.js:597` branches on `res.ok` alone and a thrown status would surface as a transport failure in a path that has a perfectly good result to show. |
| R16 | *carries the corrected species' name, distinct from comname* | http+db | The response's `species_comname` is the **catalogue's** `species.comname` for the new species, while `observation.comname` is unchanged. Without it a corrected tile shows the old animal's name for ever; reusing `comname` would let the catalogue's current label be mistaken for the annotator's frozen one. |
| R17 | *the whole correction is one transaction* | db | Covered by the R3 and R9 pairs above: a refusal leaves nothing partially applied. |
| R18 | `npm run docs:build` | build | The generated contract carries `POST /v2/mosaic/observations/species` and its request and response schemas, and the diff is generated rather than hand-edited. |

## Requirements with no test

- **R17's row lock, as a lock.** The tests prove the transaction is atomic and that the
  reported refusal reason matches what applied. They do **not** prove `FOR NO KEY UPDATE` is
  the mechanism — removing it would not fail a named test here. Under last-wins the lock's
  original justification is gone and the surviving one is narrow: the version comparison is
  read before the write and reported after it, and without the lock two commits can
  interleave so the *reported* reason is not the one that applied. That is a reporting
  accuracy property, and a test for it would be inherently racy. **Stated as a gap rather
  than covered by a test that would flake.** Phase 5's concurrency test used to be the lock's
  proof; under last-wins it no longer is, and nothing replaces it.
- **R7's `down`.** The reverse migration restores the previous definition and the column, and
  is not exercised. No migration `down` in this repository is tested; doing it here would be
  a new practice rather than this phase's work.

## Edge cases

- **A correction on an observation with no previous species.** 4% of production rows.
  `previous_species_id` is null and the correction still records — the column is deliberately
  nullable while `corrected_species_id` is not.
- **A correction naming the species already recorded.** Writes nothing (R4). Under the
  version-boundary design this replaced it was a correctness landmine: the version trigger
  fires only `WHEN (old.* IS DISTINCT FROM new.*)`, so a no-op would have recorded a boundary
  at a version that never moved, invalidating every decision and admitting none, for ever.
  **D3's boundary is `review_id`-keyed, not version-keyed, so that trap is gone** and this is
  a behavioural rule rather than a load-bearing one. Tested anyway, because the trap will look
  attractive again to anyone who reaches for a version boundary.
- **A second correction.** The observation's current species is no longer what the first
  correction changed *to*, which is why `previous_species_id` and `corrected_species_id` are
  two columns rather than one. Asserted: the chain reconstructs.
- **A correction naming a species that does not exist.** `{ok: false, error: 'not-found'}`
  before any write, matching the fixture, which checks the species first *"so a correction
  that cannot be made writes nothing"*.
- **Two decisions inside one clock tick.** Ordinary under last-wins where they were
  exceptional before. `decided_at DESC, review_id DESC` is what makes the answer deterministic
  rather than planner-dependent, and the mid-log test decides twice in one transaction.

## Regression coverage

- **`twoReviewers()` in `tests/observation-review-current.test.js` borrowed users.** It read
  `SELECT user_id FROM users ORDER BY user_id LIMIT 2` and asserted the second was defined —
  the Phase 3 CI failure class exactly, passing here and failing on a database with one
  bootstrap user. R11 rewrites parts of that file, so it seeds two reviewers of its own and
  cleans them up. **Called out in its own commit rather than folded in silently.**
- **The CRLF comparison.** `75dc718` on `develop` today. Inherited by the new
  find-the-current-definition helper, which reads a second migration file.
- **A cleanup that removes nothing looks like a cleanup that worked.** Phase 5's `afterAll`
  counts what is left under the run's marker and throws if it is not zero. The new suite does
  the same, for observations *and* for the species it seeds.

## Known gaps

- **The mosaic read row still shows the pre-correction species name.** A4 puts the corrected
  name in the correction *response*, which paints the tile for one session; the read row
  (`repository/mosaic.repository.js:147-163`) carries `o.comname` and no species join, so a
  reload shows the old animal's name again — while the species *filter* is `o.species_id`, so
  filtering by the new species returns a tile labelled with the old one. `.marp/task.md`
  records this under *Findings left alone* as **needing a scoping call rather than a
  decision**, and no requirement covers it. Not built here, and raised rather than assumed
  either way.
- **Nothing verifies the client.** `frontend/` is out of scope; the five incompatibilities the
  spec records are Phase 8's, and the fixture still contradicts the endpoint in three of them.
- **No performance claim.** One observation on this database. Nothing is benchmarked and no
  number is claimed, on the same agreed basis as #99, #103, #105 and #106.
- **CI runs the fast tiers only.** A green pipeline is not G4.

## Manual steps

None. Everything here is automated and there is no GUI, GPU or Jellyfin dependency.
`tests/jellyfin.test.js` is untouched by this phase but is run locally as part of the full
suite, because CI excludes it by name and cannot report it broken.

## Walkthrough videos

None. This phase adds no client behaviour — `frontend/` is explicitly out of scope — so
there is nothing rendered to narrate, and a walkthrough that narrated an API result without
asserting it would be exactly the kind of test the doctrine warns about.

## Tests that change, and why

The distinction the doctrine turns on: **because the rule changed**, or **because it broke**.
Everything below is the first. If any test in this list turns out to be the second, that is
reported as a defect rather than edited away.

| File · test | Change | Which |
| --- | --- | --- |
| `mosaic-commit` · *gives the record to the first reviewer and reports the second* | Becomes *gives the record to the second reviewer, and keeps the first in the log*. | rule changed — A6 |
| `mosaic-commit` · *lets the claiming reviewer revise without moving first_decided_at* | Deleted; there is no claiming reviewer and no `first_decided_at`. What survives is *lets a reviewer revise their own decision*, two log rows and one projection row. | rule changed — A6 |
| `mosaic-commit` · *lets two reviewers hold the two purposes independently* | Kept as is. | unaffected |
| `mosaic-commit` · *serializes two commits arriving together, and logs only the winner* | Becomes *both commits land, and the projection holds one of them*. No longer asserts one is refused; asserts a consistent end state. | rule changed — A6 |
| `mosaic-commit` · *refuses to withdraw a decision another reviewer owns* | Inverted: a withdrawal by anyone clears the current decision. | rule changed — A6 |
| `mosaic-commit` · *is a no-op with no log row when there is nothing to withdraw* | Kept. The rule that a refused decision is never logged **narrows** rather than disappearing: it existed because logging a loser would make them the earliest claimant for ever, and that reason is gone — but a version-refused decision must still not be logged, or a rebuild would resurrect a decision the server refused. | rule narrowed |
| `observation-review-current` · *agrees with the derivation through a claim, a losing claim, a revision and a withdrawal* | The "losing claim" step becomes a **superseding** decision by a second reviewer, and asserts the second reviewer's decision is current. Plus the new mid-log invalidation case. | rule changed — A6 |
| `observation-review-current` · `twoReviewers()` | Seeds two reviewers instead of borrowing them. | it was wrong |
| `observation-review-schema` · `describe('observation_review_current')` | The column-list assertion loses `first_decided_at`; the log's vocabulary assertion gains `corrected`. | rule changed — A2, A6 |
| `mosaic-query` · the row-shape assertion | **Unchanged.** The read row is not touched by this phase; see *Known gaps*. | unaffected |
| `mosaic-query` · the `decide()` helper | Stopped writing `first_decided_at` into the projection. | **it broke** — the column went, and the helper inserted it by name. Not predicted by this plan, and it took the whole suite down: 48 failures in one file, all cascading from one insert. Named here rather than quietly fixed. |

Everything else in both suites is untouched: the vocabulary `CHECK`s, the delete cases, the
fingerprint case, the append-only assertion, and the route and permission cases.

---

## Results

Real output, including what failed on the way.

### The suite

Baseline on `abf00b9`, before any change:

```
  Test Suites : 35 passed, 0 failed, 35 total
  Tests       : 348 passed, 0 failed, 0 skipped, 348 total
  Duration    : 24.4s
```

Final, on the rebuilt database:

```
  Test Suites : 36 passed, 0 failed, 36 total
  Tests       : 377 passed, 0 failed, 0 skipped, 377 total
  Duration    : 25.4s
  Result: ALL TESTS PASSED
```

**348 to 377 reconciles exactly**, which is the point of counting rather than reporting
"green":

| Suite | Was | Now | Why |
| --- | --- | --- | --- |
| `observation-review-current` | 6 | 10 | +1 finder assertion, +1 no-`first_decided_at`, +1 mid-log invalidation, +1 corrected-cannot-project |
| `observation-review-schema` | 28 | 32 | +1 corrected vocabulary, +1 both-way species CHECK, +1 species FK restrict, +1 projection column list |
| `mosaic-commit` | 31 | 31 | four rewritten in place, none added or lost |
| `mosaic-correction` | — | 21 | new |
| everything else | 283 | 283 | untouched |
| **total** | **348** | **377** | **+29** |

### What failed on the way

Three failures, all real, none left standing.

**1. `twoSpecies()` — the `species` table does not use the timestamp names the rest do.**

```
  ✗ observation_review_current > ... > agrees with the derivation across an invalidation
      at twoSpecies (tests\observation-review-current.test.js:335:29)
  ✗ observation_review_current > ... > is reproduced exactly by the committed rebuild SQL
      at twoSpecies (tests\observation-review-current.test.js:335:29)
```

The seed used `"createdAt"`/`"updatedAt"` and omitted `taxserial`. `species` uses
`created_at`/`updated_at` and `taxserial` is `NOT NULL` — read from `information_schema`
rather than guessed at the second attempt. Fixed in the helper.

**2. Two schema assertions written with collapsed regex escapes.**

```
      Expected pattern: /scientific[sS]*corrected/
      Received string:  "CHECK (((((purpose)::text = 'scientific'::text) AND ..."

      Expected pattern: /REFERENCES species(id)/
      Received string:  "FOREIGN KEY (previous_species_id) REFERENCES species(id) ..."
```

Both patterns were written through a JS template literal, where `\s` and `\(` collapse to
`s` and `(`. Rewritten as positional `indexOf` checks and `toContain`, which say what they
mean and cannot rot the same way. **Worth noting as the same class of bug as the CRLF one
this plan already warns about**: an escape that survives one layer and not the next.

**3. `mosaic-query.test.js` — 48 failures from one insert.**

```
  Test Suites : 34 passed, 1 failed, 35 total
  Tests       : 308 passed, 48 failed, 0 skipped, 356 total
```

Its `decide()` helper writes the projection directly and named `first_decided_at`, which
this phase drops. Every test in the file depends on that helper, so one dead column took
the suite down. **This is a test that broke rather than one whose rule changed**, and it
was not predicted by the plan above — the plan's *Tests that change* table listed only the
two review suites. Fixed by removing the column from the insert; the suite is about the
read path and does not care which decision is current, only that one is.

### The rebuild, and the three-way structural comparison

`marp db destroy` then `marp db up`, then `db:migrate:undo` four times and `db:migrate`
forward again:

```
before (superseded chain) : {"columns":"eec58d8446c3144c","constraints":"88c7551f5420797b","indexes":"f34b1c358f2dc6e1","triggers":"aaf9df9373d23854"}
after  (folded, rebuilt)  : {"columns":"eec58d8446c3144c","constraints":"88c7551f5420797b","indexes":"f34b1c358f2dc6e1","triggers":"aaf9df9373d23854"}
round-trip (down then up) : {"columns":"eec58d8446c3144c","constraints":"88c7551f5420797b","indexes":"f34b1c358f2dc6e1","triggers":"aaf9df9373d23854"}

folded === superseded  : true
round-trip === folded  : true
sizes all equal        : true
sizes                  : {"columns":472,"constraints":235,"indexes":85,"triggers":1,"tables":37}
```

**The first equality is the one that matters**: the folded `120100` and `120200` produce a
schema identical to the one the superseding chain produced, so the fold changed how the
files read and nothing about what they do. The second proves the edited `down` migrations
are correct against the edited `up`.

`db:migrate:status` reports 24 up and 0 down.

### What the rebuild cost, and what came back

| | Before | After | |
| --- | --- | --- | --- |
| `species` | 854 | 854 | Reproduced in full by `20260901120200-import-species-lists`, which reads `seed-data/species/lists/*.csv`. Confirmed **before** destroying anything: `readSpeciesLists()` returns 854 records, 6 empty rows skipped, 2 duplicate keys merged. |
| `permissions` | 23 | 23 | Seeded by migration. |
| `users` | 16 | 1 | The 15 lost were test fixtures left behind by earlier runs; 1 is the bootstrap administrator. |
| `observations` | 1 | 0 | Test detritus. |
| `keyframes` | 8 | 0 | Test detritus. |
| `sessions` | 1 | 0 | Test detritus. |
| `SequelizeMeta` | 26 | 24 | The two phantom rows for the deleted migrations are gone, so this database and a fresh one now name exactly the same 24 files. |

### Migration round-trip, verbatim

```
== 20260909120400-add-missing-foreign-key-indexes: reverting =======
== 20260909120400-add-missing-foreign-key-indexes: reverted (0.009s)
== 20260909120300-add-dataset-observations-observation-fk: reverting =======
== 20260909120300-add-dataset-observations-observation-fk: reverted (0.006s)
== 20260909120200-create-observation-review-current: reverting =======
== 20260909120200-create-observation-review-current: reverted (0.007s)
== 20260909120100-create-observation-reviews: reverting =======
== 20260909120100-create-observation-reviews: reverted (0.008s)

== 20260909120100-create-observation-reviews: migrating =======
== 20260909120100-create-observation-reviews: migrated (0.012s)
== 20260909120200-create-observation-review-current: migrating =======
== 20260909120200-create-observation-review-current: migrated (0.007s)
== 20260909120300-add-dataset-observations-observation-fk: migrating =======
== 20260909120300-add-dataset-observations-observation-fk: migrated (0.021s)
== 20260909120400-add-missing-foreign-key-indexes: migrating =======
== 20260909120400-add-missing-foreign-key-indexes: migrated (0.006s)
```

### The generated contract

`npm run docs:build` emits pre-existing JSDoc parse errors from
`frontend/apps/marp-mosaic-review/src/model/schedule.js` (a `@param` documenting a
destructured shape). They are on `develop`, unrelated to this phase, and not fixed here.

The contract itself carries the route and both schemas:

```
path present: /v2/mosaic/observations/species
MosaicCorrectionRequest: true
MosaicCorrectionResult: true
conflicted reason enum: ["version"]
```

The last line is the last-wins unwind reaching the published surface: `claimed` is gone as
a conflict reason, because nothing can be refused for being second any more.

### Not run

`tests/jellyfin.test.js` runs as part of the suite above and passes; nothing in this phase
touches Jellyfin. No browser tier exists for this work and none was invented.
