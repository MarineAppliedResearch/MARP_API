---
task: MarineAppliedResearch/MARP_API#137
repos: [marp-api]
status: ready-for-pr
needs: []
---

## Goal

Make the pager colour and completed-page count reflect a fully decided page after Commit Marked, including decisions accumulated across several commits.

## Requirements

- **R1** — In Scientific and Training review, a successful selective commit completes the page only when every displayed row has a decision in the current mode, from this sitting or its existing record.
- **R2** — Partial selective commits leave the page incomplete until the remaining rows are decided.
- **R3** — Selective commits never pin page membership or rows, even when the completion indicator changes.
- **R4** — A fully successful sweep continues to show completion. The pager colour and completed-page count use the same completion state.
- **R5** — Completion is a pure rule in model/page.js, exercised by focused logic and browser assertions.

## Open assumptions

- [x] **A1 · behavioural · blocking** — Settled by the user: leave Delete Mode alone.
- [x] **A2 · behavioural · blocking** — Settled by the user: a page only shows complete when everything on it has been committed. A conflicted outcome is not a successful commit.

## Decisions

- 2026-09-12 — Rebased onto pushed develop a3a7990a; preserved #135 take-back/version fixes and #151 phone chrome. Browser tests use the real-API runner and the isolated `marp_test` database.
- 2026-09-12 — Work is isolated on 137-commit-marked-pager. No API or schema changes are planned.
- 2026-09-12 — The inherited task specification described #138; it is replaced on this task branch only. Its original record remains in Git history.
- 2026-09-12 — Other registered workspaces cover #151 and #157. Their task files currently also describe #138, so they cannot establish precise file ownership. Keep edits confined to completion logic and its focused tests; do not modify their layouts or browser infrastructure.

## Plan

1. Settle A1 and A2.
2. Add the pure completion predicate and call it after commit outcomes are applied, keeping selective pinning unchanged.
3. Add focused model/store and rendered-pager regression cases.
4. Present the verification plan for approval before executing it.

## Acceptance criteria

All rows decided together or across commits produces a coloured pager and an incremented count. Partial work remains incomplete. Selective commits never exclude untouched records from later queries.

## Test plan

See .marp/verification.md for the issue-specific scenarios, real-API test environment, restoration, commands and coverage gaps. The user authorized resuming on the new testing system.

## Status

- **Gate:** ready-for-pr
- **Notes:** Implemented on current pushed develop. Focused verification passed: 3 model tests and 18 real-API browser tests. Evidence and setup failures are in .marp/verification.md. No whole-suite run, push or PR.
