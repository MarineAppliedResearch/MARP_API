# Verification — MARP_API#181: watch an observation in its source video

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1, R4 | `tests/api/video-window.spec.mjs` › *Open video shows the observation in its own window, and reuses that window* | browser, API tier, desktop and phone | the button opens `inspect.html` in a window of its own, answered by the real read; a second observation goes to the same window, no new page |
| R5 | same | browser | the Mosaic is still showing its tile after the window opens |
| R2 | `tests/mosaic-video-context.test.js` › *groups observations by video, and puts each keyframe at the time its writer meant* | API + DB | a GUI row's keyframes at `framenum / 25`, a GPU row's at `framenum / nominal`, on one video whose nominal rate is not 25 |
| R2 | › *reports a weak match as unresolved rather than opening the wrong dive* | API + DB | a match below the thumbnail pass's score is not opened |
| — | › *refuses a request that names no observations*, › *requires a signed-in reader* | API | the request is validated, and gated like the other Mosaic reads |
| R2 | `tests/unit/video-boxes.test.mjs` (6 tests) | unit | interpolation between keyframes, nothing outside a track's span, several observations and subsets at once, and where a letterboxed picture sits |

## Requirements with no automated test

- **R3 (the full frame at once) and R6 (a slow connection)** are wired, but no test watches
  a real video load. Playback needs WebCodecs, a real Jellyfin, and a reviewer signed in to
  Jellyfin with their own account, and Claude does not type passwords.

## Manual steps

1. From the Mosaic, open a tile's details and press **Open video**. A window opens.
2. Sign in with your Jellyfin account in that window. Expect the video at the observation's
   moment, paused, with its box marked in green and the page's other boxes in cyan.
3. Open another tile's video. Expect the same window, a seek rather than a reload.

Observation 115874 (Fish-eating anemone, `20260611_161158_Fwd`, 19.6 s) is a good first
case: its box was checked against the decoded frame pixel for pixel during #236.

---

## Results

**2026-09-24, branch `181-inspect-source-video`.**

- `tests/mosaic-video-context.test.js`: 4 passed.
- `test:mosaic`: 280 passed in 8 suites. `test:subsystems`: every suite in exactly one group.
- Mosaic `test:unit`: 302 passed.
- `tests/api/video-window.spec.mjs`: 2 passed (desktop and phone). **Red first:** with the
  picker's old handler, which only fired the `openVideo` event, both fail waiting for a window.
- The real read against the development database, for observation 115874: the right
  Jellyfin item, nominal 25 fps, moment 19.6 s, 9 keyframes from 18.52 s to 20.76 s.
- **The whole browser tier, once:** one failure, `render-filters.spec.mjs` › *R2: the
  confidence slider narrows the mosaic*, at phone width (*"the mosaic said 1944 before and
  1944 after, with the store applying {"confidence":null}"*). Nothing in this change touches
  the rail. Run alone it passed twice at both widths, so it is intermittent in a full run.
  Left as found, not fixed here.
