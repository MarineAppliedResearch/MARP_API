# Verification plan — MARP_API #167: pending and recorded decisions

Issue: https://github.com/MarineAppliedResearch/MARP_API/issues/167

## What is being tested

Issue #167 reports that a pending choice and the committed decision look alike. The first implementation dimmed only committed exceptions; user testing rejected both parts of that treatment. The corrected change applies to flags, reviews, exclusions, promotions, and taking back. Pending work uses a 3px outline; recorded decisions use a 1px outline in the same established color and solid/dashed pattern. Scientific and Training imagery remains unfiltered.

The browser must observe the rendered outline and unchanged image filter while the API confirms each decision. A store or model test cannot prove either visible treatment or persistence, and the retired fixture cannot faithfully represent the difference between a commit outcome and the unchanged row already displayed by the real API.

## Requirement coverage

| Requirement | Scenario | Evidence required |
| --- | --- | --- |
| R1/R2 | Start with one ready, undecided observation. Mark an exception, then separately mark an acceptance, without committing. | FLAGGED, REVIEWED, EXCLUDED, and PROMOTED each have one badge, lack `recorded`, use a 3px outline, and leave the image filter `none`. |
| R2 | Press Commit Marked for each pending choice. | The real response succeeds, the API reads back the expected decision, the same tile gains `recorded`, the outline becomes 1px, and the image filter remains `none`. |
| R3 | Reload after each successful commit. | The page is API-backed; each existing decision remains `recorded`, has one primary badge, uses a 1px outline, and leaves the image filter `none`. |
| R4 | Inspect the image before marking, while pending, after committing, and after reload. | Its computed filter is `none` at every Scientific and Training state. |
| R5 | Click each reloaded committed tile once, then again. Separately abort a real commit request and create a real observation-version conflict. | TAKING BACK lacks `recorded` and uses 3px; canceling restores `recorded` and 1px and disables Commit Marked because nothing remains pending. Failed and conflicted marks remain pending at 3px and do not reach the record. |
| R6 | Inspect every pending, committed, reloaded, and take-back state above. | Each tile has exactly one `.badge`; mark > outcome > record precedence remains visible and a borrowed `.rtag` never becomes the primary badge. |
| R7 | Run all four decisions at desktop and phone viewports. Review the Delete selectors in the diff. | Eight successful-transition cases pass. Delete's destructive filter and treatment are unchanged; no Delete action is executed. |

## Real-API data setup and restoration

The runner uses this workspace's disposable `marp_test`, never `mare_v1`. `npm run testing-db status` reports the target and source dump. If the isolated workspace has no dump of its own, set `MARP_CORPUS_DUMP` to the newest existing local dump before provisioning; do not copy an environment path into tracked documentation.

Each successful-transition test discovers a species and line containing exactly one ready observation. It captures that row's original mode decision and reason, withdraws the decision through the API to establish the pending baseline, and restores the original decision and reason in `finally`. IDs and filters are discovered on every run. Append-only review-history rows remain in the disposable testing copy by design.

The existing failure and conflict tests already restore the row or species they touch. The conflict is produced through the correction API rather than by editing the database.

## Commands, in order

From the issue workspace repository root, after provisioning or reusing `marp_test`:

1. `npm run test:app:mosaic-review:api -- decision-state.spec.mjs`
   - Eight cases: Scientific and Training, exception and acceptance, at desktop and phone viewports.
   - Proves pending and recorded border weights, unchanged imagery, API persistence, reload behavior, take-back/cancel behavior, and one-badge precedence.
2. `npm run test:app:mosaic-review:api -- affordances.spec.mjs -g "an aborted commit|a species corrected"`
   - Two existing real failure paths with new #167 assertions.
   - Proves aborted and conflicted marks stay visually pending at 3px.
3. Run `git diff --check` and `marp spec check`.

Every browser command starts its own API on a free port, signs in with the narrow testing reviewer, uses one worker, and stops that API afterward.

## What is not covered

- No whole-suite or narrated walkthrough run; those belong to the end-of-phase gate and the human's call.
- No visual-regression screenshot threshold. The test asserts the browser's computed outline width and image filter exactly, which observes this CSS behavior without making unrelated pixels part of the contract.
- No Delete commit is performed. Delete's selector and destructive dimming are outside the changed rules and are reviewed in the diff.
- No production or development corpus is read or written.

## Results

Verified against the isolated `marp_test` database. The API runner reused the populated copy, started its own API on an operating-system-selected port, used one browser worker, restored each decision in `finally`, and stopped its API after each command. The review server remained available on port 3012 and returned HTTP 200 after verification.

| Run | Result |
| --- | --- |
| Decision-state real-API browser cases | 8 passed, 0 failed, 0 skipped (10.0s) |
| Aborted-request and species-conflict cases | 2 passed, 0 failed, 0 skipped (2.1s) |
| `git diff --check` | Passed; only existing Windows line-ending notices |
| `marp spec check` | Passed: 5 assumptions answered, 7 requirements, clear |

### Passing browser output

```text
Running 8 tests using 1 worker

  ok 1 [api] › tests\api\decision-state.spec.mjs:29:9 › #167 desktop › scientific: a pending exception becomes a lighter recorded decision (1.3s)
  ok 2 [api] › tests\api\decision-state.spec.mjs:29:9 › #167 desktop › scientific: a pending acceptance becomes a lighter recorded decision (1.2s)
  ok 3 [api] › tests\api\decision-state.spec.mjs:29:9 › #167 desktop › training: a pending exception becomes a lighter recorded decision (1.2s)
  ok 4 [api] › tests\api\decision-state.spec.mjs:29:9 › #167 desktop › training: a pending acceptance becomes a lighter recorded decision (1.2s)
  ok 5 [api] › tests\api\decision-state.spec.mjs:29:9 › #167 phone › scientific: a pending exception becomes a lighter recorded decision (1.1s)
  ok 6 [api] › tests\api\decision-state.spec.mjs:29:9 › #167 phone › scientific: a pending acceptance becomes a lighter recorded decision (1.1s)
  ok 7 [api] › tests\api\decision-state.spec.mjs:29:9 › #167 phone › training: a pending exception becomes a lighter recorded decision (1.2s)
  ok 8 [api] › tests\api\decision-state.spec.mjs:29:9 › #167 phone › training: a pending acceptance becomes a lighter recorded decision (1.1s)

  8 passed (10.0s)

The API tier passed, against a real server on the testing database.
```

```text
Running 2 tests using 1 worker

  ok 1 [api] › tests\api\affordances.spec.mjs:54:3 › what the fixture used to fake › R10: an aborted commit says Failed, changes nothing, and keeps the mark (854ms)
  ok 2 [api] › tests\api\affordances.spec.mjs:151:3 › what the fixture used to fake › R10: a species corrected underneath the page conflicts rather than overwriting (720ms)

  2 passed (2.1s)

The API tier passed, against a real server on the testing database.
```

### Failures retained

The first command was refused before starting an API or browser because the live review server's local `.env` deliberately points at the disposable database:

```text
Refused: the testing database and the development database are both "marp_test".

Nothing has been changed. A testing database is a second database --
give it a different name with MARP_TESTING_DB_NAME, or point DB_NAME at
the development one. `marp db status` says which is which.
```

The rerun supplied `DB_NAME=mare_v1` only to the launcher as its comparison value. The launcher continued to override its child API with `DB_NAME=marp_test`; no process connected to the development database.

That run then reached the temporary API and authenticated, but the sandbox refused Playwright's worker process before any test case ran:

```text
Running 8 tests using 1 worker

Error: spawn EPERM
    at ChildProcess.spawn (node:internal/child_process:421:11)
    at spawn (node:child_process:796:9)
    at Object.fork (node:child_process:174:10)
    at WorkerHost.startRunner (frontend\apps\marp-mosaic-review\node_modules\playwright\lib\runner\index.js:1899:49)
```

The identical approved command passed when allowed to spawn the local worker. Neither setup failure is claimed as a product result.

## Files touched

- `.marp/task.md`: corrected scope, requirements, decisions, and gate state.
- `.marp/verification.md`: approved plan, actual results, failures, and coverage limits.
- `frontend/apps/marp-mosaic-review/src/ui/tile.js`: one derived `recorded` state for every Scientific and Training decision.
- `frontend/apps/marp-mosaic-review/src/store.js`: canceling a take-back clears the stale pending touch.
- `frontend/apps/marp-mosaic-review/styles/app.css`: 3px pending and 1px recorded outlines; Scientific and Training decision dimming removed.
- `frontend/apps/marp-mosaic-review/tests/api/decision-state.spec.mjs`: real-API coverage for both modes, both decision kinds, both viewports, reload, take-back, cancel, and image visibility.
- `frontend/apps/marp-mosaic-review/tests/api/affordances.spec.mjs`: pending-state assertions for aborted and conflicted commits.

No generated files, API contracts, schema, dependencies, or Delete Mode behavior were changed.

## Status

- **Gate:** G4 verification complete and accepted by the human.
- **Next:** The human authorized commit, push, pull-request creation, and merge for issue #167.
