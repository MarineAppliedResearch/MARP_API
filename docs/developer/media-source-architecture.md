# Media-source architecture investigation (#36, Phase 5)

Status: **investigation complete for the Jellyfin paths; requirements confirmed
with the product owner. No engine code changed on the basis of this document.**

Goal: one JavaScript video engine whose scheduler, both cache tiers,
demux/decode pipeline, reverse playback, seeking, frame stepping and canvas
renderer behave identically regardless of where the media comes from — running
in a normal browser tab and inside the C# WebView2 host.

Facts marked **measured** were verified against the real dev Jellyfin server
(`47.208.203.78:8097`, item `fb6a3c0f…`, the 1354 s ROV dive clip).
**Unverified** means exactly that.

---

## Start here (instructions for the next agent)

**Read first, in this order:** `agents.md` (behavioural guidelines — they are not
optional), the last entry of `agents_history.md` (2026-08-16/17, which explains
how everything below came to be), then this whole document. There is no
`CLAUDE.md` in this repo; `agents.md` serves that role.

**State on arrival.** Branch `36-behind-session-absolute-indexing`, pushed to
origin, five commits: `7e44b2a`, `a6757a2`, `a80f0d3`, `2a4769a`, `14f7843`.
129/129 video-engine unit tests pass. Bundle rebuilt. No PR opened.

**Working agreements with the product owner — these were hard-won, honour them:**

1. **Narrate every edit before making it, and show diffs.** The owner supervises
   this work closely and objected, correctly, when changes outpaced explanation.
2. **"Commit" means commit exactly what is on disk. Touch no code.** Never infer
   consent for a code change from an acknowledgement like "okay." This mistake was
   made in the previous session and caused real friction.
3. **Unit tests are not evidence that anything works.** They stayed green through
   every genuine bug found in the previous session. The owner's browser testing
   and direct server measurement are the real signals. Never describe code as
   "tested" or "well-tested" on the strength of unit tests.
4. **Validation model:** drive Playwright automated checks yourself at each step;
   the owner verifies manually at the checkpoints marked in §9.
5. **Rebuild the bundle** (`node video-engine/build.js`) after any
   `video-engine/src/` change. A stale bundle has silently masked fixes more than
   once — the browser only ever runs `frontend/apps/VideoPlayer/dist/`.
6. **Do not touch MARE_API's existing `/api/v2/jellyfin/*` routes.**
7. **Check in at milestones** rather than building far ahead unreviewed.

**Measured facts — do not re-derive these** (each cost real time):

- Jellyfin HLS segment indices are **absolute**; `StartTimeTicks` only moves where
  encoding begins. See §2 and commit `7e44b2a`.
- A lone backward or far-forward segment request **never fails** — it costs a
  restart (~2–3 s, next request up to ~15 s). **Only concurrent requests 500.**
- An already-written segment is served off disk in **~59 ms**, no index check.
- `TranscodeManager.KillTranscodingJobs` matches on `PlaySessionId` when supplied,
  **not** `DeviceId` — multiple sessions from one device cannot restart each other.
- Jellyfin's forward tolerance is `24 / segmentLength` = **8 segments** ahead of a
  session's *current* position.
- Direct Play findings in §2, including the 1.05 MB / 107 ms index fetch.

**Environment.** Dev Jellyfin: `ssh jellyfin-dev-server` (two-hop bastion, see
`agents.md` §6), instance on **port 8097** — never 8096, that is live production.
Admin `admin` / `MarpDevJellyfinRemote2026!`. This sandbox has **no real GPU
decode**, so decode-timing measurements are invalid here (see §9); networking is
fine.

**Where to begin:** §9 Phase 0 spikes. Do not start Phase A until S1/S2 have
answered the retention-window and unit-granularity questions, because their
answers can still change the interface shape.

**Two unexplained loose ends**, carried forward rather than fixed: the
`[behind@seg36]` observation (a session anchored ~114 segments behind being routed
a far-ahead segment — possibly a bug in the segment-number log label added in the
last session, not necessarily a routing fault), and whether per-session
concurrency should be 1 or 2 (currently 2; its documented failure mode has been
seen live and is absorbed by backoff).

---

## 0. Confirmed requirements

These come from the product owner and are the basis for every tradeoff below.
Where an earlier draft of this document treated one of these as an open
hypothesis, it was wrong.

| # | Requirement | Consequence |
|---|---|---|
| R1 | **Direct Play is the preferred path** and always was. Transcoding was where the project started, not where it is going. | Direct Play drives the design; the transcode path adapts to the common interface, not the reverse. |
| R2 | **Local-file playback is a must-have**, not a nice-to-have. The organisation cannot adopt the player without it. | First-class source, first build target, must work offline with no server. |
| R3 | **Reverse playback must stay at least as good as it is today.** The *required* review depth is a few seconds (frame-stepping and short re-review around an event), but the transcode path's reverse already works well and moving to Direct Play must not make it worse or harder. | The few-seconds figure is a **floor that makes 1080p Direct Play feasible** (§3) — it is *not* licence to reduce reverse capability or strip working machinery. Any change that degrades reverse is a regression, full stop. |
| R4 | **MP4/H.264 now; MKV and AVI must remain possible later.** | Container parsing must be pluggable, not baked into the engine. |
| R5 | **Local files arrive via a file picker and drag-and-drop.** | Both yield a `File`; the source takes a `File`/`Blob`, which also covers host injection for free. |
| R6 | **Transcoding stays as a fallback for both** constrained bandwidth and media the client cannot decode. | Session machinery is maintained, not retired. |
| R7 | **Resolution/framerate mixed and growing** — no ceiling to design against. | All memory sizing must derive from the actual stream at runtime. |
| R8 | **Direct Play must work remotely, over internet/VPN.** | Bandwidth is a first-order constraint, not an afterthought. See §4. |
| R9 | **WebView2 is a hard dependency** (a separate project consumes this engine); verification there is manual and later. | Design to its constraints now; see §6. |

---

## 1. What the current engine actually assumes

Less than expected — the playback core is nearly source-agnostic already.

`scheduler.js` reads exactly one field off a segment in its playback logic:
`segment.startTime`. `cache-window.js` is pure index arithmetic. `gop-decoder.js`
requires only that a decodable unit begins with a keyframe. `canvas-renderer.js`
and `marp-video-shim.js` know nothing about sources.

The HLS-specific assumptions sit in four places:

| Assumption | Where | Direct Play / local reality |
|---|---|---|
| A separate init segment must be prepended to every media segment | `segment-fetcher.js#fetchInitSegment`, `demuxer.js#demuxSegment(init, media)` | No init segment; codec config comes from `moov` once |
| Each decodable unit has its own URL | `SegmentIndex.segments[].url` | Units are **byte ranges** of one file |
| Unit timing comes from `#EXTINF` | `playlist-manager.js` | Timing comes from the container sample table — authoritative |
| `fps` and cache sizing derive from `segments[0].duration` | `index.js:99`, `frame-store.js:110` | Unit durations are neither uniform nor small |

`segment-fetcher.js` already has `buildRangeHeaderOptions()` and honours 206 —
speculative work from an earlier session that is exactly what is needed here.

---

## 2. Jellyfin Direct Play — measured

`PlaybackInfo` with `EnableDirectPlay: true` and a permissive `DirectPlayProfiles`
entry reports:

```
Container: mp4        Protocol: File       SupportsDirectPlay: True
Size: 1345712477      Bitrate: 7950247     RunTimeTicks: 13541340000
Video: h264 Main L4.0  1920x1080  25fps    CodecTag: avc1
```

**Byte-range access works, and is stateless.**
`GET /Videos/{id}/stream?static=true&api_key=…`

```
200 OK           Accept-Ranges: bytes     Content-Length: 1345712477
206 Partial      Content-Range: bytes 0-1023/1345712477
206 Partial      Content-Range: bytes 700000000-700001023/1345712477   (mid-file)
```

No `PlaySessionId`, no transcoder, no restart semantics. **The entire dual-session
apparatus is unnecessary on this path** — that complexity exists solely to work
around a sequential transcoder.

**The index is at the front of the file.** Top-level box walk:

```
0          32          ftyp
32         1033817     moov      <- 0.99 MB, before mdat
1033849    8           free
1033857    1344678620  mdat
```

A 1.05 MB prefix (**107 ms measured**) yields mp4box `onReady` plus the complete
sample table:

```
33852 samples, timescale 12800, duration 1354.160 s
136 keyframes -> average GOP 248.9 samples (~10 s)
avcC description: 54 bytes, from the prefix alone
```

**Arbitrary GOP retrieval works end to end.** The GOP covering t=677 s:

```
samples 16750..16999 (250 frames), presentation 670.120 s .. 680.080 s
byte range 665004368..675146637   (9905 KB)   fetched in 670 ms (LAN)
250 chunks assembled, first 'key', real container timestamps throughout
```

So R1 is well founded: authoritative timing, true random access, no fabricated
HLS timing, no session juggling.

---

## 3. The GOP-size problem, and why R3 dissolves it

Measured GOPs are ~10 s / 249 frames at 1080p, versus 3 s / 75 frames at 720p on
the transcode path. Naively that is alarming:

| | Transcode | Direct Play |
|---|---|---|
| Decodable unit | 3.0 s | ~10 s |
| Bytes per decoded frame | 1.38 MB | 3.11 MB |
| Decoded bytes per **whole unit** | ~104 MB | **~774 MB** |

But the *required* review depth is a few seconds (R3), so we never need a whole
GOP resident **in order to meet the requirement** — while still not regressing
what reverse does today. The unit of *decoding* and the unit of *retention* can
differ:

- Decode forward from the keyframe (unavoidable — that is how inter-frame coding
  works), but **retain only a window of frames around the playhead**.
- A ±5 s window at 1080p25 is ~250 frames ≈ **780 MB**, and at ±3 s ≈ 470 MB.
  Comfortable inside the existing multi-GB budget, and it is the same cost
  whether units are 3 s or 10 s.

This makes 1080p Direct Play viable and turns the earlier blocking question into
a design decision: **retention is a time window, not a unit count.** Two things
follow that the current code does not do:

1. `frame-store.js#_computeMaxSegmentsBuffered` counts *segments*. It must become
   **seconds of decoded video**, computed from the real stream dimensions at
   runtime (R7), so the budget means the same thing on every path and at every
   resolution.
2. Eviction must be able to drop *frames within* a decoded unit, not only whole
   units. Today the smallest evictable thing is a segment.

**Unverified:** the CPU cost of re-decoding from a keyframe each time the playhead
leaves the retained window, especially when stepping backwards across a GOP
boundary. This is the main thing to prototype.

---

## 4. Bandwidth (R8) — the real constraint on Direct Play

Direct Play streams the original bitrate: **7.95 Mbps sustained**, and a cold seek
pulls up to **~10 MB** for one GOP. Over a VPN at, say, 8 Mbps effective, that
worst-case seek is roughly **10 seconds** of waiting. On a 1 Mbps link Direct Play
is simply not usable.

Two mitigations, both enabled by having the real sample table:

- **Fetch sub-GOP sample ranges, not whole GOPs.** To display time T we need the
  keyframe plus samples up to T — and we know every sample's exact offset and
  size. Seeking near a GOP's start becomes cheap; only seeks near its end
  approach the full 10 MB.
- **Retain the encoded bytes**, which are ~250× smaller than decoded frames. The
  existing Tier-1 raw cache (3 GB) can hold a great deal of encoded media, so
  re-decoding after eviction usually needs no network at all.

This is also why **R6 is right**: transcoding is not legacy scaffolding, it is the
answer whenever the link cannot carry the original. Source selection therefore
needs to be **capability- and bandwidth-aware**, not a static preference:

```
prefer Direct Play  if  container/codec is decodable by this client
                    and measured throughput sustains the media bitrate
else                    Jellyfin transcode at a negotiated tier
```

**Unverified:** how to measure throughput cheaply and honestly enough to make that
call, and whether to switch paths mid-session or only at load.

---

## 5. Local files (R2, R5) and containers (R4)

In a browser a `File`/`Blob` supports `blob.slice(start, end)` →
`arrayBuffer()`: the same read primitive as an HTTP range, without a network. A
faststart MP4 is then handled by *exactly* the Direct Play logic — parse prefix,
build sample table, slice sample ranges. Local playback needs no server and works
offline.

Both confirmed entry points (R5) produce a `File`:

- `<input type="file">` picker
- drag-and-drop onto the player

So `LocalFileMediaSource` should accept a `File`/`Blob` (or a URL) and know
nothing about how it was obtained. That also means host injection works for free
if the C# side ever wants it.

**Containers (R4).** MP4/H.264 today; MKV and AVI must remain possible. Two
consequences:

- Container parsing must sit behind a seam so a Matroska/AVI parser can be added
  without touching the engine. mp4box cannot read either format.
- **Codec, not just container, decides the path.** AVI in particular tends to
  carry MJPEG/DivX/Xvid, which WebCodecs generally cannot decode at all. Such
  files will have to go through Jellyfin transcoding regardless of how well we
  parse the container — another reason R6 holds. Worth confirming against real
  archive samples before promising AVI support.

---

## 6. WebView2 (R9) — hard requirement, later verification

A separate project depends on this engine, so it must work there. Only the
*verification* is deferred; development and automated tests run in a browser.
That distinction matters — "verified later" must not become "designed for browser
only, ported later."

| Engine needs | Browser | WebView2 viability |
|---|---|---|
| `VideoDecoder` (WebCodecs) | yes | Chromium-based, yes — **but needs a secure context.** This already bit us over plain HTTP from a LAN address in #36; a mapped `https://` virtual host satisfies it. |
| Byte-range reads | `Blob.slice` / HTTP+Range | `Blob.slice` works identically; HTTP+Range via virtual host is **unverified** |
| Bundle load | `<script>` IIFE, no CDN | same — already how `marp-video-engine.js` ships |

Design rules that follow:

- **The reader contract is exactly `read(start, end) → bytes`.** Nothing above it
  may assume HTTP. That is what makes the host a below-the-abstraction detail.
- **A `Blob`-backed reader is the baseline; HTTP+Range is the optimisation.** A
  `Blob` needs no Range support at all, so the undocumented WebView2 Range
  behaviour is not a risk to the architecture.
- **No service workers, no CDN, no cross-origin assumptions** — all are
  restricted or awkward under a virtual host mapping.

When that project is picked up, the Range check is five minutes: from JS inside
the WebView, `fetch(url, {headers: {Range: 'bytes=1000-2000'}})`, assert 206 with
`Content-Range`, repeat mid-file. If it returns 200 with the whole body, use a
`WebResourceRequested` handler, a small localhost listener, or simply hand the
WebView a `File` — which reduces the C# case to the browser case. Doing this
early on a throwaway branch would de-risk the one assumption I cannot test here.

---

## 7. Proposed architecture

The unifying abstraction is **not** "a list of segment URLs":

> a byte-range reader, plus a container index yielding decodable units with
> authoritative timing, plus a way to turn part of a unit into decoder chunks.

```
┌─ common engine (source-agnostic) ──────────────────────────────────┐
│ scheduler · cache-window · frame-store (Tier 2) · gop-decoder      │
│ canvas-renderer · marp-video-shim                                  │
│ knows only: ordered units with real start/end times, "give me      │
│ chunks for [unit, sampleFrom..sampleTo]", and a decoder config     │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ MediaSource interface
        ┌─────────────────────┼─────────────────────┐
   DirectPlay             Transcode              LocalFile
   (HTTP+Range)         (HLS + sessions)        (Blob.slice)
        │                                            │
        └────────── ByteRangeReader ─────────────────┘
              HTTP+Range │ Blob │ (WebView2 host, later)
```

### Interface hypothesis

```
getDecoderConfig()                  -> {codec, description}
getUnitIndex()                      -> [{index, startTime, endTime, duration}]
fetchChunks(unitIndex, {from, to})  -> [{type, timestamp, duration, data}]
maxConcurrentFetches                -> number | undefined
prepareForPlayhead(time, direction)  // transcode-only; hides session lifecycle
reportPlaybackStarted/Progress/Stopped
```

Three decisive changes from today:

1. **Demux moves below the interface.** Direct Play and local files assemble
   chunks from the sample table they already hold; only the transcode path runs
   mp4box over init+media. `demuxer.js` becomes a helper that source uses, and
   `fetchInitSegment()` leaves the engine entirely. This is also the seam that
   makes MKV/AVI additive (R4).
2. **Session lifecycle moves below the interface.** The ~200 lines of
   close/extended behind-session tiling now in `app.js`, reaching into the engine
   via shim methods, belong inside `JellyfinTranscodeMediaSource` behind one
   `prepareForPlayhead()` call. Neither the app nor the C# host should know
   sessions exist.
3. **Sub-unit addressing.** `fetchChunks` takes a sample range, not just a unit
   index, because §4 requires fetching part of a 10 s GOP and §3 requires
   retaining part of one.

### Responsibility split

| Common engine | Media source |
|---|---|
| Scheduling and pacing | Locating bytes |
| Both cache tiers, eviction priority | Container parsing, timing authority |
| Decode, keyframe-continuity merge | Unit boundaries, chunk assembly |
| Reverse, seek, frame stepping | Concurrency ceiling, session lifecycle |
| Render, media-element-ish events | Quality tiers, playback reporting |
| Content-mismatch detection | Whether this client can decode it at all |

---

## 8. Open questions

1. **Re-decode cost when the playhead leaves the retained window** (§3) —
   the main prototype. Decides how wide the window must be.
2. **Retention as a time window** — reworking `_computeMaxSegmentsBuffered` into
   seconds-of-video, and making eviction able to drop frames within a unit.
3. **Throughput measurement for source selection** (§4) — how to decide Direct
   Play vs transcode honestly, and whether to switch mid-session.
4. **Is the ~10 s GOP typical?** One file measured. Other cameras and encoders
   will differ; assume neither 3 s nor 10 s.
5. **`moov`-at-end (non-faststart) files** — probe strategy for raw camera
   output. Needs a real test file.
6. **Real archive survey** — containers, codecs, resolutions and framerates
   actually present in `/mnt/rov-video-new`, to confirm R4/R7 and to find out
   whether AVI content is WebCodecs-decodable at all.

## 9. Roadmap

Agreed working model:

- **Refactor before building.** The interface goes in under the existing
  transcode path first, so later sources are additive rather than bolted onto
  HLS-shaped code.
- **Spikes before the refactor**, because their answers can still change the
  interface shape.
- **Validation:** Playwright-driven automated checks at every step, run here;
  the product owner verifies manually at the marked checkpoints, once enough has
  accumulated to be worth a session.
- **Unit granularity is an open measurement**, not a decision (see S1).

### A note on where measurements can happen

This sandbox has **no real GPU decode** (software SwiftShader), which is why the
existing e2e suite shows false `VideoDecoder.flush()` stalls. Networking is *not*
the limitation: the dev server is reached over the public internet from here, and
a 9.9 MB GOP fetch measured 670 ms (~118 Mbps), so remote byte-range behaviour is
measurable here — what cannot be reproduced is a *slow* link.

| Measurable here | Must be measured on the product owner's machine |
|---|---|
| Container parsing, index building, byte-range behaviour | Decode throughput, time-to-first-frame |
| Correctness, routing, cache logic, chunk assembly | Frame-memory ceilings, GPU surface limits |
| Remote fetch behaviour on a fast link | Behaviour on a genuinely constrained link |

Spike deliverables are therefore **self-contained measurement harnesses** that
print numbers, built and smoke-tested here, then run once by the product owner.

---

### Phase 0 — Spikes (throwaway code, no engine changes)

Goal: answer the three prototype questions and the unit-granularity question
before committing to an interface.

| Spike | Question | Where it runs | Status |
|---|---|---|---|
| **S1** | Decode cost and unit granularity: how long does a ~250-frame 1080p GOP take to decode? What is time-to-first-frame for seeks landing early vs late in a GOP? What does it cost to re-decode from the keyframe when stepping backwards out of the retained window? | Harness built here, **numbers from the owner's browser** | Harness built and driven; **awaiting real GPU** |
| **S2** | Time-window retention: how wide a window (in seconds) stays comfortably inside the frame-buffer ceiling at 1080p and at a larger format? Where does `VideoFrame` allocation actually start failing? | Same harness | Same; failure *mode* known (§10) |
| **S3** | Throughput and seek latency for Direct Play, including worst-case (end-of-GOP) seeks. Baseline is measurable here over the internet (670 ms for 9.9 MB); what needs the owner's machine is behaviour on a genuinely constrained link. | Baseline here; constrained-link numbers from the owner | **Answered** on a fast link (§10) |
| **S4** | Archive survey: containers, codecs, resolutions, framerates actually present; whether any AVI content is WebCodecs-decodable; how many files are non-faststart (`moov` at end). | Scriptable against the media archive | **Answered** (§10) |

Also in Phase 0, small and worth doing once:

- Generate **small MP4 test fixtures** with ffmpeg (short/faststart,
  non-faststart, long-GOP) in the persistent `/home/mare/test-fixtures/`
  location, so local-file tests need neither the 1.3 GB clip nor a server.
- Move the Direct Play probe scripts out of the scratchpad (which keeps getting
  wiped) into a tracked `video-engine/test/probes/` directory so measurements are
  repeatable.

**Exit criteria:** a retention-window width to design against, a decision on
GOP-sized vs subdivided units, a go/no-go on Direct Play over VPN, and a known
codec/container inventory.

---

### Phase A — Extract the media-source interface (refactor, no new behaviour)

1. Define the interface from §7, with `JellyfinTranscodeMediaSource` as the only
   implementation.
2. Move demux below it: source returns chunks; `fetchInitSegment()` leaves the
   engine; `demuxer.js` becomes a helper the transcode source calls.
3. Move session lifecycle below it: the ~200 lines of close/extended tiling in
   `app.js` go inside the source behind `prepareForPlayhead()`; remove
   `setBehindSession`/`setBehindSessionForRole` from the shim surface.
4. Replace `_computeMaxSegmentsBuffered`'s segment counting with
   **seconds-of-decoded-video**, derived from the real stream at runtime (R7).

**Validation:** all 129 existing unit tests stay green; Playwright run against
the dev server showing playback, seek, reverse and frame-step unchanged.
**→ Owner checkpoint 1: manual verification that nothing regressed.**

Risk: this touches the code that took this whole session to stabilise. Mitigation
is that it is a pure move — no logic changes — done in reviewable steps, with the
content-mismatch detector and `CONTENT MISMATCH` warning still in place to catch
any routing regression loudly.

---

### Phase B — `LocalFileMediaSource` (satisfies R2)

1. `ByteRangeReader` abstraction with a `Blob` implementation (`blob.slice`).
2. MP4 container indexer: fetch prefix → mp4box → sample table → unit list +
   decoder config. Handles `moov`-at-end per S4's findings.
3. `LocalFileMediaSource` accepting a `File`/`Blob` — no picker knowledge, so the
   same class serves a browser picker, drag-and-drop, and any future host
   injection.
4. App wiring: file picker **and** drag-and-drop (R5).

**Validation:** self-contained Playwright e2e against the small fixtures — no
server, no transcoder, so this is the first genuinely reliable e2e in the project.
**→ Owner checkpoint 2: play a real dive file from disk, seek, reverse, step.**

---

### Phase C — Time-window retention and sub-unit fetching

Only as wide as S1/S2 say is needed.

1. Retention as a time window around the playhead; eviction able to drop frames
   *within* a unit, not just whole units.
2. `fetchChunks(unit, {from, to})` sub-unit addressing.
3. Re-decode-on-demand when the playhead leaves the retained window.

**Validation:** unit tests for window/eviction maths; Playwright reverse-and-step
runs against fixtures. **→ Owner checkpoint 3: reverse and stepping still feel
right on real footage.**

---

### Phase D — `JellyfinDirectPlayMediaSource` (satisfies R1)

1. Direct Play negotiation and the `static=true` byte-range reader.
2. Reuse Phase B's indexer unchanged — this is the payoff for the seam.
3. Bandwidth/capability-aware source selection (§4), informed by S3.

**Validation:** Playwright against the dev server; correctness checked by the
existing content-mismatch detector plus a probe comparing decoded timestamps to
container timing. **→ Owner checkpoint 4: Direct Play over the VPN.**

---

### Phase E — Revisit the transcode path

It stays (R6). **Its reverse behaviour currently works well and must not be
degraded** — do not treat R3 as permission to simplify the close/extended tiling
just because the *minimum* requirement is a few seconds. Any restructuring here
has to demonstrate equal-or-better reverse behaviour on real footage first.

The genuinely open items on this path are narrower:

- the still-unexplained `[behind@seg36]` observation (a session anchored ~114
  segments behind being routed a far-ahead segment — possibly a bug in the
  segment-number label added for logging rather than a real routing fault);
- whether per-session concurrency should be 1 or 2 (currently 2; its documented
  failure mode — two concurrent requests for unproduced segments racing a
  restart — has been observed, and backoff absorbs it).

---

## 10. Phase 0 results

All probes are tracked in `video-engine/test/probes/` (see its README) so every
number below can be re-derived rather than trusted. Fixtures were generated from
the real 1080p source into `/home/mare/test-fixtures/video-engine/fixtures/`.

### S3 — throughput and seek latency (answered on a fast link)

Measured from the sandbox against the dev server, `s3-throughput.mjs`. Media
bitrate derived from sample sizes: **7.94 Mbps**, matching the reported 7.95.

| Measurement | Result |
|---|---|
| Cold index (1.05 MB prefix) | **109 ms** |
| Whole GOP (250 frames, ~9.5 MB) | 448–539 ms, 146–180 Mbps |
| Sustained 8 consecutive GOPs | 76.6 MB / 80 s of video in 3.6 s — **21.9× realtime** |

**Seek cost scales linearly with landing position inside the GOP** — the §4
mitigation is real and large:

| Landing | Frames fetched | Bytes | Time |
|---|---|---|---|
| 0 % | 1 | 0.10 MB (1 %) | 26 ms |
| 25 % | 63 | 2.47 MB | 139 ms |
| 50 % | 126 | 4.86 MB | 234 ms |
| 75 % | 188 | 7.37 MB | 339 ms |
| 100 % | 250 | 9.67 MB | 432 ms |

A 96× spread between best and worst landing. **Sub-unit addressing therefore
belongs in the interface from the start** (§7 item 3), not deferred to Phase C:
without it every seek pays the worst case.

Projected worst-case cold seek for the 10.0 MB largest GOP in this file:

| Link | Worst-case seek | Playback sustainable? |
|---|---|---|
| 100 Mbps | 0.8 s | yes |
| 25 Mbps | 3.4 s | yes |
| 8 Mbps | 10.5 s | yes, barely (7.9 Mbps needed) |
| 4 Mbps | 21.0 s | **no** |

So Direct Play over VPN is a **go above ~10 Mbps and a no-go below ~8**, with
transcode fallback (R6) as the answer under that. Still unmeasured: real
behaviour on a genuinely constrained link, which needs the owner's connection.

### S4 — archive survey (answered)

`s4-archive-survey.py`, run read-only on the Jellyfin box. 54 files ffprobed
across every top-level project; `moov` position censused across **all 2,692**
MP4 files in `/mnt/rov-video-new`.

- **Codec: h264 everywhere** (51/54 sampled), Main or High profile, `yuv420p`
  — WebCodecs-decodable. The exceptions are **two `mpeg4` Simple Profile**
  files in `OUTREACH`, both `_output` products of some local tool. WebCodecs
  generally cannot decode these, which is a concrete instance of R6: capability
  detection must gate the path, and transcode must catch what fails.
- **Resolution: 1920×1080 universally.** No 4K present. R7 still holds as a
  forward-looking requirement, but there is nothing larger to design against
  today.
- **Framerate: 25 fps (42) or 30 fps (11).** Both must be handled; neither is
  safe to assume.
- **Bitrate spans 0.47 → 29.9 Mbps.** The recent projects (MERCI5, SALT7,
  PALEO2023, MBNMS2025) run **~28 Mbps High profile** — 3.5× the reference
  clip. The S3 link projections above must be tripled for that content: a
  28 Mbps file is **not** Direct-Playable over a 25 Mbps link at all.
- **Faststart: 2,659 of 2,692 (98.8 %).** Only **31** have `moov` at the end,
  plus 2 unreadable. They cluster in specific projects (MBNMS2025, MERCI5,
  SALT7, PALEO2023, the ML training segments, the OUTREACH `_output` files). So
  a non-faststart fallback is needed for completeness but is **not** on the
  common path — a tail-probe strategy can be added in Phase B without holding
  anything up.
- **No MKV or AVI exists anywhere in the readable archive.** R4's AVI concern is
  currently hypothetical. Note the other three mounts (`rov-video1`, `seagate`,
  `seagate2`) return `Input/output error` from the dev account and are
  **unsurveyed** — the drives may simply be offline.

### S1/S2 — harness built, real numbers still pending

`harness/` is built, served over localhost (WebCodecs needs a secure context)
and driven end to end under headless Chromium: index build, `isConfigSupported`,
chunk assembly, decode, and all four S1 measurements plus the S2 ramp run
without error. **The sandbox's numbers are not reported here on purpose** — it
has software-only decode, so they answer nothing about a real machine.

Two things the smoke run did establish, which are not decode-speed claims:

1. **Fetch and decode are timed separately** in the harness, so S1's numbers
   cannot be contaminated by network time the way a naive measurement would be.
2. **S2's exhaustion mode is a renderer crash, not an exception.** The tab died
   rather than throwing, so a `try/catch` cannot report the ceiling. The harness
   therefore logs every 50 retained frames as they are retained; the last line
   printed brackets the ceiling. (In the sandbox that was 1,350–1,400 frames of
   1080p, ~54 s, ~3.9 GB nominal — a software-decode figure, quoted only to show
   the mechanism works.)

**Phase A remains blocked** until S1/S2 are run on real hardware, per the rule
in §9: the retained-window width and the re-decode cost can still change the
interface.

---

### Later, separate project — WebView2 verification

Run the finished engine in the C# host: the Range check from §6, secure-context
confirmation, and the `File`-injection fallback if Range is unsupported. Should be
wiring, not engine work — and worth doing early on a throwaway branch to de-risk
the one assumption that cannot be tested here.
