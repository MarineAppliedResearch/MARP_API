# Instructions: prepare the C# app to run the MARP engine diagnostic

**Part 1 is for the agent working in the C# WPF/WebView2 project**
(`VIDEO_PLAYER`, containing `MareMediaElement.xaml.cs`). **Part 2 is for the
product owner**, who builds and runs the app.

Written by the agent working in the MARE_API repo, where the video engine
lives.

## Background — what this is leading to

The MARE annotation GUI plays video through `MareMediaElement`, which hosts a
WebView2 and, inside it, a plain HTML `<video>` element (plus hls.js for
Jellyfin transcode streams). That is what `BuildPlayerHtml` generates today.

We are replacing that `<video>` element with a **purpose-built video engine**
developed in the MARE_API repo. It decodes frames itself using WebCodecs and
draws them to a `<canvas>`, which a `<video>` element cannot do: exact
frame-by-frame stepping, and true **reverse playback** at real speed — both
core to the annotation workflow, and both unreliable or impossible with
`<video>` seeking.

The engine already works in a normal browser and plays three sources:

- **Jellyfin Direct Play** (the preferred path — the original file, read by
  HTTP byte range, no transcoding),
- **Jellyfin transcode** (the fallback, for media the client cannot decode or
  links too slow for the original bitrate),
- **local files** on disk.

What that means for this control, eventually:

- `BuildPlayerHtml` stops emitting `<video>`/hls.js and instead loads
  `marp-video-engine.js` and drives a `<canvas>`.
- The `Source` URI is routed to whichever of the three sources fits.
- **The C# side barely changes.** The engine exposes a `<video>`-shaped API
  (`currentTime`, `playbackRate`, `play()`, `pause()`), and it already posts
  `status|` / `metadata|` / `frame|` messages in exactly the format
  `CoreWebView2_WebMessageReceived` parses. The public control API and the
  annotation GUI above it stay as they are.

**Why a diagnostic first.** WebCodecs is only available in a *secure
context*, and the current page is loaded with `NavigateToString`, which has
no origin at all — so the engine would not merely misbehave there, it would
be undefined. Before porting anything we need to know what this host
actually supports. Hence the three edits below.

## Goal

Temporarily point the app's video window at a **diagnostic page**, so we can
find out what WebView2 supports before porting the video engine into it.

This is not the integration. It is three small, reversible edits so one
screen shows a diagnostic page instead of video.

**Division of labour:** the C# agent makes the edits below and stops. It does
not build, run, or verify anything. The product owner then runs the app and
returns the results.

---

# Part 1 — for the C# agent

## Why the change is needed (do not skip — it explains the odd parts)

The engine decodes video with **WebCodecs** (`VideoDecoder`). Browsers only
expose WebCodecs in a *secure context*: the page must come from `https://`
or from `localhost`.

`MareMediaElement.LoadSourceWhenReady()` currently ends with
`webVideo.NavigateToString(html)`. A page loaded from a string has **no
origin**, so it is not a secure context and `VideoDecoder` does not exist
there at all. The current player works because a plain `<video>` element has
no such requirement.

The fix is to serve the page from a **virtual host mapping**: a made-up
hostname that WebView2 resolves to a local folder. No web server, no DNS, no
network traffic. This control already uses that API for local video files
(see `LoadSourceWhenReady`, hostname `mare-local-video.local`).

## Step 1 — add the diagnostic files to the project

Ask the product owner for these two files from the MARE_API repo:

| From | To (in the C# project) |
|---|---|
| `frontend/apps/VideoPlayer/webview2-check.html` | `player/webview2-check.html` |
| `frontend/apps/VideoPlayer/dist/marp-video-engine.js` | `player/dist/marp-video-engine.js` |

The `dist` subfolder must be preserved: the page loads
`dist/marp-video-engine.js` relative to itself.

Mark both as **Content**, **Copy to Output Directory = Copy if newer**, so
they land beside the built executable.

## Step 2 — create WebView2 with one extra browser argument

`UserControl_Loaded` currently calls `await webVideo.EnsureCoreWebView2Async();`
with no environment. Replace that single call with an environment that adds
`--allow-running-insecure-content`:

```csharp
CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions();
options.AdditionalBrowserArguments = "--allow-running-insecure-content";

CoreWebView2Environment environment =
    await CoreWebView2Environment.CreateAsync(null, null, options);

await webVideo.EnsureCoreWebView2Async(environment);
```

Reason: the diagnostic page will be served over `https://`, and the Jellyfin
server it talks to is plain `http://`. Without this argument the browser
blocks that as mixed content and the Jellyfin checks fail for a reason that
tells us nothing. This is temporary scaffolding; it goes away once Jellyfin
has TLS.

## Step 3 — point the WebView at the diagnostic page

In `LoadSourceWhenReady()`, comment out the existing
`webVideo.NavigateToString(html);` (around line 473) and put this in its
place:

```csharp
string playerFolder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "player");

webVideo.CoreWebView2.SetVirtualHostNameToFolderMapping(
    "marp-player.local",
    playerFolder,
    CoreWebView2HostResourceAccessKind.Allow);

webVideo.CoreWebView2.Navigate("https://marp-player.local/webview2-check.html");
```

Leave the `BuildPlayerHtml(...)` call above it in place even though its
result is now unused — this is a temporary diversion, not a rewrite.

## Do not change

- `CoreWebView2_WebMessageReceived`, `HandleStatusMessage`,
  `HandleMetadataMessage`, `HandleFrameMessage` — the engine already posts
  messages in exactly that format and they will be needed unchanged.
- `BuildPlayerHtml`, the public API (`Source`, `Position`, `Play`, `Pause`,
  `SpeedRatio`, `NaturalDuration`, `DisplayedFrameChanged`), or the XAML.
- Anything outside `MareMediaElement.xaml.cs` and the new `player/` folder.

## Step 4 — stop, and hand back

Do **not** build, run, or verify. Do not try to make anything work end to
end — the point of the diagnostic is to discover what does not.

Report to the product owner:

1. Every file you changed, with the before/after of each edit.
2. Confirmation that the two files landed at `player/webview2-check.html`
   and `player/dist/marp-video-engine.js`, and are set to copy to the output
   directory.
3. Anything that did not match these instructions — different line numbers,
   a `CoreWebView2Environment` already being created elsewhere, an existing
   virtual-host mapping, or a build configuration that does not copy content
   files. Say so rather than improvising.

If something here cannot be done as written, stop and explain why. A wrong
guess here produces a misleading diagnostic result, which is worse than no
result.

---

# Part 2 — for the product owner (running it)

Once the edits are in, build and run the app, then open the window that
shows the video player. The diagnostic page appears instead of video.

1. Checks 1–3 run on their own as the page loads.
2. Check 4: click the file input and pick any local MP4.
3. Checks 5–6: click **Run Jellyfin checks** — server, credentials and item
   id are pre-filled for the dev instance on port 8097.
4. Click **Copy summary** and send back **the whole summary text**. If the
   clipboard button does nothing (hosts often block clipboard access), copy
   the text out of the Summary box on the page.

Also useful: the WebView2 Runtime version installed, and the `user agent`
line the page prints.

### Expect some failures — that is the point

Nothing here needs fixing before reporting:

- `secure context: FAIL` — Step 3 did not take effect. Everything else will
  fail too; report it and we will sort out the navigation first.
- `same-origin Range: FAIL` — the virtual host does not serve partial files.
  A genuinely possible outcome that changes how local video is read; not a
  fault.
- `mixed content` or a failed Jellyfin login — Step 2's browser argument did
  not take effect.
- Environment rows passing while playback rows fail is still a good result:
  it means the engine can run there and the remaining work is ours.

### Reverting

Restore `webVideo.NavigateToString(html);` (and, if you like, the original
`EnsureCoreWebView2Async()` call). Keep the `player/` folder — the real
integration will use it.
