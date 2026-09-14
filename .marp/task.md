---
task: MarineAppliedResearch/MARP_API#172
repos: [MARP_API]
status: ready-for-pr
needs: [database-schema]
---

## Goal

Make the Mosaic Reviewer's structured exception reasons and free-text decision notes part
of the existing staged commit workflow. A reviewer can open details for reviewed, flagged,
promoted, or excluded decisions; committed details survive a reload and remain independent
between scientific and training review.

## Requirements

- **R1** — Preserve two meanings in the scientific record. `reason` remains an optional
  mode-specific structured value for flagged or excluded decisions. `note` is optional
  plain text on any scientific or training decision.
- **R2** — Add a nullable note field to both `observation_reviews`, the append-only history,
  and `observation_review_current`, its maintained current projection. Existing rows remain
  valid with a null note, and projection rebuild/integrity rules preserve the field.
- **R3** — The Mosaic commit contract accepts a note with a marked decision, validates and
  normalizes it according to the settled limits, writes it to history, and carries it into
  the current projection. The page query returns the current scientific and training notes
  independently.
- **R4** — The status badge opens a decision-details panel for each recorded or pending
  `reviewed`, `flagged`, `promoted`, and `excluded` state. Clicking the tile outside the
  badge retains its existing mark/take-back behavior.
- **R5** — Flagged and excluded details retain their current mode-specific reason choices.
  Every reason may carry a note, and reviewed and promoted details expose the same note
  editor without inventing an exception reason.
- **R6** — There is no separate Save action. Changing a reason or note stages that tile,
  makes the pending state visible, and keeps the edit in the current browser session until
  it is committed, reverted, or superseded by another deliberate edit.
- **R7** — Both existing commit controls include staged detail edits. `Commit Marked`
  includes an otherwise already-recorded decision whose details changed, and a page commit
  carries those details while retaining its established sweep behavior.
- **R8** — A successful details edit appends a new `observation_reviews` row and updates
  `observation_review_current`; it never mutates an earlier history row. A failed or refused
  commit leaves the staged edit available and does not claim it was stored.
- **R9** — After reload/re-query, a saved exception reason recreates its reason chip and
  reopening any decision badge shows its saved note. The tile shows a compact indication
  that a note exists, never the full free text; the badge remains the route back to it.
- **R10** — Scientific reason/note and training reason/note remain independent when the
  same observation has decisions in both purposes.
- **R11** — Notes are plain text. User content is rendered safely as text in the editor and
  never interpolated as active markup into the tile or panel.
- **R12** — Named repository and real-API browser tests cover migration shape, history and
  projection writes, query hydration, staged UI behavior, both commit buttons, reload
  persistence, all four decision values, and purpose independence.
- **R13** — On a phone, focusing and typing in the note editor keeps that editor inside the
  keyboard-reduced visible viewport and leaves the panel vertically scrollable. A downward
  drag from the top of the mosaic remains available to the browser's pull-to-refresh.
- **R14** — Every recorded reviewed, flagged, promoted, or excluded badge and borrowed tag
  shows the decision author's two initials in a consistent compact circular icon. The initials
  are derived from the existing `reviewer_id` relationship and username at query time; no
  identity row, review row, or initials column is added to the database. Existing exception
  decisions seeded into the page's mark map retain their stored author's initials.
- **R15** — Decision tags, supporting chips, and the species-name caption remain legible
  while using translucent backgrounds that reveal more of the thumbnail underneath. Delete
  Mode retains its established visual treatment.
- **R16** — Each tile with a numeric confidence shows a compact lower-right confidence
  chip inside the transparent species-caption line. The caption reserves its right edge
  for the chip, while decision tags retain their established position above it. It renders
  the rounded percentage with at least two
  digits (`0.54` as `54`, `0.07` as `07`), does not overlap a decision tag, and a missing
  confidence renders no chip.

## Open assumptions

- [x] **A1 · API contract/database schema · blocking** — Answered 2026-09-13: notes are
  limited to 1,000 Unicode characters, stored as `text`, and rejected above the limit by
  the API. Leading/trailing whitespace is trimmed and a blank result is stored as null.
- [x] **A2 · scientific/data meaning and product/UI · blocking** — Answered 2026-09-13:
  a note may accompany any structured flag/exclusion reason, including but not limited to
  `Other / unsure`, and may also accompany reviewed or promoted decisions. Changing the
  structured reason never silently clears the note.
- [x] **A3 · product/UI · blocking** — Answered 2026-09-13: no Save details button. Reason
  and note edits are staged and saved through the existing commit controls with the rest of
  the review work.
- [x] **A4 · database/schema · blocking** — Answered by the requested distinction and the
  existing contract: do not overload `reason`. Add a nullable note to both review history
  and current projection so structured exception classification and explanatory free text
  remain separately queryable and lossless.
- [x] **A5 · product/UI · non-blocking** — Preserve the established gesture split: the
  decision badge opens details; the surrounding tile continues to mark or take back.
- [x] **A6 · product/UI and security/permissions · blocking** — Answered 2026-09-13: show
  every decision author's initials. Derive them from the username reached through the
  review's existing `reviewer_id`; do not add a database row or persist duplicated initials.
  A small additive Mosaic response change is acceptable.

## Decisions

- **2026-09-13** — The backend already persists and returns a structured reason when it is
  included in a commit. The disappearing chip is a client staging defect: `setReason`
  changes only browser state and does not make an existing seeded exception eligible for
  `Commit Marked`.
- **2026-09-13** — Notes are distinct from reasons. The current contract intentionally
  rejects reasons on accepted decisions and enforces a closed reason vocabulary; relaxing
  that field would change existing scientific meaning.
- **2026-09-13** — Details use the established commit workflow. Edits remain pending until
  an existing commit action succeeds, rather than creating a one-off save path.
- **2026-09-13** — The details target is the status badge for every decision value. This
  extends the target already used by flags while preserving the separately settled tile
  gestures.
- **2026-09-13** — Notes apply to all four scientific/training decision values and may
  supplement any structured exception reason. A compact tile indicator says a note exists;
  the full text remains in the details panel.
- **2026-09-13** — Notes are capped at 1,000 Unicode characters, trimmed at the API
  boundary, and normalized from blank text to null.
- **2026-09-13** — Mobile review keeps the details panel inside the visual viewport while
  the keyboard is present and permits the browser's native pull-to-refresh gesture.
- **2026-09-13** — Decision attribution is one or two initials derived from the existing
  author's username. The Mosaic response exposes only those initials alongside its existing
  reviewer id; it does not expose a full name or username and stores nothing new.
- **2026-09-13** — Image overlays use lighter translucent surfaces so labels do not conceal
  as much of the organism. Delete Mode remains outside this visual adjustment.

## Plan

1. Add the nullable note columns through a reversible migration and update both Sequelize
   models plus projection rebuild/integrity coverage.
2. Extend commit validation, history insertion, projection maintenance, OpenAPI schemas,
   generated documentation, and page-query fields without weakening reason validation.
3. Extend the Mosaic row/mark model so a pending or recorded decision can stage details,
   becomes eligible for either commit control, and hydrates its saved details after reload.
4. Generalize the badge details panel across both values in Scientific and Training while
   retaining mode-specific structured reasons only for exceptions.
5. Derive current decision-author initials through the existing reviewer/user relationship
   and render them on every recorded primary badge and borrowed tag.
6. Write the detailed G3 verification plan after A1 and A2 are answered; do not run tests
   before the human approves that plan.

## Acceptance criteria

- Existing flags and exclusions can acquire or change a reason through a normal commit,
  and the reason chip survives reload.
- Reviewed, flagged, promoted, and excluded decisions can carry a persisted note, and a
  flag/exclusion note can accompany any structured reason.
- Both commit buttons save staged details and continue to perform their existing decision
  semantics.
- Reopening a badge shows the current stored or staged details, and the UI distinguishes a
  pending edit from a stored value.
- Review history, current projection, API responses, and browser rendering agree after a
  commit and reload.
- Existing records, reason vocabularies, decision ownership/concurrency behavior, Delete
  Mode, species correction, and tile gestures retain their established meaning.

## Test plan

Written in `.marp/verification.md`. It names the focused migration/repository tests and
real-API Playwright cases that restore every disposable row they touch. Awaiting human
review before any verification command is run.

## Status

- **Gate:** verification plan awaiting approval
- **Notes:** The isolated workspace is based on the `develop` merge of #170. Investigation
  and G1 are complete with every material assumption answered. The separate populated
  review server remains on the prior workspace for the human to explore.
