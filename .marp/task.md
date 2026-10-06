---
task: MarineAppliedResearch/MARP_API#181
repos: [MARP_API, marp-video-player]
status: verified
needs: []
---

## Goal

From a Mosaic tile, a reviewer opens that observation's source video at its exact frame and
sees, on the exact frames they belong to, the boxes of every observation in that video that
the Mosaic's current query matches -- not only the page on screen -- with the chosen
observation highlighted above the rest. The reviewer can correct those boxes the way the
annotation GUI lets them: drag, resize, add or delete a keyframe, set the end, delete the
observation; each change is written through the API as it is made. It works on a desktop
and on a phone, both for watching and for editing.

## What investigation found

- **Only the current page is drawn.** The Mosaic sends the visible page's ids; observations
  of the same video on other pages, or anywhere else the query matches, are never asked for.
- **There is no read for "this video under this query".** The query's filters
  (`src/api/requests.js` `filtersBody`) go to `/mosaic/observations/pages|counts|facets`,
  none of which can narrow to a video; the Mosaic row carries no `video_source`.
- **Boxes vanish outside a keyframe span** (`model/video-boxes.js` `boxesAt`): drawn only
  between a track's first and last keyframe. Isaac, 2026-10-05: every observation has one
  start, one end and usually middles, all interpolated between -- the GUI's rule
  (`VideoPlayer.xaml.cs` `DrawAnnotations`). The database agrees: 114,840 observations,
  114,840 start and 114,840 end keyframes, 1,869,633 middles.
- **Volume.** 461 videos, 2.1 M keyframes. The busiest video holds 2,798 observations and
  47,736 keyframes -- about 4 MB of JSON, too much to load upfront on a phone.
- **The pictures are off the reported time.** The player ignores the MP4 edit list:
  Direct Play shows each picture three frames before its time on MARP's dives (measured
  2026-09-26), a transcode two. A cold-started Jellyfin transcode is up to ten seconds off
  as well. Both are being fixed in marp-video-player#20 (branch
  `20-transcode-cold-start-shift`); boxes cannot be on the exact frame, nor edits saved
  against the right one, until it lands.
- **A phone cannot play the original file.** A 10-second 1080p GOP decodes to ~742 MB; the
  phone runs out of memory and its other apps are killed. Phones open a 720p transcode
  (branch `181-phones-open-a-transcode`), which needs #20's transcode fix to be exact.
- **How the GUI edits** (all in C# over the player): drag or resize saves on mouse-up --
  `PUT /keyframe/:id` on a keyframe, otherwise a new `middle` keyframe at the current frame
  via `POST /keyframe`; double-click deletes a keyframe (promoting the next to `start` if it
  was the start) or pins a `middle`; right-click: Set As End Keyframe, Delete Keyframe,
  Delete Entire Observation. No conflict check. Boxes are centre x/y and size, 0..1 of the
  picture. `framenum = floor(ms × 25 / 1000)`.
- **Editing needs groundwork in marp-api:** the video read returns no `keyframe_id`; the only
  keyframe write is the old `PUT` (whitelist x, y, width, height, type, framenum; no range
  check); `keyframes:write` is held only by the annotation GUI's token; an edited box does
  not refresh its thumbnail (the trigger fires on insert); turning a seconds position back
  into `framenum` must use 25 for a GUI row and the video's nominal rate for a GPU row.

## Requirements

- **R1** — Opening a tile opens its video at that observation's exact frame (#20).
- **R2** — The boxes drawn are those of every observation in this video that the Mosaic's
  current query matches, across all pages.
- **R3** — A box is drawn from its start keyframe to its end keyframe, interpolated linearly
  between keyframes, on the exact frame (#20). Nothing before the start or after the end.
- **R4** — The chosen observation is highlighted above the others; the others are drawn in
  their species colours as in the GUI.
- **R5** — Keyframes are loaded by time window around the playhead, the next window ahead,
  so a 48,000-keyframe video opens as fast as a small one and a phone is not loaded with it.
- **R6** — Editing, for a user holding `keyframes:write`: drag and resize save on release
  (update the keyframe, or add a `middle` at the current frame on an in-between box);
  double-click deletes a keyframe or pins one; the menu sets the end, deletes a keyframe,
  deletes the observation. The last save wins.
- **R7** — An edited observation's thumbnail is extracted again.
- **R8** — Watching and editing both work on a phone.
- **R9** — When the Mosaic's query changes while the video is open, the boxes follow it.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-10-05: every observation in this video
  matching the current query, all pages (1a).
- [x] **A2 · behavioural · blocking** — answered 2026-10-05: start to end, interpolated, as
  the GUI (2a).
- [x] **A3 · product/UI · blocking** — answered 2026-10-05: the GUI's box controls (3a).
  Creating observations and changing species are not in this task.
- [x] **A4 · security/permissions · blocking** — answered 2026-10-05: the existing
  `keyframes:write`, granted by an administrator; no new permission (4a).
- [x] **A5 · behavioural · blocking** — answered 2026-10-05: last save wins (5a).
- [x] **A6 · data-meaning · blocking** — answered 2026-10-05: re-extract the thumbnail after
  an edit (6a).
- [x] **A7 · scientific · blocking** — answered 2026-10-05: boxes on the exact frames, so the
  player is fixed (Direct Play's edit list included). Existing data is not touched.
- [x] **A8 · product/UI · blocking** — answered 2026-10-05: watching and editing on a phone.
- [x] **A9 · API contract · blocking** — answered 2026-10-05: the two reads, windowed (the
  recommendation). **How the page gets its boxes.** Recommended: two
  reads, both taking the Mosaic's filters body plus the video: (1) the matching
  observations in that video with their species and start/end times -- small, loaded once;
  (2) keyframes for those observations within a time window, fetched around the playhead.
  Alternative: one read of everything, simpler but ~4 MB for the busiest video.
- [x] **A10 · product/UI · non-blocking** — touch: tap selects, drag moves, corner handles
  resize, double-tap is double-click, long-press opens the menu.
- [ ] **A11 · scientific/data-meaning · non-blocking** — keyframes drawn in the annotation
  GUI over this player since it adopted it were drawn on pictures three frames early. When
  did that start, and does that data need attention later? Not touched here.

## Decisions

- **2026-10-05** — answers A1-A9 above, from Isaac.
- **2026-10-05** — "Set As End Keyframe" is not offered on the start keyframe, and the API
  refuses it: the GUI allows it and leaves the observation with no start. Isaac chose to
  withhold it.
- **2026-10-05** — the browser test for editing signs in to the real Jellyfin with the test
  credentials in `.env`, as the player's own end-to-end tests do, so it plays a video and
  drags a box with the mouse. It depends on Jellyfin being reachable.
- **2026-10-05** — touch (A10) as proposed, checked on the emulator by real touch input:
  `edit-check.cjs` in the umbrella's git-ignored `.marp/local/emulator/`, 10 of 10.

## Plan

1. marp-video-player#20: finish the cold-start fix (requests to a session go forward while a
   unit is assembled) and apply the edit list on Direct Play and local files; release.
2. marp-api reads (A9) with tests; generated docs rebuilt.
3. The video page: query-wide boxes, start-to-end interpolation, highlight, windowed loading,
   following the Mosaic's query; phone opens 720p.
4. Editing: keyframe ids in the read, the gestures, saves through the API, thumbnail refresh.
5. Verify on desktop and on the Android emulator against the testing database.

## Acceptance criteria

- On a desktop and the Android emulator, a box is on the frame its keyframe names, checked
  against the original file's pictures.
- Every observation in the video matching the query is drawn; the chosen one stands out.
- An edit made on the page is in the database, and the GUI shows it.

## Test plan

- Unit: interpolation start-to-end; window planning; seconds-to-framenum for GUI and GPU
  rows; the edit gestures' requests.
- API (Jest, `npm run test:mosaic`): the new reads under filters, windows and limits; edits
  restored afterwards.
- Browser (`npm run test:app:mosaic-review:api`): boxes and highlight; editing on the testing
  database; phone width.
- Real: the emulator harness against the live Jellyfin for frame exactness.

## Verification

Run 2026-10-05 on `181-video-review` with marp-video-player 0.6.0 installed.

- Unit (`npm run test:unit` in the app): 322 pass.
- API (`npm run test:mosaic`): 308 pass. The corpus guard flags `gpu_workers`,
  `service_clients` and `service_tokens` on every file -- heartbeats the running workers and
  services write during the run, not rows a test wrote.
- Browser (`npm run test:app:mosaic-review:api -- -g "#181"`): 14 pass, desktop and phone
  width, including the editing test over real video. Before 0.6.0 was installed the phone-width
  editing test failed: the old player showed a picture 5 s early (the burned-in clock read
  13:11 at a reported 13:16), so the box was never drawn.
- Emulator (Android 15 Pixel 7, live Jellyfin, real touch input): 10 of 10 -- tap selects,
  drag on an in-between box adds a middle at the picture's frame and draws where dropped,
  double tap removes it, corner drag resizes a keyframe keeping its frame and kind, long press
  opens the menu, Set As End saves, a drag on no box saves nothing. Edited rows were restored
  exactly.
- Frame exactness (player, marp-video-player#36): all points exact on two dives on the
  emulator's 720p transcode, 37.5-40 dB against the original frame and 27-35 dB against its
  neighbours; Direct Play on a desktop 45-48 dB.

Not covered: the annotation GUI drawing what this page saved (the GUI reads the same rows,
but it was not run); A11 is open.
