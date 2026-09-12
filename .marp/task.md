---
task: MarineAppliedResearch/MARP_API#135
repos: [MARP_API]
status: design
needs: []
---

# Taking a promotion back, and committing the take-back

## Goal

In Training mode a reviewer right-clicks a tile to promote it and presses **Commit
Marked**; the tile should read `PROMOTED`. Clicking it again should read as *taking the
promotion back*, and committing that should record the withdrawal — leaving the tile with
no training decision on screen and no projection row in the database. Today only the first
of those three steps works, and it works only against a server new enough to understand
what a right-click means.

## What is actually broken, which is not what the issue guessed

The issue proposed that the commit endpoint classifies a promotion as `reverted`. **It does
not, on current `develop`.** Read in the code and confirmed by tests that already exist:

- `repository/mosaic-commit.repository.js` — an `accept` mark is not `excepted()`, so it is
  written as `mode.accepts` (`promoted`) and reported through `out.accept()` into
  `reviewed` as `{observation_id, outcome: 'promoted'}`. `reverted` is only ever produced
  by a withdrawal, or alongside `flagged` when an exception replaces an acceptance.
- `tests/mosaic-commit.test.js`, *"promotes an accept mark on the training route"*, asserts
  exactly that.

**The badge the reviewer saw was `TAKING BACK`, the derived one — not `TAKEN BACK`.** The
issue eliminated that branch on the grounds that an accept mark survives its own commit, so
`!marked` cannot hold. That is true only when the commit comes back `promoted`. It comes
back `excluded` from a server that predates #126 (`cf83352e`, 2026-09-10, the day before the
report — and the issue itself records that *"the server-side JavaScript on that process was
older"*), because such a server reads every mark as an exception. Then:

`outcome = 'excluded'` → `survives()` in `model/page.js` drops the accept mark, because the
outcome is not `acceptedValue('training')` → the tile is `!marked`, `touched`, and its
outcome equals `pendingException('training')` → `takingBack` is true → **TAKING BACK**.

So **step 1 is already fixed on `develop`** by the server half of #126, and what #135 leaves
is a regression tripwire for it plus the two steps that were never built:

- **Step 2 does nothing visible.** Right-clicking a committed promotion removes the accept
  mark; `takingBack` only ever compares against the mode's *exception*, so it stays false
  and the tile keeps drawing `PROMOTED` from its outcome. The click looks like it did
  nothing, which is the one thing the app's own notes say must never happen to a committed
  tile.
- **Step 3 cannot be reached.** `selectedRows` requires a mark, so an unmarked take-back is
  not in what **Commit Marked** sends, and the button is disabled. Nothing in the client has
  ever sent `withdraw`, and `applyCommit` reads only `reviewed`, `flagged` and `conflicted`
  — so even a withdrawal that was sent would leave the outcome saying `promoted`.

## Requirements

- **R1** — A promotion committed with **Commit Marked** leaves the tile reading `PROMOTED`.
  Regression tripwire for step 1: a commit answering `reviewed: [{outcome: 'promoted'}]`
  keeps the accept mark and draws the promoted badge; one answering `excluded` is what the
  reviewer reported and must not be what a current client and current server produce.
- **R2** — Un-marking a tile whose *acceptance* this sitting recorded, or whose acceptance
  the record already carried, derives the take-back state, the same way un-marking an
  exception already does. The tile says so rather than continuing to read `PROMOTED`.
- **R3** — **Commit Marked** acts on those take-backs: they are sent as `withdraw`, so the
  endpoint deletes the projection row in `observation_review_current` and logs a `withdrawn`
  decision in `observation_review_log`. The history is kept; the current decision is absent,
  which is what *undecided* means.
- **R4** — After that commit the take-back label is gone and the tile shows no training
  decision, in the page and on a re-read from the endpoint.
- **R5** — The button's count and disabled state include the take-backs it will commit, or
  R3 is unreachable by clicking.

## Open assumptions

- [ ] **A1 · product/UI · blocking** — **Does this apply to Scientific mode as well?** The
  issue is written entirely about Training and promotion. The mechanism is symmetric — an
  acceptance in Scientific is `reviewed` — and building it for one mode only is a rule with
  an exception in it. Build it for both, or for Training alone as written?

- [ ] **A2 · behavioural · blocking** — **What should taking back an *exception* through
  Commit Marked do?** Today nothing: an unmarked tile is not in the selection, so the main
  button ignores it, while the page *sweep* records it as accepted (`reviewed`/`promoted`).
  Once the main button carries take-backs, an un-marked flag has to mean something there.
  Two coherent answers: (i) *withdraw* it, symmetric with R3 and consistent with "this
  button decides only what I touched, and I have decided nothing about this one"; or (ii)
  *accept* it, consistent with what the sweep does with the same gesture. They record
  different things in the database, so this is not a detail. The sweep is unchanged either
  way.

- [ ] **A3 · behavioural · blocking** — **The client bumps `row.version` after a commit and
  the endpoint does not move it, so step 3's second commit comes back `conflicted`.**
  `store.js` does `row.version += 1` for every row a commit gave an outcome, which is
  correct against `src/data.js` (the fixture bumps) and wrong against the API: a review
  commit writes `observation_reviews` and `observation_review_current` and never `UPDATE`s
  `observations`, and `observations.version` moves only on that trigger. So the second
  commit of the same tile in one sitting sends a version one ahead of the live row and is
  refused for a conflict that did not happen. **Step 3 is a second commit, so #135 cannot be
  delivered without settling this.** The small fix is to stop the store bumping and align
  `src/data.js` to the endpoint by not bumping either; the alternative is a contract change
  making the commit response carry the new version, which is *ask first* under the
  permissions. Which, and is it in this task or its own issue?

- [ ] **A4 · product/UI · non-blocking** — Assumed: the take-back of an acceptance draws the
  **same `TAKING BACK` badge** the exception take-back draws, with the accepted value's
  colour and icon rather than the exception's (violet tick for a promotion, not the amber
  exclusion mark), since it is the promotion being withdrawn. Say if it wants different
  wording — `WITHDRAWING` reads more precisely, at the cost of a second vocabulary for one
  state.

- [ ] **A5 · behavioural · non-blocking** — Assumed: *"click it again"* in step 2 is the
  **same gesture that promoted it** — a right-click (a double tap on touch), toggling the
  accept mark off. A left-click is an exclusion mark, which is a new decision rather than a
  take-back, and stays what it is.

## Decisions

- **2026-09-12** — The issue's diagnosis is not adopted. The endpoint does not classify a
  promotion as `reverted`; the reported badge is the derived `TAKING BACK`, reachable only
  through a pre-#126 server. Recorded here rather than acted on, so the fix is not aimed at
  code that is already correct.

## Plan

Written against the answers above; the shape does not change, only which modes and which
verb A1 and A2 settle.

1. `model/modes.js` — a take-back derivation that knows both the mode's exception and its
   accepted value, so `ui/tile.js` and the button's rule ask one question rather than two
   that can disagree.
2. `ui/tile.js` — draw it for an acceptance being withdrawn (A4).
3. `model/modes.js` — `selectedRows` / `selectionOutcome` carry the take-backs, so the
   button says what it will do and is enabled when it will do it (R5).
4. `store.js` — send them as `withdraw`; `model/page.js` — fold `reverted` in `applyCommit`
   so the outcome stops saying `promoted` after a withdrawal (R4).
5. Whatever A3 settles about the version.

## Acceptance criteria

- Right-click, **Commit Marked** → `PROMOTED`, and the mark survives (R1).
- Right-click again → the tile says the promotion is being taken back (R2).
- **Commit Marked** → the label is gone, the tile shows no training decision, and a re-read
  from the endpoint has no `observation_review_current` row for that observation and purpose
  (R3, R4).
- The button is enabled and its count includes the take-back (R5).

## Test plan

Filled in at G3.

The tiers this needs, named now because choosing wrong is how this gets reported twice:
`tests/unit/` for the derivation and for what reaches the wire (`api-requests.test.mjs`
asserts the *serialised* body, so a `withdraw` that never leaves the client is visible);
`tests/e2e/render.spec.mjs` for the badges, because every rendering defect in this app has
passed the store-level checks; `tests/api/` for R4's database half, because the fixture
writes the row's status column in place and the endpoint does not — and that gap is the
whole reason that tier exists. `npm run test:mosaic` if the endpoint needs anything, which
on this reading it does not.

## Status

- **Gate:** design — stopped at G1 with A1, A2 and A3 open.
- **Notes:** the diagnosis is verified in the code and against existing tests; nothing is
  implemented.
