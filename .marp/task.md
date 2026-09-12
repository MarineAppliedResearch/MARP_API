---
task: MarineAppliedResearch/MARP_API#132
repos: [marp-api]
status: design
needs: []
---

<!--
  Covers two issues, in order: #132 is the mechanism, #157 is the migration that
  needs it. #157 is deliberately only started here -- see R10 and R11 -- because
  proving the mechanism is worth more than moving 231 checks before it is proven.
-->

## Goal

Running the mosaic reviewer's browser tests against a real MARP API is one command, and
the first time it runs it builds itself a testing database from a corpus dump and stops
doing so afterwards. Today it is impossible: one checkout has exactly one thumbnails
directory, hardcoded, so a development database and a testing database in the same
checkout are forced to share it and loading either one deletes the other's pictures. Once
storage is per-database, a second database is just a second database, and the browser tier
can be moved onto it -- which is what #157 exists for, and why 231 checks currently grade a
fixture that cannot be wrong the way the endpoint is.

## Requirements

### #132 -- the mechanism

- **R1** -- The thumbnail storage directory is configurable, as an environment variable
  beside the five `DB_*` ones, documented in `.env.example`. Unset, it is exactly what it
  is today (`storage/observation-thumbnails`), so every existing checkout, CI and
  production are unaffected.
- **R2** -- A relative value is resolved against the repository root, not the working
  directory. `dotenv` already resolves `.env` against the working directory and that has
  cost time here; a storage path that moves with `cd` would be the same trap with the
  corpus behind it.
- **R3** -- `holdsCorpus` asks the database whether the database is occupied. Thumbnail
  files no longer short-circuit it, so a provably empty second database is loadable
  without `--force`.
- **R4** -- The file count stays in the load's report and in the round-trip check against
  the manifest. R3 removes it from the *refusal*, not from the evidence.
- **R5** -- A load into an empty database that nevertheless has thumbnail files on disk
  says so, naming the count it is about to replace. R3 makes that case proceed; it must
  not make it silent.
- **R6** -- One command provisions a testing database: it creates the database, restores a
  corpus dump into it, puts that dump's thumbnails in the testing database's own storage
  directory, and creates the reviewer login the browser tier signs in with. Idempotent --
  run twice, the second run changes nothing.
- **R7** -- That command refuses when the testing database name is the same as the
  development one in `.env`. The whole point is that they are two databases; a
  configuration that makes them one must fail rather than load a dump over the corpus.
- **R8** -- One command runs the mosaic reviewer's API-tier browser tests: it provisions
  per R6 if needed, starts an API against the testing database on a port nobody else
  holds, runs the tests, and stops the server it started.
- **R9** -- Its output says which of the two happened -- *provisioned* or *reused* --
  without the reader having to infer it from how long it took.

### #157 -- the migration, started and proved

- **R10** -- The four fixture affordances have real-server equivalents, and each is
  demonstrated by at least one test in `tests/api/`:
  `failNextCommit` and `slowNextCommit` become `page.route()` on the commit endpoint --
  aborted, and fulfilled after a delay; `bumpVersion` becomes a real write to the testing
  database between the read and the commit; `breakThumbnails` becomes data setup against
  rows whose thumbnail genuinely failed.
- **R11** -- A small representative slice of `tests/e2e/render.spec.mjs` runs in the API
  project against the testing database and passes, proving the mechanism end to end for
  the rest of the migration.
- **R12** -- Nothing in this change deletes `src/data.js` or the `?backing=fixture` flag,
  and the fixture-backed `desktop`/`phone` projects keep working exactly as they do now.
  The remaining migration is described, not performed.

## Open assumptions

- [ ] **A1 - architectural** -- The testing database is a second **database** inside
  whatever PostgreSQL `DB_*` already points at (default name `mare_test`), not a second
  PostgreSQL cluster on its own port. #132's reopening comment says *"a second database on
  its own port"*, and a port was the only isolation available while storage was shared.
  With R1 done, a second name isolates just as completely, needs no second cluster, and
  keeps standing clusters up in the umbrella where `marp db up` lives -- which this task
  may not change. **A second cluster still works** and costs nothing to choose: point
  `DB_PORT` at it and the same command runs. Not blocking: the design supports both, and
  R7 is the guard that matters either way.
- [ ] **A2 - security/permissions** -- The provisioning command creates a reviewer login in
  the testing database and writes its generated password to `.marp/local/`, which is
  git-ignored. Without that, "one command" is two: create a user, then run. Recommendation
  as described; it honours `MARP_REVIEW_USERNAME`/`MARP_REVIEW_PASSWORD` when they are
  already set. Not blocking.
- [ ] **A3 - environment** -- The dump is found as the newest directory under this
  checkout's git-ignored `.marp/local/corpus/`, overridable with `MARP_CORPUS_DUMP`, and
  its absence is a loud failure naming `marp db dump` rather than an invented dataset.
  There is no separate curated test corpus and none is being created. Not blocking.
- [ ] **A4 - environment** -- The API the launcher starts binds an ephemeral free port
  rather than a fixed one. Nothing outside needs to know the number -- the launcher hands
  it to Playwright as `MARP_API_BASE` -- and a fixed port is how a browser run once graded
  a different checkout for an hour. Not blocking.
- [ ] **A5 - behavioural** -- When the dump on disk is newer than the one the testing
  database was built from, the command **says so and reuses anyway**. Re-loading by
  surprise would throw away whatever a test run had set up, and a stale corpus is a
  judgement rather than an error. `--reset` reloads deliberately. Not blocking.

No blocking assumption is open. Two are worth a sanity check rather than an answer, and
they are A1 and A2.

## Decisions

- **2026-09-12** -- Thumbnail files stop making a database "occupied" for the purposes of
  refusing a load. Taken from #132's reopening comment, which is the human's own
  reading: *"holdsCorpus then asks the database whether the database is occupied, which is
  what it was always trying to ask."* The guard was standing in front of the missing
  per-database storage; R1 removes what it was guarding. The information does not go away
  -- R4 keeps the count in the report and in the round-trip check, and R5 makes the newly
  permitted case announce itself.
- **2026-09-12** -- The launcher owns the API server's lifetime rather than Playwright's
  `webServer`, because `webServer` is deliberately disabled whenever `MARP_API_BASE` is
  set and that flag is what selects the API project at all.
- **2026-09-12** -- #157 stops after R10 and R11. The remaining 231 checks are a
  mechanical migration whose cost is knowable only once one slice has actually run, and
  moving them before the mechanism is proved risks moving them twice.

## Plan

1. `config/thumbnails.js`: `STORAGE_DIR` reads `THUMBNAIL_STORAGE_DIR`, resolved against
   the repository root when relative. `.env.example` documents it beside `DB_*`. (R1, R2)
2. `db/corpus.js`: `holdsCorpus` stops consulting the file count. `tests/corpus.test.js`
   changes with it -- the test asserting the old short-circuit is the behaviour being
   reversed, so it is rewritten rather than deleted. (R3)
3. `scripts/load-corpus.js`: keep the count in both reports, and warn about orphaned files
   in the newly permitted empty-database case. (R4, R5)
4. `scripts/testing-database.js`: provision, status, reset. Idempotent, refuses R7.
5. `scripts/test-on-testing-database.mjs`: the launcher. Provision if needed, start an API
   on a free port, run the API project, stop the server. Root npm script. (R8, R9)
6. `tests/api/`: one spec per affordance, against the testing database. (R10)
7. A representative slice of the render tier, in the API project. (R11)
8. Documentation: the repository's `AGENTS.md` under *The corpus, and how to copy it*, and
   the app's `CLAUDE.md` under *The API tier*. Minimal edits -- another agent owns several
   sections of that file right now.

## Acceptance criteria

- `THUMBNAIL_STORAGE_DIR` unset reproduces today's path exactly; set, the extractor, the
  serving route, the dump and the load all use it.
- A load into an empty second database succeeds with no `--force`, and the development
  corpus's thumbnails are byte-identical afterwards.
- The launcher's first run provisions and its second run reuses, says which, and the
  second is seconds rather than minutes.
- Every affordance in R10 has a passing test against a real server.
- The fixture-backed `desktop` and `phone` projects still pass unchanged.

## Test plan

Written in full at G3 in `.marp/verification.md`. Tiers: `tests/corpus.test.js` and a new
`tests/thumbnail-storage.test.js` at the fast tier for R1-R3; `scripts/testing-database.js`
exercised for real against this workspace's PostgreSQL for R6-R9, since idempotence is not
observable without a database; `tests/api/` in a real browser for R10 and R11.

## Not covered

- The 231 checks in `tests/e2e/render.spec.mjs` and `tests/requirements.js` beyond the
  slice in R11. Described, not migrated.
- Deleting `src/data.js`, the `?backing=fixture` flag, and the unit tier's dependency on
  the fixture.
- `marp db load`'s umbrella wrapper. It sets `DB_*` as real environment variables and does
  not set `THUMBNAIL_STORAGE_DIR`, so it reads the value from `MARP_API/.env` -- correct
  for the development database and wrong for a testing one reached with `-Port`. Named in
  the report; the umbrella is a different repository.
- The server-side Jest suite. It runs against whatever `.env` says, as it always has.
