---
task: MarineAppliedResearch/MARP_API#202
repos: [marp-api]
status: implementing
needs: []
---

## Goal

The pool view stops being fiction. A machine that has been switched off reads `offline`
rather than `online`, so "what is running" is answerable by looking. Worker 966 read
`online` more than an hour after its process was killed, and worker 48 read `online` with
a `last_seen_at` six days old.

## Requirements

- **R1** — A worker whose `last_seen_at` is older than the offline threshold is reported
  `offline` by the pool view.
- **R2** — A worker heard from inside the threshold stays `online`. The sweep never
  touches a machine that is talking.
- **R3** — A `paused` worker is never moved to `offline`, however long it has been gone.
  The operator's intent outlives the machine.
- **R4** — An offline worker that comes back is `online` again with no operator action.
  This already works — `markWorkerSeen` and the enrolment both undo `offline` — and the
  requirement is that the sweep does not break it.
- **R5** — The threshold is one named constant beside the other orchestration timings, not
  a literal at the query.
- **R6** — The sweep runs where a stale row would otherwise be seen: on the pool read, and
  on the poll, which is the same placement `expireStaleLeases` already has.

## Open assumptions

- [x] **A1 · behavioural · blocking** — answered 2026-09-18: what counts as gone.
  **Three minutes.** A healthy idle worker long-polls with a ceiling of
  `POLL_MAX_WAIT_SECONDS` (60 s) and a running one heartbeats every
  `HEARTBEAT_SECONDS` (10 s), so 180 s is three missed idle polls or eighteen missed
  heartbeats. Same shape as `LEASE_SECONDS`, which is six missed heartbeats for the reason
  that a home connection drops one now and then.
- [x] **A2 · behavioural · blocking** — answered 2026-09-18: `paused` survives.
  The sweep moves `online` to `offline` and nothing else, which is the mirror of the rule
  already in `markWorkerSeen`: it brings `offline` back to `online` and leaves `paused`
  alone. A machine an operator parked and then shut down is still parked when it returns.
- [x] **A3 · architectural** — answered 2026-09-18 from the code: who marks it. A sweep, in
  the places `expireStaleLeases` is already called from. That is an established pattern
  here with its reasoning written out — *"a read that reports a state the system has already
  abandoned is worse than a slightly slower read"* — and it costs one indexed `UPDATE`.
  Not a timer: this needs no second thing to be running, and a pool nobody is looking at
  has no stale row to mislead anybody.
- [x] **A4 · database/schema** — answered 2026-09-18 from the code: no migration. The
  column, the state and the return transition all exist. `WORKER_STATES` already includes
  `offline`, `last_seen_at` is written on enrolment, poll and heartbeat, and nothing was
  ever reading it to decide `state`.

## Decisions

- **2026-09-18** — `COALESCE(last_seen_at, enrolled_at)` rather than `last_seen_at` alone.
  A row that has somehow never been seen is judged from when it enrolled, so a null cannot
  make a worker immortal — which is the failure mode that produces exactly the ghost this
  issue is about.
- **2026-09-18** — The sweep is its own repository method and its own service method rather
  than folded into `expireStaleLeases`. They answer different questions — one is about a
  job, one is about a machine — and a caller that wants only one should be able to say so.

## Plan

1. `WORKER_OFFLINE_SECONDS` in `config/gpu-orchestration.js`, documented against the poll
   ceiling it is derived from.
2. `markStaleWorkersOffline()` in the repository: one `UPDATE`, returning what it changed.
3. `sweepStaleWorkers()` in the service, called from `listPool` and from the poll.
4. Tests in `tests/gpu-orchestration.test.js`, moving the clock rather than waiting — the
   pattern that file already uses for lease expiry and the attempt cap.

## Acceptance criteria

- A worker backdated past the threshold reads `offline` in `GET /gpu/workers`.
- A paused worker backdated the same way still reads `paused`.
- A worker inside the threshold still reads `online`.
- A backdated worker that polls once is `online` again.

## Test plan

Filled in at G3 in `.marp/verification.md`.

## Status

- **Gate:** implementing
- **Notes:** —
