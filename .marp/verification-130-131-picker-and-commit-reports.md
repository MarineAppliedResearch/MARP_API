# Verification — MarineAppliedResearch/MARP_API#130 and #131

The picker finds species, and a commit says which commit ran. The plan below is for review
**before** it is accepted as this phase's evidence.

**What has already happened.** G2 ran the targeted tiers to know the work functioned — the
mosaic and species API groups, the client unit tier, and the render specs that touch what
changed. What has *not* happened is anybody agreeing they are the right tests, or that the
gaps below are acceptable. `## Results` stays empty until this plan is approved and run.

**The whole suite has deliberately not been run.** It is the supervisor's single run at the
end of the phase, not each agent's — three agents worked here and a full run each would be
the same minutes spent three times, none of them on the assembled branch. Settled by the
human on 2026-09-11: *"the agent doesn't end the feature, you do."*

**Do not run `marp verify plan` against this file.** It *drafts* a plan from `task.md` and
overwrites what is here; it does not check it. It already destroyed this plan once. Run it
before hand-writing, never after.

## Why the tier choices are unusual here

This phase fixed three defects that **no existing tier could observe**, and that is the
story of the verification rather than a footnote:

- **#130's cause is invisible to the browser tier.** The render tier runs on
  `?backing=fixture`, and the fixture's `searchSpecies` ignores its `list` argument
  entirely — so the picker cannot fail there however broken the real path is. Mutating
  `speciesListFor` back to `return null` left every new render test green until a
  discriminator was added.
- **#131's two defects are invisible to the store tier.** `state.commit.status === 'ok'` is
  a *true* statement about the commit that ran; the defect is one field being mapped onto
  two DOM elements. There is nothing store-level to see.
- **The take-back defect is invisible to both.** It only arises when the record disagrees
  with this sitting's outcome, which happens under the API and never under the fixture,
  because `src/data.js` mutates the row's status column in place.

So this phase added a tier rather than only tests: `tests/api/`, running against the real
API and the real corpus. That is R14, and it exists because the alternative — a fixture
affordance simulating the endpoint — was started and then rejected by the human: *"why are
we doing tests on the fixture instead of the actual system? If the fixture doesn't trigger
the error and the actual system does, that doesn't make any sense."*

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | render: two characters in the picker return candidates | render | The gesture works end to end at the tier that draws it. |
| R1, R2 | `tests/mosaic-query.test.js` exact-key list gains `species_list` | API | **Red before green**, captured verbatim. The row now carries the list. |
| R2 | the list is a SQL `CASE` generated from `db/species-lists.js` | API | One copy of the type-to-list map, on the server. The client does no mapping, which is what A1 settled and what `store.js:268-277` objected to. |
| R3 | `tests/v2_species.test.js`: the cross-list route, with `is_active` and its permission | API | The widen action has something to call. It never had. |
| R4 | render: a widened result carries `.slist`; a scoped one does not | render | A common name is not unique across lists — `Red sea urchin` is 769 on `Inverts` and 544 on `GULF_Inverts` — and a correction is written to the record. |
| R5 | render: three distinct empty states | render | *No list*, *nothing on this list*, *nothing in the taxonomy* are different facts. The old single message was false twice over: no request had been sent, and the remedy it suggested was itself broken. |
| R6 | render × 2 viewports: committing the marked leaves the sweep untouched, and the reverse | render | Both directions, and the **fill** is asserted at `rgba(0,0,0,0)` — classes alone would pass if the fill returned through another selector, and the fill is what made this read as "the whole page was accepted". |
| R6 | the same tests assert the idle button keeps its label, is not spun and stays enabled | render | A4: nothing happens to the button that did not run. |
| R7 | render: the badge title before and after a commit | render | `Not committed yet` becomes `Recorded as reviewed — click to flag it instead`. Only a DOM tier can read a `title`. |
| R8 | **`tests/api/take-back.spec.mjs`**, against the real API | API-backed render | The one test in this phase that could not exist before it. Proven to fail with the fix reverted. |
| R9 | the existing tile tests, unchanged | render | The `.badge` chain keeps its order; both fixes change a string or a condition inside a branch that was already chosen. |
| R10 | **`tests/unit/row-shape.test.mjs`** — 5 checks, ~70 ms | unit | The durable part. The endpoint's generated `MosaicRow` against the fixture's row **both ways**, plus every row field the client reads. Mutation-proven three ways. |
| R11 | every fix has a tier that can see it | all | The table above is the claim. |
| R12 | the exact-key tripwire is *moved into*, never widened | API | A published contract gained a field deliberately. |
| R13 | `migrations/` untouched | review | No schema change, so nothing can reach production by accident. |
| R14 | the `api` Playwright project, `MARP_API_BASE` ungated from `WALKTHROUGH` | API-backed render | The tier exists, asserts `data-backing`, and refuses loudly if named without the environment variable. |

## Requirements with no test

- **R13** is verified by reading the diff, not by a test. `migrations/` has no change; there
  is nothing to assert.

Everything else has a named test. If that is wrong, this gate is the place to say so.

## Edge cases

- **A species list the row names but the catalogue has nothing active on** — the *nothing on
  this list* empty state, distinct from *no list at all*.
- **A common name on two lists.** `Red sea urchin` is 769 on `Inverts` and 544 on
  `GULF_Inverts`; the widened result labels both.
- **A row whose session type maps to no list.** The fixture's `Fish_GULF` and
  `INVERTS_GULF` do exactly this and are deliberately left untidy — they are the only way a
  browser test can reach the no-list path.
- **Committing with one button while the other is idle**, in both directions.
- **A take-back committed, then the page not re-read.** The record disagrees with the
  outcome for the rest of the sitting; the outcome wins.
- **An accept mark committed, then a reload.** No mark survives a reload, so the tile falls
  to a badge with no tooltip — nothing false is left behind, which is why "committed" means
  *this sitting*.

## Regression coverage

- **The fixture/endpoint shape gap.** `tests/unit/row-shape.test.mjs` exists because this
  gap produced #130 and, before it, #124's F6 (`comname` read where `species_comname` is
  sent) and F8 (four attribution fields the row does not carry). It found a **fourth** on
  its first run: the endpoint sends `flag_reason` and `exclusion_reason` and the fixture
  rows carried neither.
- **`tests/requirements.js:607`** no longer reads `state.rows[0].species_id`, a fixture-only
  field it was reading back as its own input.
- **The existing render spec now pins `?sessionType=Inverts`.** It was passing only because
  the fixture ignored its `list` argument.

## What the tests cannot see, stated plainly

- **The take-back fix cannot be observed at the fixture render tier**, and never will be.
  `src/data.js` writes the row's status column in place, so the condition the fix addresses
  cannot arise there. It is covered only by `tests/api/take-back.spec.mjs`, which needs a
  server and the corpus. **If that tier is not run, R8 has no evidence.**
- **#130's cause likewise.** The render tests prove the picker works; they cannot prove it
  was broken. The tiers that can are the API tripwire and
  `tests/unit/api-requests.test.mjs`.
- **`tests/api/` writes to the corpus.** One row, chosen because species 622 has exactly
  one observation so a page sweep touches one decision, restored through `withdraw` in a
  `finally`. `observation_review_log` keeps its rows by contract — that is the endpoint's
  design, not litter. A test that cannot restore what it wrote must fail loudly rather than
  pass quietly.

## Known gaps

- **The full API suite and the full Playwright suite have not been run on the assembled
  branch.** That is the end-of-phase run and it is the human's call when it happens. A
  green targeted run is not that.
- **CI runs the fast tiers only**, deliberately, and CI does not run the `api` project at
  all — it has no server and no corpus. So CI going green says nothing about R8 or R14.
- **`tests/walkthrough/scenarios.mjs:1161`** (`verify-correction`) types `lea` on an
  unfiltered page. Now that the scoped search is real, whether that matches depends which
  session the first fresh tile belongs to, so that scene will fail or narrate nothing when
  next recorded. Found and left alone.
- **`src/ui/picker.js` reads `row.species_list` directly** while `src/store.js` has
  `speciesListFor`. Two readers of one fact. Left as a plain field read rather than
  refactored, and the test strengthened instead.
- **`npm run docs:build` exits 1** on four pre-existing jsdoc errors in
  `model/schedule.js`. Unchanged by this branch.
- **The species picker needs a current server.** It is an API change, and `express.static`
  serves client files from disk — so a long-running server has the client fixes and not the
  server one.

## Found in real use during this phase, and not fixed here

Three defects the human hit while reviewing the ten-dive corpus. **None is in this branch**,
and #135 and #137 are the same family as #131 — state written for one commit button now
read by two:

- **#135** — promoting and committing labels the tile as taken back. The outcome
  `reverted` is arriving from the server inside `reviewed`; `applyCommit` ignores
  `result.reverted` deliberately.
- **#137** — a page fully committed with *Commit Marked* never colours in the pager.
  `committedPages.add` shares an `if (!selective)` with the pin, and the documented reason
  covers the pin only.
- **#138** — a committed delete leaves the tile fully interactive, and the next commit
  reports the reviewer's own deletion as somebody else's race.

Folding #135 and #137 into this phase was offered and is the human's call.

## Also on this branch, outside #130 and #131

Declared because it will appear in the pull request and is not a picker or a commit fix:

- **`scripts/process-dive.js`** and project 44 in `scripts/seed-inference-context.js` — the
  parameterised dive runner that replaced a copy-per-dive family of scripts, and the
  CAMPA2026 project row it needs. Operational tooling, used to build the corpus this phase
  was verified against. `Refs #68`.

## Manual steps

1. **Correct a species in the mosaic, against a current server.** Open the correction
   panel, type two characters. *Expected:* candidates from the observation's own list.
   Then *Search all lists*: candidates from every list, each labelled with its list.
2. **Commit with each button and watch the other one.** *Expected:* only the button pressed
   says `Saving…` then `Saved`; the other keeps its label and its outline.
3. **Right-click a tile, commit, hover the badge.** *Expected:* `Recorded as reviewed —
   click to flag it instead`, not `Not committed yet`.

**The phone is not a manual step.** Playwright's `phone` project is how this project tests
a phone — it honours the real viewport width and runs touch gestures in a genuine
`hasTouch` context. Settled by the human, 2026-09-10: *"You're supposed to test it on an
emulated phone… we don't need to test it on a real phone for now."*

---

## Results

*Empty until the plan above is approved.*
