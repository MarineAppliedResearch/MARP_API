---
task: MarineAppliedResearch/MARP_API#133
repos: [marp-api]
status: design
needs: [production-jellyfin]
---

## Goal

When a GPU worker streams a Jellyfin-backed video, Jellyfin's administration views show
which MARP worker and slot are reading which item and their current position. MARP closes
that Jellyfin session whenever the attempt stops reading, while Jellyfin failures never
change the inference job's outcome.

## Requirements

- **R1** -- A successfully leased Jellyfin-backed attempt reports playback started after
  its video is resolved. Jellyfin identifies the session as a MARP GPU worker and displays
  the enrolled worker name and slot.
- **R2** -- A heartbeat carrying frame progress reports the absolute media position to
  Jellyfin. The position is `(range.start_frame + progress.done)` at MARP's established
  25-frames-per-second timebase and is bounded to the submitted range.
- **R3** -- MARP reports playback stopped when an attempt succeeds, fails, is cancelled,
  is paused or abandoned by a control response, or loses an expired lease. A stopped
  session is not left visible as active in Jellyfin.
- **R4** -- Playback reporting is best effort. Authentication, network, or Jellyfin API
  failures are logged with attempt context and never prevent a lease, heartbeat response,
  result publication, cancellation, retry, or lease reclamation.
- **R5** -- Jobs submitted with a bare video URL do not call Jellyfin playback reporting.
  Only a stored `spec.video.jellyfin_item_id` opts an attempt into this lifecycle.
- **R6** -- This issue adds no worker-side Jellyfin reporting protocol and gives workers no
  standing Jellyfin credentials. MARP_API reports playback now. The design remains compatible
  with the planned future flow in which MARP_API issues a Jellyfin token to a worker for its
  media access.
- **R7** -- Reporting uses MARP_API's configured Jellyfin service account. The production
  server provides no playback-start operation that creates an active session without also
  updating that account's playback data, so the accepted fallback is that GPU activity may
  change history, play count, last-played time, played state, and resume position for the
  service account only.
- **R8** -- The information needed to close a Jellyfin session survives an MARP_API restart
  and does not depend only on an in-memory token or map.
- **R9** -- Repeated worker reports and result retries do not create duplicate active
  sessions or repeatedly close an already-closed session.
- **R10** -- Verification covers the coordinator lifecycle against a local disposable
  PostgreSQL database and confirms the visible session lifecycle against the configured
  production Jellyfin server without changing Jellyfin configuration.

## Open assumptions

- [x] **A1 · security/permissions · blocking** -- answered 2026-09-13: the worker keeps no
  Jellyfin credentials; MARP_API reports with its configured service account.
- [x] **A2 · data-meaning · blocking** -- answered 2026-09-13: prefer no Jellyfin history or
  resume changes, but accept them when active-session reporting cannot be separated. The
  inspected production server's playback-start path always updates authenticated-user data,
  so reporting will affect only the configured service account.
- [x] **A3 · environment · blocking** -- answered 2026-09-13: perform the final media-tier
  verification against the configured production Jellyfin server, with no configuration
  writes.
- [ ] **A4 · behavioural · blocking** -- Should Jellyfin show one session per independently
  leased piece on a worker slot (recommended, because pieces can run concurrently and move
  between workers), rather than one session for an entire submitted batch?
- [ ] **A5 · database/schema · blocking** -- May a reversible migration add playback-session
  metadata and start/stop timestamps to `gpu_job_attempts` (recommended), so an API restart
  can close an expired session using the exact identity and negotiation ids that opened it?

## Decisions

- **2026-09-13** -- Coordinate playback reporting in MARP_API; workers continue to receive
  only playable URLs.
- **2026-09-13** -- Use the configured Jellyfin service account and accept its unavoidable
  playback-history changes rather than changing a human user's history.
- **2026-09-13** -- Reporting errors are operational evidence, never inference failures.
- **2026-09-13** -- A later phase will authenticate workers to Jellyfin with tokens issued by
  MARP_API. Issue #133 neither implements nor prevents that future worker media-access flow.

## Plan

1. Settle session granularity and durable attempt metadata.
2. Add the minimum reversible attempt-schema change required to retain playback identity
   across process restarts, if approved.
3. Wrap the existing Jellyfin start/progress/stop utilities in a best-effort GPU-attempt
   lifecycle service.
4. Start reporting after Jellyfin video resolution, update from accepted frame heartbeats,
   and stop on every terminal or relinquished-lease path.
5. Add named HTTP/database tests with Jellyfin stubbed at its repository boundary.
6. Write the G3 verification plan for human review before running tests, including a
   controlled production-Jellyfin media check.

## Acceptance criteria

- A Jellyfin-backed attempt appears in Jellyfin with its MARP worker and slot identity while
  active and disappears after every way that attempt can stop.
- Jellyfin's displayed position follows the worker's absolute frame position.
- Concurrent worker slots appear as distinct sessions.
- A restarted coordinator can close playback belonging to an expired attempt.
- A Jellyfin outage cannot change job state or prevent worker control responses.
- URL-backed attempts never create Jellyfin sessions.
- Production verification records the unavoidable service-account history effect and does
  not change server configuration.

## Test plan

Filled at G3 after implementation, then reviewed before anything is run.

## Status

- **Gate:** design
- **Notes:** Existing Jellyfin reporting utilities, lease-time video resolution, frame
  heartbeats, worker identity, and lease expiry are present. Production is reachable through
  the configured non-admin service account. Jellyfin's current server implementation has no
  active playback-start path that leaves that account's playback data untouched. A4 and A5
  remain blocking.
