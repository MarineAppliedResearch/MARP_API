# Verification — MARP_API#125, dump and load the development corpus

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `marp db dump` against the development database | database | a dump file is written, and `pg_restore -l` lists a `TABLE DATA` entry for every table in the schema — not a subset |
| R2 | the same run, with thumbnails on disk | database + filesystem | the file half is carried: the dump directory holds the same number of JPEGs as `storage/observation-thumbnails` |
| R3 | `marp db load` into a second database on its own port | database | it loads into a running server rather than standing one up, and the target is chosen by `DB_*` alone |
| R4 | `marp db load` at the corpus, no flags; then again with `-Apply` and no `-Force` | database | both refuse, exit 1, and the counts afterwards are unchanged |
| R4 | `tests/corpus.test.js` → `holdsCorpus` | unit | the refusal fires on one row in any corpus table and on a thumbnail file with no row, and does **not** fire on a database `marp db up` has just built |
| R5 | `marp db load` with no flags into an empty second database | database | it reports what it would do and writes nothing; a second read shows the database still empty |
| R6 | `marp db load` with a **deliberately doctored** manifest | database | the mismatch is named per table and the exit code is 1 — the check has teeth rather than narrating |
| R6 | `tests/corpus.test.js` → `compareCounts` | unit | a missing table is a difference, and a table the manifest never knew is not |
| R7 | `psql` count of `users`, `auth_identities`, `service_tokens`, `permissions`, `user_permissions` in the loaded database | database | the credential rows arrived, so *load and go* holds |
| R8 | `marp harness check` | contract | no tracked file names a host, a port or a password; the manifest is checked by reading it |
| R9 | `.marp/local/corpus-dump.md` after a dump | filesystem | the pointer exists, is git-ignored, and carries the load command |

**Why the database tier for most of it.** A dump that cannot be loaded is the defect this
work exists to prevent, and no unit test can observe it: it lives in `pg_dump`'s output
format, in `pg_restore --clean` against a database that already has a schema, and in
whether the counts come back. Only a real second database can see any of that. The two
decisions that *are* observable without one — the refusal and the count comparison — were
deliberately put in `db/corpus.js` so they could be tested there.

## Requirements with no test

None. R1–R9 each have a row above.

## Edge cases

- **A load into a database that `marp db up` has just built.** The case that would have
  broken silently: a fresh database is not an empty one — the baseline seeds `species` and
  `permissions`, and the bootstrap migration puts an administrator in `users`. A refusal
  keyed on "any row anywhere" would fire on every fresh database and teach people to pass
  `-Force` by reflex.
- **A load over a populated database, with `-Force`.** `pg_restore --clean --if-exists`
  has to drop 40 tables and 4 views in dependency order and put them back. Run, and the
  counts matched.
- **A dump whose manifest disagrees with what loaded.** Forced by hand, because it cannot
  be produced on purpose any other way.
- **A dump taken while an inference run is writing.** Observed rather than contrived: the
  counts rose between two dumps taken minutes apart. A snapshot of a moving target loads
  consistently — `pg_dump` is transactional — but it is a snapshot, and that is recorded in
  the manifest's `taken` timestamp.
- **A thumbnails directory with nothing in it.** The dump creates the directory anyway, so
  `load` always has something to be pointed at and a corpus with no tiles yet is not a
  special case.

## Regression coverage

- `tests/corpus.test.js` → *says no to a database marp db up has just built*. Nothing had
  broken yet; this is the refusal's own failure mode, written down before it could.
- `CORPUS_TABLES against the schema`. A table name misspelled in that list is invisible to
  every pure test in the file — `countCorpus` reports it absent and `holdsCorpus` reads
  absent as empty, so the refusal would quietly stop protecting that table. Only the schema
  can see it, which is why one test in this file talks to a database.

## Known gaps

- **`species_pictures`, `artifacts` and `gpu_artifacts_staging` point at files under
  `storage/` too, and those files are not carried.** The interface settled in #125 is two
  inputs — a dump and a thumbnails directory — so that is what was built. `species_pictures`
  is a pre-existing gap rather than one this introduces: `marp db up` already restores those
  rows on a fresh database without the images. Recorded as A6 in `.marp/task.md`.
- **CI gets nothing from this**, deliberately and as #125 says. A dump on one machine is
  invisible to a runner, and the rule that a test seeds what it asserts does not relax.
- **No test covers a dump between two different PostgreSQL major versions.** Both sides of
  every run here were the same server.
- **The POSIX path was exercised on Git Bash on Windows, not on Linux or macOS.** Argument
  parsing, the refusal and the flag wording were all confirmed there; `locate_postgres` on
  a Linux machine takes a different branch and was not run.
- **`marp db dump` was not run on a machine without `pg_dump`.** The message for that case
  is written but untested.

## Manual steps

The round trip cannot be automated in this repository's suite: it needs a second
PostgreSQL, and the suite must never be pointed at the one holding the corpus.

1. `marp db dump` — note the directory it reports.
2. `marp db up -Port <n> -DataDirName <name>` — a second database, its own port and its own
   data directory.
3. `marp db load <dump> <thumbnails-dir> -Port <n> -DataDirName <name>` — expect a dry-run
   report and nothing written.
4. The same with `-Apply` — expect *Round trip verified: every count matches the manifest*.
5. `marp db load` at the first database with `-Apply` and no `-Force` — expect a refusal,
   exit 1, and the counts unchanged.
6. `marp db down -Port <n> -DataDirName <name>` when finished. **Stop what you start.**

---

## Results

Run 2026-09-11, against the development corpus for the read side and a second database on
its own port for every write. **Nothing was ever loaded into the corpus.** A GPU inference
run was writing throughout, which is why the counts differ between the first two entries.

```
marp db dump                                        EXIT=0   0.56 s
  2 projects, 10 sessions, 1 ml_models, 1322 observations, 17846 keyframes,
  1322 observation_thumbnails, 219 observation_reviews, 61 gpu_jobs, 0 thumbnail files
  corpus.dump 1.3 MB
  pg_restore -l: 40 TABLE DATA entries, i.e. every table in the schema, users and
  service_tokens among them
```

The first run reported 0 thumbnail files, correctly: it ran in a worktree whose
git-ignored `storage/` was empty. The tool copies from the checkout it runs in, which is
the right behaviour and was the wrong rig. Thumbnails were placed in that checkout's
`storage/` and the dump retaken.

```
marp db dump                                        EXIT=0   0.89 s
  2 projects, 10 sessions, 1 ml_models, 1346 observations, 17998 keyframes,
  1346 observation_thumbnails, 219 observation_reviews, 61 gpu_jobs, 1339 thumbnail files
  corpus.dump 1.4 MB, manifest.json written, .marp/local/corpus-dump.md written

marp db load <dump> <thumbs>                        EXIT=1   (R4 — at the corpus)
  Refused: this database already holds a corpus, and a load replaces it.
  Nothing has been changed.

marp db up -Port <n> -DataDirName <name>            EXIT=0   12.4 s
  baseline 23 tables / 4 views, then every migration; no corpus in it

marp db load <dump> <thumbs> -Port <n> ...          EXIT=0   (R5 — dry run)
  In it now: 0 for all eight corpus tables, 0 thumbnail files
  Dry run -- nothing written.

marp db load <dump> <thumbs> -Port <n> ... -Apply   EXIT=0   1.34 s
  Loaded: 2 projects, 10 sessions, 1 ml_models, 1346 observations, 17998 keyframes,
  1346 observation_thumbnails, 219 observation_reviews, 61 gpu_jobs, 1339 thumbnail files
  Round trip verified: every count matches the manifest.
```

Read back independently, with `psql` against the loaded database rather than through the
tool that wrote it — 40 tables, 4 views, 32 migrations recorded, `users` 33,
`auth_identities` 1, `service_tokens` 12, `permissions` 27, `user_permissions` 4, `species`
854, `observation_review_current` 209. Every one of those matches the corpus. R7 holds:
the loaded database can be logged into and its tokens authenticate.

```
marp db load ... -Apply           (no -Force, target now holds a corpus)   EXIT=1   (R4)
  Refused: this database already holds a corpus, and a load replaces it.

marp db load ... -Apply -Force    (over that populated database)           EXIT=0
  Round trip verified: every count matches the manifest.

marp db load <doctored manifest> ... -Apply -Force                         EXIT=1   (R6)
  The load does not match the dump:
    keyframes: expected 18003, got 17998
    thumbnail files: expected 1337, got 1339
  Do not treat this dump as a backup until that is understood.
```

The manifest was edited by hand for that last run — keyframes up five, thumbnail files
down two — because a check that only ever sees matching counts has never been shown to be
able to fail.

The POSIX wrapper was run too, on Git Bash: `sh scripts/marp.sh db load <dump> <thumbs>
--port <n> --data-dir <name>` produced the identical refusal, exit 1, with the flags spelled
`--force` and `--port` rather than `-Force` and `-Port`.

```
npm run test:subsystems                             0.4 s   ok, every suite in one group
npx jest tests/corpus.test.js                       2.2 s   14 passed, 1 suite passed
npm run test:core                                   8.0 s   8 suites passed, 53 passed
marp harness check                                  ok      shared blocks in sync;
                                                            no stale environment facts,
                                                            no credentials
node scripts/harness/spec-check.mjs                 ok      clear to implement
```

`test:core` ran against the *loaded* second database rather than the corpus, which is worth
saying twice: it is also incidental evidence for R7, since those suites authenticate and
write through the API against a database that came entirely out of a dump.

One failure, found and fixed, recorded because it is the kind that reads as something
else: `tests/corpus.test.js` first reported **`Test Suites: 1 failed`, with all 14 tests
passing.** An `afterAll` closing the Sequelize connection ran before
`tests/setup/authenticated-agent.js`'s own `afterAll`, which then failed deleting its
fixture user — `ConnectionManager.getConnection was called after the connection manager was
closed!`, thirty lines into a file this change does not touch. The `afterAll` was removed;
`--forceExit` is what `npm test` passes for exactly this.

### Not done

The umbrella's `CLAUDE.md` warning that #125 asks to edit down — *"do not run `marp db
destroy` … there is no backup"* — **was not edited.** It is not on `origin/develop`, which
this branch is based on: it lives on an unpushed local commit on the umbrella's `develop`.
Editing it from here would mean writing the section from scratch onto a base that does not
have it, and conflicting with that commit. It is also the human's call, because the dump
taken here proves the tooling and is **not the real dump** — the corpus was being written to
throughout.
