---
task: MarineAppliedResearch/MARP_API#134
repos: [marp-api]
status: verify
needs: []
---

## Goal

From a flagged tile's details panel, a reviewer can ask MARP for a different square
thumbnail without creating a scientific `No imagery` decision. That request becomes the
first work in the extraction schedule, tries a different keyframe or a bounded interpolated
frame, and replaces the Mosaic image as soon as it is ready. Full-resolution frame
inspection is tracked separately by #176 and video-player integration remains outside this
task.

## Requirements

- **R1** -- The Scientific Data Review details panel has a separate, plainly named
  `Request replacement image` action. `No imagery` is no longer a reason that can be
  attached to or committed as a scientific review decision.
- **R2** -- Using the replacement action clears the temporary flag, reason, and note for
  that tile before it queues extraction. It appends no review-history row and changes no
  current scientific decision.
- **R3** -- Replacement can be requested for a failed thumbnail or for a `ready`
  thumbnail that the reviewer judges unusable. Structural permanent failures that no
  alternative frame can repair remain refused with an explanation.
- **R4** -- A reviewer-requested replacement or retry is the highest-priority class in the
  thumbnail schedule, ahead of page-triggered and future background work while remaining
  inside the existing Jellyfin concurrency ceiling. Requests within that class remain
  first-in, first-out.
- **R5** -- The first extraction keeps the current representative-frame rule. Later
  requests use one finite deterministic sequence within the already-selected first object
  subset: untried real keyframes ordered by distance from the observation frame, followed
  by one untried midpoint frame from each adjacent keyframe span, also ordered by distance.
  Candidate frame numbers are de-duplicated.
- **R6** -- An interpolated candidate uses only the two surrounding keyframes from the
  selected subset to calculate its box. MARP never interpolates between different tracked
  objects.
- **R7** -- One request causes one extraction attempt. A failure stays retryable while a
  candidate remains; exhausting the finite candidate sequence makes the failure permanent.
  One gesture never opens multiple Jellyfin streams in succession.
- **R8** -- Attempt state survives re-queueing and structurally records which candidate was
  attempted, including failures. Selection never parses a frame number from error prose and
  never rewrites observations, keyframes, or review history.
- **R9** -- The Mosaic immediately paints the tile as preparing, polls through the existing
  page query, and swaps in the replacement thumbnail as soon as it is ready. It never
  fabricates synchronous success, freezes the page, or leaves a `No imagery` flag behind.
- **R10** -- Existing per-tile and per-page `Ask again` controls use the same priority and
  candidate-rotation rules for transient failures. Existing permanent structural failures
  remain protected from repeated requests.
- **R11** -- Existing historical review rows whose reason is `No imagery` remain readable
  and unchanged. Removing that value from new commits is not a migration or a rewrite of
  the scientific record.
- **R12** -- Repository, extraction, API, model, and real-browser tests prove the separate
  action, absence of a review write, priority ordering, ready-row replacement, deterministic
  rotation, interpolation, exhaustion, queued UI, successful image swap, and permanent
  refusal.

## Open assumptions

- [x] **A1 · scientific or data-meaning · blocking** -- Answered 2026-09-13: a successful
  replacement leaves no `No imagery` flag because no such review decision is written in
  the first place. The extractor never authors or withdraws a review on somebody's behalf.
- [x] **A2 · product/UI · blocking** -- Answered 2026-09-13: requesting replacement is a
  special second button in the pop-up details panel. It is not the page commit and does not
  require committing a flag.
- [x] **A3 · performance/concurrency · blocking** -- Answered 2026-09-13:
  reviewer-requested work is the number-one priority class in the entire thumbnail schedule.
- [x] **A4 · behavioural · blocking** -- Answered 2026-09-13: usable keyframes may all be
  tried, and interpolated frames may be tried if needed. The finite rule is the real
  keyframes plus one midpoint per adjacent span in the chosen subset, one explicit request
  at a time; it never crosses subsets.
- [x] **A5 · API contract · blocking** -- Answered 2026-09-13: add
  `POST /api/v2/observations/:observationId/thumbnail/replacement` for this one
  reviewer-driven action, and keep the existing page retry endpoint's bulk/failure-only
  meaning.

## Decisions

- **2026-09-13** -- `No imagery` becomes an extraction action, not a scientific-review
  reason. Existing historical values are preserved, but the client and commit validator no
  longer offer or accept a new one.
- **2026-09-13** -- The replacement action removes the tile's pending mark locally and
  queues extraction directly. Success is represented by the new image arriving, not by an
  automatically written review transition.
- **2026-09-13** -- #134 owns replacement of the square bounding-box thumbnail. #176 owns
  extraction and full-screen pan/zoom inspection of the complete high-resolution source
  frame. They share extraction limits and serving patterns but produce different artifacts.
- **2026-09-13** -- Video playback, scrubbing, and player integration are Phase 10 work and
  are not included in either thumbnail retry or the full-resolution still issue.

## Plan

1. Add named failing repository and extraction tests for top priority, preserved candidate
   position, real-keyframe rotation, midpoint interpolation, ready-row replacement, and
   exhaustion.
2. Add the minimum durable queue/candidate state and migration required to distinguish
   reviewer priority and remember attempted candidates; preserve all existing rows.
3. Implement the replacement endpoint and keep the existing bulk retry behavior compatible.
4. Replace the `No imagery` reason chip with the separate panel action, clear pending
   review state on use, and connect it to existing bounded polling.
5. Add real-API browser coverage for the complete gesture and resulting image lifecycle.
6. Write the G3 verification plan and stop for approval before running it.

## Acceptance criteria

- A reviewer can request another crop from the tile panel whether the current thumbnail is
  failed or merely unusable.
- The request writes no review decision and leaves no pending or committed `No imagery`
  flag.
- Interactive replacement work is claimed before ordinary queued work.
- Each explicit request tries a new finite candidate and never crosses object subsets.
- A ready replacement appears in the existing tile as soon as bounded polling observes it.
- Candidate exhaustion is permanent; structural permanent failures remain unqueueable.
- Historical `No imagery` review records remain intact and readable.
- #176 remains independently implementable and no video-player code is added here.

## Test plan

Filled in at G3 after A5 is approved and implementation is complete. Targeted groups will
be `tests/thumbnails.test.js`, `tests/mosaic-commit.test.js`, the Mosaic unit group, and
named real-API browser checks that observe the panel action and image lifecycle.

## Status

- **Gate:** verification evidence awaiting human review
- **Notes:** Existing retry resets `attempts` to zero, the planner always calls the same
  deterministic `chooseBox`, failed extraction does not structurally record its candidate,
  and ready thumbnails are explicitly refused by the retry endpoint. The design now reflects
  the human's corrections and the published replacement endpoint is approved.
