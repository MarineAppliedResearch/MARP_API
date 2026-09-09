---
task: MarineAppliedResearch/MARP_API#111
repos: [marp-api]
status: design
needs: []
---

# Phase 7 — species correction, invalidation, and the permission review

Design specification for MARP_API#111, the last API phase of #68 before the fixture is
replaced. Three things, and the middle one turned out to be the largest:

1. **The species correction endpoint** — `data.js`'s `setSpecies()` made real.
2. **The invalidation a correction causes**, which sent the question back to what "current"
   means — and the answer, given by the human on 2026-09-09, **overrules first-valid-review-
   wins in two already-merged phases.** That change is written up as its own piece of work
   below, because it is one.
3. **The permission review**, which is a negative obligation rather than a feature.

**G1 only. Nothing is implemented while a `blocking` assumption below is open.** Phases 3
(#103), 4 (#105) and 5 (#106) are merged to `develop`; this branch stacks on nothing. Their
specs are preserved beside this one as `.marp/task-103-review-state-schema.md`,
`.marp/task-105-mosaic-query.md` and `.marp/task-106-page-commit.md`.

## Goal

A biologist looking at a wall of pictures sees one that is plainly the wrong animal, presses
**Change Species**, picks the right one, and the tile confirms it. What the record then says
is the truth: the observation's species is the corrected one, the annotator's own label is
still there to be audited against, and **any approval given to the old classification is
gone**, so the observation comes back round to be reviewed again by whoever reviews it next.

And underneath that, a simpler rule than the one built: two reviewers are not expected to be
working the same filters at the same time, and when they are, the last one to commit wins.
Nobody is locked out of an observation by somebody who got there first.

## The basis, and what each recommendation rests on

Three bases, and every recommendation below says which one it stands on.

- **The live development database, read only.** PostgreSQL 18.6, queried through
  `information_schema`, `pg_constraint`, `pg_trigger`, `pg_proc`, `pg_indexes` and
  `pg_get_functiondef`. This is the baseline plus 24 migrations, including #103's five, so it
  is the authority for what a constraint, index or trigger actually is.
  `db/baseline/schema.sql` predates this whole design and is not consulted for it.
- **The repository's files**, and **the client's files**, which are a constraint on the
  contract rather than background: `frontend/apps/marp-mosaic-review/src/data.js`
  (`setSpecies`), `src/store.js` (`changeSpecies`), `src/ui/tile.js`, and that app's
  `CLAUDE.md`.
- **No measurement.** 1 observation, 8 keyframes, 1 session, 854 species, 15 users, 0
  `observation_reviews`, 0 `observation_review_current`, 24 `SequelizeMeta` rows. One row
  answers "fast" to every question, so nothing here is benchmarked and no number is claimed.
  Same agreed basis as #99, #103, #105 and #106, not a fallback.

**On citing #68.** `AGENTS.md` now says a requirement taken from #68 is checked with the
human rather than inherited: it is a record of thinking written over months, it contradicts
itself in places, and three phases have built from a single line of it and had to unwind —
the deletion provenance table, first-valid-review-wins, and a `GET` that #99 had already
settled as a `POST`. So every #68 line this spec leans on is **quoted** and, where it is
load-bearing and unconfirmed, **asked** (A5) rather than asserted.

## What is settled before this phase starts

Inherited. Contradicting any of these fails a constraint or a test rather than drifting.

- **`comname` is never rewritten, and neither is `taxserial`.** Settled in #111. `comname` is
  the label the list entry carried when the annotator pressed the button, and roughly 50,000
  observations already disagree with what their list says today because lists were renamed and
  renumbered underneath records that were correct when made
  (`migrations/20260901120500-add-observations-species-id.js`, Refs #52). A correction changes
  `species_id`. `taxReview`, `sizereview` and the `TimeSpan` columns are untouched too.
- **`observations.species_id` is nullable and about 4% of production rows have no value.**
  Read from the migration above: 438,988 of 440,102 rows carry a `taxserial`, and the backfill
  could not resolve roughly 4% of them. The single row on this database has `species_id =
  NULL`, `comname = 'Blue/Deacon Rockfish'`, `taxserial = 166730`. So "the species before the
  correction" is legitimately absent, not merely unknown.
- **`species_id` references `species(id)`**, `ON UPDATE CASCADE ON DELETE SET NULL` — read
  from `pg_constraint` as `observations_species_id_fkey`. `species` has 854 rows here and
  carries `comname`, `species` (the scientific name), `gui_display_name`, `taxserial`,
  `species_list` and `is_active`.
- **`observations.version` is trigger-maintained.** `observations_bump_version_trigger`,
  `BEFORE UPDATE … FOR EACH ROW WHEN (old.* IS DISTINCT FROM new.*)`, and
  `observations_bump_version()` assigns `NEW.version := OLD.version + 1` from **`OLD`**, never
  `NEW` — read from `pg_get_functiondef`. Read it to detect a conflict; never write it.
- **The projection table stays.** `observation_review_current` is built, tested and merged,
  and the mosaic's default "unreviewed" filter is a primary-key anti-join against it, which is
  what #105's query relies on. Under last-wins it gets *simpler* to maintain, not redundant.
  Replacing it with a view is not proposed and would be a regression.
- **The projection is a derived value and therefore part of the data contract**, not a cache.
  Its definition ships once, as a `-- rebuild:` block in a migration, and
  `tests/observation-review-current.test.js` asserts projection equals derivation. That test
  is what catches a half-change months later, and it is the reason this phase's changes to the
  derivation and to the write path have to land together.
- **Every route under `/api/v2/`**, declared without the prefix through
  `registerVersionedRoute`, which is also what attaches `requirePermission`.
  `routes/lib/register-versioned-route.js:46` throws on a path that already starts `/api/v2/`,
  and hand-mounting to dodge that throw gets the URL and loses the permission check.
- **No new permission key is seeded.** Phase 2 settled the existing model.
- **A delete leaves no trace.** Withdrawn 2026-09-09; nothing here reinstates it.
- **`frontend/` is not changed by this phase.** The incompatibilities this phase creates for
  the client are recorded below and are Phase 8's work, exactly as #105's three were.

## The three questions #111 named

**1 · What a correction records, and where — answered.** 2026-09-09, the human: *"a species
correction is a review decision."* So it is a row in `observation_reviews`, not a separate
audit table beside it. What that implies is D1, D2 and D6, and it is not all obvious: the
table's `CHECK` has no value for it; it carries data no decision carries (the species it
replaced) and none of the data a flag carries (a `reason` from the client's vocabulary); and
a row in that table takes part in whatever the derivation says "current" means — which for a
correction must be *nothing*, because a correction is not an approval and must not paint a
tile as reviewed.

**2 · The invalidation collision — dissolved, by overruling the rule it collided with.**
2026-09-09, the human: *"obviously the last person to commit something wins, in our normal
workflow we are not expecting two people to query and review with the same filters, but if
they do, the last one to commit should win, and if they want to update they can just refresh
their page and requery."*

There is no earliest claimant, no race rule and no reservation. **The collision described in
#111 cannot occur**, because there is no first claimer to get stuck on: after a correction
removes the current decision, anyone may decide, because anyone may always decide. What
remains is not a collision but a mechanism — a correction has to *stop* the previous decision
being current — and D3 is that mechanism. The whole of *Last-write-wins* below is the change
this answer makes to two merged phases.

**3 · Whether a correction is version-checked — answered: yes.** 2026-09-09. It looked as
though A6 might have decided this by implication — *"if they want to update they can just
refresh their page and requery"* reads as last-write-wins on the annotation as well as on the
decision — and it does not. **Last-write-wins governs whose *decision* stands. It does not
govern whether a decision may be recorded against an observation that has changed underneath
it.** Approving a picture whose species somebody has since corrected records an approval of a
classification the reviewer never saw, which is the exact failure invalidation exists to
prevent. So `conflicted` survives A6 with `version` as its only reason.

## Last-write-wins: what changes in two merged phases

Its own piece of work, listed exhaustively, because it revises code and tests that are
already on `develop` and a half-done version of it would be invisible for months.

### What "current" becomes

Phase 3's own spec predicted this shape: *"if the answer is simply last write wins, the
derivation collapses to one `DISTINCT ON (observation_id, purpose)` that an index on
`(observation_id, purpose, decided_at DESC)` serves directly."* That index exists —
`observation_reviews_observation_purpose_decided_idx`, read from `pg_indexes`.

The three CTEs (`claim`, `claimer`, `latest`) collapse to one, and the whole notion of a
claimer disappears. D3 carries the SQL, including the one thing corrections add to it.

### What goes, precisely

| Where | What goes | Why |
| --- | --- | --- |
| `migrations/20260909120200`, `-- rebuild:` | `claim` and `claimer` CTEs | there is no earliest claimant |
| `observation_review_current` | the `first_decided_at` column | see below |
| `mosaic-commit.repository.js:520` | `WHERE observation_review_current.reviewer_id = EXCLUDED.reviewer_id` on the upsert | the later decision wins unconditionally |
| `mosaic-commit.repository.js:445-470` | the `claim`/`claimer` CTEs and the `NOT EXISTS` in `appendDecisions` | nothing is refused for being claimed |
| `mosaic-commit.repository.js:500-514` | the `JOIN LATERAL` computing `first_decided_at` | the column is gone |
| `mosaic-commit.repository.js:557-563` | `AND reviewer_id = $3` on `releaseWithdrawn` | a withdrawal by anyone clears the current decision |
| `mosaic-commit.repository.js:675-681` | the `held.reviewer_id !== reviewerId` branch for a withdrawal | same |
| `mosaic-commit.repository.js:133` | `CONFLICT_CLAIMED` | unreachable once nothing can be claimed |

**`first_decided_at` does not survive, and it should not.** Its column comment says what it is
for — *"Preserved when they revise their own decision, which is what first-valid-wins has to
keep"* — and that purpose has evaporated. It is `NOT NULL`, so keeping it forces every writer
to invent a value and the next reader to believe it means something. It could be redefined as
"when this observation was first decided for this purpose, by anyone", but nobody has asked
for that fact, it is in the log if anyone ever does, and computing it would put a second pass
back into a derivation that just collapsed to one. Drop it. Every database has 0 rows in this
table, so nothing is lost.

**`reviewer_id` in the projection survives** and changes meaning cleanly: from *"the reviewer
who owns this record"* to *"who made the current decision"*. Its comment has to change with
it, and — new under last-wins — the upsert must now include it in the `SET` list, where it was
deliberately excluded before.

**The row lock: keep it, with the reason rewritten.** `lockObservations`'
`FOR NO KEY UPDATE` (`mosaic-commit.repository.js:355`) is justified today by the claim test:
*"without it two reviewers arriving together both pass the claim test on their own snapshot,
both append a log row, and only one projection write applies — leaving the loser logged."*
Under last-wins both log rows are correct history and either projection outcome is legitimate,
so **that justification is gone and the lock is not needed for it.** It is kept for a
different, smaller reason, which A3 preserved: the version comparison that produces
`conflicted / version` is read before the write and reported after it, and without the lock two
commits can interleave so that the *reported* reason is not the one that actually applied. So
the lock stays and its comment is rewritten to say that instead — had A3 gone the other way it
would have been deleted outright, which is worth recording because the comment currently in the
file is the only thing that explains why it is there.

### Which merged tests change, and into what

- `tests/mosaic-commit.test.js`, `describe('first valid review wins (R11, R13)')` — the whole
  block is now asserting a rule that does not exist. Four cases:
  - *"gives the record to the first reviewer and reports the second"* → **gives the record to
    the second reviewer, and the first's decision stays in the log**. It becomes the
    last-wins test.
  - *"lets the claiming reviewer revise without moving first_decided_at"* → **deleted**; there
    is no claiming reviewer and no `first_decided_at`. What survives from it is that a
    reviewer revising their own decision produces a second log row and one projection row,
    which the case above already covers.
  - *"lets two reviewers hold the two purposes independently"* → **kept as is**. Purpose
    independence is unaffected.
  - *"serializes two commits arriving together, and logs only the winner"* → **both commits
    log, and the projection holds one of them**. It is no longer a test that one is refused;
    it is a test that concurrency produces a consistent end state — two log rows, exactly one
    projection row, `reviewer_id` matching whichever review row the projection points at, and
    projection equal to derivation. Note it can no longer assert *which* reviewer won without
    being flaky, and that is correct: under last-wins that is genuinely undetermined.
- `tests/mosaic-commit.test.js`, *"refuses to withdraw a decision another reviewer owns"* →
  **inverted**: a withdrawal by another reviewer succeeds and clears the current decision.
- `tests/observation-review-current.test.js`, *"agrees with the derivation through a claim, a
  losing claim, a revision and a withdrawal"* → the "losing claim" step becomes a
  **superseding** decision by a second reviewer, and the assertion becomes that the second
  reviewer's decision is current. Plus the new mid-log invalidation case (R11).
- `tests/observation-review-schema.test.js`, `describe('observation_review_current')` — the
  column-list assertion and *"refuses withdrawn"* both need the dropped column and the widened
  log vocabulary reflected.

Everything else in both suites is untouched — the vocabulary CHECKs, the delete cases, the
fingerprint case, the append-only assertion, the route and permission cases.

### Does this need a migration?

Yes, and the phase can have them. Three changes, best as **two files**:

1. **`observation_reviews` widened**: the two species columns and the rebuilt
   purpose/decision `CHECK` (R6).
2. **The projection redefined**: `first_decided_at` dropped, and a new
   `CURRENT_DERIVATION_SQL` with its rebuild re-run (R7). One file, because both halves are
   the same decision.

**Migration `20260909120200` is not edited.** Editing an applied migration makes the file
disagree with what ran: the ledger already records it, so its `up()` never runs again, and
every existing database would keep a projection maintained against a definition the file no
longer contains. A superseding migration is honest, applies wherever `db:migrate` runs, and is
exactly what #103 planned for — its own header says the projection is *"separate from the
migration that creates `observation_reviews` so that a different answer about the shape of
current state replaces one file rather than editing two features apart."* This is that
different answer.

The consequence for R11: two migration files then carry a `-- rebuild:` block, so *"the
definition exists once"* becomes *"exactly one definition is current, and it is the newest"*.
The test finds it rather than hard-coding a path, which is also the shape that survives the
next redefinition.

## What is already true, checked rather than assumed

- **`observation_reviews_purpose_decision_check` admits six combinations and no more:**
  `scientific` × {`reviewed`, `flagged`, `withdrawn`} and `training` × {`promoted`,
  `excluded`, `withdrawn`}. There is no value for a correction, so this phase needs a
  migration whether or not anything else forced one.
- **`observation_review_current_purpose_decision_check` admits four:** `scientific` ×
  {`reviewed`, `flagged`} and `training` × {`promoted`, `excluded`}. Anything the projection's
  `CHECK` does not name simply cannot be inserted, which is what makes `withdrawn` a `DELETE`
  — and a correction inherits that property for free, loudly, rather than by convention.
- **`observation_reviews` has no column for a species**, in either direction. Its columns are
  `review_id`, `observation_id`, `purpose`, `decision`, `reason`, `reviewer_id`,
  `observation_version`, `reviewed_keyframe_count`, `reviewed_keyframe_max_updated_at`,
  `representative_keyframe_id`, `decided_at`, `created_at`, `updated_at`.
- **Phase 5 holds a second copy of the claim rule, deliberately.**
  `repository/mosaic-commit.repository.js:433-467`. So the derivation and the write path have
  to change together or they disagree, and #103's test is what would find it, long afterwards.
- **`updateObservation` propagates `comname` to keyframes.**
  `repository/observation.repository.js:690-712`: when the submitted `comname` differs from the
  stored one it updates every `keyframes` row for that observation. `keyframes` carries a
  `comname` and **no `species_id`** — checked in `information_schema`. So the correction must
  not go through `updateObservation`, and because it never sends a `comname` the propagation
  would not fire anyway. Both halves are stated because relying on the second alone is one
  refactor away from being wrong.
- **`observations.species_id` is written nowhere in the application today.** Only
  `migrations/20260901120500` populates it and `model/observation.model.js:227` declares it.
  The correction is its first write path; there is no existing pattern to match.
- **`observations` has no `scientific_name` column**, and the mosaic row carries `o.comname`
  with no species join at all (`repository/mosaic.repository.js:147-163`). This is why A4
  exists.
- **The permission catalog holds 23 keys and exactly two for observations**, read from the
  live table: `observations:read`, and `observations:write` described as *"Record, change and
  delete observations. This is what an annotator needs."*
- **`user_permissions` has no project column** — `user_permission_id`, `user_id`,
  `permission_id`, `granted_by_user_id`, `createdAt`, `updatedAt` — and
  `observations.project_id` is **nullable**, with the single local row carrying null. Both
  matter to D7.
- **`observation_id` is assigned by hand** as `max(observation_id) + 1` (#62), despite the
  column carrying a `nextval` default. This phase creates no observation; it is a note for
  whoever seeds test rows — insert with SQL, as `tests/observation-review-current.test.js:245`
  already does.

## Requirements

- **R1** — One route, one observation: `POST /api/mosaic/observations/species`, declared
  through `registerVersionedRoute` so it lands at `/api/v2/mosaic/observations/species` behind
  `requirePermission`. Single-observation rather than bulk, because the client's seam is
  `setSpecies(observationId, speciesId)` (`data.js:790`) called one tile at a time
  (`store.js:596`); a bulk form is additive later and nothing asks for it now.
- **R2** — The only observation column written is `species_id`. `comname`, `taxserial`,
  `taxReview`, `sizereview` and the `TimeSpan` columns are not touched, and the write does not
  go through `updateObservation`.
- **R3** — The request carries `{observation_id, version, species_id}` and a stale `version` is
  refused without writing anything, reported the way Phase 5 reports it (A3).
- **R4** — A correction naming the species the observation already has writes nothing. It
  would otherwise invalidate live review decisions in exchange for changing nothing at all.
  *(Under the version-boundary design this replaced, a no-op was a correctness landmine —
  the trigger's `WHEN (old.* IS DISTINCT FROM new.*)` means a no-op update does not move the
  version, and a boundary at an unmoved version would have made the observation permanently
  unreviewable. D3's boundary is not version-shaped, so that trap is gone and this is now a
  behavioural rule rather than a correctness one. Recorded because the trap will look
  attractive again to anyone who reaches for a version boundary.)*
- **R5** — The correction appends exactly one `observation_reviews` row: `purpose =
  'scientific'`, `decision = 'corrected'`, `reviewer_id` = the acting user,
  `observation_version` = the version it applied to, `previous_species_id` and
  `corrected_species_id`, `reason` null, and the annotation fingerprint populated server-side
  the way Phase 5 populates it (A2).
- **R6** — A migration widens `observation_reviews`: the two species columns, the
  purpose/decision `CHECK` rebuilt to admit the correction, and a `CHECK` tying
  `corrected_species_id IS NOT NULL` to `decision = 'corrected'` and null to every other
  decision — so a correction cannot be recorded without saying what it changed to, and an
  ordinary decision cannot pretend to be one. `previous_species_id` stays nullable because 4%
  of observations legitimately have no prior species.
- **R7** — A second migration redefines "current" for last-write-wins (D3), drops
  `first_decided_at`, and re-runs the rebuild so every database ends holding a projection the
  new definition agrees with. `down` restores the previous definition and the column, and
  rebuilds again.
- **R8** — A `corrected` row **never projects**: an observation somebody corrected but nobody
  has reviewed since is unreviewed, for both purposes.
- **R9** — The correction removes the observation's `observation_review_current` rows for
  **both** purposes, **regardless of `reviewer_id`**, in the same transaction as the log row
  and the `species_id` update. An explicit `DELETE`, because the projection is maintained
  rather than recomputed — and the derivation must agree with it, which R11 is what proves.
  Unlike `releaseWithdrawn` (`mosaic-commit.repository.js:557`) it is not reviewer-scoped: it
  removes other people's projection rows, which is what invalidation means. Their decisions
  stay in the log, which is what *"retaining that decision's audit history"* means.
- **R10** — Phase 5's write path is brought into line with the new derivation in the same
  change: the claim CTEs and the `NOT EXISTS` go, the upsert becomes unconditional and
  includes `reviewer_id`, `releaseWithdrawn` loses its reviewer scope, and `CONFLICT_CLAIMED`
  goes. Enumerated in *What goes, precisely*.
- **R11** — `tests/observation-review-current.test.js` reads the **current** definition rather
  than a hard-coded path, and gains a case with **an invalidation in the middle of a log**:
  decide, correct, decide again as a *different* reviewer, asserting projection equals
  derivation at every step and that the second reviewer's decision is the current one. Any
  comparison of file content against a template literal normalises `\r\n` to `\n` first — the
  suite already does this at line 79, and the reason is in the test plan.
- **R12** — The route takes its own permission constant, `CORRECTION_PERMISSION`, alongside
  Phase 5's three. Value `observations:write`; no new key seeded.
- **R13** — A non-user principal is refused `403` before any write, with Phase 5's reasoning
  verbatim: `observation_reviews.reviewer_id` is `NOT NULL REFERENCES users(user_id)`, a
  bearer principal's id is a `service_clients.service_client_id`, both sequences start at 1,
  and the failure is not an error but a correction silently attributed to an unrelated person
  in the scientific record.
- **R14** — Refusal-case tests in the style of `tests/auth.test.js` and
  `tests/v2_users.test.js`: anonymous, a user without `observations:write`, and a service
  token. Plus the coupling assertion D7 owes — that review, training, deletion and correction
  each read their own constant, so changing one does not move the others. Rows are seeded,
  never borrowed: **CI builds the baseline plus migrations with no observations and no
  sessions**, and a test that borrows an existing row passes here and fails there. That
  happened on Phase 3.
- **R15** — `deniedObservationIds` (`mosaic-commit.repository.js:329`) learns which operation
  is asking. It is one function shared by all three modes and returns `[]`; a per-project
  delete rule cannot be written inside it without knowing that delete is the caller, and the
  parameter is cheaper now with three call sites than later with more.
- **R16** — The response is substitutable for the fixture's: `{ok: true, observation,
  previous}` on success and `{ok: false, error}` on refusal, because `store.js:597` branches on
  `res.ok` alone. `observation` carries the **corrected species' name from `species.comname`**
  in its own field alongside the frozen `comname`, and the new `version`; `previous` carries
  the prior `species_id` and its name (A4).
- **R17** — The whole correction is one transaction. The observation row is locked `FOR NO KEY
  UPDATE` before its version is read — the same strength as `lockObservations`
  (`mosaic-commit.repository.js:355`) and, since A3 keeps the version refusal, for the
  narrowed reason given in *Last-write-wins*: the version is read before the write and reported
  after it, and without the lock a concurrent commit can make the reported reason not the one
  that applied.
- **R18** — `npm run docs:build` is re-run and its output committed: this adds a route, and
  `docs/openapi.generated.json` and `docs/developer/` are tracked.

## Open assumptions

- [x] **A1 · scientific or data-meaning · blocking** — answered 2026-09-09: a species
  correction *is* a review decision, recorded in `observation_reviews` rather than in a
  separate audit table. Consequences in D1, D2, D6. → candidate ADR.
- [x] **A6 · architectural · blocking** — answered 2026-09-09: **the last commit wins.** No
  earliest claimant, no race rule, no reservation; a reviewer who wants the current state
  refreshes and requeries. This overrules first-valid-review-wins in #103 and #106 and is
  written up as *Last-write-wins* above. → this one must become an ADR, because it reverses a
  documented decision in two merged phases.
- [x] **A2 · database/schema · blocking** — answered 2026-09-09: **a correction is a
  *scientific* review decision.** One row, `purpose = 'scientific'`, `decision = 'corrected'`.
  Two candidates were put up and both are now closed: a purpose-neutral `classification` value
  is not used, and the correction does **not** write a second row for the training purpose.
  The consequence is that the correction row cannot invalidate the training purpose by being
  the latest row for it — so **the boundary in D3 is required rather than optional**, and it
  is deliberately written without a purpose filter so that one scientific-purpose row ends the
  round for both. Recorded because a later reader will otherwise try to simplify the boundary
  away.
- [x] **A3 · API contract · blocking** — answered 2026-09-09: **yes, a correction is
  version-checked**, and Phase 5's version refusal stands with it. So `conflicted` survives
  A6 with `version` as its only remaining reason, `claimed` having gone with the claim rule;
  the row lock is kept for the narrowed reason in *Last-write-wins*; and the client must send
  a version it does not send today (`data.js:790`), which is incompatibility 1 below. Last-
  write-wins governs whose *decision* stands, not whether a decision may be recorded against
  an observation that has since changed underneath it — the two were the question, and they
  are answered differently on purpose.
- [x] **A4 · product/UI · blocking** — answered 2026-09-09: **the response carries the
  corrected species' name**, because `comname` is frozen and without it a corrected tile shows
  the old animal's name for ever. Taken from `species.comname` — the catalogue's full common
  name, not `gui_display_name`, which is an abbreviation (`Greenblotched RF`), and not
  `species`, which is the scientific name — in a field named for what it is rather than reusing
  `comname`, so nothing can mistake the catalogue's current label for the annotator's frozen
  one. **Still to route, and it is not this assumption:** the mosaic *read* row
  (`repository/mosaic.repository.js:147-163`) carries `o.comname` and no species join, so a
  reload undoes the display. Whether that field lands here or in Phase 8 is a scoping call,
  and it is raised in *Findings left alone* rather than settled here.
- [x] **A5 · scientific or data-meaning · blocking** — which of #68's *Invalidation* list are
  real requirements? Asked rather than inherited, per `AGENTS.md`. The quoted lines: *"If an
  approved observation changes materially, its active approval is automatically invalidated
  and it must be approved again before being used as approved training data. Material changes
  include at least: Changing the species or classification · Changing the observation's start
  or end frame · Adding, removing, or changing a bounding-box keyframe · Any other change
  altering the frames, labels, or interpolated bounding boxes exported for training"*, and
  *"A material change also invalidates an active **Excluded** disposition and returns the
  observation to **Undecided**"*, and *"Presentation-only changes, such as selecting a
  different representative image, invalidate nothing."* **This phase implements exactly one of
  them — the species correction — and the recommendation is that it should.** What is being
  asked is whether the other three are requirements at all, because two of them are cheap to
  agree to and expensive to build: a keyframe edit does not move `observations.version` and so
  cannot use this phase's mechanism at all (D6), and it happens in the annotation GUI's write
  path, which would have to reach into the review log. Also worth confirming: does a species
  correction really invalidate the **training** disposition too, or only the scientific one?
  A2 assumes both, on the strength of the *Excluded* line above.
- [ ] **A7 · behavioural · non-blocking** — how is R4's no-op reported: `400`, or `{ok: false,
  error: 'unchanged'}`? Recommendation: the latter, because the client branches on `ok` alone
  and a `400` surfaces as a transport failure in a path that has a perfectly good result to
  show.
- [ ] **A8 · scientific or data-meaning · non-blocking** — may a correction name a species with
  `is_active = false`, or one whose `species_list` differs from the owning session's list?
  Recommendation: refuse an inactive entry, following `repository/species.repository.js:412,
  444, 474`, which filters `is_active: true` everywhere it offers species for annotation;
  **allow** an off-list one, because a misidentification is exactly the case where the right
  answer is on another list. The consequence to see: `taxserial` stays frozen, so after an
  off-list correction `taxserial` and `species_id` name different organisms and a query joining
  on `taxserial` gets the pre-correction answer — the same auditable drift `comname` already
  carries, by the same decision.
- [ ] **A9 · database/schema · non-blocking** — `previous_species_id` and
  `corrected_species_id`: `ON DELETE RESTRICT` or `SET NULL`? Recommendation: `RESTRICT`,
  matching `observation_reviews.reviewer_id`, whose migration reasons that an actor must not be
  able to vanish from a record that belongs to them. Species are retired with `is_active`
  rather than deleted, so nothing is blocked in practice, and `SET NULL` — which
  `observations.species_id` uses — would silently empty an audit row. That column's choice is
  about a live value; this one is about a historical one.

- **A5 — answered 2026-09-09, both halves.**

  **Part 2, the human's answer, and the load-bearing one: a relabel invalidates *both*
  purposes.** His words: *"yes if someone relabels something it needs to be reapproved."*
  So a species correction ends the round for the scientific review **and** the training
  disposition, and the observation returns to unreviewed and undecided for anybody to
  decide again. The reason is the one that matters scientifically rather than the one #68
  happens to state: a promoted training sample carrying the wrong label teaches the model
  the wrong thing, which is worse than not having the sample at all.
  So the `boundary` CTE stays **unfiltered by purpose**, R9's `DELETE` removes both
  projection rows, and the acceptance criterion is that a corrected observation is
  unreviewed for both purposes.

  **Part 1, settled by the coordinator: the other three material changes in #68's
  *Invalidation* list are out of scope for this phase.** Changing the start or end frame,
  adding or changing a bounding-box keyframe, and anything else altering the exported
  frames or boxes — none is built here. Two reasons, both from what is actually in the
  repository rather than from preference: a keyframe edit **does not move
  `observations.version` at all**, since keyframes are their own table, so it cannot use
  this phase's mechanism; and it happens in the annotation GUI's write path, which would
  have to reach into the review log to record anything. That is a different piece of work
  with a different risk.
  **They are deferred, not rejected.** The boundary is a `review_id`-keyed "this round is
  over" marker precisely so a second cause of invalidation arrives as a second branch of
  one `SELECT`, and D6 records that a keyframe fingerprint would instead land as a
  predicate inside `latest`. Neither is foreclosed.

  **And the reason this was asked at all rather than inherited:** `AGENTS.md` now says a
  requirement taken from #68 is checked with the human, because three phases have built
  from a single line of it and had to unwind — the deletion provenance table,
  first-valid-review-wins, and a `GET` that #99 had already settled as a `POST`. *Invalidation*
  is exactly that kind of section, and this phase's whole mechanism is built to satisfy it.

## Decisions

- **2026-09-09 · D1 — A correction is a decision row, and it is the vocabulary's second
  non-projectable state.** `withdrawn` is legal in the log and illegal in the projection; a
  correction joins it. That is not a workaround for A1's answer, it is what A1's answer
  implies: recorded *as* a decision, and not an approval, so it must not paint a tile. The
  projection's `CHECK` enforces it **without being changed at all** — any value it does not
  name cannot be inserted, and it fails loudly rather than quietly. What must change is the
  derivation's final filter, from `WHERE decision <> 'withdrawn'` to one that excludes a
  correction too, or the rebuild would try to insert a `corrected` row and hit that `CHECK`.

- **2026-09-09 · D2 — The previous and the corrected species are two columns on the log row,
  not one and not a `reason`.** Two, because after a *second* correction the observation's
  current species is no longer what the first correction changed *to*, so a single
  `previous_species_id` leaves the chain unreconstructable — and #68 asks a correction to
  record *"actor, time, previous classification, new classification, and observation version"*.
  Not `reason`, because that column holds the reviewer-facing flag vocabulary in `varchar(64)`
  and putting a species *name* there would reintroduce the exact failure `comname` documents: a
  text label that goes stale underneath the record. A key, not a name.

- **2026-09-09 · D3 — "Current" is the latest decision per `(observation_id, purpose)`, with a
  correction ending what came before it.** A6 collapses three CTEs to one; A2 requires the
  `boundary` that goes back in front of it.

  **Why the boundary is not optional, given A2.** The correction row carries `purpose =
  'scientific'`, so it is the latest row for the *scientific* purpose and no row at all for
  training. Without the boundary a correction would leave a live `promoted` disposition
  standing against a classification that no longer exists. The `boundary` CTE therefore
  deliberately carries **no purpose filter**: one scientific-purpose correction row ends the
  round for both purposes, which is what makes A2's one-row answer sufficient.

  ```sql
  -- rebuild:begin
  WITH boundary AS (
      -- The most recent correction per observation. Deliberately unfiltered by
      -- purpose: a correction is recorded as a scientific decision but it
      -- invalidates the training disposition too, so one row ends the round for
      -- both. A second cause of invalidation is a second branch of this SELECT.
      SELECT observation_id, MAX(review_id) AS at_review_id
        FROM observation_reviews
       WHERE decision = 'corrected'
       GROUP BY observation_id
  ),
  latest AS (
      -- Last write wins. One DISTINCT ON, served by
      -- observation_reviews_observation_purpose_decided_idx.
      SELECT DISTINCT ON (r.observation_id, r.purpose)
             r.review_id, r.observation_id, r.purpose, r.decision, r.reason,
             r.reviewer_id, r.decided_at, r.observation_version
        FROM observation_reviews r
        LEFT JOIN boundary b ON b.observation_id = r.observation_id
       WHERE r.decision <> 'corrected'
         AND (b.at_review_id IS NULL OR r.review_id > b.at_review_id)
       ORDER BY r.observation_id, r.purpose, r.decided_at DESC, r.review_id DESC
  )
  SELECT review_id, observation_id, purpose, decision, reason,
         reviewer_id, decided_at, observation_version
    FROM latest
   WHERE decision <> 'withdrawn'
  -- rebuild:end
  ```

  **`review_id`, not `observation_version`, is the boundary token.** It is a gapless BIGINT
  sequence assigned by the database, strictly increasing, with no ties and no dependence on
  what else touched the observation row. A version boundary looked natural and is a trap: the
  version trigger fires only `WHEN (old.* IS DISTINCT FROM new.*)`, so a correction that
  changes nothing records a boundary at a version that never moves — invalidating every
  decision and admitting none, forever. `review_id` has no such failure mode, and R4 becomes a
  behavioural rule rather than a load-bearing one.

  **`decided_at DESC, review_id DESC` keeps the existing tie-break**, which matters more under
  last-wins than it did before: two decisions inside one clock tick are now ordinary rather
  than exceptional, and `review_id` is what makes the answer deterministic instead of
  planner-dependent.

- **2026-09-09 · D4 — The definition is superseded by a new migration; `20260909120200` is not
  edited.** Reasoning in *Does this need a migration?* above. The test consequence — find the
  current definition rather than hard-code a path — is R11.

- **2026-09-09 · D5 — Invalidation is not the same event as a race, and only one of them was
  overruled.** Worth writing down because #111 framed them as one question and they are not.
  A6 removes the race rule entirely. Invalidation survives A6 untouched: without it, a
  correction leaves the pre-correction `reviewed` row as the latest decision and the tile goes
  on reading *reviewed* for a classification that no longer exists. D3's boundary is that, and
  it is the only thing corrections add to what would otherwise be a bare `DISTINCT ON`.

- **2026-09-09 · D6 — Which boundaries this phase implements, and the shape the rest arrive
  in.** Subject to A5, which asks whether the rest are requirements at all. This phase
  implements **one**: a species correction.

  - **An observation-boundary change** (start or end frame) — identical shape: a decision row
    in the correction family, a second branch inside `boundary`. #68 records the set of triage
    corrections beyond species as unsettled, so it waits for that.
  - **A bounding-box keyframe added, removed or changed** — **a different shape, and this is
    the honest part.** A keyframe edit does not move `observations.version` at all, and it is
    not an act in the review log, so it can be neither a version boundary nor a `corrected`
    row without the annotation write path reaching into review data. #103 anticipated it
    differently: `reviewed_keyframe_count` and `reviewed_keyframe_max_updated_at` are recorded
    with every decision, and the predicate would be a *fingerprint comparison against live
    keyframe state* — a decision counts while the observation's current fingerprint still
    matches the one it recorded. That lands as a second predicate inside `latest`, not a second
    branch inside `boundary`. So `latest` is the extension point for both kinds and `boundary`
    for only one of them, and nothing about this phase forecloses either.
  - **Presentation-only changes** — invalidate nothing, and D3 gives that for free by not
    looking at the observation row at all.

- **2026-09-09 · D7 — The permission review, which is this phase's negative obligation.**
  #68: *"the schema and API must not couple those three operations in a way that prevents finer
  permissions later, since deletion in particular is likely to want its own."* Audited rather
  than asserted.

  **What is already uncoupled.** `routes/mosaic-commit.routes.js:60-62` declares
  `REVIEW_PERMISSION`, `TRAINING_PERMISSION` and `DELETE_PERMISSION` as three separate
  constants that happen to hold the same value, and `registerVersionedRoute` attaches
  `requirePermission` per route. The route layer is genuinely split: swapping one is one line.
  R12 preserves that by giving correction a fourth constant rather than reusing one.

  **What is coupled, and it is one thing.** `deniedObservationIds(principal, observationIds)`
  (`mosaic-commit.repository.js:329`) is the named seam for the per-observation authorization
  #68 asks for on a mixed-project request, and it is **one function shared by all three modes
  with no way to tell which is asking.** It returns `[]` today, so nothing is wrong; but a
  per-project delete rule cannot be expressed inside it without a parameter. R15.

  **What splitting deletion off costs today**, priced against the live catalogue: a new
  permission key seeded (one row in the existing seed migration's pattern, granted to nobody,
  so nothing breaks the day it lands); **project scope, which exists nowhere** — no project
  column on `user_permissions`, so a per-project grant is a migration and not a key, and
  `observations.project_id` is nullable, so a project-scoped rule needs an answer for "no
  project" before it can be written; the route's guard constant swapped; a real body for
  `deniedObservationIds`; and Delete Mode's gating in the client reading the new key.

  **The consequence this phase adds, and it should be visible.** Phase 5 recorded that anyone
  who can correct a species can also permanently delete. The correction route inverts the
  interesting direction: **anyone holding `observations:write` can now destroy any reviewer's
  approval, on any observation, in any project, by correcting a species.** That is what
  invalidation *is* and the log keeps the history — but it is a new power on an old key, and
  the `annotation-gui` token preset holds that key
  (`scripts/create-application-token.js:47-52`). R13 is why a *token* cannot reach this route;
  a person holding the key can.

## Five incompatibilities the client will meet

Recorded the way #105 recorded its three, because Phase 8's measurable claim is that nothing
above `api/` changes and these already break it. **Not fixed here** — `frontend/` is out of
scope for this phase.

1. **`setSpecies` sends no version** (`data.js:790`), and A3 requires one. `store.js:596` has
   the row in hand, so it is a small change in a known place.
2. **The fixture rewrites `comname`, `scientific_name` and `taxserial`** (`data.js:802-804`).
   All three are frozen by #111, so the fixture does not merely stand in for the endpoint, it
   contradicts it.
3. **`store.js:598` reads `res.observation.comname` as the new label**, and with `comname`
   frozen that value never changes — so the tile's *"was X → Y"* renders `was X → X`. A4 is
   the endpoint half of this.
4. **`tile.js:94-95` falls back to `row.previous_comname`**, a field the fixture invents on the
   row (`data.js:799`) and which no real row will carry.
5. **The fixture's species objects key on `species_id`** (`data.js:794`) while the real
   catalogue's primary key is `species.id`. In the picker's data rather than in this endpoint,
   but it belongs in the same list.

## Plan

Each step small enough to verify. The order is load-bearing at steps 2 and 3.

1. The migration widening `observation_reviews` (R6). `db/data-integrity.js` around it: it
   adds nullable columns and widens a constraint, so nothing should move, and the guard is what
   proves it.
2. The migration redefining "current" and dropping `first_decided_at` (R7, D3, D4). **After
   step 1**, because its rebuild reads a vocabulary step 1 creates.
3. `tests/observation-review-current.test.js` onto the current definition, with the mid-log
   invalidation case (R11). **Before the write path**, so the test that catches a half-change
   is in place while the half-change is possible.
4. Phase 5's write path brought into line (R10), and the merged tests listed in *Which merged
   tests change* rewritten to assert last-wins.
5. `repository/mosaic-correction.repository.js`: the transaction — lock, version check, no-op
   check, species lookup, `species_id` update, the log row, projection removal for both
   purposes. Beside the other two mosaic repositories, sharing their error shapes.
6. `routes/mosaic-correction.routes.js`: the HTTP surface, its own permission constant, the
   non-user refusal, and the OpenAPI operation with request and response schemas added to
   `docs/openapi.js` beside `MosaicCommitRequest`.
7. `deniedObservationIds` gains the operation parameter (R15) and its four call sites.
8. The refusal-case and coupling tests (R14).
9. `npm run docs:build`, then `npm test` in full.

## Acceptance criteria

- A species correction changes `species_id` and nothing else on the observation; `comname` and
  `taxserial` are byte-identical afterwards, asserted rather than assumed.
- After a correction, an observation that was `reviewed` is unreviewed for **both** purposes,
  and a **different** person can review it — the case that was impossible before this phase.
- Two reviewers committing the same observation both land in the log, and the projection holds
  the later decision. Nobody is refused for being second.
- The projection equals the derivation after every step of decide → correct → decide-as-
  somebody-else, and the committed rebuild SQL reproduces it exactly.
- A correction naming the current species writes nothing.
- Anonymous, under-permissioned and service-token callers are refused, and each of the four
  mosaic write routes reads its own permission constant.
- `npm test` is green in full, including `tests/jellyfin.test.js` locally, and
  `docs/openapi.generated.json` is rebuilt rather than hand-edited.

## Test plan

Filled in at G3, before anything is run, and reviewed by a human. `marp verify plan` writes the
first draft of `.marp/verification.md` from the requirements above, including the ones with no
test against them — which is the part worth looking at. Two constraints already known, both
recorded in R11 and R14 because each has cost a day here: **CI builds an empty database**, so
every test seeds its own observation and session with SQL rather than borrowing one; and **any
comparison of file content against a template literal normalises `\r\n` to `\n`**, because
ECMAScript normalises CRLF inside a template literal and `readFileSync` does not, so such a
test passes in CI and fails on Windows.

The tier that matters for this phase is Jest against the real development PostgreSQL. A
last-wins concurrency case, a mid-log invalidation case and a projection-equals-derivation
case are all meaningless anywhere else.

## Status

- **Gate:** design
- **Notes:** Five blocking assumptions answered by the human on 2026-09-09 — A1, A2, A3, A4
  and A6. **A6 is the large one**: it overrules first-valid-review-wins in two merged phases
  and is written up as its own piece of work, and it is the one that must become an ADR. A2
  and A4 were not in #111; they were found by working out what A1's answer and the frozen
  `comname` imply, and both were answered on the same day. **A5 was the last thing holding G2 and was answered on
  2026-09-09** — a relabel invalidates both purposes, and #68's other three material changes
  are deferred with the boundary shaped to take them later. It was asked rather than
  inherited because `AGENTS.md` now says a #68 requirement is checked rather than
  inherited, and *Invalidation* — which this phase's whole mechanism is built to satisfy — is
  exactly the kind of section that has already cost three phases an unwind. Nothing is
  implemented.

## Findings left alone

Named rather than fixed, per `AGENTS.md`.

- **The withdrawal lock-out is gone, but not because anybody fixed it.** Phase 5 recorded that
  *"a claimer who has withdrawn still owns the observation"* (`mosaic-commit.repository.js:41-
  46`). A6 removes claims altogether, so the latent issue evaporates rather than being
  addressed. Worth knowing, because the comment describing it is still in the file and will
  read as current until R10 rewrites it.
- **The mosaic read row still shows the pre-correction species name, and that is not fixed
  here.** A4 puts the corrected name in the *correction response*, which paints the tile for
  one session; the read row (`repository/mosaic.repository.js:147-163`) carries `o.comname` and
  no species join, so a reload shows the old animal's name again — while the species *filter*
  is `o.species_id`, so filtering by the new species returns a tile labelled with the old one.
  Adding the field to the read row is a change to Phase 4's row shape and belongs either here
  or in Phase 8; it needs a scoping call rather than a decision, which is why it is named here
  and not settled.
- **The mosaic cannot see that an observation was corrected.** By design — a correction never
  projects — so there is no *filter* for corrected-and-unreviewed. It would be an anti-join of
  the log against the projection rather than a projection lookup, so it is not free the way the
  existing status filters are. #68's workflow may want one.
- **`repository/observation.repository.js` `updateObservation` accepts a `comname` and
  propagates it to every keyframe** (lines 690-712). It is the pre-existing annotation write
  path and the GUI depends on it, so nothing about it is wrong; but it is the one route by
  which a caller can still rewrite the annotator's frozen label, and #111's *"`comname` is
  never rewritten"* is a rule this phase honours rather than a property the schema enforces.
- **`observations.version` moves on a change to any column** — `taxReview`, a size count,
  `updateddate`. So a page fetched before an unrelated edit gets `conflicted` today. Correct
  but blunt, and it will read as a false conflict to a reviewer. Relevant to A3 and not this
  phase's to change.
