# The video player as a library (#36)

Read this before `media-source-architecture.md`, which describes the
playback engine underneath. This document describes the player a consumer
actually gets.

## The goal, in the product owner's words

> "The whole point of this project is that we'll be able to use it as a
> library... our video player is supposed to be a library, that has all UI
> controls included. When the video player gets called, it has all the UI
> controls we created, including the buttons, the scrub bar, the spinner,
> all of that should be 100% importable from the JavaScript."

## Status: the UI is in the library

One script tag and one call produce a complete, working video player --
picture, transport, scrub bar, spinner, settings -- in a browser or inside a
WebView2 host, from the same file:

```html
<script src="dist/marp-video-engine.js"></script>
<script>
    const player = MarpVideoEngine.createMarpVideoPlayer(document.getElementById('mount'), {
        jellyfin: { serverUrl, accessToken, userId },   // optional: adopt a host session
        itemId,                                        // optional: or file, or url
    });
</script>
```

With no options at all it still comes up usable: the player's own settings
menu signs in to Jellyfin, takes an item id, opens a local file, picks a
quality tier and exposes the cache diagnostics. Nothing outside the mount
element is required, and there are no sibling asset files -- the markup, the
stylesheet and the MARP mark all ship inside the bundle.

`createMarpVideoEngine(canvas, options)` is still exported for a consumer
that draws its own interface, and is what the player uses internally.

### What lives where

| File | Role |
|---|---|
| `video-engine/src/ui/player-ui.js` | The player: builds the DOM, wires every control, owns the load paths |
| `video-engine/src/ui/markup.js` | The DOM as a template |
| `video-engine/src/ui/styles.js` | The stylesheet, scoped under `.marp-player` |
| `video-engine/src/ui/logo.js` | The placeholder mark, inlined as a WebP data URI |
| `video-engine/src/engine.js` | `createMarpVideoEngine()` |
| `video-engine/src/index.js` | Package barrel |
| `frontend/apps/VideoPlayer/index.html` + `app.js` | Test harness: a mount point, dev credentials, and the page globals the suites drive. 83 lines total |
| `frontend/apps/VideoPlayer/player.html` | The page a WebView2 host loads |

### Player options

`aspectRatio` (default `'16 / 9'`, pass `null` to fill a sized container),
`maxWidth` (default `'960px'`), `jellyfin`, `jellyfinClient`, `prefill`,
`itemId` / `file` / `url`, `defaultItemId`, `showDiagnostics`,
`rawCacheGiB` / `decodedCacheGiB`, `exposeGlobals` (assign each loaded
engine to `window.marpVideo` and `window.mareVideo`), `webview2Bridge`
(post `status|`/`metadata|`/`frame|` to the host on every load), `onLog`.

The player delegates the `<video>`-shaped surface (`currentTime`, `play()`,
`playbackRate`, `addEventListener`, `requestVideoFrameCallback`, ...) to
whichever engine is loaded, so one object survives item and quality changes
-- each of which replaces the engine underneath.

## Decisions worth knowing

- **Element ids are kept alongside scoped classes.** Styling and internal
  queries go through `marp-`-prefixed classes so two players can coexist,
  but the markup still carries the harness's original ids because the
  Playwright suite and the probes address elements by id. Keeping them means
  the extraction was verified by the existing suites rather than by
  rewritten ones. Two players on one page therefore duplicate ids; nothing
  in the library queries by id.
- **No credentials in the library.** `app.js` used to prefill the dev
  Jellyfin server's username and password. Those stay in the harness page;
  the library takes a `prefill` option.
- **The log panel is gone.** Messages go to the console, and to `onLog`.
  `player.html` deliberately does *not* forward `onLog` to the host: one
  message per fetch/decode and per tenth frame would flood the channel the
  host parses.
- **The speed override moved into the settings menu** ("Playback"), and the
  step buttons moved into the transport row. Both were loose on the harness
  page before.
- **The mark is inlined, not an asset.** Downscaled from 599x525 PNG
  (162 KB) to 320px WebP (~36 KB). A relative image path breaks inside a
  WebView2 virtual-host mapping; the whole bundle is 613 KB.

## Constraints that already cost time

- **WebCodecs needs a secure context.** `NavigateToString` gives a page no
  origin, so `VideoDecoder` is undefined there. The host must navigate to a
  real origin -- a WebView2 virtual-host folder mapping works, and is
  already set up in `MareMediaElement.cs`.
- **The bundle must reach the build output.** A newly added file in a C#
  project defaults to "do not copy"; when it is missing the page fails in
  confusing ways. `webview2-check.html` reports this as check 0.
- **No audio.** The engine decodes video only; `volume`/`muted` do nothing.
  Deferred by the owner, not forgotten.
- **The dev sandbox has no GPU decode.** Direct Play's ~250-frame 1080p GOPs
  cannot be decoded at playback speed there, so its E2E suite and the Direct
  Play leg of the player-page probe fail locally and pass on real hardware.
  Do not chase it.
- **Reverse playback pauses itself at the start of the clip.** A test that
  "pauses" with a transport click after reverse playback reaches 0
  therefore starts playback instead. Measured, not inferred; see the
  reverse-playback test's comment. The stray `currentTime` reading at that
  boundary is a known bug -- see below.

## Known bugs

### currentTime reads the clip's end when reverse playback stops at 0

Not fixed. Logged rather than chased because it is cosmetic in the player
itself, and the owner's call is to leave it until it actually bothers
something.

Playing in reverse into the start of a clip makes `currentTime` report the
clip's **end** for roughly one frame before the engine pauses itself at 0.
Measured on a 30.44s local fixture: the playhead walked `2.16 -> 2.04 ->
... -> 0.28 -> 0.20` normally, then one 100ms sample read `30.12`, then
`pause` fired and it settled at `0.12`.

The stop is correct -- `scheduler.js`'s tick clamps `targetTime` to 0 on a
reverse boundary. The getter, though, returns `_presentedMediaTime` (the
frame actually on screen), not that clamped target, so whatever frame lands
at the boundary is reported verbatim. The clamping and the reporting read
two different values.

Why it may stop being cosmetic: the WebView2 bridge posts a `frame|`
message per presented frame, so a host can see `Position` jump to the end;
and Jellyfin playback reporting posts the current position, so a report
firing on that sample could record a resume position at the end of the
video -- which is how something gets marked watched when it was not. The
`currentTime` glitch was observed directly; neither downstream consequence
has been confirmed.

Reproduce: play in reverse into 0 while sampling `currentTime`. The note
lives on the getter in `video-engine/src/scheduler.js` too.

## How to verify

- `npm run test:video-engine:unit` -- 132 tests.
- `npx playwright test --config video-engine/playwright.config.js --grep "local file"`
  -- six playback checks, deterministic, ~16s, no server needed.
- `node video-engine/test/probes/player-page.mjs` -- drives `player.html`
  the way a host does, for both a Jellyfin item and a plain URL.
- `video-engine/test/probes/` -- behind sessions, playback reporting, host
  messages, local-file playback. These cover things no suite can see, such
  as whether Jellyfin actually recorded a position.
- The owner tests manually on real hardware; that is the signal that counts.

## Working agreements

From `agents.md` and hard experience on this issue:

1. Narrate each edit before making it, and show diffs. Do not outpace review.
2. "Commit" means commit what is on disk. Never infer consent for a code
   change from an acknowledgement.
3. Unit tests are not evidence that anything works. They stayed green
   through every real bug here, including the one this extraction caused.
4. Rebuild the bundle (`node video-engine/build.js`) after any
   `video-engine/src/` change -- the browser only runs `dist/`.
5. When something is measurable, measure it against the real thing instead
   of reasoning from logs. Every genuine root cause on this issue came from
   measurement, and several confident log readings were wrong.
