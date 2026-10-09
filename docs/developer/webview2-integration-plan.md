# WebView2 integration plan (#36)

How the MARP video engine replaces the `<video>` element inside
`MareMediaElement`, which becomes `MarpMediaElement`.

Status: **plan only — no code written.** Written against
`docs/old_scripts_for_reference/MareMediaElement.cs` (1049 lines) and
`MareMediaElement.xaml`.

---

## What does not change

Most of the control is already compatible, which is why this is a small job:

- **The public API.** `Source`, `Position`, `Play()`, `Pause()`, `Stop()`,
  `SpeedRatio`, `NaturalDuration`, `NaturalVideoWidth/Height`,
  `DisplayedFrameChanged`, `MediaOpened`, `OverlayContent` all keep their
  signatures and semantics, so the annotation GUI is untouched.
- **The message protocol.** `CoreWebView2_WebMessageReceived` and its
  `HandleStatusMessage` / `HandleMetadataMessage` / `HandleFrameMessage`
  parse `status|…`, `metadata|duration|width|height` and
  `frame|mediaTime|presentedFrames|…`. `video-engine/src/webview2-bridge.js`
  already posts exactly that format. **No C# parsing changes.**
- **The command surface.** The control drives the page with
  `currentTime`, `playbackRate`, `play()`, `pause()` on a global. Those are
  `MarpVideoShim`'s own members, so the JS the control sends barely changes.
- **The XAML.** `WebView2CompositionControl` plus the overlay
  `ContentPresenter` stay as they are.

---

## Change 1 — the page needs a real origin

**Today:** `LoadSourceWhenReady()` ends in `webVideo.NavigateToString(html)`
(line 473).

**Why it must change:** a page loaded from a string has no origin, so it is
not a *secure context*, and `VideoDecoder` — the whole engine — is undefined
there. A plain `<video>` never cared; WebCodecs does.

**The change:** ship a folder with the app containing the engine bundle
(`marp-video-engine.js`), write the generated page into it, map the folder
to a private hostname, and navigate to it:

```csharp
File.WriteAllText(Path.Combine(playerFolder, "player.html"), BuildPlayerHtml(...));

webVideo.CoreWebView2.SetVirtualHostNameToFolderMapping(
    "marp-player.local", playerFolder, CoreWebView2HostResourceAccessKind.Allow);

webVideo.CoreWebView2.Navigate("https://marp-player.local/player.html");
```

The hostname is invented and private to the WebView — no DNS, no network, no
web server. The control already uses this same API for local video files
(line ~448, `mare-local-video.local`).

## Change 2 — reaching Jellyfin from an https page

An `https://` page cannot fetch `http://…:8097`. Jellyfin is currently plain
http, so Direct Play and transcode would both be blocked.

**Interim:** pass `--allow-running-insecure-content` when creating the
WebView2 environment.

**Permanent:** put Jellyfin behind TLS, then delete the flag. The flag is a
Chromium switch rather than a WebView2 API contract, so it is scaffolding,
not a design decision. Local files are unaffected either way: they are served
from an `https://` virtual host too, so no mixed content arises.

## Change 3 — the player page itself

`BuildPlayerHtml` currently emits a `<video>` element and loads **hls.js from
a CDN** (`cdn.jsdelivr.net`). Both go. The replacement is a small page that:

1. loads `marp-video-engine.js` from the same folder (no CDN, no network),
2. creates a `<canvas>`,
3. builds the right media source for the URL it was given,
4. calls `attachWebView2Bridge(engine)` so the existing C# handlers keep
   receiving `status|`/`metadata|`/`frame|`,
5. assigns the engine to the global the control talks to.

## Change 4 — choosing a source from one `Source` URI

The control passes a single URI, and the app already builds the two Jellyfin
forms itself (`jellyfin_client.cs`):

| `Source` looks like | Source used |
|---|---|
| `…/Videos/{id}/stream?static=true&api_key=…` (`BuildDirectStreamUrl`) | byte-range MP4 — **Direct Play** |
| `…master.m3u8…` (transcode negotiation) | `JellyfinTranscodeMediaSource` |
| `https://mare-local-video.local/clip.mp4` (mapped local folder) | byte-range MP4 — **local file** |

Direct Play and local files are the *same* code path: one MP4 read by byte
range over a URL. That needs one small engine addition — a source that takes
a plain URL — since today's byte-range sources take either a Jellyfin
client+itemId or a `File`. Roughly fifteen lines on the existing
`Mp4ByteRangeMediaSource` base.

**Prerequisite:** local files only work this way if the WebView2 virtual host
answers **Range** requests with `206`. `webview2-check.html` now tests this
("same-origin Range"). If it returns whole files instead, local video must
come in as a `File` (picker/drag-drop, already supported) or through a
`WebResourceRequested` handler that implements Range.

---

## Open items

1. **No audio.** The engine decodes video only — `demuxer.js` never extracts
   the audio track, and the shim has no `volume`/`muted`. The control sets
   both; the assignments would silently do nothing. Deferred by the product
   owner for now, but it is a real difference from `MediaElement`.
2. **`Stretch`.** `GetCssObjectFitForStretch()` maps `Stretch` to CSS
   `object-fit` on the `<video>`. A `<canvas>` is a replaced element so
   `object-fit` should apply, but this needs checking rather than assuming.
3. **Virtual-host Range** — see above; decides the local-file design.
4. **Trickplay/thumbnails and any other feature** built on the old page are
   out of scope here and need review before switch-over.

## Verification order

Each step gates the next, so a failure is unambiguous.

1. Load `webview2-check.html` in the host from the virtual host. Confirms
   secure context, WebCodecs, H.264, and the two Range questions.
2. Add the flag; re-run. Confirms Jellyfin is reachable and Direct Play plays.
3. Swap the real player page in; confirm Direct Play, then transcode, then a
   local file.
4. Confirm the control's own surface end to end: `Position` round-trips,
   `DisplayedFrameChanged` fires with sane `mediaTime`, `SpeedRatio` reverses.
