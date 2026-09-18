---
task: MarineAppliedResearch/MARP_API#203
status: verified
---

## What was run

```
npm run test:app:mosaic-review:api -- -g "#203"
```

The browser tier, against a real API on the testing database, at desktop and phone width.
This is the tier the issue asked for: it can see which buttons a panel renders, and a
store-level check cannot.

```
Running 4 tests using 1 worker
  ✓  1 [api]       #203 R1, R2, R4: a replacement image can be asked for in training mode (1.1s)
  ✓  2 [api]       #203 R3: a refused replacement in training mode restores the mark and says why (1.0s)
  ✓  3 [api-phone] #203 R1, R2, R4: a replacement image can be asked for in training mode (1.1s)
  ✓  4 [api-phone] #203 R3: a refused replacement in training mode restores the mark and says why (1.1s)
  4 passed (6.2s)
```

Plus `npm run test:unit` (296 checks, 0 failures) after every edit, which carries the parse
check.

## Red first

Both checks were written before the fix and run against it. Verbatim:

```
  ✘  1 [api] #203 R1, R2, R4: a replacement image can be asked for in training mode (11.4s)
    Error: expect(locator).toBeVisible() failed
    Locator: locator('.pick [data-act="replace-thumbnail"]')
    Error: element(s) not found
```

The rest of each check's setup — the tile, the popup, the reason chip — ran, so the failure
is the button's absence and not a broken fixture.

## Requirement by requirement

| | Proved by |
| --- | --- |
| **R1** the button appears in training mode | `#203 R1, R2, R4`, `expect(replace).toBeVisible()` |
| **R2** pressing it behaves as in scientific | same check: popup closes, tile goes `queued`, `thumbnail_status` is `queued`, mark and touch cleared, and the record is re-queried to show no training decision was written |
| **R3** a refusal reports the same way | `#203 R3`: the popup comes back, the `Occluded` chip is still `on`, the row keeps `failed` + `permanent` + a reason, and the mark is back in `state.marks` |
| **R4** the title names the mode's mark | same check, `toHaveAttribute('title', /exclusion/i)` |
| **R5** `delete` mode does not get it | not separately tested. `renderPicker` returns early for `delete` (`picker.js:212`), so the popup this button lives on is never drawn in that mode — the existing delete-mode checks cover that the panel does not appear |

## What is NOT covered

- **The picture actually arriving** after a replacement is requested. The check stops at
  `queued`. It cannot go further: the API under test starts its own thumbnail extraction,
  which claims the queued row and fails it — there is no video behind a seeded observation
  — so the `ready` the test helper writes is overwritten before the poll reads it.
- A real extraction, which needs Jellyfin and is not reachable from any test tier here.

## A pre-existing failure found, and left alone

`#134 R1, R2, R9: requesting a replacement clears the pending flag and writes no review`
fails on its last assertion, and **it fails identically on `origin/develop` with none of
this branch's changes applied** — verified by checking `origin/develop`'s `src/` and
`tests/` out over the branch's and re-running:

```
  ✘  1 [api] #134 R1, R2, R9: requesting a replacement clears the pending flag and writes no review (13.8s)
    Error: expect(locator).toBeVisible() failed
    Locator: locator('.tile[data-id="2095"]').locator('img')
```

Cause: the API log says `Thumbnail extraction started.` The extractor claims the row the
check queued and marks it `failed`, overwriting the `ready` that
`completeThumbnailReplacement` wrote, so the tile is left with no picture. It is the same
reason the coverage gap above exists.

Not fixed here — it is outside #203 and the fix is a decision about whether the test API
should run its extractor at all. Reported rather than repaired.
