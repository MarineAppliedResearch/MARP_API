# Verification — MARP_API#132 and #157

Run 2026-09-12, in the agent workspace `MARP_API--157-retire-fixture`, against its own
PostgreSQL and its own API port. The development corpus in the human's checkout was read
(one dump, read-only) and never written to; its thumbnails were counted before and after
and are unchanged.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `tests/thumbnail-storage.test.js` · *is storage/observation-thumbnails when nothing is set* | unit | the default is today's path exactly, so every existing checkout, CI and production are unaffected |
| R1 | `tests/thumbnail-storage.test.js` · *uses an absolute value exactly as given* | unit | an absolute setting is honoured, which is what the launcher passes |
| R2 | `tests/thumbnail-storage.test.js` · *resolves a relative value against the repository root, not the cwd* | unit | a `cd` cannot repoint the extractor at an empty directory |
| R1, R2 | `tests/thumbnail-storage.test.js` · *is what the dump and the load will use* | unit | `db/corpus.js` reads the value rather than holding a second copy of the path |
| R3 | `tests/corpus.test.js` · *asks the database, and ignores anything it is handed about files* | unit | the short circuit is gone: an empty database is loadable, a database with one row is not |
| R3 | `tests/corpus.test.js` · the three pre-existing `holdsCorpus` cases | unit | the refusal still fires on a corpus and still does not fire on a freshly built database |
| R3, R4, R5 | `node scripts/testing-database.js reset`, real run | database | a load into an empty database with 2,079 files beside it proceeds without `--force`, announces the orphans by count and directory, and verifies the round trip against the manifest |
| R6, R9 | `node scripts/testing-database.js up`, twice | database | first run `PROVISIONED`, second run `REUSED`, and the word is in the output |
| R7 | `refuseIfUnsafe` in `scripts/testing-database.js` | reasoning only | **no test — see *Requirements with no test*** |
| R8, R9 | `node scripts/test-on-testing-database.js`, real run | end to end | one command provisions or reuses, serves, signs in, runs the tier, and stops the server |
| R10 | `tests/api/affordances.spec.mjs` · *an aborted commit says Failed, changes nothing, and keeps the mark* | API browser | `failNextCommit`, replaced by `page.route().abort()` — and the "nothing was written" half is asserted against the server, not the screen |
| R10 | `tests/api/affordances.spec.mjs` · *a commit held open paints Saving, then lands* | API browser | `slowNextCommit`, replaced by a real response held 2.5 s then fulfilled |
| R10 | `tests/api/affordances.spec.mjs` · *a species corrected underneath the page conflicts rather than overwriting* | API browser | `bumpVersion`, replaced by a real correction between the read and the commit; the conflict **banner** is asserted, not the store |
| R10 | `tests/api/affordances.spec.mjs` · *an observation whose picture really failed still shows its species and stays markable* | API browser | `breakThumbnails`, replaced by data setup — the corpus carries fifteen genuinely failed thumbnails |
| R11 | `tests/api/render-slice.spec.mjs`, five checks | API browser | the render tier runs against a real database: settling, the species name a row actually carries, marking, server-side pagination, and all three modes |
| R12 | `npm run test:e2e` (desktop + phone) | fixture browser | the fixture-backed tier still passes; `?backing=fixture` and `src/data.js` are untouched |

**Why the tier in each case.** R1–R3 are decisions in pure functions, so they are at the
fast tier where they cost a second. R6–R9 are about idempotence against a real PostgreSQL,
which no unit test can observe — "it did not rebuild the second time" is only true of a
database that exists. R10 and R11 are about what a real server does and what the browser
then draws, which is the whole reason the tier exists.

## Real results, verbatim

### Fast tier — R1 to R3

```
npx jest tests/thumbnail-storage.test.js tests/corpus.test.js --runInBand --forceExit

  Test Suites : 2 passed, 0 failed, 2 total
  Tests       : 19 passed, 0 failed, 0 skipped, 19 total
  Result: ALL TESTS PASSED
```

**It failed first, and the failure is worth recording.** Every case reported the default
path regardless of the environment variable:

```
  ✗ THUMBNAIL_STORAGE_DIR > uses an absolute value exactly as given
      Expected: "C:\\...\\somewhere-else\\thumbs"
      Received: "C:\\...\\MARP_API--157-retire-fixture\\storage\\observation-thumbnails"
```

The cause was in the test, not the change: Jest gives each test file its own module
registry, and `delete require.cache[...]` does not touch it, so the module was never
re-read. `jest.resetModules()` is the fix and the reason is written into the helper.

### The provisioner — R3 to R7, R9

First run, on an empty `mare_test`:

```
==> creating mare_test
==> loading ..\..\MARP\MARP_API\.marp\local\corpus\20260912-085415
...
Round trip verified: every count matches the manifest.
==> migrations
==> reviewer login mosaic-testing

Testing database: PROVISIONED  (mare_test built from a dump)
  observations     2092
  reviews          495
  thumbnail files  2079

real    0m2.634s
```

Second run, unchanged inputs:

```
Testing database: REUSED  (mare_test was already there)
  observations     2092
  reviews          495
  thumbnail files  2079

real    0m0.259s
```

**2.6 s to build, 0.26 s to reuse — a factor of ten, and the word says which.**

`reset`, which is the case the old `holdsCorpus` refused — an empty database with 2,079
thumbnail files beside it:

```
Note: no rows here, but 2079 thumbnail files are on disk.
They are orphans -- nothing in mare_test names them -- and a load
replaces them. Their directory is C:\...\storage\testing\observation-thumbnails
(THUMBNAIL_STORAGE_DIR, or its default). If that is not the directory you
meant, stop now: the rows that name these files are in another database.

==> pg_restore <- ...\corpus.dump
    restored
==> thumbnails <- ...\observation-thumbnails
    2079 files
...
Round trip verified: every count matches the manifest.
```

**It failed first, and that failure was a real defect in `scripts/load-corpus.js`:**

```
Load failed: relation "public.SequelizeMeta" does not exist
```

`to_regclass` returns null at run time for a missing table, but the subquery beside it in
the same `CASE` is resolved at *parse* time — so the statement failed whichever branch
would have been taken. It never showed up because every previous target was a database
`marp db up` had already given a schema to. A genuinely empty one is what found it.

### The launcher and the API tier — R8 to R11

```
Testing database: REUSED  (mare_test was already there)
==> API on http://127.0.0.1:59852   (this run's own, stopped when it finishes)
signed in to http://127.0.0.1:59852 as mosaic-testing (user 2842)

Running 10 tests using 1 worker

  ✓   1 affordances.spec.mjs › R10: an aborted commit says Failed, changes nothing, and keeps the mark (810ms)
  ✓   2 affordances.spec.mjs › R10: a commit held open paints Saving, then lands (3.5s)
  ✓   3 affordances.spec.mjs › R10: a species corrected underneath the page conflicts rather than overwriting (709ms)
  ✓   4 affordances.spec.mjs › R10: an observation whose picture really failed still shows its species and stays markable (816ms)
  ✓   5 render-slice.spec.mjs › R11: the mosaic renders and stays settled (739ms)
  ✓   6 render-slice.spec.mjs › R11: a tile names the species the row actually carries (805ms)
  ✓   7 render-slice.spec.mjs › R11: marking a tile draws it marked and the page count moves (765ms)
  ✓   8 render-slice.spec.mjs › R11: the pager moves, and page two is not page one (1.2s)
  ✓   9 render-slice.spec.mjs › R11: every mode renders against a real query (1.7s)
  ✓  10 take-back.spec.mjs › R8: a recorded take-back stops saying TAKING BACK (456ms)

  10 passed (12.1s)

The API tier passed, against a real server on the testing database.
```

**Four failures on the way there, and every one of them was the tier doing its job** —
each is something the fixture agrees with itself about:

1. *`Cannot read properties of undefined (reading 'review_decision')`.* Two tests isolated
   "the species with exactly one observation" and got the *same* observation, in parallel;
   one corrected its species while the other was re-reading it. Fixed by running the `api`
   project on one worker. **The fixture cannot have this defect** — it lives in the
   browser, so every test has its own copy.
2. *`locator('.tile[data-id="1978"]') — element(s) not found`.* The page number was swept
   at `filters: {}`, but a bare address carries `reviewStatus: ['unreviewed', 'flagged']`,
   so the browser was asking a different question. Fixed by merging over the app's own
   `DEFAULT_FILTERS`.
3. The same failure again, now because the sweep used page size 45 while the running app
   had settled on 50 — *page size follows the viewport*. Fixed by asking the store.
4. *`Received string: "tile out-reverted"`.* The first tile on the default page already
   carried a decision, so clicking it is a take-back rather than a mark. Fixed by choosing
   the row on what the endpoint says about it.

### The fixture tier is untouched — R12

```
npm run test:e2e        # desktop + phone, MARP_API_BASE unset

  1 failed
    [phone] › tests\e2e\render.spec.mjs:2527:3 › the filter rail, cleaned up › L5: time and date take one rail row each
  5 skipped
  294 passed (2.1m)
```

That one failure re-run on its own:

```
npx playwright test --project=phone -g "L5: time and date take one rail row each"
  ✓  1 [phone] › ... L5: time and date take one rail row each (1.0s)
  1 passed (2.2s)
```

Flaky under parallel load at phone width, and **not caused by this change**: with
`MARP_API_BASE` unset the config resolves to `fullyParallel: true, workers: 6`, which is
exactly what it was, and nothing in `tests/e2e/`, `src/ui/` or the stylesheets was touched.

### The rest of the repository

```
npm run test:mosaic
  Test Suites : 6 passed, 0 failed, 6 total
  Tests       : 233 passed, 0 failed, 0 skipped, 233 total

npm run test:core
  Test Suites : 11 passed, 1 failed, 12 total
  Tests       : 199 passed, 2 failed, 0 skipped, 201 total
  ✗ the fork stayed a diff > every unchanged file is byte-identical to docdash
  ✗ the fork stayed a diff > the forked jsdoc.css is upstream truncated, not upstream edited
```

Both failures are in `tests/docs-branding.test.js`, which compares `docs/developer-theme/`
against `node_modules/docdash`. Neither is in this branch's diff, so the failure cannot be
this change's. Pre-existing in this workspace and reported, not fixed.

### The development corpus is intact

```
storage/observation-thumbnails            (this workspace, development)  2079
storage/testing/observation-thumbnails    (this workspace, testing)      2079
MARP/MARP_API/storage/observation-thumbnails  (the human's checkout)     2079
```

## Requirements with no test

- **R7** — the refusal when the testing database name equals the development one. The
  guard is three comparisons in `refuseIfUnsafe` and the only way to exercise it for real
  is to point a provisioning run at the development database, which is the one thing it
  exists to prevent. It is reachable and worth a test; doing it properly means extracting
  the decision into a pure function the way `holdsCorpus` already is, so that a unit test
  can ask it without a database. **Named rather than quietly skipped.**

## Edge cases

- **A truly empty database has no `SequelizeMeta`.** Found by running one; see the load
  failure above. Every previous target had a schema.
- **A dump older than the branch.** The provisioner runs `db:migrate` after the restore,
  which is a no-op today because the dump is level with `migrations/`. It will not always
  be, and the failure it prevents arrives from deep inside a query during a browser test.
- **A newer dump on disk than the one loaded.** Reported and not acted on (A5). Reloading
  by surprise would throw away whatever a run had set up.
- **An orphaned thumbnails directory.** Permitted since R3, and announced by count and by
  directory, because the person reading is the one who knows whether an empty database is
  a surprise.
- **The login already exists.** `create-review-user.js` is idempotent, and the password is
  carried forward from the stamp rather than regenerated, so a `reset` does not invalidate
  a session state somebody is holding.

## Regression coverage

- `tests/corpus.test.js` · *asks the database, and ignores anything it is handed about
  files* — pins the reversal. It replaces a case asserting the opposite, and it passes a
  file count anyway so that a re-introduced short circuit fails rather than being ignored.
- `tests/thumbnail-storage.test.js` · *is storage/observation-thumbnails when nothing is
  set* — the default moving is the failure that would take production's pictures out of
  service while leaving every row in place.
- `playwright.config.mjs` · one worker on the API — pins the collision described above.

## Known gaps

- **231 browser checks have not moved.** Five have. `tests/e2e/render.spec.mjs` (148
  declarations) and `tests/requirements.js` (80) still run on the fixture, and `src/data.js`
  and `?backing=fixture` are deliberately still there (R12).
- **The phone viewport is not in the API project**, by design — the tier is about what is
  written and read back. Layout stays on the fixture tier for now.
- **`marp db load` in the umbrella does not set `THUMBNAIL_STORAGE_DIR`**, so a load
  reached with `-Port` writes into whichever directory `.env` names. The umbrella is a
  different repository and was not changed.
- **`tests/api/take-back.spec.mjs` queries with raw filters** rather than over the app's
  defaults, so its page numbering agrees with the browser only by luck. It passes today.
  Not changed — another agent is working in that file.
- **The API tier is not in CI** and must not be: it needs a server, a database and a login.
- **The testing database accumulates `observation_reviews` rows.** Restoring a decision
  through the API appends to the log rather than erasing it, which is correct and means
  the count grows a few rows per run. `testing-db reset` is the answer if it ever matters.
