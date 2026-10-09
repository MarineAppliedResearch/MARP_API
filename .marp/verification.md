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

---

**2026-09-24, after first use: `181-video-page-on-an-insecure-address`.**

Isaac's first use failed: *"crypto.randomUUID is not a function"* on signing in. MARP is
reached at `http://47.208.203.78:3000`, which a browser does not treat as secure, and there
it offers neither `crypto.randomUUID` nor WebCodecs. Every test above ran on localhost, which
it does treat as secure, so none of them could see it. Fixed by serving HTTPS beside HTTP on
port 3000 with a certificate for the address, and by reaching Jellyfin through MARP at
`/jellyfin`, because a secure page cannot fetch from plain-http Jellyfin.

Measured at the public address with Chromium, certificate warning accepted:

```
https://47.208.203.78:3000/ {"secure":true,"VideoDecoder":"function","randomUUID":"function"}
http://47.208.203.78:3000/  {"secure":false,"VideoDecoder":"undefined","randomUUID":"undefined"}
```

A second defect, found by the new sign-in test: the sign-in form was never hidden, because
its `display: grid` beat the `hidden` attribute. Red before the style fix, green after.

- `tests/listen.test.js` 5, `tests/jellyfin-proxy.test.js` 6: both protocols on one port,
  the page redirect and its localhost exception, and the proxy's pass-through, cookie
  stripping, Range, sign-in body, redirect rewriting and gate.
- `tests/api/video-window.spec.mjs` 6 (3 × 2 widths): the window, the real Jellyfin reached
  through `/jellyfin`, and signing in with Jellyfin's answer stood in.
- `test:mosaic` 288, `test:core` 245, `test:auth` 36, `test:gpu` 187; Mosaic unit 303.
- Whole browser tier: 596 passed, 1 failed, 21 skipped. The failure was *A4: an accept mark
  on a tile with no picture is refused* at phone width; alone it passed twice at both widths.
  The run before, a different phone-width test failed the same way. Intermittent, not fixed here.

Still not by a test: playback after a real Jellyfin sign-in. That step is Isaac's.
