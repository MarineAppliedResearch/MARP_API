---
task: MarineAppliedResearch/MARP_API#77
repos: [MARP_API]
status: design
needs: []
---

# Filter rail: the remaining dimensions, and multi-select

## Goal

A reviewer can ask for the irregular combinations the work actually requires — two dives
from one project and one from another, the model's uncertain calls only, the night dives —
instead of one project, one dive, one line at a time.

## What is already true

Read from the code and the database, not assumed:

- **The rail is five controls**, each a `.sel` button opening `menu()` from `ui/menus.js`.
  Adding a dimension today means touching `model/filters.js`, `data.js` twice, `index.html`,
  `ui/menus.js`, `ui/chrome.js` and `ui/mount.js` — the notes say so, and that is the cost
  this task should not multiply by five.
- **`applyFilter` nests bluntly**: setting `project` clears `dive` and `line`; setting
  `dive` clears `line`. That rule exists because a line only means something inside a dive.
- **`toggleStatus` already does multi-select** for the status dimensions. Project, dive and
  line are the single-select ones.
- **`tc` is .NET TimeSpan text with an optional day group.** `db/timecode.js` parses
  `(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})`, so a dive crossing midnight reads `1.00:15:33`
  and `21:57:22` is day 0. The parser already handles it; nothing here re-implements it.
- **The fixture has `session_id` (12), `session_type` (ROV / Drop Cam) and
  `processor_name` (3).** `confidence` runs 0.50–0.99. There is no model field.
- **The fixture's `video_source` values carry no date** (`dive4_line1.mp4`), unlike
  production (`20190712_215503_Fwd`). Nothing here depends on that; see #76.

## Requirements

- **R1** — Session, session type and processor are filterable.
- **R2** — Confidence filters by a range, both ends, replacing `minConfidence`.
- **R3** — Time of day filters every observation, whether or not `tc` carries a date.
- **R4** — A time-of-day range may wrap past midnight, and observations either side of it
  are one window. A dive from 22:00 to 02:00 is one night.
- **R5** — Date filters where `tc` carries one, and **says how many observations it had to
  exclude for having none**. A filter that silently omits is worse than no filter.
- **R6** — Project, dive and line accept several values.
- **R7** — Removing one value from a wider dimension drops only what no longer applies.
  Removing a project takes its dives with it and leaves the others.
- **R8** — An empty selection in a dimension means that dimension is not filtering.
- **R9** — The dive and line lists still offer only what the chosen filters can return.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-05: confidence is one slider with
      two handles, replacing the one-ended `minConfidence`.
- [x] **A2 · product/UI · blocking** — answered 2026-09-05: a time-of-day range may wrap
      past midnight, and `tc`'s day component is how that shows up in the data.
- [x] **A3 · product/UI · blocking** — answered 2026-09-05: an empty selection means the
      dimension is not filtering, matching how the status filters already behave. Clearing
      a dimension widens the result rather than blanking the screen.
- [x] **A4 · product/UI · non-blocking** — decided rather than asked: the rail's shape at
      ten controls is mine to show. Grouped by the question each answers — where it came
      from, what it is, when, who — so the column is scannable rather than ten identical
      dropdowns.

- [x] **A5 · architectural · blocking** — answered 2026-09-05: refactor first. A dimension
      becomes one declaration, the way `MODES` already works for the status filters. Adding
      the sixth then costs almost nothing, and the seven-file dance stops being a trap for
      whoever comes next.

## Decisions

- **2026-09-05** — Fixture-backed. `src/data.js` stays the seam.
- **2026-09-05** — The refactor comes first and is judged by one test: adding a dimension
  is one entry in a declaration and nothing else. If it ends up being two places, it has
  not worked, and the five dimensions should wait rather than be built on a half-refactor.
- **2026-09-05** — Parsing `tc` goes through `db/timecode.js` when this reaches the API.
  The client's own parsing must agree with it exactly, including the day group, or the same
  observation lands in two different hours depending on who asked.
- **2026-09-05** — Model stays a placeholder. There is no data behind it until Phase 3, and
  a control that filters nothing is worse than one that is visibly not ready.

## Plan

A1-A5 answered. The steps, refactor first:

0. `model/filters.js` grows a `DIMENSIONS` declaration — key, label, where the values come
   from, what it nests under, single or multi. The rail, the query, the counts, the labels
   and the collapsed-rail badge all read it, the way they already read `statusDimensions()`.
   **The five new dimensions are added only after adding one is a single entry.**
1. `model/filters.js` — multi-select, the nesting rule that drops only what no longer
   applies, and the time-of-day window including the wrap.
2. `data.js` — the new dimensions in `query` and `counts`, and the count of rows excluded
   for having no date.
3. The rail, grouped.
4. Tests at all three tiers, then a walkthrough.

## Acceptance criteria

- Two dives from one project and one from another can be reviewed together.
- Removing a project keeps the dives that still apply.
- A 22:00–02:00 window returns both sides of midnight.
- The date filter states its exclusions.
- `marp verify run` green.

## Test plan

Filled in at G3. The nesting rule and the midnight wrap belong in `model/` as unit tests —
the wrap especially, because it is arithmetic and a browser proves nothing about it. What
the query returns belongs in the contract tier. The rail's grouping and the exclusion
notice belong in Playwright.

## Status

- **Gate:** G3 — implementation complete, verification plan written and awaiting review
- **Notes:** nothing implemented.
