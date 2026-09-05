---
task: MarineAppliedResearch/MARP_API#72
repos: [MARP_API]
status: design
needs: []
---

# The grid states that have never been rendered

## Goal

A reviewer whose filter matches nothing, or whose page is all broken imagery, is told what
happened and what to do about it. Today the grid has only ever been seen full and healthy.

## What is already true

Read from the code, not assumed:

- **A failed thumbnail already draws.** `ui/tile.js` renders three bodies: the image when
  `thumbnail_status` is `ready`, a `PREPARING` placeholder when `queued`, and a warning
  with `NO IMAGE` otherwise. The per-tile states exist; what is missing is everything above
  the tile.
- **Nothing anywhere handles an empty grid.** No branch in `ui/grid.js` or `ui/chrome.js`
  reacts to `state.rows` being empty; the count simply reads `0`.
- **A non-ready row cannot be committed.** `commitCount` counts only `ready` rows, and
  `data.js` skips the rest with `reason: 'no-imagery'`. The interface never says so.
- **Queued thumbnails resolve on their own.** `store.js` walks the `queued` rows after a
  page lands and marks each `ready` when it arrives. Nothing retries a failure.

## Requirements

<!-- R7 added at G1, out of A3 and A4. -->

- **R1** — A filter matching nothing says so, and says what to change.
- **R2** — ~~A filter whose work is finished says *that*, and is distinguishable from
  R1.~~ **Withdrawn at G1 by A1:** the two are indistinguishable from the client without a
  second query, and one honest message was judged enough. R1 covers both.
- **R3** — A page whose thumbnails have all failed does not offer a commit that would do
  nothing; it explains why.
- **R4** — When the result is smaller than one page, the grid, the pager and the counts
  agree that this is all of it — no phantom second page.
- **R5** — The count of what a commit will act on is visible when it differs from the
  number of tiles on screen, so "commit" never silently means "commit some of these".
- **R6** — Thumbnail transitions are exercised by tests: queued → ready, queued → failed,
  and what a commit does with each.
- **R7** — A failed thumbnail can be retried, per tile and for a whole failed page.
- **R8** — Flagging a row with no imagery records the flag. Accepting one does not: an
  unmarked no-imagery row is skipped, never silently accepted.
- **R9** — "No imagery" is an available flag reason, so a flag raised because nobody could
  see the observation says so on the record rather than landing under "Other / unsure".

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-05: one honest message is enough. Do NOT add a second count query to distinguish "matches nothing" from "everything here is done" -- an extra query on every empty result, forever, to change one sentence.

- [x] **A2 · product/UI · blocking** — answered 2026-09-05: disable the commit and say why — a live button that would act on nothing is a button that lies. **Narrowed the same day** by the flag rule below: on an all-failed page a flag is still real work, so the commit is disabled only when it would truly do nothing.

- [x] **A3 · behavioural · blocking** — answered 2026-09-05: a retry must be possible from here.

- [x] **A4 · scientific/data-meaning · blocking** — answered 2026-09-05: the backend notices a missing thumbnail and fetches it, so a failed tile is not permanently stuck and needs no status of its own. The reviewer can also flag it — and a flag belongs in the database, like every other flag. It is not a new client-side concept.

- [x] **A5 · product/UI · non-blocking** — answered 2026-09-05 (question was badly worded; restated): the empty state states the fact and offers one way out -- clear the filters. No next-dive navigation.

## Decisions

- **2026-09-05** — Fixture-backed. `src/data.js` stays the seam; no API work.
- **2026-09-05** — Per-tile failed and queued rendering already exists and is not being
  redesigned. This task is about the page and the chrome around it.
- **2026-09-05** — ~~"Flag to view later" is client-side only.~~ **Wrong, corrected the
  same day.** A flag belongs in the database; that is what flagging means here. There is
  no new client-only concept — flagging a broken tile is the existing flag.
- **2026-09-05** — Retry (A3) re-requests the thumbnail through `data.js`, the same seam
  everything else uses. Per tile, and per page when the whole page failed, because the case
  that motivated it is a whole page of failures.
- **2026-09-05** — **Accepting needs imagery; flagging does not.** `data.js` currently drops
  every non-ready row before it even looks at the marks, so a flag on a broken tile is
  silently lost. "Reviewed" means somebody looked, and that needs a picture. "Flagged" means
  somebody is saying something is wrong, and a missing thumbnail is itself worth flagging.
  So: a marked no-imagery row commits its flag; an unmarked one is skipped rather than
  quietly accepted.
- **2026-09-05** — Scientific review gains a "No imagery" flag reason (R9). The existing
  five — Wrong species, False detection, Duplicate, Bounding box, Other / unsure — have no
  way to say "I could not see it", so every such flag would land under "Other / unsure" and
  the reason a batch of observations was flagged would be invisible to anything querying the
  record later. Training review keeps its own list; a training sample with no imagery is
  already covered by "Ambiguous ID".
- **2026-09-05** — That supersedes A2 in one respect: the commit is **not** disabled on an
  all-failed page, because flags there are real work. It is disabled only when a commit
  would genuinely do nothing.

## Plan

A1-A5 answered. The steps:

1. The fixture gains a way to produce each state on demand — it cannot today, and none of
   this is testable until it can.
2. The rule in `model/`: what a page's state is, given its rows and the filter.
3. The chrome and grid render it.
4. Tests at all three tiers, then a walkthrough of each state.

## Acceptance criteria

- Each state can be reached in the running app and looks deliberate.
- A commit never claims to act on more than it will.
- No phantom page when the result is short.
- `marp verify run` green; a walkthrough shows each state.

## Test plan

Filled in at G3. Expected: the page-state rule in `model/` as unit tests, "what does a
commit act on" in the contract tier, and every one of the four states in Playwright — they
are, by definition, things that are drawn.

## Status

- **Gate:** implementing — A1-A5 answered 2026-09-05, G1 cleared
- **Notes:** nothing implemented.
