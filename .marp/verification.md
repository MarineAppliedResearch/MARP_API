# Verification — MARP_API#85, every mode shows every workflow's tags

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `R1: a tag another workflow recorded is carried into every other mode` | unit | every combination of dimension and mode lends the right tag |
| R1 | `R1: a tag carries the workflow, the reason and the person for its tooltip` | unit | the tooltip has something to say, since the face carries no label |
| R1 | `R1: a record that carries nothing lends nothing` | unit | an untouched observation gains no tag in any mode |
| R1 | `R1: both dimensions decided means the other one is still borrowed, once` | unit | no duplication when the record carries two decisions |
| R1 | `R1: a training exclusion is drawn while reviewing science` | render | the tag is actually on the tile — the store was right every previous time a badge never appeared |
| R1 | `R1: a training promotion is drawn while reviewing science` | render | the other training value, in the other direction |
| R1 | `R1: a scientific review is drawn while reviewing training data` | render | the reverse direction, plus the tooltip naming the workflow |
| R1 | `R1: Delete Mode shows the training tags it used to hide` | render | the sharpest case in the issue: an exclusion visible before a permanent delete |
| R2 | `R2: a mode never borrows its own dimension, so no tag can duplicate the badge` | unit | the primary slot's dimension is excluded at the source |
| R2, R3 | `R2/R3: a mark still outranks the record, and the tag does not swallow the click` | render | clicking a tagged tile — on the tag itself — marks it for this mode and the badge changes |
| R4 | `a scientific commit writes only the review status` (new, `tests/requirements.js`) | contract | no row on the page changes its training disposition when science commits |
| R5 | `R1/R5: a committed flag reaches training as the record, not as an outcome` | render | the tag appears in the other mode while the primary badge stays silent, so it was the record and not a travelling outcome |
| R5 | `a scientific commit leaves no badge behind in training or delete` (existing) | render | outcomes still do not travel; comment updated to say what that means now |
| R6 | `R6: a borrowed tag is not this mode's exception, so it cannot seed a mark` | unit | a training exclusion cannot arrive marked in scientific review |
| R6 | asserted inside `R1: a training exclusion is drawn while reviewing science` | render | no `has-excluded` class and `filter: none` on the image — the picture is not dimmed by another workflow |
| R7 | `R7: the tag stays inside the tile and clear of the caption` | render | measured box: inside the tile, above the caption, in the lower half, and the page does not scroll sideways. Run at desktop *and* phone width |
| R9 | `the state a record carries for a mode is still read per mode` | unit | the old rule's test rewritten with the date and the reason, not deleted |
| R10 | `the mode keeps its own status filter, and ignores the other mode's` (existing) | unit | the rail and the query are unchanged |

## Requirements with no test

- **R8** — "a reviewer can tell which workflow a tag came from" is a legibility claim about
  a person, and no tier can assert it. What is testable is asserted: the tooltip names the
  workflow (render), and the tag wears the owning workflow's colour class. Whether the
  distinction actually reads is for the user in the app.

## Edge cases

- **A record carrying both decisions** — covered in the unit tier. Without the
  own-dimension exclusion this draws the same word twice, because a page arrives with its
  existing exceptions already marked.
- **A tile with no imagery** — the render helper picks rows with a ready thumbnail, so the
  claim about the image not being dimmed has an image to make it about.
- **Clicking the tag itself** rather than the tile around it, which is the click most
  likely to be swallowed by a new element.
- **Phone width** — every render test runs at both viewports. A 96px tile is where a second
  label would bury the picture.

## Regression coverage

- **The precedence that produced the most reported defects in this app** — a mark outranks
  an outcome, which outranks the record. `.badge` is kept as exactly one element per tile so
  a record tag structurally cannot reach that slot, and the render test clicks a tagged,
  committed tile to prove the click still does something.
- **`page.seedMarks` seeding from the wrong dimension** — the reason `existingState` was
  not widened. Named unit test.
- **Outcomes wearing another mode's answer** — the existing test stands, and the new one
  proves the thing that now travels is the record.

## Known gaps

- **`src/data.js` is a fixture.** The tags read back are the ones the fixture holds and the
  ones a commit writes to it. No claim here has been made against a real API or schema.
- **Only two dimensions exist.** The slot stacks with `column-reverse` so a third would
  grow upward, but nothing has ever drawn two borrowed tags at once, so that layout is
  unexercised.
- **#82 is untouched.** TAKING BACK on exclusions nobody touched is not fixed or broken
  here; see `.marp/task.md`.
- **The colour contrast of a tag over a photograph** has not been measured; it carries a
  dark hairline ring rather than a measured contrast ratio.

## Manual steps

None. Everything above runs in `npm run test:unit` and `npm run test:e2e`.

## Walkthrough videos

None recorded. Not requested, and every claim above is asserted at a tier that runs
constantly.

---

## Results

Run on 2026-09-08 in the `85-tags-across-modes` worktree, Node 24.11.1, real Chromium at
desktop and phone widths.

### Unit tier — `npm run test:unit`, after every change

```
ℹ tests 119
ℹ suites 0
ℹ pass 119
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 87.5515
```

113 before this task, 119 after: six new rules.

### Render tier — the #85 block, `npm run test:e2e -- -g "every workflow"`

```
  14 passed (6.2s)
```

Seven tests at two viewports.

### Proving the render tests can see the defect

The `${borrowed(row)}` call was removed from `ui/tile.js` (after `cp` to a scratch copy,
restored from it afterwards) and the same command re-run:

```
  ✘  [desktop] R1: a training exclusion is drawn while reviewing science
  ✘  [desktop] R1: a training promotion is drawn while reviewing science
  ✘  [desktop] R1: a scientific review is drawn while reviewing training data
  ✘  [desktop] R1: Delete Mode shows the training tags it used to hide
  ✘  [desktop] R1/R5: a committed flag reaches training as the record, not as an outcome
  ✘  [desktop] R2/R3: a mark still outranks the record, and the tag does not swallow the click
  ✘  [desktop] R7: the tag stays inside the tile and clear of the caption
  ✘  [phone] ... the same seven
```

All 14 fail with the rendering removed and the model layer intact — which is the point:
the unit tier stayed green throughout that run.

### Contract tier — `npm run test:e2e -- -g "requirement checks"`

```
  ✓  2 [desktop] the requirement checks in tests.html all pass (38.8s)
  ✓  1 [phone]   the requirement checks in tests.html all pass (38.8s)
  2 passed (40.0s)
```

R4's check is new, and it was also shown to catch the defect: with
`row.training_disposition = 'excluded'` added to the *scientific* branch of `commitPage`
in `src/data.js` (again via `cp`, restored afterwards), it failed at both widths:

```
Error: contract checks failed:
no scientific decision may write a training disposition, changed: 100129 expected 0, got 1
```

### Whole suite — `npm run test:e2e`, run twice

**First run:** `1 failed / 4 skipped / 169 passed (1.2m)`. **Second run**, after fixing my
own test: `1 failed / 4 skipped / 169 passed (1.1m)` — a *different* test, and a different
flake. **Third run**, after adding R4's contract check:

```
  4 skipped
  170 passed (1.1m)
```

Green. The two failures above are flakes under six parallel workers, each passing alone,
and neither is in this change's path — see below. The 4 skips are pre-existing conditional
skips in tests written before this task.

**A test of mine was wrong first.** `R1/R5` failed at both widths on the first run:

```
Error: expect(locator).toHaveCount(expected) failed
Locator:  locator('.tile[data-id="100129"]').locator('.badge')
Expected: 0
Received: 1
```

It waited on its own tile's badge, which already read FLAGGED as a *mark*, and so switched
mode while the commit was still in flight. `commitPage` then resolved and wrote
`state.outcomes` after `setMode` had cleared them, painting the scientific commit's answers
across Training. The test now waits for the commit to land. **The race is real and lives in
`store.js`, not in the test** — reported, deliberately not fixed here.

**Flake 1 — the contract checks, phone only, first run:**

```
Error: contract checks failed:
an observation without ready imagery is skipped, and does not block the batch
unavailable imagery must be skipped
```

Passes alone at both widths (38.0s / 38.3s). The check takes any row whose thumbnail is
not `ready` and requires the commit to skip it, but a `queued` thumbnail can resolve to
ready before the commit runs. Nothing in this change is in that path: `tests.html` imports
`store.js`, `model/modes.js` and `data.js` only — never `ui/tile.js` or the stylesheet.

**Flake 2 — the TAKING BACK colour test, desktop only, second run:**

```
TypeError: Cannot read properties of null (reading 'map')
```

Passes alone at both widths (1.4s / 1.5s). It reads `getComputedStyle` once on a badge that
a full re-render can detach, and `''.match(/\d+/g)` is null. The helper immediately below
it in the same file carries a comment describing exactly this and polls instead; this test
was never given the same treatment. Pre-existing, and unrelated to this change.
