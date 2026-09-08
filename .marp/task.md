---
task: MarineAppliedResearch/MARP_API#89
repos: [MARP_API]
status: verified
needs: []
---

# Every mode filters on both workflow statuses, as Delete does

## Goal

A reviewer in Scientific Data Review can narrow the mosaic by training disposition, and a
reviewer in Training Data Review can narrow it by review status — the way Delete Mode
already offers both. #85 made every workflow's *tags* visible from every mode; this does
the same for the *filters*, so seeing that something is already excluded from training is
followed by being able to ask for only those. Nothing about what a mark means, what
arrives marked, or what a commit writes changes: the borrowed dimension is a question the
reviewer may ask, never a decision they can record from the wrong mode.

The one thing that must not move is the default view. `trainingDisposition` defaults to
`['undecided']`, so handing Scientific that filter carelessly would drop every promoted and
excluded observation from its opening page — the exact rows #85 exists to surface.

## What is already true

Read from the code on `89-per-mode-session-work` (this branch's parent), not assumed:

- **`statusDimensions(modeId)` already returns a list**, one entry for the review modes and
  two for Delete, and every consumer reads the list rather than a key: `ui/chrome.js`
  draws it, `filters.queryFilters` decides what to send, `filters.defaultStatusFor` and
  `ensureStatusFor` seed it, `filters.activeFilterCount` counts it, and
  `query-url.js` both writes and reads it. So widening the function is most of the change.
- **The rail already draws two groups.** `renderStatusFilters` puts the first dimension's
  label in `#statusLbl` and gives every later one a `.lbl.sub` heading of its own. Delete
  Mode exercises that path today; the review modes will simply reach it too.
- **The status counts are not conditioned on either status dimension.**
  `store.js:countFilters()` sends `{ species, project, dive }` and nothing else, and
  `data.js:counts()` returns all six values on every call. `ui/chrome.js` reads
  `state.counts[value]` by *value*, and the two vocabularies are disjoint
  (`unreviewed|flagged|reviewed` vs `undecided|promoted|excluded`), so a borrowed
  dimension's counts already exist and already mean the same thing Delete's do. See A1.
- **The default result count is 1083 observations**, measured through the app's own code
  path (`defaultQuery` → `queryFilters` → `MarpData.query`) on the parent branch. Under
  the default question those 1083 split 932 undecided / 66 promoted / 85 excluded — so a
  naive `defaultStatusFor` would silently lose 151 rows.
- **`DEFAULT_FILTERS.trainingDisposition` is `['undecided']`, and `defaultQuery()` copies
  `DEFAULT_FILTERS` straight out with no `defaultStatusFor` pass.** That is the second
  route the trap arrives by, and it is the one that is easy to miss: even a correct
  `defaultStatusFor` leaves the default question carrying `['undecided']`, which would then
  be applied (nothing drops it any more) *and* written into the address, so the default
  question would stop producing a bare address.
- **`MODES` and `STATUS_DIMENSIONS` both describe a dimension.** `statusLabel` /
  `statuses` on `scientific` are character-for-character the same as `statusLabel` /
  `statuses` on `delete`, and `training`'s pair is the same as `delete`'s `also*` pair.
  Once every mode filters on every dimension, those per-mode copies describe the dimension
  rather than the mode. See A2.
- **`existingState`, `borrowedTags`, `pendingException` and `page.seedMarks` are
  untouched by this.** They read `MODES[mode].statusKey`, which stays exactly one
  dimension per mode — what a mode *acts on* is not what it can *filter on*.

## Requirements

- **R1** — Every mode filters on both workflow status dimensions, its own first, in the
  shape Delete Mode already has. `statusDimensions()` stays the single place that decides.
- **R2** — A borrowed dimension arrives **not filtering**. Entering a mode sets the
  dimensions that mode owns to that mode's defaults and the borrowed one to no selection —
  never to the other mode's default.
- **R3** — Scientific's default result set does not move. Measured before the change and
  after it, the default question returns the same number of observations.
- **R4** — The query sends every status dimension the reviewer has narrowed, and sends
  nothing for a borrowed dimension they have not touched. `queryFilters` no longer drops a
  dimension because of which mode is in front.
- **R5** — The counts beside each status keep the meaning they have today: per dimension,
  over the non-status rail filters, unconditioned on either status selection — which is
  what Delete Mode already draws.
- **R6** — The collapsed-rail badge counts a borrowed dimension only while it is
  narrowing, and the badge at the default question is unchanged.
- **R7** — The address: a bare address is still the default question; a borrowed filter
  round-trips; and a link into a mode carrying the other workflow's dimension applies it
  rather than discarding it. Absence of a borrowed dimension means "not filtering", not
  "use the mode default".
- **R8** — Delete Mode is unchanged — both dimensions, both defaults, all three
  training values ticked on arrival.
- **R9** — What a mark means, what arrives marked, and what a commit writes stay the
  active mode's own. Ticking Excluded in Scientific narrows the result and nothing else.
- **R10** — The app's `CLAUDE.md` paragraph stating that the filters deliberately did
  *not* change with #85 is rewritten, not left contradicting the code — and it records that
  #89 reverses A2 of #85 and why.

## Open assumptions

Nothing here is judged blocking: each has one answer the issue or the existing code
settles, and the reasoning is written out so a different answer can overrule it in a
sentence.

- [x] **A1 · product/UI · non-blocking** — *What do the counts beside a borrowed status
  count?* Answered 2026-09-08 from the code: **unchanged — per dimension, over
  `{species, project, dive}`, unconditioned on either status selection.** The counts are
  already computed that way for both dimensions on every call, Delete Mode already draws
  both sets that way, and #89 says Delete does not change and that Delete's rail is the one
  the other two should have. The rival answer — conditioning the borrowed counts on the
  mode's own status filter, so Scientific's *excluded* count means "excluded among the
  unreviewed and flagged" — would change what Delete Mode shows, which the issue rules out.
  Not free of cost: an *excluded* count larger than the result total is possible, exactly as
  it already is in Delete.
- [x] **A2 · architectural · non-blocking** — *Where do a dimension's label and value list
  live?* Answered 2026-09-08: **`STATUS_DIMENSIONS`**, whose docstring already claims to
  declare the dimensions a record carries once. The four per-mode copies (`statusLabel`,
  `statuses`, `alsoStatusLabel`, `alsoStatuses`) become redundant the moment every mode
  filters on every dimension, and a borrowed dimension needs its label from somewhere that
  is not "some other mode's declaration". `MODES` keeps what is genuinely per mode: which
  dimensions it owns, and with what defaults.
- [x] **A3 · behavioural · non-blocking** — *Does a borrowed selection survive a mode
  switch?* Answered 2026-09-08: **no** — `defaultStatusFor` already resets every status
  dimension on entering a mode, deliberately, and R2 makes "reset" mean "not filtering" for
  a borrowed one. So ticking Excluded in Scientific, glancing at Delete and coming back
  leaves it unticked. Consistent with the rule that a mode opens at its own default; the
  rival answer would need a per-mode parking scheme for filters, which is a bigger change
  than #89.
- [x] **A4 · product/UI · non-blocking** — *Is a borrowed dimension marked as borrowed in
  the rail?* Answered 2026-09-08: **no.** "Delete's rail is the one the other two should
  have", and Delete draws two plain groups. The `.lbl.sub` heading already names which
  dimension each group is.

## Decisions

- **2026-09-08** — This reverses **A2 of #85**, which left the filters out of that change
  on purpose. The reasoning there was sound and is now spent: the risk it named was
  "handing Scientific that filter with a careless default would hide the very promoted and
  excluded rows #85 exists to surface". R2 and R3 are that risk, addressed directly and
  measured, rather than avoided by leaving the filter out.
- **2026-09-08** — A mode's **own** dimension and the dimensions it **filters on** are now
  different things. `MODES[mode].statusKey` (own) drives `existingState`, mark seeding and
  the commit; `statusDimensions(mode)` (filters on) drives the rail, the query, the
  defaults, the badge and the address. Conflating them again is how a training exclusion
  comes to seed a scientific mark.

## Plan

1. `model/modes.js` — move `label` and `statuses` onto `STATUS_DIMENSIONS`; widen
   `statusDimensions()` to append every dimension the mode does not own, with
   `defaults: []` and `own: false`.
2. `model/filters.js` — derive `DEFAULT_FILTERS`' status entries from
   `statusDimensions('scientific')` so the default question carries no training narrowing;
   stop `queryFilters` dropping a status dimension.
3. Unit tests for R1–R2, R4, R6, and the R3 rule (the default question sends no
   training-disposition narrowing).
4. `tests/unit/query-url.test.mjs` — R7: bare address, borrowed round trip, a link into
   Training carrying a review-status filter.
5. `tests/e2e/render.spec.mjs` — R1, R3, R9: both groups drawn in Scientific and Training,
   the default total measured against the fixture, ticking Excluded narrows to excluded.
6. Rewrite the `CLAUDE.md` paragraph (R10).
7. Re-measure the default result count and run `npm run test:e2e` once.

## Acceptance criteria

- The default question returns 1083 observations after the change, as it did before it.
- Scientific's rail draws Review status and Training disposition, with the three training
  boxes unticked on arrival.
- Ticking Excluded in Scientific returns only excluded observations.
- Training's rail draws Training disposition first and Review status below it.
- Delete Mode's rail is byte-identical in behaviour: both defaults applied, all three
  training values ticked.
- `?trainingDisposition=excluded` in a scientific address applies; a bare address is still
  the default question; `toQuery(defaultQuery()) === ''`.
- `npm run test:unit` green; `npm run test:e2e` green at desktop and phone.

## Test plan

See `.marp/verification.md` — which test proves which requirement, the measured before and
after counts, and what is not covered.

## Status

- **Gate:** verifying — evidence recorded, waiting on a human. No PR opened.
- **Notes:** branched from `89-per-mode-session-work`, which is ahead of `develop` with the
  per-mode session parking and the page-scoped mark count. Baseline on that branch: 120 unit
  tests passing, default result total 1083. Now 127 unit tests and 206 browser tests pass,
  and the default result total is still 1083.

  Two existing tests had to change rather than pass, and both are judgement calls worth
  overruling if they are wrong:

  - `render.spec.mjs` asserted that *only* Delete offered both dimensions. That is the rule
    reversed, so it now asserts what is still Delete's own — the default.
  - `L7: nothing in the rail is drawn where it cannot be reached` asserted that the rail's
    contents fit without scrolling. Six status boxes plus a sub-heading no longer fit, so
    Scientific's rail scrolls the way Delete's already did. The test now asserts the
    container is scrollable whenever it overflows, in all three modes. The alternative was
    to shorten the rail, which is a design change #89 did not ask for.
