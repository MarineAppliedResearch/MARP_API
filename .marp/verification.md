---
task: MarineAppliedResearch/MARP_API#206
status: verified
---

## What was run

```
npm run test:app:mosaic-review:api -- -g "#206"

  ✓ 1 [api]       #206 R1, R5 scientific: the track length is on the tile, and reads 0f with no keyframes
  ✓ 2 [api]       #206 R1, R5 training:   the track length is on the tile, and reads 0f with no keyframes
  ✓ 3 [api]       #206 R2, R3, R4: a reason and the track length are both shown, and neither covers the other
  ✓ 4 [api]       #206 R4: the corner does not swallow a click meant for the tile
  ✓ 5-8 [api-phone] the same four, at phone width
  8 passed (8.0s)
```

Plus `npm run test:unit` (296 checks) after every edit, and the whole browser tier once —
see *The tier run, and the 48 failures in it* below.

## Red first

Proved against `develop`'s `tile.js` and `app.css` copied over the branch's, then restored
from a copy — never `git checkout --`, which discards uncommitted work:

```
  ✘ 1 #206 R1, R5 scientific: ...   Locator: locator('.tile[data-id="2095"]').locator('.frames')
                                    Error: element(s) not found
  ✓ 2 #206 R1, R5 training:  ...    (855ms)
  ✘ 3 #206 R2, R3, R4: ...          .frames not found
  ✘ 4 #206 R4: ...                  .frames not found
  3 failed, 1 passed
```

**The training case passing on `develop` is the useful half of that.** It says the check is
pointed at the right thing: training mode already had the chip, scientific never did, and
the three that failed are exactly the three the issue is about.

## Requirement by requirement

| | Proved by |
| --- | --- |
| **R1** visible in both modes, no hover | `#206 R1, R5`, run once per mode, asserting `.frames` is *visible* rather than present |
| **R2** reason and count together | `#206 R2, R3, R4` — a tile marked `Duplicate` in scientific mode shows both chips with their own text |
| **R3** neither covers the other | same check, asserting the **geometry**: `overlaps` is false and the count's top is at or below the reason's bottom. Two chips can both satisfy `toBeVisible()` while occupying the same pixels, which is precisely what two rules sharing `top: 4px; right: 4px` produced |
| **R4** the corner takes no click | `#206 R4` — clicks the frame chip itself and asserts the **tile** becomes marked. This is the regression the change could cause: a positioned container laid over a tile is how a corner starts eating gestures |
| **R5** `0f` with no keyframes | `#206 R1, R5` — `seedPage` without `tie` plants no keyframes, and the assertion is `toHaveText('0f')`, which a client that coalesced badly would fail with `undefinedf` |

Both projects, `api` and `api-phone`, so R3 is checked at desktop and phone width.

## The tier run, and the 48 failures in it

The whole browser tier was run, and **48 of 587 failed. None of them are mine.**

That is established rather than asserted. The same three files were run on `origin/develop`
and on this branch, and the failing test *names* were captured and diffed:

```
$ diff fail-develop.txt fail-branch.txt && echo IDENTICAL
IDENTICAL          # 13 failures, the same 13, on both
```

None of the eight `#206` checks is among them, and every failure is in a file this branch
does not touch.

**The cause, as far as it was chased:** the API the tier starts runs its own thumbnail
extraction (`Thumbnail extraction started.` in its log). It claims the thumbnails of
observations the checks seed, cannot produce a crop — a seeded observation has no
`video_source` — and marks them `failed`. A freshly reset testing database, immediately
after one full run:

```
observations                    2187      (the dump has 2091)
observations with no video_source  96      left behind by seeders
thumbnails failed                 111, of which
  'No Jellyfin video matched video_source ""'   96
```

So each full run leaves about ninety-six seeded observations behind with broken pictures,
and several of the failing checks reason about the *population* of rows with no imagery —
`openOnBrokenPicture`, "an unmarked row with no imagery is skipped", "the button says how
many will be skipped". A corpus gaining ninety-six broken rows per run is not the corpus
they were written against.

Two things follow, and neither is fixed here because neither is #206:

- `npm run testing-db reset` does **not** clear it, which is why it looked like corpus
  exhaustion at first and is not: the pollution is regenerated inside the very next run.
- It is the same root cause as the `#134` failure recorded on the `#203` branch.

Left alone and reported. The fix is a decision about whether the tier's API should start
its extractor at all, and that is the human's to make.

## What is NOT covered

- **Delete mode.** The count is now unconditional, so it renders there too, and nothing
  asserts it. It was not asked for — see A2 — and the delete-mode checks are among the
  pre-existing failures above, so adding an assertion there would have nothing trustworthy
  to stand on.
- **A reason long enough to wrap.** `.reason-chip` is given `max-width: 100%` with an
  ellipsis and the corner is capped at the tile's width less its gutters, but no check
  drives a reason longer than the five in the vocabulary.
