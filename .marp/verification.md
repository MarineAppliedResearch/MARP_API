# Verification — MARP_API#135, taking a promotion back

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `render.spec.mjs` › taking a promotion back (#135) › *step 1: promoting and committing leaves the tile reading PROMOTED* | render | The badge the reviewer actually reads says PROMOTED, and neither TAKING BACK nor TAKEN BACK. This is the report itself, at the only tier that can see a badge. |
| R1 | `requirements.js` › Training data review › *promoting one tile and committing it reads as promoted, not as a take-back* | contract | The store folds the commit to `promoted` and the accept mark survives it — the two facts that, when either fails, produce the reported badge. |
| R2 | `model.test.mjs` › *#135 R2: taking back a promotion this sitting recorded is a take-back* (and the scientific and exception siblings) | unit | The rule names what is being taken back, for an acceptance in both modes and for an exception as before. |
| R2 | `render.spec.mjs` › *step 2: clicking it again says the promotion is being taken back* | render | The badge appears, the tile carries `out-reverted`, and the tooltip names the promotion — so the click stops looking as though it did nothing. |
| R3 | `model.test.mjs` › *#135 R3: the take-backs are their own list, and the marks are not in it* | unit | The two lists stay two lists, which is what keeps an id out of both `marks` and `withdraw` — the endpoint refuses a request carrying both. |
| R3 | `model.test.mjs` › *#135 R3: clicking a mark off makes the main button withdraw it* | unit | A2's answer, and the reversal of #126's R7 in the one place that decides it. |
| R3, R4 | `requirements.js` › Training data review › the same three-step check | contract | The withdrawal reaches the backing, the outcome becomes `withdrawn`, and the row carries no training decision afterwards. |
| R4 | `model.test.mjs` › *#135 R4: applyCommit folds a withdrawal* and *…a revert that co-occurs with a flag* | unit | `reverted` is read, and reading it does not disturb the entry that co-occurs with `flagged`. |
| R4 | `render.spec.mjs` › *step 3: committing the take-back clears the label and the decision* | render | No badge at all afterwards — which is what undecided looks like — plus the row's decision read back through the store. |
| R5 | `model.test.mjs` › *#135 R5: the button counts a take-back* | unit | The count includes it, so the button is enabled; without this step 3 is unreachable by clicking. |
| R5 | `render.spec.mjs` › step 2, the last two assertions | render | The button is enabled and its title says *takes back 1*. |
| R6 | `data-scale.test.mjs` › *#135 R6: a commit does not move the version* | unit | Two commits of the same rows, and the second is not conflicted. **It commits twice because committing once cannot observe it.** |
| R6 | `data-scale.test.mjs` › *#135 R6: a species correction still moves it* | unit | The distinction: a correction edits the observation, so its token does move. |
| R6 | `requirements.js` › Training data review › *committing the same page twice is not a phantom conflict* | contract | The same defect through the real store, which is the half that was wrong. |

### The corrected rules, 2026-09-12 — and the tier they are proved at

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R7 | `take-back.spec.mjs` › *R7: the page sweep withdraws a take-back instead of deciding it again* | **api** | The issue's own sequence, in Training, against a real server: promote, *Commit Marked*, click again, then press the **sweep** — and the tile ends with no badge and `observation_review_current` holds no row. Red before the fix: badge `PROMOTED`, record `promoted`. |
| R7 | `take-back.spec.mjs` › *R8: a recorded take-back stops saying TAKING BACK* | **api** | The same rule in Scientific, on a flag the record carried before the page was loaded. Its previous expectation — `REVIEWED` — was the superseded rule, and is the line that changed. |
| R7 | `model.test.mjs` › *#135 R7: the sweep withdraws a take-back rather than deciding it again* | unit | The rule itself, plus the half that must **not** change: the same page with an empty `takenBack` still accepts the unmarked tile. |
| R7 | `model.test.mjs` › *#135 R7: a take-back with no imagery is withdrawn rather than skipped* | unit | A withdrawal removes a decision instead of making one, so the imagery rule has nothing to say about it — matching the endpoint, whose `withdraw` branch runs before its imagery check. |
| R7 | `requirements.js` › Review states › *a committed page stays editable: the exceptions are still marked* | contract | The same reversal through the real store. Its last assertion expected `reviewed` and now expects `null`. |
| R7 | `render.spec.mjs` › a committed page is still editable › *the flag stays marked, a click takes it back, and committing withdraws it* | render | What is drawn after the second sweep: no badge, not marked. Its name and its last assertion both changed. |
| R7a | `take-back.spec.mjs` › *R7a: a decision made in an earlier sitting can be taken back* | **api** | A promotion written through the API **before the page is loaded** can be taken back. **This was green before any change** — see below. |
| R7b | the two API tests above, last assertion of each | **api** | Vanilla for the mode is the *absence* of a projection row, read back from the endpoint rather than off the screen. |

**The supervising diagnosis was wrong, and R7a is the proof.** It said `existingState`
cannot see a decision from an earlier sitting because the API never writes the row's status
column. `ROW_COLUMNS` in `repository/mosaic.repository.js` selects
`rc.decision AS review_decision` and `rt.decision AS training_decision` out of
`observation_review_current`, so it arrives on the row and the derivation finds it. What the
endpoint does not do is write that column back **after a commit in this sitting**, which is
#131 and is already handled by preferring `state.outcomes`. R7a is kept as a tripwire, not
as a fix.

**Why the endpoint is not in this table.** Nothing on the server changed. The server half of
step 1 landed with #126 and `tests/mosaic-commit.test.js` › *promotes an accept mark on the
training route* already holds it; `withdraw` has been supported since #106 with no client
sending it. So `npm run test:mosaic` proves nothing about this change and was not run.

## Requirements with no test

None. R1 to R6 each have at least one test above, and R1, R2, R4 and R5 have one at the
rendering tier, because the defect was something drawn.

## Edge cases

- **A withdrawal draws no badge**, rather than a badge saying "withdrawn". `outcomeBadge`
  has no case for it, and the outcome still outranks the record — so a row the endpoint
  served as `promoted` does not go back to reading PROMOTED for the rest of the sitting.
- **A `conflicted` id keeps its take-back**, the way it keeps its mark: nothing was written
  for it, so the intention is still pending.
- **Delete Mode takes nothing back.** Both its exception and its accepted value are null, so
  a `null === null` comparison must not make every touched tile there read as a take-back.
  Asserted directly.

## Regression coverage

- **`render.spec.mjs` › *a committed page is still editable* › the flag stays marked, a click
  takes it back, and committing accepts it.** Not a new test — it is the existing one that
  went red against the first implementation, and is why the take-back is recorded rather
  than derived. Its unit-tier counterpart is *#135: taking a flag off a tile the sweep
  accepted is not a take-back*.
- **`model.test.mjs` › *#135 R3: clicking a mark off makes the main button withdraw it*** is
  #126's R7 test rewritten to A2's answer rather than deleted, so the reversal is visible in
  the history instead of the old rule quietly disappearing.

## Known gaps

- ~~**The API tier was not run.**~~ **Closed 2026-09-12.** It has been run, against a copy of
  the corpus, and it is what caught R7 — three fixture-backed step tests were green while the
  page sweep put a withdrawn promotion straight back. See *Results*. This gap was the whole
  cost of the entry above it: the tier that could see the defect was the one nobody ran.
- ~~**Nothing re-reads the page from the endpoint after a withdrawal.**~~ **Closed.** All
  three API tests read the decision back through `/mosaic/observations/pages` rather than off
  the screen, and assert it is null.
- **A6 is open and is not built.** A tile whose *acceptance* is already on the record takes
  two right-clicks to take back, because nothing seeds an accept mark — the first marks it
  accepted, agreeing with the record, and only the second takes it back. A tile carrying an
  *exception* is seeded and takes one click. The API tier asserts today's behaviour, with a
  comment saying it is the test that changes if A6 is answered the other way.
- **`observation_reviews` is not asserted.** R7b is about the projection row being absent,
  and the log keeping its rows is the endpoint's contract, covered by
  `tests/mosaic-commit.test.js`. Nothing added here reads the log.
- **No walkthrough**, and none is proposed. One is recorded only when the human asks.

## Manual steps

None. Everything above runs headless.

---

## Results

Run on 2026-09-12, on branch `135-promote-commit-take-back-label`.

### Unit — `npm run test:unit`, from the app directory

```
> node tools/syntax-check.mjs
✓ 48 files parse
…
ℹ tests 296
ℹ pass 296
ℹ fail 0
```

### Each new test proved red first, against the old behaviour

One file at a time, with the old behaviour put back by a file copy and restored from it —
never `git checkout --`.

`src/model/modes.js`, the rule narrowed back to the mode's exception and the button's
take-back count forced to zero:

```
✖ #135 R3: clicking a mark off makes the main button withdraw it
✖ #135 R2: taking back a promotion this sitting recorded is a take-back
✖ #135 R2: it is the accepted value in scientific mode too, not only training
✖ #135 R3: the take-backs are their own list, and the marks are not in it
✖ #135 R5: the button counts a take-back, or it is disabled and unreachable
ℹ tests 138  ℹ pass 133  ℹ fail 5
```

`src/model/page.js`, with the `reverted` fold removed:

```
✖ #135 R4: applyCommit folds a withdrawal, which appears in no other array
ℹ tests 138  ℹ pass 137  ℹ fail 1
```

`src/data.js`, with the version bump put back:

```
✖ #135 R6: a commit does not move the version, because the endpoint's does not
ℹ tests 29  ℹ pass 28  ℹ fail 1
```

### Browser — `npm run test:e2e` (contract and render, desktop and phone)

The first run, against the **derived** take-back, is recorded here because it is the reason
the implementation changed shape:

```
2 failed
  [desktop] › render.spec.mjs:531 › a committed page is still editable › the flag stays marked, a click takes it back, and committing accepts it
  [phone]   › render.spec.mjs:531 › a committed page is still editable › the flag stays marked, a click takes it back, and committing accepts it
5 skipped
299 passed (2.1m)
```

```
Error: expect(locator).toContainText(expected) failed
Expected substring: "REVIEWED"
Received string:    "TAKING BACK"
  - locator resolved to <span class="badge b-rev" title="Taking back reviewed — not committed yet…">
```

The second run, with `state.takenBack` recording the take-back instead:

```
  5 skipped
  301 passed (2.1m)
```

```
✓ [desktop] render.spec.mjs:1863 › taking a promotion back (#135) › step 1: promoting and committing leaves the tile reading PROMOTED (1.7s)
✓ [desktop] render.spec.mjs:1877 › taking a promotion back (#135) › step 2: clicking it again says the promotion is being taken back (1.7s)
✓ [desktop] render.spec.mjs:1896 › taking a promotion back (#135) › step 3: committing the take-back clears the label and the decision (2.2s)
✓ [phone]   render.spec.mjs:1863 › taking a promotion back (#135) › step 1 … (2.0s)
✓ [phone]   render.spec.mjs:1877 › taking a promotion back (#135) › step 2 … (2.1s)
✓ [phone]   render.spec.mjs:1896 › taking a promotion back (#135) › step 3 … (2.4s)
✓ [desktop] render.spec.mjs:531 › a committed page is still editable › the flag stays marked, a click takes it back, and committing accepts it (1.6s)
✓ [phone]   render.spec.mjs:531 › a committed page is still editable › the flag stays marked … (1.9s)
✓ [desktop] contract.spec.mjs:18 › the requirement checks in tests.html all pass (59.9s)
✓ [phone]   contract.spec.mjs:18 › the requirement checks in tests.html all pass (59.1s)
```

The contract tier runs every check in `tests/requirements.js` inside `tests.html`, so the two
added there — the three-step sequence and the phantom conflict — are inside those two lines.

The 5 skipped are **viewport-conditional render tests**, each `test.skip`ped on the project
it is not about — a phone-layout check on desktop, and `#138`'s page-level mark on the phone,
where that control is hidden. None of them is mine and none is a prerequisite skipped away.
The API tier is not in this run at all; see *Known gaps*.

I asserted these were the API specs before checking, and they are not — corrected here rather
than left standing, because a wrong sentence in the evidence is worse than no sentence.

### API — `--project=api`, 2026-09-12, against a copy of the corpus

*Known gaps* said this tier had not been run and that the work would not be finished until it
had. It has been run now, and it is what found the defect. The arrangement, because it is the
part worth repeating: `marp db dump` of the development database, `marp db up -Port 5442
-DataDirName agent135` beside it, `marp db load … --apply` into that second database, and the
API served from it on a port of its own. **Nothing was written to the development database
and no `--force` was used.**

Red first, on the branch tip, before any source change:

```
✘ take-back.spec.mjs:57 › R8: a recorded take-back stops saying TAKING BACK (7.9s)
  Error: expect(locator).toHaveCount(expected) failed
  Locator:  locator('.tile[data-id="582"]').locator('.badge')
  Expected: 0
  Received: 1

✘ take-back.spec.mjs:169 › R7: the page sweep withdraws a take-back instead of deciding it again (7.8s)
  Error: expect(locator).toHaveCount(expected) failed
  Locator:  locator('.tile[data-id="582"]').locator('.badge')
  Expected: 0
  Received: 1

✓ take-back.spec.mjs:116 › R7a: a decision made in an earlier sitting can be taken back (561ms)
```

R7a passing there is the evidence that the supervising diagnosis was wrong, and it is
recorded rather than quietly dropped.

Green after:

```
✓ 1 [api] › take-back.spec.mjs:57  › R8: a recorded take-back stops saying TAKING BACK (566ms)
✓ 2 [api] › take-back.spec.mjs:116 › R7a: a decision made in an earlier sitting can be taken back (394ms)
✓ 3 [api] › take-back.spec.mjs:169 › R7: the page sweep withdraws a take-back instead of deciding it again (597ms)
3 passed (2.0s)
```

### Browser and unit, re-run after the correction

`npm run test:unit` — **298 passed, 0 failed**, 0.9 s. `npm run test:e2e` — **301 passed, 5
skipped**, 2.1 minutes, the same five viewport-conditional skips as before.

The first e2e run after the change had three failures and all three are recorded here rather
than only the tidy result:

- `contract.spec.mjs` on both projects — `a committed page stays editable … expected
  "reviewed", got null`. That is R7 landing, on a check asserting the rule R7 reverses. The
  check was corrected.
- `render.spec.mjs:2596 [phone] › L4: confidence is one track carrying two handles` —
  `--from:0%;--to:100%` instead of `--from: 40%`. **Not mine**: nothing in this change
  touches the rail or the confidence dimension. It passed alone and did not recur on the
  re-run, so it is flaky under six parallel workers. Named here rather than fixed.

### What was not run, and why

`npm run test:mosaic` — nothing on the endpoint changed; the `withdraw` branch it relies on
has been there since #106 and runs before the imagery check, which is what makes R7 a
client-only fix. `npm test` — not run, and not a working loop. No walkthrough was recorded.
