---
task: MarineAppliedResearch/MARP_API#181
repos: [marp-api, marp-video-player]
status: implementing
needs: [jellyfin]
---

# Watch an observation in its source video, from the Mosaic

Refs MarineAppliedResearch/MARP_API#181

## Goal

A reviewer looking at a tile can open the source video at that observation's moment in the
MARP Video Player. The video shows the bounding boxes of the observations being reviewed,
and closing it returns to the Mosaic exactly as it was. Reviewers do this often, so it has
to answer at once whatever the connection: something useful on screen immediately, the
video as soon as the bytes allow, and no cold start the second time.

**Not now, but not to be designed out:** editing a box, a keyframe or a track segment in
the player. The box layer is built so that editing can grow into it.

## What investigation found

- **The Mosaic row does not carry a video.** `repository/mosaic.repository.js` `ROW_COLUMNS`
  has no video identity, no position and no keyframes, only `keyframe_count` and
  `first_framenum`. The player needs a new read: the video, the moment, and the keyframes.
- **Finding the video is solved already.** `service/thumbnail-extraction.service.js`
  resolves an observation's `video_source` through Jellyfin, never from
  `jellyfin_item_id`, and refuses a weak match.
- **The browser can already reach the video.** `GET /api/v2/jellyfin/items/:id/stream`
  redirects to Jellyfin: Direct Play by byte range, or an HLS transcode at 1080p, 720p or
  480p. MARP never carries the bytes.
- **The player plays Jellyfin by byte range**, and fetches only the chunks around where it
  is, so opening at a moment in a 20 GB dive costs seconds of video, not the file. It has
  no runtime dependencies and makes no requests at load. Its host contract with the
  annotation GUI (`MarpVideoEngine`, the `postMessage` lines, `player.html`'s query
  parameters) is add-only.
- **The player already draws boxes, but only in live mode.** `src/live-frame-presenter.js`
  draws track boxes and labels for the worker's watch window from pushed frames. Recorded
  playback has no box layer.
- **The Mosaic is vanilla ES modules with no build step and no dependencies**, on purpose.
  `src/api/` is the only place that knows a URL.
- **A keyframe's `framenum` means two things,** depending on who wrote it:
  - The annotation GUI computes it at an assumed 25 (VIDEO_PROCESSING_GUI#221), so its time
    is `framenum / 25`, which recovers the millisecond it was written from, on any video.
  - A GPU observation's `framenum` is the real decoded frame, so its time is
    `framenum / real rate`.
- **Thumbnails refuse every non-25 video** (R21 in `thumbnail-extraction.service.js`). Since
  #231, 24.946 fps results are stored, and their thumbnails fail permanently: observation
  115227 reads *"Source frame rate is 24.946… Refusing to seek."* The Mosaic cannot show
  them. See A5.

## Requirements

- **R1** — From a tile, a reviewer opens the source video at that observation's moment.
- **R2** — The video shows the boxes of the observations under review that appear in it
  (A2), placed in time by who wrote them (see the finding above), between keyframes by
  linear interpolation. Linear interpolation is the premise the keyframe reduction was built on.
- **R3** — Something useful is on screen at once: the observation's frame and box, from
  the full frame the thumbnail pipeline already extracts, while the video loads behind it.
- **R4** — A second observation opens without a cold start: the player stays loaded, and
  the same video is a seek, not a reload.
- **R5** — Closing it returns to the Mosaic with its page, filters, marks and scroll
  untouched. A hidden player stops downloading.
- **R6** — On a slow connection it still answers. It fetches only around the moment, shows
  when it is waiting, and a lower-quality tier is one click away.
- **R7** — Nothing in the player's existing host contract changes. Additions only.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-09-24: **(a), its own reused window.**
  **Where does it open?**
  - **(a) Its own window, opened by the Mosaic and reused.** Recommended: it can sit on a
    second monitor, it survives anything the Mosaic re-renders, the player stays warm, and
    it is a page, so on a phone it opens as a tab. Editing later gets a whole page to grow
    in.
  - **(b) A panel inside the Mosaic page.** Nothing to switch between, but it shares the
    grid's screen and its code lives inside the Mosaic.
  - **(c) A plain new page, navigated to.** Simplest, but leaving the Mosaic is what R5
    says must not happen.
- [x] **A2 · product/UI · blocking** — answered 2026-09-24: **(a), the current page's, in
  this video.** **Which boxes does it draw?**
  - **(a) Every observation on the current Mosaic page that falls in this video.**
    Recommended: that is "the ones being reviewed", and neighbours are visible.
  - **(b) Only the observation that was opened.**
  - **(c) Every observation in the database for that video,** reviewed or not.
- [x] **A3 · cross-repository / architectural · blocking** — answered 2026-09-24: **the way
  VIDEO_PROCESSING_GUI does it.** A released host archive from a marp-video-player GitHub
  release, unpacked into the repository by an update script, with `PLAYER_VERSION`
  recording which release is installed, and never edited by hand
  (`MAREGUI_PROOFofCONCEPT/player/`). **How does marp-api get the
  player?** The two are deliberately disconnected today.
  - **(a) A pinned copy of the player's built bundle,** checked into marp-api with the
    version and commit it came from, updated deliberately. Recommended: it is one file with
    no dependencies, and it matches how the worker installer pins it
    (`packaging/player.lock.json`).
  - **(b) An npm dependency** on marp-video-player.
  - **(c) Served from its own deployment,** separate from marp-api.
- [ ] **A4 · architectural · non-blocking** — The box layer for recorded video is drawn by
  the MARP page over the player's canvas, timed off the engine's current frame. It does not
  go into the player library yet. It moves into the player later if the annotation GUI
  wants the same thing. Editing is then built on that layer.
- [x] **A5 · data-meaning · blocking** — answered 2026-09-24: **(a), first, on its own
  branch.** **Fix the non-25 thumbnails first?** Thumbnails
  for 24.946 fps video fail permanently (above). The fix is the same time rule as R2: seek
  to `framenum / real rate` for a GPU row, and keep refusing a GUI row whose rate
  disagrees.
  - **(a) First, on its own branch,** so those observations can be reviewed at all.
    Recommended.
  - **(b) As part of this task.**
  - **(c) Later.**
- [ ] **A6 · performance · non-blocking** — Bandwidth. The page opens on the extracted
  frame instantly (R3), then plays Direct Play from the moment by byte range. It fetches the
  index of the next videos on the page ahead, not their video, and offers the 480p
  transcode when bytes are not arriving. Prefetching video for tiles nobody opens would
  compete with Jellyfin's small stream ceiling, which thumbnails and the GUI share.

## Decisions

- **2026-09-24** — The player opens in its own window, opened by the Mosaic and reused (A1).
- **2026-09-24** — It draws the boxes of the current Mosaic page's observations in that
  video (A2).
- **2026-09-24** — marp-api installs the player from a released host archive, the way
  VIDEO_PROCESSING_GUI does (A3).
- **2026-09-24** — The non-25 thumbnail fix goes first, on its own branch (A5). Done in
  #236 and #237, which also found that a frame number is playback time times the video's
  *nominal* rate, never a count of frames decoded.
- **2026-09-24** — A reviewer reaches Jellyfin with their own Jellyfin account, signing in
  from the player page. Isaac: *"the user will login and they will be able to access the
  jellyfin server with their credentials."* MARP's own sign-in is local and does not carry a
  Jellyfin session, so the player's own `JellyfinClient` signs in and keeps its session in
  the browser, the way jellyfin-web does. MARP never sees a Jellyfin password.

## Plan

1. **Install the player** the way VIDEO_PROCESSING_GUI does: an update script downloads
   the host archive of a marp-video-player release into `frontend/shared/vendor/
   marp-video-player/`, with `PLAYER_VERSION` recording which. v0.4.0, the latest release.
2. **One read for the player**, `POST /api/v2/mosaic/video-context` with the page's
   observation ids. It returns them grouped by video: the Jellyfin item (resolved from
   `video_source` as the thumbnail pass does, refused below the same match score), the
   nominal rate, and per observation its moment and its keyframes **already in seconds**.
   A GUI row's frames are `framenum / 25`; a GPU row's are `framenum / nominal rate`.
3. **The player page**, `inspect.html` in the Mosaic app: the player with its own
   interface and Jellyfin sign-in, and a canvas over it that draws, at each presented
   frame, every page observation whose keyframes span that time, interpolated, with the
   opened one marked.
4. **The Mosaic opens it**: a tile action opens or reuses one named window and tells it
   which observation and which page, by `BroadcastChannel`. The same video is a seek; a
   different one is a load.
5. **Responsiveness**: the page shows the observation's extracted full frame, or its
   thumbnail, with its box at once, and swaps to the video when the first frame at that
   moment is presented. The video context is fetched once per page and kept.
6. Tests at the tiers below.

## Acceptance criteria

- From a tile, the video opens at the observation's moment with its box drawn on the right
  frame, and the Mosaic is unchanged when it closes.
- The second observation opened shows its frame at once and its video without a reload.

## Test plan

- **API, `mosaic-video-context.test.js`**: grouping by video; a GUI row's times at 25 and
  a GPU row's at the nominal rate; an unresolvable or weak match reported, not guessed;
  the permission.
- **Unit, Mosaic `tests/unit`**: the box at a time, interpolated between keyframes, and none
  outside the track's span.
- **Browser, API tier**: the tile action opens the named window and hands it the
  observation; opening a second one reuses it.
- **By hand, once:** a real observation, signed in to Jellyfin, box on the animal. That
  step needs a person to sign in; Claude does not enter passwords.

## Status

- **Gate:** implementing
- **Notes:** A1–A3 and A5 answered 2026-09-24. Waiting on the thumbnail fix (A5) before G2.
