# Verification — MarineAppliedResearch/MARP_API#106

Phase 5, the page commit. The plan was written from the requirements in `.marp/task.md`
before the run; the results below are appended verbatim, including what failed on the way.

#105's verification is not gone: it was renamed to `.marp/verification-105-mosaic-query.md`
in the same commit as this file, the same way #103's was renamed when #105 arrived. Three
phases sit unmerged on this branch, so each phase's evidence has to survive while this file
stays what a reader and the harness find for the phase in flight.

**The tier that matters here is the HTTP tier against a real PostgreSQL**, and four of the
requirements are observable at no other tier: the concurrent claim, the version conflict,
the withdrawal's `CHECK`, and the delete cascade. A unit test on a repository method cannot
see any of them — it cannot see two transactions racing, it cannot see a constraint refuse a
value, and it cannot see what four foreign keys did on the way out. Everything runs through
`npm test`, never `npx jest`, because the suite shares one PostgreSQL and `package.json`
passes `--runInBand` for that reason.

**The database holds one observation.** Every test seeds its own rows, committed rather than
in a rolled-back transaction, because an HTTP request cannot see an uncommitted one. Nothing
is benchmarked and no number is claimed: one row answers "fast" to every question. Cleanup
is asserted rather than assumed — `afterAll` counts what is left under this run's marker and
throws if it is not zero, because a previous phase left fixtures behind and a cleanup that
silently removed nothing looks exactly like a cleanup that worked.

## What each test proves

`tests/mosaic-commit.test.js` unless another file is named.

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | *are served under /api/v2/ and nowhere else* | http+db | All three answer at `/api/v2/mosaic/observations/{review,training,delete}`, and the declared path is `404` — so the prefix was derived by `registerVersionedRoute` and not written by hand beside it, which would have got the URL and lost the permission wrapper. |
| R2 | *accepts what is unmarked and flags what is marked* | http+db | The marks are the exception set: unmarked rows are accepted, marked rows are flagged with their reason. |
| R2 | *promotes on the training route and leaves the scientific decision alone* | http+db | The same request shape on the training route, and the two purposes are independent decisions. |
| R2, R18 | *destroys only the marked observations and their dependents* | http+db | Delete inverts the rule: the marked row goes, the unmarked one is untouched. |
| R3 | *keys every entry by observation_id, never by id or by position* | http | Every response entry is found by `observation_id`; the fixture's `id` key is not what the endpoint emits. |
| R4 | *answers conflicted with reason version…* and *gives the record to the first reviewer…* | http+db | The two causes of a conflict are told apart by reason: `version` for the annotation moving, `claimed` for another reviewer getting there first. |
| R4 | *gives the record to the first reviewer and reports the second* | http | The conflict entry names no reviewer — showing who belongs to the read path, under the key that gates identity. |
| R5 | *reports a flag that takes back an acceptance in flagged and reverted both* | http | The arrays are not a partition: one id, two arrays. |
| R5 | *destroys only the marked observations…* | http | A delete request's unmarked id appears in **none** of the five arrays. |
| R5 | *skips an id that is no longer an observation, and skips it for that reason only* | http+db | `skipped` carries `not-found` and nothing else. No test asserts an imagery skip, because this phase cannot produce one. |
| R6 | *accepts what is unmarked and flags what is marked* | http | `atomicity` is `per-observation` — a value, so a later change is expressible without a rename. |
| R7 | *answers conflicted with reason version, and writes no log row for it* | db | The log row and the projection change are one unit: the refused observation has neither. Its enforcement is the invariant check in the write path, which rolls the request back rather than leaving a log row unprojected. |
| R8 | *answers conflicted with reason version…* | http+db | Ineligibility rolls nothing back: the conflicted row comes back conflicted while the rest of the page lands. |
| R9 | *require observations:write, and seed no new permission key* | http+db | A caller holding nothing gets `403` on all three; a caller holding only `observations:write` gets `200`; and the catalog has no key matching mosaic, review or delete. |
| R10 | — | — | No test. See *Requirements with no test*. |
| R11 | *gives the record to the first reviewer and reports the second* | http+db | First valid review wins: the second reviewer is `conflicted: claimed`, the reviewer and `first_decided_at` do not move, and the second decision is **not** in the log. |
| R11 | *lets the claiming reviewer revise without moving first_decided_at* | http+db | The claiming reviewer may revise; `decided_at` moves and `first_decided_at` does not. |
| R11 | *lets two reviewers hold the two purposes independently* | http+db | The claim is per `(observation_id, purpose)`, not per observation. |
| R11, R12 | *serializes two commits arriving together, and logs only the winner* | http+db | Two commits genuinely in flight together over the same observation: exactly one log row, exactly one projection row, and they agree on the reviewer. **Proved to be observable**: with the row lock removed this is the one test that fails. |
| R13 | asserted at the end of eight tests | db | The projection equals the `-- rebuild:` derivation read off the committed migration, after a version conflict, after a losing claim, after a concurrent commit, after a revision, after a withdrawal, and after a delete. |
| R14 | *leaves no projection row and every decision* | http+db | A withdrawal deletes the projection row — the `CHECK` refuses `withdrawn` there, so a delete is the only legal expression of it — and the log still holds `reviewed`, `flagged`, `withdrawn` in order. |
| R14 | *refuses to withdraw a decision another reviewer owns* | http+db | It deletes only when the withdrawing reviewer owns the row. |
| R15 | *fingerprints the annotation server-side at decision time* | http+db | The keyframe count and `max(keyframes."updatedAt")` on the log row are what the database held, computed server-side; the client is not asked for them. |
| R16 | *fingerprints the annotation server-side at decision time* | db | `representative_keyframe_id` is `NULL`, recorded as owed to Phase 6 rather than guessed. |
| R17 | four tests under *the request is refused rather than guessed at* | http | An unknown reason is a `400`; a training reason on the review route is a `400`, because the vocabularies differ; any reason on delete is a `400`, because a delete records none. |
| D1 | *rejects an absent version rather than overwriting silently* | http | An absent version is a `400`, never an implicit overwrite. |
| D1 | `tests/mosaic-query.test.js` *the row shape (R13) is exactly the agreed key set* | http+db | The version is in the mosaic row, which is the only channel that can carry it to the client. |
| R19 | *conflicts a stale delete rather than destroying the row* | http+db | A delete is conditional on the version, and a row that moved is still there afterwards. |
| R20 | *destroys only the marked observations and their dependents* | http+db | What the delete removes, named and counted: the observation, its keyframes, its `dataset_observations` membership, its log rows and its projection row. What it does not remove, counted in the same query: the dataset, the session, the project, and the unmarked observation. |
| R21 | `npm run docs:build` | build | The generated contract carries the three routes under `/v2/`, the two new schemas, and `version` on `MosaicRow`. |
| R22 | the whole suite | http+db | `npm test`, through `tests/setup/authenticated-agent.js`, against the real development PostgreSQL. |
| R23 | `git diff --stat` | review | No migration, no permission key, nothing under `frontend/`. |
| D2 | *answers conflicted with reason version, and writes no log row for it* | db | **The decisive one.** A refused decision leaves no log row, so the derivation cannot make that reviewer the earliest claimant and a rebuild cannot resurrect a decision the server refused. |
| D2 | *gives the record to the first reviewer and reports the second* | db | The same rule for the claim cause: the losing reviewer's decision is reported, not recorded. |
| D3 | *leaves no projection row and every decision* | http+db | The explicit `withdraw` list is what expresses a withdrawal, and it is accepted on review and training. |
| D3 | *rejects a withdrawal on the delete route* | http | And refused on delete, which records no decision to take back. |
| D4 | *answers 403 on all three routes and writes nothing* | http+db | A bearer token holding exactly `observations:write` gets `403` on all three, no log or projection row exists, and the observation it asked to destroy is still there. The token is granted the permission first, so the refusal is provably about the principal and not about the key. |
| D6 | *emits no UPDATE or DELETE against observation_reviews* | source | The write path is append-only by construction, and this fails the moment somebody adds one. No trigger, because the table's cascade from `observations` means "nothing is ever deleted" is already false by design. |

## Requirements with no test

- **R10 — per-observation authorization.** `deniedObservationIds()` returns an empty array in
  this phase and cannot return anything else: all three routes take `observations:write`,
  which the route has already required, and no scoped key exists to consult. A test would
  assert that a function returns `[]`, which proves nothing about authorization — it is the
  *place* that is required now, not behaviour. **The test that belongs here arrives with the
  scoped key**, and it will be a mixed-project request where some observations are denied and
  the rest still commit.
- **R8's unexpected-failure half.** That an unexpected failure rolls the whole request back is
  a property of `db.sequelize.transaction`, and provoking one honestly — killing a connection
  mid-statement, forcing a deadlock — is a test that either needs a second live connection
  harness or a mock that no longer exercises the real thing. The invariant check inside the
  write path is the part that is asserted, indirectly, by the tests that pass through it.

## Edge cases

Each traces to a defect or to a reading of a settled decision:

- **A page where one row conflicts and the rest land.** The whole reason for
  per-observation outcomes, and the case a whole-page rollback would make unreachable.
- **A flag that replaces an acceptance.** The fixture pushes the same entry into `flagged`
  *and* `reverted` (`data.js:769`), so the arrays are not a partition and the test asserts
  the duplication rather than tidying it away.
- **A delete request's unmarked ids.** They appear in no array at all (`data.js:746`). Asserted
  as absence from all five, because absence is exactly the thing an assumption glosses over.
- **A training reason sent to the review route.** The two vocabularies differ and neither is a
  superset, so a route that accepted the other's list would write a reason nothing can query.
- **A withdrawal with nothing to withdraw.** Logged as nothing, reported as `withdrawn`. If it
  were logged, the derivation would make that reviewer the earliest claimant of an observation
  nobody has decided, and lock every other reviewer out of it permanently.
- **A withdrawal of somebody else's decision.** `conflicted: claimed`, and their decision
  untouched.
- **An id deleted between the fetch and the commit.** `skipped: not-found` on review and on
  delete both — the same condition, the same reason, so a client does not need two rules.

## Regression coverage

- **The concurrency test was proved to be able to fail.** The lock was removed from
  `lockObservations` and the suite re-run: *serializes two commits arriving together, and logs
  only the winner* failed and nothing else did, so the test observes the race rather than
  narrating it. The lock was restored and the suite re-run green. This is recorded because a
  concurrency test that passes for the wrong reason is indistinguishable from one that works.
- **Cleanup is counted, not assumed.** `afterAll` throws if any observation carrying this run's
  marker survives. A previous phase in this repository left fixtures behind, and the failure
  mode is a cleanup that ran and removed nothing.
- **`observations.version` is asserted unchanged** after a review and a training commit, and
  `model/observation.model.js` is untouched, so `tests/observation-version.test.js` still holds.

## Known gaps

Stated plainly, because a gap that is written down is a decision.

- **No measurement.** One observation. Nothing here says anything about a page of 600 rows over
  a production-sized table, and the row lock in particular is unmeasured: it is correct, and how
  long it holds under real concurrency is not known.
- **The imagery rule is not tested and cannot be.** The server makes no imagery judgement until
  Phase 6, so no test asserts a skip for it. Deliberate: a test that cannot fail is worse than
  no test.
- **`skipped` for imagery, and the `no-imagery` reason, are Phase 6's.**
- **The client cannot yet drive any of this.** `marks` is a `Map` and `excludeIds` a `Set`, and
  neither survives `JSON.stringify`; the fixture keys its entries `id` where the endpoint
  returns `observation_id`; and `applyCommit`/`marksAfterCommit` do not know `conflicted`, so a
  conflicted tile would draw no badge and lose its mark. All three are Phase 8's, and nothing
  here touches `frontend/`.
- **A withdrawal reserves the observation for its withdrawer, permanently.** That follows from
  the settled derivation rather than from a choice made here, and it is not covered by a test
  asserting it is *desirable* — only by tests asserting the projection stays equal to the
  derivation. Named in the report for a human's decision.
- **CI runs this suite**, so CI green is not the same as this verification: the whole suite was
  run locally, which is where the Jellyfin tests are also observable.

## Results — 2026-09-09

Run on the local development PostgreSQL 18.6, with Node 24.11.1 (see *What surprised the
run* — the pinned 22.22.1 is not installed on this machine).

### `npm test -- tests/mosaic-commit.test.js`

```
[mosaic-commit.test.js] the mosaic page commit (#106) > the routes (R1, R9, D5) > are served under /api/v2/ an…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the routes (R1, R9, D5) > require observations:write, …... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > a service token is refused before any write (D4) > ans…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the page commit (R2, R3, R5, R6) > accepts what is unm…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the page commit (R2, R3, R5, R6) > keys every entry by…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the page commit (R2, R3, R5, R6) > promotes on the tra…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the page commit (R2, R3, R5, R6) > reports a flag that…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the page commit (R2, R3, R5, R6) > skips an id that is…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the request is refused rather than guessed at (D1, R17…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the request is refused rather than guessed at (D1, R17…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the request is refused rather than guessed at (D1, R17…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the request is refused rather than guessed at (D1, R17…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the request is refused rather than guessed at (D1, R17…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the request is refused rather than guessed at (D1, R17…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the request is refused rather than guessed at (D1, R17…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the request is refused rather than guessed at (D1, R17…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > a version conflict is reported and not recorded (D1, D…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > a version conflict is reported and not recorded (D1, D…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > first valid review wins (R11, R13) > gives the record …... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > first valid review wins (R11, R13) > lets the claiming…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > first valid review wins (R11, R13) > lets two reviewer…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > first valid review wins (R11, R13) > serializes two co…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > a withdrawal deletes the projection row and keeps the …... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > a withdrawal deletes the projection row and keeps the …... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > a withdrawal deletes the projection row and keeps the …... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > what the log row records (R15, R16) > fingerprints the…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > what the log row records (R15, R16) > does not write o…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > delete (R18, R19, R20) > destroys only the marked obse…... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > delete (R18, R19, R20) > skips an id that has already …... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > delete (R18, R19, R20) > deletes nothing when nothing …... PASS
[mosaic-commit.test.js] the mosaic page commit (#106) > the log is append-only by construction (D6) > emits no…... PASS

  Test Suites : 1 passed, 0 failed, 1 total
  Tests       : 31 passed, 0 failed, 0 skipped, 31 total
  Duration    : 1.6s

  Result: ALL TESTS PASSED
```

### `npm test` — the whole suite

```
  Test Suites : 35 passed, 0 failed, 35 total
  Tests       : 348 passed, 0 failed, 0 skipped, 348 total
  Duration    : 24.7s

  Result: ALL TESTS PASSED
```

Run locally, so the 17 in `tests/jellyfin.test.js` are included — CI excludes them by name
and cannot tell you they broke.

### The deliberate failure, to prove the concurrency test can see the race

`FOR NO KEY UPDATE` removed from `lockObservations`, everything else unchanged:

```
Test: [mosaic-commit.test.js] the mosaic page commit (#106) > first valid review wins (R11, R13) > serializes two co…... FAIL

  Tests       : 30 passed, 1 failed, 0 skipped, 31 total
  Result: FAILURES DETECTED — see below
  ✗ the mosaic page commit (#106) > first valid review wins (R11, R13) > serializes two commits arriving together, and logs only the winner
```

One test failed and only that one, which is what makes it a test of the lock rather than a
narration of it. The lock was restored and the suite re-run: 31 passed.

### Cleanup, counted afterwards

After the runs above — including the deliberately failed one — the database is back to what
it started as:

```
{"obs":1,"jest_obs":0,"rev":0,"cur":0,"kf":8,"sess":0,"proj":0,"ds":0,"usr":0,"apps":0}
```

One observation, eight keyframes, no review rows, and no fixture sessions, projects,
datasets, users or applications left behind.

### `npm run docs:build`

The generated contract carries the three routes and the two schemas:

```
/v2/mosaic/observations/pages
/v2/mosaic/observations/counts
/v2/mosaic/observations/review
/v2/mosaic/observations/training
/v2/mosaic/observations/delete
MosaicRow has version: true
MosaicCommitRequest: true MosaicCommitResult: true
```

Each of the three carries `observations:write` in its description, a documented `403`, and
both security schemes.

**`jsdoc` reported four pre-existing errors**, all in
`frontend/apps/marp-mosaic-review/src/model/schedule.js` (#99), where a `@param` and a
`@returns` write a destructured object where a type expression is expected. The config runs
`--lenient`, so the build completes; the errors are not caused by this phase and are not
fixed by it.

## What surprised the run

- **Node is 24.11.1 on this machine, not the pinned 22.22.1**, and nvm-windows is not
  installed at all — `C:\nvm4w` does not exist. `AGENTS.md` and the umbrella's `CLAUDE.md`
  both describe the nvm setup as current. The suite is green on 24.11.1; the documentation is
  what is stale. Not changed here, because it is an environment fact for a human to settle.

## Status

- **Gate:** G4 complete, evidence recorded. G5 — the pull request — is the human's.
