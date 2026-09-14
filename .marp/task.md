---
task: MarineAppliedResearch/MARP_API#176
repos: [marp-api]
status: verify
needs: []
---

## Goal

From any Mosaic tile's existing details panel, a reviewer can identify the exact
observation, request the complete source-video frame behind the
thumbnail, and inspect that frame full-screen with zoom and pan. These inspection actions
must not change the square thumbnail, a pending mark, or any scientific review data. This
milestone delivers #176 and #178 together; persistent source-video playback remains the
following milestone in #181.

## Requirements

- **R1** — The details panel clearly labels the tile's exact `observation_id` as
  `Observation ID` in Scientific, Training, and Delete modes, for every thumbnail and
  review state. The identifier is selectable and is not added to the tile face.
- **R2** — The Observation ID is compact inline metadata rather than a bordered card. It
  has no dedicated copy button or feedback row and leaves room for the review controls.
- **R3** — Displaying an observation ID changes no mark, note, current review,
  review-history row, observation, or thumbnail record.
- **R4** — The same details panel offers an explicit `Request full frame` action. One
  gesture creates or reuses an asynchronous full-frame request for the exact observation
  and never pretends the artifact is ready synchronously.
- **R5** — A full-frame request captures the complete decoded video frame at the exact
  moment currently recorded on the ready square thumbnail. It does not return only the
  crop, choose another keyframe, advance the replacement candidate sequence, or alter the
  square thumbnail.
- **R6** — Full-frame work has durable queued, in-progress, ready, and failed states. A
  page reload or API restart does not lose accepted work, and duplicate requests for the
  same observation/frame converge on one artifact rather than opening duplicate streams.
- **R7** — Reviewer-requested full frames share the thumbnail extractor's existing global
  Jellyfin concurrency ceiling and highest interactive priority class. Work within that
  class is first-in, first-out; the Mosaic remains usable while it runs.
- **R8** — A ready full frame opens in a full-viewport dialog without navigating away from
  the Mosaic. Closing it restores the same page, filters, mode, tile, marks, and details
  context the reviewer had before opening it. Browser Back, including a phone's Back
  gesture, closes the dialog first instead of leaving the Mosaic.
- **R9** — The viewer initially fits the whole frame, supports zoom and pan by mouse,
  two-finger pinch anchored naturally beneath the gesture midpoint, and keyboard, exposes reset/fit and `Zoom to box` actions,
  prevents panning the image irretrievably off-screen, and has an accessible name, focus
  trap, and close behavior.
- **R10** — The served artifact preserves the decoded source frame's native pixel
  dimensions in a high-quality browser-readable image format and is privately delivered
  through MARP_API under `observations:read` with revalidation-safe caching. API responses
  never expose a Jellyfin credential, stream URL, or server filesystem path.
- **R11** — The full frame can show the observation's bounding box at the same frame as a
  non-destructive viewer overlay. The species label sits above the box and the exact numeric
  observation ID alone sits below it; each is approximately the box width and scales conservatively with that width,
  and uses light type on a nearly transparent background so it does not obscure the frame.
  Both labels hide with the box; neither label nor box is baked into or confused with the
  source image. The box itself is one pure-color stroke without a black outline or shadow.
- **R12** — Full-frame failures say whether retrying can help. Transient failures offer an
  explicit retry at interactive priority; permanent failures such as an unresolvable video,
  frame-rate mismatch, or frame outside the source do not repeatedly contact Jellyfin.
- **R13** — Full-frame availability and file provenance are additive, re-creatable cache
  state. The Mosaic can report availability without downloading the full frame or issuing
  one extra query per tile. Eviction clears that availability without changing an
  observation, keyframe, derived scientific column, review decision, or review-history row.
- **R14** — Named repository/service/route tests prove queue identity, ordering,
  concurrency, extraction provenance, serving/auth/cache behavior, retry classification,
  and absence of scientific writes. Real-API browser tests prove compact ID display
  and the full-frame request/view/zoom/pan/close lifecycle on desktop and phone.
- **R15** — #181 is not implemented here: no playable stream, scrubbing, playback cache,
  or persistent video-player lifecycle is added to this milestone.
- **R16** — One storage manager covers both existing square thumbnails and new full frames.
  It enforces a configured disk budget, records enough access information for deterministic
  eviction, removes database availability and file bytes consistently, and allows an
  evicted artifact to be requested again rather than reporting a broken `ready` image.
- **R17** — Review-imagery scheduling, extraction, storage accounting, eviction, and
  retrieval live behind one cohesive internal boundary. Routes and the Mosaic depend on
  that boundary rather than directly owning filesystem behavior, so the worker/storage
  implementation can later move out of MARP_API and communicate with it without redesigning
  the reviewer-facing contract.
- **R18** — The existing admin dashboard shows the configured review-imagery cache maximum,
  eviction order, low-watermark target, current total usage, thumbnail/full-frame usage
  separately, and the resolved storage locations. An administrator can change the maximum,
  eviction order, and low-watermark target through an `admin`-permission API; values are
  validated, persisted, survive API restarts, and become active without editing an
  environment file or restarting the service. The dashboard explains in plain language
  what each setting controls, when eviction begins, what it removes, and that observations
  and reviews are not removed.
- **R19** — Lowering the configured maximum below current usage starts bounded eviction and
  reports progress/current usage honestly. A rejected or failed settings write leaves the
  previous limit active and gives the administrator an explicit error.

## Open assumptions

- [x] **A1 · product/UI · blocking** — Answered 2026-09-13: completion does not interrupt
  Mosaic work. The UI reports readiness and waits for an explicit `Open full frame` action.
- [x] **A2 · scientific or data-meaning · blocking** — Answered 2026-09-13: retrieve the
  complete video frame at the exact `observation_thumbnails.framenum` currently backing the
  square crop, not merely the pixels inside that crop and not a different moment.
- [x] **A3 · product/UI · blocking** — Answered 2026-09-13: the bounding box is shown by
  default in the frame viewer and has a plainly labeled toggle that removes the overlay.
- [x] **A4 · storage/API contract · blocking** — Answered 2026-09-13: preserve the native
  decoded dimensions in an appropriately high-quality browser-readable image. The specific
  encoding is an implementation choice justified by measured fidelity, size, and browser
  support rather than a new product behavior.
- [x] **A5 · storage/retention · blocking** — Answered 2026-09-13: one persisted,
  configurable maximum cache size governs thumbnails and full frames, and it is visible and
  editable in the admin dashboard. Never evict an in-progress artifact.
- [x] **A6 · database/schema · blocking** — Answered 2026-09-13: add full-frame
  status/provenance/access columns to the existing one-row-per-observation
  `observation_thumbnails` record. The Mosaic's existing join reports availability with its
  normal page response and no download or per-tile query. These are operational cache
  fields, never fields on a scientific review or review-history row.
- [x] **A7 · performance/concurrency · blocking** — Answered 2026-09-13: full-frame and
  replacement-thumbnail requests are peers in the highest-priority reviewer class, share
  one retriever and the existing stream ceiling, and are served fairly.
- [x] **A8 · product/UI · blocking** — Answered 2026-09-13: show a read-only `Full frame
  available` checkbox/status inside the tile details panel beside the request/open action.
  Eviction unchecks it but never rewrites a recorded scientific flag.
- [x] **A9 · architectural · blocking** — Answered 2026-09-13: review imagery is one
  cohesive retriever/storage section even while it runs inside MARP_API. Its internal
  boundary must support moving it to a filesystem-side service that later talks to the API.
- [x] **A10 · storage/retention · blocking** — Answered 2026-09-13: seed a 25 GiB initial
  maximum, large enough for the earlier estimated roughly 5 GiB thumbnail corpus plus a
  useful full-frame working set, but still bounded. The admin dashboard displays and edits
  it.
- [x] **A11 · storage/retention · blocking** — Answered 2026-09-13: evict
  least-recently-viewed full frames first, then least-recently-viewed thumbnails, stopping
  below a 90% low watermark. The dashboard displays and configures both the order and the
  low-watermark target.

## Decisions

- **2026-09-13** — #176 and #178 are one Phase 9 milestone because both extend the same
  observation details and inspection lifecycle, but each keeps separately named
  requirements and tests.
- **2026-09-13** — Observation ID display and full-frame inspection are read-only
  inspection actions. They do not participate in the review commit workflow.
- **2026-09-13** — #181 follows this milestone and owns embedded source-video playback and
  its persistent paused/background lifecycle.
- **2026-09-13** — Disk management is no longer deferred. This milestone adds eviction for
  both existing thumbnails and new full frames; #121 is the legacy-thumbnail backfill issue,
  not storage management.
- **2026-09-13** — Whether an artifact is cached is operational state. It may be displayed
  near review controls, but eviction never changes the scientific review flag or its
  history.
- **2026-09-13** — Cache capacity is runtime administration, not an environment-only
  deployment value. The admin dashboard owns its persisted setting and reports actual usage.

## Plan

1. Resolve A6, A8, A10, and A11 and update this specification with the human's answers.
2. Add focused failing tests for compact observation ID display and for the durable
   full-frame queue, identity, priority, extraction, failure, and serving contracts.
3. Add the minimum additive migration/model/repository state for re-creatable full-frame
   availability and last access without changing scientific rows.
4. Introduce the review-imagery boundary and reuse the current resolver, probe, exact-frame
   extraction, concurrency ceiling, and private file-serving patterns within it.
5. Add shared storage accounting and deterministic eviction for thumbnails and full frames,
   including safe database/file consistency and on-demand regeneration.
6. Add the admin-only persisted cache setting/status API and the admin-dashboard storage
   panel, including validation, usage reporting, and lowering-the-limit behavior.
7. Extend the Mosaic API/store and details panel with request/status/retry/open actions,
   keeping asynchronous updates independent of marks and review commits.
8. Build the accessible full-viewport viewer with fit, zoom, pan, overlay, and exact-context
   return behavior.
9. Add real-API desktop and phone browser coverage plus admin-dashboard contract/browser
   coverage, then write the G3 verification plan and
   stop for approval before running it.

## Acceptance criteria

- Every tile's details panel identifies the observation in a compact selectable row without
  a dedicated copy control.
- A reviewer can explicitly request the full source frame, keep working while it is queued,
  and later open the ready artifact.
- The full-screen viewer makes fine detail inspectable with accessible fit, zoom, pan,
  overlay, and close controls on desktop and phone.
- Closing the viewer returns the reviewer to the same Mosaic context.
- Full-frame generation survives reloads/restarts, is de-duplicated, respects shared media
  limits, and never leaks Jellyfin credentials.
- The shared disk budget evicts old full frames and thumbnails deterministically without
  broken ready states, scientific writes, or eviction/regeneration loops.
- An administrator can see actual cache usage, change the persisted maximum, and observe
  eviction bring an oversized cache under the configured limit.
- Failures do not loop against Jellyfin and useful retry behavior is explicit.
- No scientific record, pending review work, or square thumbnail is changed by inspection.
- #176 and #178 are fully covered while #181 remains a separate next milestone.

## Test plan

The complete requirement-to-test map, ordered commands, manual observations, exclusions,
and known gaps are in `.marp/verification.md`. The plan covers the focused unit, database,
filesystem, route, source-contract, desktop-browser, phone-browser, admin-dashboard, and
supervised live-Jellyfin tiers.

## Status

- **Gate:** verification plan awaiting human approval
- **Notes:** Investigation found that the details panel already owns per-observation
  inspection actions, while the thumbnail row already records the exact extracted frame and
  decoded dimensions. The human settled frame behavior, the overlay, fidelity, scheduling,
  and the future service boundary. The cache maximum, eviction behavior, operational
  availability, and admin-dashboard ownership are settled. Implementation and focused
  development checks are complete; the G4 run has not begun.
