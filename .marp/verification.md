# Verification — MARP_API #157: retire the Mosaic fixture

This is the approved G3 verification package and its recorded G4 evidence.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | Every `tests/api/render-*.spec.mjs` check, at both configured API viewports | browser + API + database | The former render suite still asserts the rendered behavior it asserted before, but the rows, counts, decisions, thumbnails, and failures now come through the real API. |
| R2 | Every `tests/api/requirements-*.spec.mjs` check, at both configured API viewports | browser + API + database | The former requirements suite still exercises the review rules through the shipping browser/API boundary rather than through `src/data.js`. |
| R3 | Playwright project inventory and the complete API browser run | configuration + browser | Both desktop and phone projects run; neither viewport was removed to make the migrated tier faster. |
| R4 | `tests/api/affordances.spec.mjs`; static absence checks for `src/data.js`, `backing=fixture`, and fixture-only tools/assets | browser + review | Network failures and version races are exercised through the real client path, and no application or URL flag can select the deleted backing. |
| R5 | `npm run test:unit` from `frontend/apps/marp-mosaic-review` | parse + unit + wire | Every surviving model rule parses and passes; wire assertions still test serialised API bodies; rules formerly hidden inside the fixture were either retained in model/API tests or removed with their subject. |
| R6 | `tests/api/journal.mjs` self-checks during the browser run, plus the launcher’s before/after projection digest | browser + API + database | Tests restore the current-review projection they changed; a failed restoration fails the run instead of contaminating the next check. Append-only history growth is reported separately and is not mistaken for damaged current state. |
| R7 | The destructive checks using `tests/api/seed.mjs` and the journal’s delete refusal | browser + API + database | A deletion may reach the real endpoint only for observations that the test created and explicitly allowed; an attempt against a borrowed corpus row fails naming the ids. |
| R8 | Documentation/source consistency checks in the unit/parse tier, plus review of `CLAUDE.md`, `README.md`, package scripts, VS Code tasks, and launch configuration | unit + review | Instructions name the single real backing and the testing-database command; no supported command or document directs a browser check to the fixture. |

The complete browser command also runs the API-backed checks merged after this branch was
created: account-menu behavior (#166), committed decision appearance (#167), and selective
page completion (#137). It also runs #172's decision-details suite, including the four
rendering checks that #172 originally added to the now-deleted fixture tier. This is
required because #157 has now incorporated current `origin/develop` and those checks share
the files changed by the fixture retirement.

## Requirements with no test

None. R8 includes a human diff review because prose accuracy is not completely observable
from runtime behavior, but the deleted names and supported commands also have mechanical
checks.

## Commands, in order

Run only after the human approves this plan.

1. `git diff --check origin/develop...HEAD`
   - Expected: no conflict markers or whitespace errors.
2. `npm run test:unit` from `frontend/apps/marp-mosaic-review`
   - Expected: parse, model, request-serialisation, row-shape, cache, URL, and scheduling
     checks all pass with no skipped test silently replacing a fixture-dependent assertion.
3. `npm run test:subsystems` from the repository root
   - Expected: every Jest suite belongs to exactly one subsystem.
4. `npm run test:mosaic` from the repository root
   - Expected: the targeted Mosaic API, schema, commit, correction, facet, and thumbnail
     suites pass against the local database and restore every row they create or change.
5. `npm run test:app:mosaic-review:api` from the repository root
   - Expected: the launcher provisions or reuses the assigned testing database, starts its
     own API, runs every Mosaic browser check once at desktop and once at phone width with
     one worker, restores current review state, and stops what it started.
6. `npm run test:app:mosaic-review:api -- -g "affordance"` only if the complete run does
   not make the four replacement-affordance results individually visible.
   - Expected: abort, delay, real version conflict, and real failed/seeded thumbnail states
     are each exercised without a fixture backing.
7. `git diff --check origin/develop...HEAD` again after recording results.

The full repository suite is not part of this plan. The task changes the Mosaic subsystem
and its application browser tier; the repository’s testing doctrine assigns the whole suite
to an end-of-phase run requested by the human.

## Edge cases

- **A page begins with recorded exceptions.** Migrated marking checks open on the
  undecided question or discover a fresh tile, so a click cannot silently become a
  take-back merely because the copied corpus already contains decisions.
- **The corpus changes between runs.** Tests discover species, dives, lines, pages,
  confidence cuts, and page sizes from the API. No test pins an id or row count that was
  true on one machine.
- **Desktop and phone address different page sizes.** Tests ask the running store for the
  page size rather than assuming the fixture’s value.
- **A commit finishes during another action.** Tests wait for the resulting state or hold
  the real request with Playwright routing; they do not depend on the fixture’s invented
  latency.
- **A correction changes page membership.** The journal captures the original species
  immediately before the real correction and restores both review dimensions afterwards.
- **A test is interrupted.** The after-each journal must still attempt restoration, and a
  later before/after digest must expose anything left in the current-state projection.
- **Permanent deletion cannot be undone.** Only rows seeded by that test may be deleted;
  every other delete is rejected by the harness before it reaches the API.
- **Thumbnail states absent from the copied corpus.** The test seeds the missing state and
  removes it afterwards rather than rewriting a real endpoint response.
- **A second backing is reintroduced later.** Every browser check asserts
  `data-backing="api"`, even though the fixture is now absent.

## Regression coverage

- #130 and Phase 8 findings F6/F8: the fixture’s row shape concealed differences between
  the observation’s original fields and the API’s current species/reviewer fields.
- #135: fixture commits rewrote row status locally, so take-back behavior passed while the
  API-backed page sweep restored the decision.
- #137: selective commit completion is exercised after returning to the page.
- #166: application menus remain usable after the branch incorporates current `develop`.
- #167: pending and recorded decisions remain visually distinct on the real row returned
  after a commit.
- #172: reasons, notes, reviewer attribution, confidence treatment, overlay transparency,
  and the phone details viewport are exercised through real persisted decisions rather
  than through fixture row mutation.
- The journal’s previous pagination defect: restoration must read every affected page and
  leave the current-review digest unchanged.

## Known gaps

- This plan does not benchmark production scale. That belongs to Phase 9 in #68.
- It does not run a real Jellyfin extraction. Thumbnail lifecycle rows and already-created
  image bytes are exercised; hardware/media extraction remains outside this browser task.
- `observation_reviews` is append-only and therefore grows when a browser check makes and
  withdraws decisions. The current projection and observations are restored; erasing the
  audit history would violate its data meaning.
- The testing database is built from the newest local corpus dump. If no usable dump exists,
  the launcher must fail with the missing prerequisite rather than skip the browser tier.
- No narrated walkthrough is included. Walkthroughs are recorded only when the human asks
  and are not verification evidence.

## Manual steps

No manual application judgment is required to prove #157. The task changes which backing
the automated browser suite grades, not the intended appearance or interaction.

After the automated run, inspect its summary for all of the following:

- both API viewport projects ran;
- the backing assertion passed;
- the launcher reports whether the testing database was provisioned or reused;
- current-review state was restored successfully;
- no process started by the launcher remains running.

---

## Results

Run on 2026-09-13 on `157-retire-fixture`, after merging current `develop` and #172.

- `git diff --check`: passed. Git reported only the repository's existing LF-to-CRLF
  checkout warnings; it found no whitespace errors.
- `npm run test:unit`: passed. All 68 source files parsed and all 278 unit checks passed.
  The first sandboxed attempt falsely reported parse failures because the sandbox denied
  the child processes used by the parser; the same command outside that restriction passed.
- `npm run test:subsystems`: passed. All 52 Jest suites belonged to exactly one subsystem.
- `npm run testing-db -- reset`: passed and rebuilt the disposable testing database from
  its corpus dump, including the #172 note migration. `npx sequelize-cli db:migrate` also
  brought the disposable development database up to the branch schema. The browser
  launcher's reuse of the older test database had first failed with `column rc.note does
  not exist`; that failure is why the database-refresh rule was added to `AGENTS.md`.
- `npm run test:mosaic`: passed: 7 suites, 248 checks, no failures. An earlier run exposed
  an intermittent concurrency check whose final projection disagreed with its derived
  history; the named check passed when rerun alone, and the complete Mosaic group then
  passed. No unrelated concurrency implementation was changed in #157.
- The API browser tier exercised every spec at both configured viewports against the real
  server and disposable testing database. Assertions made stale by merged #166, #167 and
  #172 were aligned with their delivered behavior, then their affected files passed:
  decision-details overlays 2/2, colour 14/14, mark/account behavior 2/2, and mosaic panel
  behavior 24/24. The remaining 348-case segment reported 340 passes, 7 intentional
  viewport/production-depth skips and one intermittent phone geometry failure; that exact
  geometry check immediately passed at both viewports (2/2). No production CSS was changed
  for a failure that could not be reproduced.
- The launcher stopped each API process it started and its before/after journal checks did
  not report damaged current-review state. The append-only test history grew as documented;
  resetting the disposable testing database remains the way to discard that test history.

Not covered, as planned: production-scale performance, live Jellyfin extraction, production
`mare_v1`, and a narrated walkthrough. Those are not evidence for fixture retirement.
