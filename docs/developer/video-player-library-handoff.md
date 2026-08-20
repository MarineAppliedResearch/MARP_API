# Handoff: make the video player a real library (#36)

Written for an agent picking this up with fresh context. Read this before
`media-source-architecture.md` — that document describes the playback
engine, which is done. This one describes what is not.

## The goal, in the product owner's words

> "The whole point of this project is that we'll be able to use it as a
> library... our video player is supposed to be a library, that has all UI
> controls included. When the video player gets called, it has all the UI
> controls we created, including the buttons, the scrub bar, the spinner,
> all of that should be 100% importable from the JavaScript."

One import gives a consumer a **complete, working video player**: picture,
transport controls, scrub bar, spinner, settings. It runs in a browser and
inside the C# WebView2 desktop app, from the same files.

## What is done

The playback engine and its sources are finished and verified on real
hardware, in a browser and inside WebView2:

- three media sources — Jellyfin Direct Play (default), Jellyfin transcode
  (fallback), and local files — behind one interface;
- forward playback, true reverse playback, frame-accurate stepping, seeking;
- everything a consumer needs is in the library: path selection and
  negotiation (`createJellyfinSource`), the behind-session tiling that keeps
  transcode reverse fast, and playback reporting to Jellyfin;
- a `<video>`-shaped API (`currentTime`, `play()`, `pause()`, `playbackRate`,
  `addEventListener`, `requestVideoFrameCallback`) plus a WebView2 bridge
  posting `status|`/`metadata|`/`frame|` messages.

## What is missing, and why this handoff exists

**The UI is not in the library.** It lives in the test harness:
`frontend/apps/VideoPlayer/index.html` (608 lines of markup and CSS) and
`app.js` (1070 lines, 41 event listeners) wire it to the engine by element
id.

`player.html` — written for the C# host — is a bare `<canvas>` with no
controls at all. That was a mistake, made by reasoning that the WebView2
host draws its own WPF overlay so the page needed no UI. That is an argument
about one host, not about a library, and it produced exactly the thing the
owner did not ask for: a player with no play button.

So today a consumer gets picture and an API, then has to rebuild the entire
interface themselves. That is the gap to close.

## The UI that must move

All of it currently exists and works in the harness. Element ids, for
reference:

| Area | Elements |
|---|---|
| Transport | `playPauseButton`, `centerPlayButton`, `centerPlayOverlay`, `stepBackButton`, `stepForwardButton`, `speedOverrideInput`, `speedDisplay`, `muteButton`, `fullscreenButton` |
| Scrub bar | `scrubTrack`, `scrubTrackBg`, `scrubHandle`, `scrubTooltip`, plus per-unit shading built from `getSegmentStates()` |
| State | `bufferingSpinner`, `timeDisplay`, `placeholderLogo`, `controlsBar` (auto-hide) |
| Settings menu | `playerSettingsButton`/`Menu`/`Anchor`, accordion sections for login, load item, quality, advanced |
| Sources | `itemIdInput`, `loadButton`, `localFileInput`, drag-and-drop on the canvas, `qualityOptionsList` |
| Jellyfin session | `jellyfinServerUrlInput`, `jellyfinUsernameInput`, `jellyfinPasswordInput`, `jellyfinLoginButton`, `jellyfinLogoutButton`, `loginStatus` |
| Diagnostics | `rawCacheGiBInput`, `decodedCacheGiBInput`, `applyCacheSettingsButton`, `readCacheSettingsButton`, `dumpEngineStateButton`, `log` |

## Suggested shape

Not prescriptive, but this is the shape the owner's description implies:

```js
const player = await MarpVideoPlayer.create(container, {
    jellyfin: { serverUrl, accessToken, userId },
    itemId,            // or file, or url
    controls: true,
});
```

`create()` builds the canvas, the controls and the settings UI inside
`container`, wires them to the engine, and returns something with the
existing `<video>`-shaped API still on it. A consumer embedding it in a page
or in WebView2 gets a finished player.

Points worth settling early:

1. **Where does the markup and CSS live?** Built in JS, or a template string
   in the bundle? It must ship *inside* the library — a consumer copying two
   files should not also be copying HTML they have to keep in sync.
2. **What is optional?** The diagnostics panel, the login form and the cache
   controls are developer tools; a host embedding the player probably wants
   the transport controls and scrub bar only. A `controls` option, or a
   preset, rather than all-or-nothing.
3. **What stays in the harness?** After the move, `index.html`/`app.js`
   should be a thin page that mounts the library and nothing else, which is
   also the proof the extraction is complete.
4. **The C# host.** `player.html` becomes a page that mounts the library with
   controls enabled. `MareMediaElement`'s WPF overlay then overlaps it, so
   decide with the owner whether the host shows the library's controls or
   keeps its own.

## Constraints that already cost time

- **WebCodecs needs a secure context.** `NavigateToString` gives a page no
  origin, so `VideoDecoder` is undefined there. The host must navigate to a
  real origin — a WebView2 virtual-host folder mapping works, and is already
  set up in `MareMediaElement.cs`.
- **The bundle must reach the build output.** A newly added file in a C#
  project defaults to "do not copy"; when it is missing, the page fails in
  confusing ways. `webview2-check.html` reports this as check 0.
- **Attach the WebView2 bridge to an already-loaded engine.** It replays
  `loadedmetadata` on attach, because the host raises `MediaOpened` from that
  message and reveals its own UI on it.
- **No audio.** The engine decodes video only; `volume`/`muted` do nothing.
  Deferred by the owner, not forgotten.
- **The dev sandbox has no GPU decode.** Direct Play's ~250-frame 1080p GOPs
  cannot be decoded at playback speed there, so its E2E suite fails locally
  and passes on real hardware. Do not chase it.

## How to verify

- `npm run test:video-engine:unit` — 132 tests.
- `npx playwright test --config video-engine/playwright.config.js` — the same
  six playback checks against each of the three sources. The **local-file**
  suite is the trustworthy one: deterministic, ~12s, no server.
- `video-engine/test/probes/` — behind sessions, playback reporting,
  host messages, local-file playback, the player page. These cover things no
  suite can see, such as whether Jellyfin actually recorded a position.
- The owner tests manually on real hardware; that is the signal that counts.

## Working agreements

From `agents.md` and hard experience on this issue:

1. Narrate each edit before making it, and show diffs. Do not outpace review.
2. "Commit" means commit what is on disk. Never infer consent for a code
   change from an acknowledgement.
3. Unit tests are not evidence that anything works. They stayed green through
   every real bug here.
4. Rebuild the bundle (`node video-engine/build.js`) after any
   `video-engine/src/` change — the browser only runs `dist/`.
5. When something is measurable, measure it against the real server instead
   of reasoning from logs. Every genuine root cause on this issue came from
   measurement, and several confident log readings were wrong.
