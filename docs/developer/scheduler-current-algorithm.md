# Scheduler Algorithm: Current Behavior

This document describes exactly how the scheduler and its two-tier cache
currently behave in code, including play, pause, seek, and cache-fill
behavior.

Scope:
- Source of truth is `video-engine/src/scheduler.js`, `video-engine/src/cache-window.js`, `video-engine/src/frame-store.js`, and `video-engine/src/segment-fetcher.js`.
- This is intentionally descriptive, not aspirational.
- Values and formulas here match the code as it exists now.

## 1) Core Intent

The scheduler has two active loops:
- Play loop (requestAnimationFrame): drives presentation time and rendering while playing.
- Paused background loop (setInterval): keeps filling the cache around a fixed paused position.

It coordinates three separate concerns:
- Rendering frames from already-decoded buffers.
- Deciding what to decode next (Tier 2).
- Deciding what raw bytes to fetch next (Tier 1).

Tier 1 (raw segment bytes, `segment-fetcher.js`) and Tier 2 (decoded
frames, `frame-store.js`) are two independent caches with independent
byte budgets and independent LRU eviction. Tier 2 can only decode a
segment once Tier 1 already has its raw bytes -- Tier 2 never triggers a
network fetch itself (the one narrow exception is the keyframe-continuity
merge fallback inside `frame-store.js#_decode`, which fetches the
immediately preceding segment's raw bytes because decoding this segment
is impossible otherwise -- an implementation necessity of decode, not a
scheduling decision).

## 2) Constants and Their Meaning

- `DEFAULT_PROTECTED_FLOOR_RADIUS_SEGMENTS = 3` (scheduler.js) -- segments protected on each side of the playhead, in both tiers.
- `TIER2_OPPORTUNISTIC_BASE_SEGMENTS = 4` (scheduler.js) -- Tier 2's per-side opportunistic window width at rest (paused, or the non-preferred side at 1x).
- `TIER1_BASE_PACING_PER_PASS = 2` (scheduler.js) -- Tier 1's base count of new raw fetches launched per cache pass.
- `DIRECTIONAL_SKEW_RATIO = 2` (scheduler.js) -- preferred-direction candidates per one opposite-direction candidate, while playing.
- `PAUSED_SKEW_RATIO = 1` (scheduler.js) -- symmetric, while paused.
- `PAUSED_FILL_INTERVAL_MS = 500` (scheduler.js) -- paused background cache-fill cadence.
- `DEFAULT_CACHE_BUDGET_BYTES = 3 GiB` (frame-store.js) -- Tier 2 decoded-frame byte budget.
- `DEFAULT_RAW_CACHE_BUDGET_BYTES = 3 GiB` (segment-fetcher.js) -- Tier 1 raw-byte budget.

Notes:
- The protected floor is a segment-count radius, never scaled by speed and never skewed by direction -- always the current segment plus `floorRadius` neighbors on each side (clamped at stream edges), in both tiers.
- Tier 1's opportunistic reach has **no fixed outer edge** -- the skew only orders fetch priority; a per-pass pacing cap limits how many *new* fetches launch each pass, not how far the eventual reach can go. Given enough passes and enough byte budget, Tier 1 can end up holding the entire stream.
- Tier 2's opportunistic reach **is** a fixed, bounded window (segment counts scaled by skew ratio and `|playbackRate|`), further truncated by remaining decode budget.

## 3) State Model

Important scheduler state fields:
- Playback state: `playing`, `playbackRate`, `seekingFlag`.
- Presented frame identity: `currentSegmentIndex`, `currentFrameIdx`, `_presentedMediaTime`.
- Wall-clock anchoring: `_anchorWallClockMs`, `_anchorTime`.
- Pause anchoring: `_pausedFreezeTime`.
- Direction of travel: `_lastDirectionSign` -- the sign of the last nonzero `playbackRate` ever set via `setPlaybackRate()`; defaults to `+1` (forward) before any rate has been set. **Persists across pause** -- pausing does not reset or symmetrize it; only the cache pass itself becomes symmetric while paused.
- Seek race/cancellation control: `_seekGeneration`, `_seekFetchAbort`.

`currentTime` behavior:
- While paused and not seeking, returns `_pausedFreezeTime`.
- Otherwise returns `_presentedMediaTime`.

## 4) Play Path

`play()` does:
- Stop the paused fill worker.
- Set `playing = true`.
- Re-anchor wall clock: `_anchorWallClockMs = now`, `_anchorTime = currentTime`.
- Clear paused freeze.
- Emit `playing`.
- Start the tick loop.

`setPlaybackRate(rate)` also updates `_lastDirectionSign` to `rate`'s sign whenever `rate !== 0`, regardless of whether playback is currently active.

`_tick(now)` does:
- If `seekingFlag` is true, do nothing but reschedule -- don't advance from the stale pre-seek anchor while a seek is still resolving. `seek()` re-anchors correctly once it lands, so the very next tick after that picks up cleanly.
- Compute target media time from wall clock and playback rate.
- Clamp to `[0, duration]`; pause at boundary if direction reaches end.
- Try `_renderAtTime(targetTime, direction)`.
- If render stalls (segment not decoded), re-anchor to `targetTime` (the position playback was trying to reach, not the last-displayed one -- anchoring to the old position let the next tick's tiny elapsed increment fall back inside the already-decoded segment and briefly "succeed" there, causing a rapid stall/recover oscillation for the whole real length of a stall), separately call `_tryUnstall()`, and call `_updateBufferState()` with the stalled segment's reason. If it rendered, clear the buffer state.
- Call `_runCachePass(targetTime, {symmetric: false})`.
- Schedule the next tick if still playing.

`_updateBufferState(state)` emits `'waiting'` (with `{reason}`) or `'playing'` on an actual state transition only (matching the real HTMLMediaElement `waiting`/`playing` contract) -- `seek()` also calls it when its target isn't yet ready, so a slow cold seek surfaces the same buffering signal a mid-playback stall would.

Direction selection for render:
- Forward/non-negative rate uses `atOrBefore`.
- Reverse/negative rate uses `atOrAfter`.

## 5) Pause Path

`pause()` does:
- Stop the rAF loop.
- Freeze shown media time into `_pausedFreezeTime`.
- Run one symmetric cache pass immediately (`_runCachePass(currentTime, {symmetric: true})`) -- does not wait for the first interval tick.
- Start the paused fill worker (`500ms` interval).
- Emit `pause`.

Paused fill worker: every `500ms`, if still paused, re-runs
`_runCachePass(currentTime, {symmetric: true})` from the **same** current
(frozen) position. There is no elapsed-time growth term and no separate
paused-mode code path -- it is the exact same cache pass playback uses,
called with `symmetric: true` instead of `false`, and with the playhead
not advancing between calls. Because the center position doesn't move
while paused, repeated passes recompute the identical protected floor and
opportunistic window each time; only newly-arrived raw bytes (letting
Tier 2 decode further) or reduced backoff windows can change what a later
pass actually reaches for.

## 6) Shared Protected-Floor + Priority-Order Math (`cache-window.js`)

`computeProtectedFloor(centerIndex, totalSegments, floorRadius)`:
- Returns `[centerIndex - floorRadius .. centerIndex + floorRadius]`, clamped to `[0, totalSegments - 1]`.
- Identical for both tiers, identical while playing or paused.

`computeOpportunisticOrder(centerIndex, totalSegments, protectedIndices, directionSign, skewRatio, preferredSideCount, otherSideCount)`:
- Builds the full ascending list of candidates above the floor's high edge (`higherSide`) and below its low edge (`lowerSide`).
- `directionSign >= 0` treats `higherSide` as preferred; `directionSign < 0` treats `lowerSide` as preferred.
- Each side is capped to its own count (`Infinity` for an uncapped side).
- The two capped lists are merged via round-robin: `skewRatio` preferred entries per one other-side entry, until both are exhausted.
- Called once per tier per cache pass, with that tier's own side counts -- this is the one function both tiers share; everything else about how each tier applies the result is tier-specific.

## 7) The Cache Pass (`Scheduler#_runCachePass`)

Called from every render tick while playing, once immediately on pause,
and every `500ms` from the paused fill worker, and once at the end of
every `seek()`.

Given `centerTime` and `{symmetric}`:
1. `directionSign = this._lastDirectionSign` (unaffected by `symmetric`).
2. `skewRatio = symmetric ? 1 : 2`.
3. `scaleFactor = symmetric ? 1 : max(1, |playbackRate|)`.
4. `protectedIndices = computeProtectedFloor(centerSegment, totalSegments, 3)`.
5. Tier 2: `preferredCount = round(4 * skewRatio * scaleFactor)`, `otherCount = round(4 * scaleFactor)`; run `_runTier2DecodePass`.
6. Tier 1: both side counts `Infinity`; `pacingCap = round(2 * scaleFactor)`; run `_runTier1FetchPass`.

While paused, `scaleFactor` is forced to `1` regardless of the stored
`playbackRate` (no rate scaling while paused) and `skewRatio` is forced to
`1` (symmetric, no directional preference) -- both tiers' opportunistic
width collapses to their base (1x) width, split evenly between the two
sides.

## 8) Tier 2's Half (`_runTier2DecodePass`)

- `frameStore.setPinned(protectedIndices)` -- only the protected floor is ever pinned; the opportunistic window is evictable.
- `surplusBudget = max(0, maxSegmentsBuffered - protectedIndices.length)`.
- `ensureList = protectedIndices + opportunisticOrder.slice(0, surplusBudget)`.
- For each index in `ensureList`: skip if already decoded or in decode-backoff; skip if `!segmentFetcher.hasRawBytes(index)` (uniformly true for protected-floor and opportunistic candidates alike -- Tier 2 never fetches); otherwise `frameStore.ensureDecoded(index)`.

## 9) Tier 1's Half (`_runTier1FetchPass`)

- `segmentFetcher.setProtectedRawSegments(protectedIndices)` -- protects the floor from raw-byte LRU eviction.
- Every protected-floor index without raw bytes yet is fetched **unconditionally** (not subject to the pacing cap), unless in fetch-backoff.
- Beyond the floor, walks `opportunisticOrder` (unbounded reach across the whole remaining timeline, skewed by direction) and launches up to `pacingCap` **new** fetches for indices that don't already have raw bytes and aren't in fetch-backoff.
- No fixed outer edge: repeated passes keep advancing this frontier (subject to Tier 1's own byte budget and LRU eviction) until the whole stream is cached or the budget is full.

## 10) Seek Algorithm

Function: `seek(targetTimeSeconds)`

Steps:
1. Clamp target time; bump `_seekGeneration`.
2. Stop the paused fill worker immediately (avoid stale-anchor interference).
3. Set `seekingFlag`, resolve the target segment, emit `seeking` (with `{targetTime, segmentIndex}` detail).
4. If the target's raw bytes are not yet cached, call `segmentFetcher.preemptInFlightFetches([target])` -- forcibly cancels every OTHER currently in-flight fetch (regardless of how many wanters each has) so this fetch gets the browser's whole per-origin connection pool to itself, instead of racing already-in-flight, lower-priority background-prefetch fetches that simply started earlier. Preempted fetches are not treated as failures; a later cache pass naturally re-requests whichever of them are still relevant.
5. Start this seek's own `AbortController`; call `segmentFetcher.ensureRawBytes(target, {signal})` synchronously (registers this seek's "want" before the previous seek's want is released), then abort the previous seek's controller.
6. Await raw bytes, then `frameStore.ensureDecoded(target)`.
7. If aborted/superseded, exit silently (not a real error) -- also emits a `debug` message identifying which seek was superseded and at which stage, so an abandoned seek is distinguishable from one still genuinely in flight.
8. Locate the target frame in the decoded segment and render it; update `currentSegmentIndex`/`currentFrameIdx`/`_presentedMediaTime`.
9. Re-anchor the wall clock to the newly shown frame.
10. Run `_runCachePass(currentTime, {symmetric: !playing})` from the new position, in the current direction of travel -- immediately re-centering both tiers' protected floor and opportunistic window on the new playhead.
11. If paused, restart the paused fill worker.
12. Clear `seekingFlag`, emit `seeked` (with `{targetTime, currentTime, segmentIndex, frameIndex}` detail -- where it actually landed, not just that it landed).

A newer seek's `ensureRawBytes` call cancels the previous seek's still-pending one via the shared AbortController pattern (now owned by `SegmentFetcher`, not `FrameStore`) -- two seeks landing in the same segment do not abort each other's shared in-flight fetch, since the new seek registers its own "want" before the old one's is released.

## 11) Error and Backoff Handling

Each tier owns its own backoff and error reporting, independently:
- `SegmentFetcher.isFetchInBackoff(index)` / `_recordFetchOutcome` -- raw-fetch failures.
- `FrameStore.isDecodeInBackoff(index)` / `_recordDecodeOutcome` -- decode failures.

Both report a real failure exactly once via their own `onError` callback,
regardless of how many callers share the same in-flight request. A
cancellation (`AbortError`) never counts as a failure or enters backoff.
The scheduler's cache pass and render-stall fallback (`_tryUnstall`) both
check the relevant backoff before attempting a fetch/decode, and never
re-report a rejection themselves.

## 12) Current Behavioral Invariants

- The protected floor is always the current segment plus a fixed 3-segment radius on each side, in both tiers, regardless of direction, speed, or budget pressure -- never evicted.
- Play and pause run through the exact same `_runCachePass`/`_runTier1FetchPass`/`_runTier2DecodePass` functions; `symmetric` is the only behavioral switch between them.
- Tier 1 has no fixed reach limit; Tier 2's reach is always bounded by a window sized from `scaleFactor`/`skewRatio` and further capped by decode budget.
- Tier 2 never fetches (except the narrow keyframe-continuity-merge exception noted in section 1).
- Direction of travel persists across pause and only changes on the next nonzero `setPlaybackRate()` call.

## 13) Quick Pseudocode (Current)

```text
on pause:
  freeze current media time
  run_cache_pass(currentTime, symmetric=true)
  every 500ms while still paused:
    run_cache_pass(currentTime, symmetric=true)   // same position every time, no growth

on tick (playing):
  targetTime = anchor + elapsed * playbackRate
  rendered = render_at(targetTime)
  if !rendered: try_unstall(segment_at(targetTime)); re-anchor to last shown time
  run_cache_pass(rendered ? targetTime : currentTime, symmetric=false)

run_cache_pass(centerTime, symmetric):
  direction = lastDirectionSign
  skew = symmetric ? 1 : 2
  scale = symmetric ? 1 : max(1, |playbackRate|)
  protected = protected_floor(centerTime, radius=3)

  tier2_order = opportunistic_order(protected, direction, skew,
                                     preferred=round(4*skew*scale), other=round(4*scale))
  run_tier2_decode_pass(protected, tier2_order)     // bounded, decode-budget-truncated

  tier1_order = opportunistic_order(protected, direction, skew,
                                     preferred=Infinity, other=Infinity)
  run_tier1_fetch_pass(protected, tier1_order, pacingCap=round(2*scale))  // unbounded reach, paced

run_tier2_decode_pass(protected, order):
  pin(protected)
  ensure_list = protected + order[0 : max(0, tier2Budget - len(protected))]
  for seg in ensure_list:
    skip if decoded or decode-backoff
    skip if !hasRawBytes(seg)          // Tier 2 never fetches
    ensureDecoded(seg)

run_tier1_fetch_pass(protected, order, pacingCap):
  protect_raw(protected)
  for seg in protected: if !hasRawBytes(seg) and !fetch-backoff: ensureRawBytes(seg)   // unconditional
  launched = 0
  for seg in order:
    if launched >= pacingCap: break
    if hasRawBytes(seg) or fetch-backoff: continue
    ensureRawBytes(seg); launched += 1
```

## 14) Where To Verify In Code

- Main source: `video-engine/src/scheduler.js`
- Shared cache-window math: `video-engine/src/cache-window.js`
- Tier 1 (raw bytes): `video-engine/src/segment-fetcher.js`
- Tier 2 (decoded frames): `video-engine/src/frame-store.js`
- Behavioral tests: `video-engine/test/unit/scheduler.test.js`, `video-engine/test/unit/frame-store.test.js`, `video-engine/test/unit/frame-store-merge.test.js`, `video-engine/test/unit/segment-fetcher.test.js`
