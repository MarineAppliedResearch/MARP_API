# Verification plan - MARP_API #137: Commit Marked page completion

Issue: https://github.com/MarineAppliedResearch/MARP_API/issues/137

## Problem and agreed outcome

Committing all tiles with Commit Marked saves their decisions but leaves the page uncoloured and its completed-page count at zero. Completion must depend on every tile having a committed decision, whether in one commit or several. Partial or refused work stays incomplete. Delete Mode stays unchanged. Selective commits do not pin rows or page membership.

## Current baseline and test system

The task branch is based on origin/develop at a3a7990a (through merged #165). The user authorized updating to the pushed testing changes, provisioning the test database and beginning testing. This replaces the earlier fixture-only plan.

New browser tests use tests/api/, a real API and this workspace's separate `marp_test` database built from the existing local corpus dump. Provisioning verified 2,092 observations, 29,666 keyframes, 2,092 thumbnail rows and 2,079 thumbnail files against the dump manifest. The runner selects a free API port, runs one browser worker, and stops its API afterward. Settings and credentials stay local and untracked. The human's development database is not the test target.

## Cases and expected results

| Case | Actions | Assertions |
| --- | --- | --- |
| Original report, R1/R4 | Discover a final page of 2-8 ready observations; clear its decisions through the API; mark all and Commit Marked. | Count is zero before save and one after; all selected decisions are read back from the real API. Move to the preceding page: completed chip has the done class and a different computed colour. |
| Multiple commits, R1/R2 | Commit the first half; then the remainder. | First commit leaves count zero and untouched decisions null. Second commit makes count one. Pager class/colour shows completion. |
| Marks alone, R1/R2 | Mark the selected tiles, without committing yet. | Count remains zero, including when every tile is marked. |
| No selective pins, R3 | Inspect membership pins and held rows after each selective commit. | Both collections remain empty; re-reading the same API query returns the expected rows, including the still-undecided half. |
| Sweep regression, R4 | Reset the short page, load fresh, use Review page or Promote page. | Save succeeds and the completed-page count/chip/colour are correct. |
| Real failed request, R2 | Existing affordance test aborts the browser's actual commit request. | Error UI remains correct, decision is unchanged on the server, completion count is zero. |
| Real version conflict, R2 | Existing affordance test corrects species through the API between page read and commit. | Conflict UI appears and completion count remains zero; existing finally restores species. |
| Rule edge cases, R1/R2/R5 | Evaluate incremental outcomes, existing decisions, another mode's decision, conflict, withdrawal, refused/null outcome and an empty page. | Only complete successful decisions in the active mode return true; later refusals override earlier decisions. |

The new completion tests run Scientific and Training review at desktop and phone viewports: eight browser cases, with the sweep check included in each one-batch case. The failure/conflict cases use their existing desktop API tests.

## Data restoration

The short-page tests capture the original decision and reason of every row they may touch. Setup and commits happen inside try/finally; finally restores decisions via the API and asserts the decision/reason values match the original. IDs, species, line and page size are discovered on each run, not hard-coded. Review-history entries remain by the API's existing append-only design, in the testing copy only.

## Commands and sequence

From the repository root:

1. `node --test --test-name-pattern="#137" frontend/apps/marp-mosaic-review/tests/unit/model.test.mjs`
2. Prove the original bug with just the desktop Scientific one-batch browser case, temporarily substituting develop's store.js from a saved copy and restoring our implementation in finally.
3. `npm run test:app:mosaic-review:api -- page-completion.spec.mjs`
4. `npm run test:app:mosaic-review:api -- affordances.spec.mjs -g "an aborted commit|a species corrected"`
5. If green, run the existing take-back file because develop's #135 changes overlap this commit path: `npm run test:app:mosaic-review:api -- take-back.spec.mjs`.

No whole-suite run or walkthrough. Each command's real output is retained locally; results and failures are recorded below.

## Limits

These checks prove the specified rule, real commit persistence and rendered completion. They do not test navigating during a commit, a broad concurrent-review workload, every mode/filter combination, or the entire application. Delete Mode is deliberately unchanged and its full suite is not part of this run. Restoration preserves current decisions and reasons, not a history with no evidence the tests ever ran.

## Results

Verified against freshly fetched origin/develop a3a7990a. HEAD and origin/develop had zero commits of divergence before the issue commit.

| Run | Result |
| --- | --- |
| Focused #137 model file selection | 3 passed, 0 failed, 0 skipped (53.5ms) |
| Original-bug tripwire using develop store.js | Failed as expected: completed count stayed 0 after all rows were saved |
| Real-API completion file, desktop and phone | 8 passed (21.9s) |
| Real aborted-request and species-conflict cases | 2 passed (2.1s) |
| Existing real-API take-back file | 8 passed (4.5s) |
| git diff --check | Passed |
| marp spec check | 2 assumptions answered; 5 requirements; clear to implement |

All eight completion tests reached and passed their finally restoration assertions. The runner reused the testing database and stopped its API after every run. No whole suite was run.

### Failures retained, including test setup failures

After the rebase, the first testing-database provisioning command found no dump because the isolated workspace's corpus directory was empty. Nothing was changed. Re-running with `MARP_CORPUS_DUMP` pointed at the existing verified dump provisioned `marp_test` and passed the manifest round-trip checks.

The first post-rebase model invocation failed before loading tests because the sandbox refused Node's test-worker spawn with `spawn EPERM`. The identical command passed when allowed to spawn its local worker. This is recorded as an environment failure, not a product result.

The first tripwire attempt did not reach the completion assertion: the setup queried without status filters while the browser URL reapplied default statuses. Fixed by spelling out the same status selections in both queries. Its assertion output was:

```text
Error: expect(received).toEqual(expected) // deep equality
- Expected  - 6
+ Received  + 0
```

The command displaying that saved log also failed with a Python Windows console encoding error. The implemented store had already been restored in finally; the saved log was read with explicit UTF-8 afterward. No test result was inferred from the console error.

The corrected tripwire then failed on the actual reported bug:

```text
Error: expect(locator).toHaveText(expected) failed
Locator:  locator('#pagesDone b').first()
Expected: "1"
Received: "0"
Timeout:  7000ms
```

The first run against the implementation passed all four desktop cases, but failed all four phone cases in setup. The phone's initial layout changed the requested page while adjusting page size. Fixed by loading and settling first, then navigating with the page-number input before asserting exact membership. Its first assertion output was:

```text
Error: expect(received).toEqual(expected) // deep equality
- Expected  -  5
+ Received  + 15
```

The second run of all eight cases passed. These setup failures are not claimed as evidence of the product bug.

### Earlier evidence files

Full command output from the pre-rebase run is retained in this workspace's git-ignored .marp/local/. The authoritative post-rebase results are the table above.

- 137-model-results.txt
- 137-red-results.txt (first setup failure)
- 137-red-results-2.txt (actual regression on develop)
- 137-api-results.txt (desktop pass / phone setup failure)
- 137-api-results-2.txt (8 passing completion cases)
- 137-refusal-results.txt (2 passing refusal cases)
- 137-take-back-results.txt (8 passing take-back cases)

### Passing test output


137-model-results.txt

```text
✔ #137 R1-R2: scientific completion requires every row committed (1.2984ms)
✔ #137 R1-R2: training completion requires every row committed (0.075ms)
✔ #137 R1: existing decisions count only in their own mode (0.0624ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 53.5475
```

137-api-results-2.txt

```text
  ok 1 [api] › tests\api\page-completion.spec.mjs:124:9 › #137 desktop › scientific: every tile committed in 1 batch(es) completes the pager (3.6s)
  ok 2 [api] › tests\api\page-completion.spec.mjs:124:9 › #137 desktop › scientific: every tile committed in 2 batch(es) completes the pager (2.2s)
  ok 3 [api] › tests\api\page-completion.spec.mjs:124:9 › #137 desktop › training: every tile committed in 1 batch(es) completes the pager (3.4s)
  ok 4 [api] › tests\api\page-completion.spec.mjs:124:9 › #137 desktop › training: every tile committed in 2 batch(es) completes the pager (2.2s)
  ok 5 [api] › tests\api\page-completion.spec.mjs:124:9 › #137 phone › scientific: every tile committed in 1 batch(es) completes the pager (2.9s)
  ok 6 [api] › tests\api\page-completion.spec.mjs:124:9 › #137 phone › scientific: every tile committed in 2 batch(es) completes the pager (2.0s)
  ok 7 [api] › tests\api\page-completion.spec.mjs:124:9 › #137 phone › training: every tile committed in 1 batch(es) completes the pager (3.0s)
  ok 8 [api] › tests\api\page-completion.spec.mjs:124:9 › #137 phone › training: every tile committed in 2 batch(es) completes the pager (1.9s)
  8 passed (21.9s)
```

137-refusal-results.txt

```text
  ok 1 [api] › tests\api\affordances.spec.mjs:54:3 › what the fixture used to fake › R10: an aborted commit says Failed, changes nothing, and keeps the mark (826ms)
  ok 2 [api] › tests\api\affordances.spec.mjs:148:3 › what the fixture used to fake › R10: a species corrected underneath the page conflicts rather than overwriting (730ms)
  2 passed (2.1s)
```

137-take-back-results.txt

```text
  ok 1 [api] › tests\api\take-back.spec.mjs:71:1 › R8: a recorded take-back stops saying TAKING BACK (592ms)
  ok 2 [api] › tests\api\take-back.spec.mjs:153:5 › #135 R8: in scientific, clicking a committed accepted takes it back (469ms)
  ok 3 [api] › tests\api\take-back.spec.mjs:153:5 › #135 R8: in scientific, clicking a committed exception takes it back (436ms)
  ok 4 [api] › tests\api\take-back.spec.mjs:153:5 › #135 R8: in training, clicking a committed accepted takes it back (474ms)
  ok 5 [api] › tests\api\take-back.spec.mjs:153:5 › #135 R8: in training, clicking a committed exception takes it back (509ms)
  ok 6 [api] › tests\api\take-back.spec.mjs:192:1 › #135 R8: clicking again puts the decision back, and only a commit reaches the flag (559ms)
  ok 7 [api] › tests\api\take-back.spec.mjs:252:1 › R7a: a decision made in an earlier sitting can be taken back (402ms)
  ok 8 [api] › tests\api\take-back.spec.mjs:305:1 › R7: the page sweep withdraws a take-back instead of deciding it again (515ms)
  8 passed (4.5s)
```

## Files touched

- .marp/task.md: #137 scope, settled decisions, updated base and status.
- .marp/verification.md: this plan, evidence and coverage limits.
- frontend/apps/marp-mosaic-review/src/model/page.js: pure completion predicate.
- frontend/apps/marp-mosaic-review/src/store.js: completion separated from sweep-only pinning; skipped outcomes prevent completion; merged take-back/version behavior preserved.
- frontend/apps/marp-mosaic-review/tests/unit/model.test.mjs: focused completion-rule cases.
- frontend/apps/marp-mosaic-review/tests/api/page-completion.spec.mjs: real-API desktop/phone completion, pins, persistence and restoration assertions.
- frontend/apps/marp-mosaic-review/tests/api/affordances.spec.mjs: incomplete-count assertions in the existing aborted-request and real-conflict cases.

No generated files, testing infrastructure, shared application code outside this feature, or other workspaces were edited. The earlier fixture test draft was removed; that file now matches develop. The original pre-update draft remains in a local safety stash.

## Status

- **Gate:** G4 complete, evidence recorded. The branch is ready for G5, which requires the human to ask for a pull request.
