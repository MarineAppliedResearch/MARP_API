# Wiring the MARP video player into a C# WebView2 host

Written for an agent working in the C# project, with no access to the
MARE_API repo. Everything the host needs is in two files and the contract
below.

## What this player is, and why the host's own UI stays

It is a frame-accurate video engine: WebCodecs decoding onto a `<canvas>`,
with **true reverse playback**, frame stepping and seeking that a `<video>`
element cannot do. It plays Jellyfin items (Direct Play or transcode) and
plain media URLs.

It ships with a complete UI of its own, which **this integration turns
off**. The host already has a transport, a scrub bar and menus, and an
annotation overlay covering the whole picture -- the built-in controls would
sit under that overlay where nothing can reach them. So the page renders
picture only, and the host drives it.

Two directions of traffic, and both are needed:

- **Page to host**: `postMessage` strings the host already parses
  (`status|`, `metadata|`, `frame|`), plus two new ones for scrub-bar
  shading (`segmentindex|`, `segments|`).
- **Host to page**: `ExecuteScriptAsync` calls for every control.

## Step 1 -- the files

| From the MARE_API repo | To (in the C# project) |
|---|---|
| `frontend/apps/VideoPlayer/dist/marp-video-engine.js` | `player/dist/marp-video-engine.js` |
| `frontend/apps/VideoPlayer/player.html` | `player/player.html` |

Keep the `dist` subfolder: the page loads `dist/marp-video-engine.js`
relative to itself. Mark both **Content**, **Copy to Output Directory =
Copy if newer**. A newly added file defaults to "do not copy", and when the
bundle is missing the page fails in confusing ways --
`webview2-check.html` (same folder in the repo) reports that as check 0.

There are no other assets. The stylesheet and the placeholder logo are
inside the bundle.

## Step 2 -- navigation

**The page must be served from a real origin.** `NavigateToString` gives a
page no origin, and WebCodecs is only exposed in a secure context, so
`VideoDecoder` is undefined there and nothing decodes. Use the WebView2
virtual-host folder mapping (already set up in `MareMediaElement.cs`):

```csharp
webVideo.CoreWebView2.SetVirtualHostNameToFolderMapping(
    "marp-player.local", playerFolder, CoreWebView2HostResourceAccessKind.Allow);
webVideo.CoreWebView2.Navigate(
    $"https://marp-player.local/player.html?controls=0&server={...}&token={...}&user={...}&item={...}");
```

### URL parameters

| Parameter | Meaning |
|---|---|
| `controls=0` | Hide the built-in UI. **Use this.** Leaves picture, buffering spinner and placeholder mark; the transport and center-play overlay are `display:none`, so they take no clicks and no tab stops under the host's overlay. |
| `input=1` | Optional. Re-enables the page's own click-to-play, drag-and-drop and speed hotkeys, which `controls=0` otherwise turns off. Leave this alone unless the host wants the page handling keys -- see "Who owns the keyboard" below. |
| `segments=0` | Optional. Turns off `segmentindex|`/`segments|`, which are **on by default** when `controls=0`. |
| `segmentIntervalMs` | Optional, default 250. How often `segments|` is posted. |
| `server`, `token`, `user`, `item` | An existing Jellyfin session and the item to play. Preferred: the library then picks the path and, on transcode, maintains the behind sessions that make reverse playback fast. |
| `mode` | `directPlay` (default) or `transcode`. |
| `src` | Instead of the Jellyfin parameters: a plain media URL. `.m3u8` is read as a Jellyfin HLS transcode stream; anything else is read as an MP4 by byte range, which covers a local file served through the virtual-host mapping. A bare `.m3u8` cannot maintain behind sessions, so prefer the Jellyfin parameters when reverse matters. |
| `fit` | `contain` (default), `cover`, `fill`, `none` -- mirrors the host's `Stretch`. |

With no `item` and no `src` the page still comes up ready and idle; the
host can load something later with `loadItem` (below).

## Step 3 -- messages from the page

All arrive in `CoreWebView2_WebMessageReceived` as strings. Split on `|`.

### Already handled by the existing host code

```
status|loadedmetadata duration=1354.16
status|playing
status|pause
status|seeking currentTime=12.345678
status|seeked currentTime=12.345678
status|video error <message>
metadata|<duration>|<width>|<height>
frame|<mediaTime>|<presentedFrames>|<expectedDisplayTime>|<presentationTime>|<width>|<height>|<callbackCount>
```

`status|loadedmetadata` is the signal to raise `MediaOpened`; it is replayed
if the host attaches late, so it is never missed. `frame|` arrives once per
presented frame and carries `mediaTime` -- the host's clock, and what should
drive the playhead.

`player.html` also posts progress lines as plain `status|` text:
`source=jellyfin directPlay`, `source=url`, `ready 1920x1080 25fps 1354.160s`,
`ready-idle ...`, and `error <message>` (including a specific one naming the
secure-context problem, worth surfacing rather than swallowing).

### New: scrub-bar shading

```
segmentindex|<count>|<start,end;start,end;...>
segments|<digits>
```

The two are split by how often they change. **Geometry is sent once per
load** because segment boundaries never move afterward; each pair is a
segment's start and end in seconds, e.g.
`segmentindex|136|0.000,10.000;10.000,20.000;...`.

**States are sent on a timer** (default every 250ms) as **one digit per
segment**, a bitmask:

| Bit | Value | Meaning |
|---|---|---|
| 1 | fetched | Raw bytes downloaded and in the raw cache |
| 2 | decoded | Decoded frames in the decoded cache -- instantly seekable |
| 4 | pinned | In the protected lookahead window; will not be evicted |

Character N describes segment N, so it indexes straight into the geometry
array. `7` = fetched + decoded + pinned. `5` = pinned but not yet decoded.

The three are deliberately **orthogonal rather than one "best" state**:
"pinned but not yet decoded" and "pinned and decoded" are different things
and the built-in bar draws them differently -- pinned is a ring *over* the
fill, not a fill of its own. A host reproducing the bar wants the same.

Why digits and not JSON: a 1354s clip is ~226 segments. This is a few
hundred bytes per tick; the equivalent JSON is tens of kilobytes, several
times a second, nearly all of it unchanged.

### Parsing, and drawing the bar

```csharp
// Once, on segmentindex|
var parts = message.Split('|');                       // ["segmentindex", count, geometry]
_segments = parts[2].Split(';')
    .Select(pair => pair.Split(','))
    .Select(p => (Start: double.Parse(p[0], CultureInfo.InvariantCulture),
                  End:   double.Parse(p[1], CultureInfo.InvariantCulture)))
    .ToArray();

// Repeatedly, on segments|
var digits = message.Substring("segments|".Length);
for (int i = 0; i < digits.Length && i < _segments.Length; i++)
{
    int bits    = digits[i] - '0';
    bool fetched = (bits & 1) != 0;
    bool decoded = (bits & 2) != 0;
    bool pinned  = (bits & 4) != 0;

    // Position from geometry, colour from the bits. Decoded wins the fill
    // over fetched; pinned is drawn as a border on top of either.
    double left  = _segments[i].Start / _duration;
    double width = (_segments[i].End - _segments[i].Start) / _duration;
}
```

Colours the built-in bar uses, if matching it is wanted: fetched `#2d9cff`
(blue), decoded `#a7ec35` (green), pinned a 3px inset ring `#22d7dc`
(cyan), track `rgba(199,212,221,0.15)`.

A working reference implementation is in the MARE_API repo at
`frontend/apps/VideoPlayer/app.js` -- search for `handleHostMessage` and
`paintHostSegmentBlocks`. It is ~40 lines of JavaScript doing exactly this,
against a fake `chrome.webview`, and it ports almost directly.

## Step 4 -- controlling the player

Everything goes through `ExecuteScriptAsync` on `window.marpVideo`, which
is set on every successful load (`window.mareVideo` is an alias, so existing
injected scripts keep working).

| Action | Script |
|---|---|
| Play | `window.marpVideo.play()` |
| Pause | `window.marpVideo.pause()` |
| Seek | `window.marpVideo.currentTime = 12.5` |
| Current position | `window.marpVideo.currentTime` |
| Duration | `window.marpVideo.duration` |
| Playback rate | `window.marpVideo.playbackRate = -1` |
| Step one frame | `window.marpVideo.currentTime += 1 / window.marpVideo.fps` |
| Paused? | `window.marpVideo.paused` |
| Size / fps | `window.marpVideo.videoWidth`, `.videoHeight`, `.fps` |
| Segment states (full objects) | `window.marpVideo.getSegmentStates()` |
| Mute | `window.marpVideo.muted = true` |

**Negative `playbackRate` is the point of this engine.** `-1` plays
backwards at normal speed; the built-in player uses a ladder of
-8, -3, -1, -0.5, -0.2, -0.08, 0.08, 0.2, 0.5, 1, 2.5, 6, 16 for its speed
hotkeys, which is a reasonable set to reuse.

`getSegmentStates()` returns the same data as `segments|` but as full
objects -- `{index, startTime, endTime, fetched, decoded, pinned}` -- which
is the better choice for a one-off read. The pushed messages are the better
choice for continuous shading.

Page-level operations use `window.marpPlayer` instead:

| Action | Script |
|---|---|
| Load a Jellyfin item | `window.marpPlayer.loadItem('<itemId>')` |
| Load at a quality tier | `window.marpPlayer.probeQualityOptions('<itemId>')` then `loadItem(id, tier)` |
| Load a URL | `window.marpPlayer.loadUrl('<url>')` |
| Fullscreen | `window.marpPlayer.toggleFullscreen()` |
| Show/hide built-in controls | `window.marpPlayer.setControlsVisible(true)` |

`setControlsVisible(true)` is useful for debugging: it brings up the built-in
transport and scrub bar so the host's own can be compared against them.

## Who owns the keyboard

With `controls=0` the page handles **no** input on the video -- no
click-to-play, no drag-and-drop, no hotkeys. This is deliberate. `space` and
the speed keys are exactly what a host binds itself, and having both fire is
worse than having neither.

So the host binds its own keys and calls the scripts above. Only pass
`input=1` if the page should keep handling keys, and then do not bind the
same keys on the host side.

## Constraints that will otherwise cost a day

- **Secure context.** `NavigateToString` means no origin, which means no
  `VideoDecoder`. The page reports this as
  `status|error WebCodecs unavailable ...` -- surface it.
- **Copy to Output Directory.** See step 1.
- **Direct Play needs real GPU decode.** Its units are ~250-frame 1080p
  GOPs. On hardware without GPU decode, forward playback stalls while
  seeking and stepping still work. If that is the symptom, compare against
  `mode=transcode` before suspecting the integration.
- **No audio.** The engine decodes video only. `muted`/`volume` exist and do
  nothing, so the host's volume UI should stay hidden or disabled.
- **Reverse playback pauses itself at the start of a clip**, and there is a
  known bug where `currentTime` reads the clip's **end** for about one frame
  while it stops -- so a `frame|` message can carry an end-of-clip
  `mediaTime` at that moment. Do not treat a single end-of-clip position as
  "playback finished" when the rate is negative; wait for `status|pause`.
- **Each load replaces the engine.** `window.marpVideo` points at a new
  object after `loadItem`/`loadUrl`, so nothing should cache the reference
  across loads. A fresh `segmentindex|` is posted each time.

## Verifying the wiring

In order, because each step depends on the last:

1. Navigate with no parameters at all: `player.html?controls=0`. Expect a
   black page with the MARP mark, and `status|ready-idle`. If `VideoDecoder`
   is missing, this is where it says so.
2. Add `server/token/user/item`. Expect `status|loadedmetadata`,
   `metadata|`, then `frame|` messages once playing.
3. Confirm `segmentindex|` arrives once and `segments|` repeats, and that
   the digit count matches the segment count.
4. Drive `play`, `pause`, a seek, and `playbackRate = -1` from C#.
5. Then wire the host's own scrub bar to the parsed data.

The equivalent of steps 1-4 runs in the MARE_API repo as
`video-engine/test/probes/host-messages.mjs`, which fakes `chrome.webview`
and asserts exactly these messages; its output is a useful reference for
what "working" looks like.
