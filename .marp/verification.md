# Verification — MARP_API#138, a committed delete is not interactive

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `tests/unit/model.test.mjs` — *R1: an observation a commit destroyed is destroyed, and nothing else is* | unit | `page.isDestroyed` answers for a deleted outcome and for nothing else — not accepted, not flagged, not conflicted, not an untouched id |
| R2 | `tests/requirements.js` — *R2 (#138): a committed delete cannot be marked again* | contract | after a real delete commit, `toggleMark` leaves `state.marks` and `state.touched` exactly as they were, and the next commit has nothing to send |
| R3 | `tests/requirements.js` — *R3 (#138): the accept gesture does not reach a destroyed tile* | contract | `acceptMark` marks nothing and raises no A4 refusal |
| R4 | `tests/requirements.js` — *R4 (#138): neither route into the correction panel opens on a destroyed tile* | contract | `openCorrection` opens no panel **and creates no mark on the way in**; `openPicker` opens none either |
| R5 | `tests/requirements.js` — *R5 (#138): marking the page steps over what the page has already destroyed* | contract | `markAllOnPage` marks every other row and not the destroyed one, and the delete confirmation names only rows that still exist |
| R2, R8 | `tests/e2e/render.spec.mjs` — *R2/R8 (#138): clicking it does nothing, and it says it is not a target* | render | a real click on a committed-deleted tile draws no `marked` class and no second badge; the tile still reads `DELETED` and carries `aria-disabled` |
| R6 | `tests/e2e/render.spec.mjs` — *R6 (#138): the tooltip says why nothing happens* | render | the tile's `title` says the observation was removed from the database |
| R3, R4 | `tests/e2e/render.spec.mjs` — *R3/R4 (#138): neither the accept gesture nor the badge reaches it* | render | a right click leaves the tile unmarked and raises no refusal; clicking the badge opens no `.pick` panel |
| R7 | `tests/e2e/render.spec.mjs` — *R7 (#138): it stays on screen with its picture* | render | the destroyed tile still draws its `<img>` |
| R5 | `tests/e2e/render.spec.mjs` — *R5 (#138): "flag all on page" steps over it* | render | the page-level mark marks the rest of the page and not the destroyed tile. Desktop only: `.markall` is `display: none` under the phone media query, so the gesture does not exist there |

**Why these tiers.** The rule is a rule, so it is proved in `model/` in sixty
milliseconds. *"The click now does nothing"* is a fact about what was drawn, and every
rendering defect in this app so far passed the store-level checks — so it is asserted in
Playwright, with a real click. The contract tier sits between them and is where the
refusals themselves are pinned, because it can drive a real commit through the
confirmation and then ask the store what it did.

## Requirements with no test

None. R1–R8 each have at least one test above.

## Edge cases

- **A destroyed tile in another mode.** Cannot happen: `cache.keyFor` carries the mode, so
  a mode switch empties the cache and re-queries, and the row is gone from the server. This
  is why the rule reads the outcome map rather than a session-wide set of destroyed ids
  (A1), and why the guards cannot be defeated by switching modes and back.
- **A conflicted delete destroyed nothing.** The statement matched no version, the row is
  still there, and the tile must stay actionable. Asserted in the unit test.
- **The id is already in `state.touched`.** The reviewer marked the tile before deleting
  it, so R2 pins that the dead click *changes* nothing rather than that the id is absent —
  the first draft of that assertion was wrong and the check caught it.
- **`aria-disabled` is advisory.** Playwright reads it as *not enabled* and would wait the
  tile out, so the render tests click with `force` — which is the dead click a reviewer
  actually makes, refused by the store rather than swallowed by the harness.

## Regression coverage

All four render tests and three of the four contract checks were run against the old files
first and failed, on `class="tile marked"` drawn over an observation the same session had
destroyed. That is the reported defect, at the tier that can see it.

## Known gaps

- **`retryFailedThumbnails` is not covered and is not guarded** (A4). A page-level retry
  can still name a destroyed row whose thumbnail had failed. It costs a request rather than
  a record, it is not one of the gestures #138 names, and it is left alone deliberately.
- **No API-tier test.** Nothing here lives in the gap between what a commit recorded and
  what the row still says — the refusal reads the commit's own answer, and both backings
  put the same `deleted` outcome there. An API-tier case would have to destroy a real
  corpus observation to assert a client-side refusal, with nothing to restore it with.
- **CI runs the fast tiers only**, so a green pipeline is not this verification.

## Manual steps

None. Everything above is automated.

---

## Results

From `frontend/apps/marp-mosaic-review`, on 2026-09-12, against `develop` at 7fe355e3.

```
$ npm run test:unit
ℹ tests 283
ℹ pass 283
ℹ fail 0
```

```
$ npm run test:e2e
  5 skipped
  295 passed (2.0m)
```

Four of the five skips are pre-existing; the fifth is R5 at phone width, skipped because
the control it drives is not rendered there.

**Red first.** With `src/store.js` reverted, three of the four contract checks failed:

```
"R2 (#138): a committed delete cannot be marked again
 the row is gone from the database; nothing may mark it expected false, got true",
"R4 (#138): neither route into the correction panel opens on a destroyed tile
 the chip must not open the chooser expected null, got {"id":100129,"correcting":true}",
"R5 (#138): marking the page steps over what the page has already destroyed
 the destroyed row must not be marked expected false, got true",
```

R3 passed there, as its own comment says it would. With `src/store.js` and `src/ui/tile.js`
reverted, all four render tests failed, on the tile the same session had destroyed:

```
Error: expect(locator).not.toHaveClass(expected) failed
    18 × locator resolved to <button data-id="100129" class="tile marked" ...>
```
