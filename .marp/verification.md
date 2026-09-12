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

- **The API tier was not run.** `tests/api/take-back.spec.mjs` needs a server, a login and
  the development corpus, and it writes to that corpus. R4's database half is proved here
  against the fixture, which for *this* defect is honest — `src/data.js` implements
  `withdraw` the way the endpoint does, deleting the decision rather than storing a fourth
  value — but the claim that the endpoint deletes the projection row rests on
  `tests/mosaic-commit.test.js` and on reading `releaseWithdrawn`, not on a run here.
- **Nothing re-reads the page from the endpoint after a withdrawal.** The tile stops
  claiming a decision because the outcome says `withdrawn`; that a *fresh query* then serves
  the row as undecided is the endpoint's behaviour and is not asserted by anything added
  here.
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

The 5 skipped are the API-tier specs, which are skipped without `MARP_API_BASE`; see *Known
gaps*.

### What was not run, and why

`npm run test:mosaic` — nothing on the endpoint changed. `npm test` — not run, and not a
working loop. The API tier — see *Known gaps*.
