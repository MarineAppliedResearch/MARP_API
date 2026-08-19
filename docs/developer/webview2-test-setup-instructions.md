# Instructions: prepare the C# app to run the MARP engine diagnostic

For the agent working in the **C# WPF/WebView2 project** (`VIDEO_PLAYER`,
containing `MareMediaElement.xaml.cs`). Written by the agent working in the
MARE_API repo, where the video engine lives.

## Goal

Temporarily point the app's video window at a **diagnostic page** so we can
find out what WebView2 supports before porting the video engine into it.

You are not integrating the engine yet. You are making one screen show a
diagnostic page, capturing its output, and reverting. Keep every change
small and reversible.

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

## Step 4 — run it and capture the output

1. Start the app and open the window that shows the video player. The
   diagnostic page appears instead of video.
2. Checks 1–3 run on load.
3. For check 4, click the file input and pick any local MP4.
4. For checks 5–6, click **Run Jellyfin checks** (server, credentials and
   item id are pre-filled).
5. Click **Copy summary**, and return **the entire summary text**.

If the clipboard button does nothing (hosts often block clipboard access),
copy the text from the "Summary" box on the page instead.

## What the results mean — report them, do not fix them

Expect some failures; that is the point. Do not attempt repairs.

- `secure context: FAIL` — Step 3 did not take effect, or navigation fell
  back to a string. Re-check Step 3, then report.
- `WebCodecs: FAIL` — follows from the above.
- `same-origin Range: FAIL` — the virtual host does not serve partial files.
  Expected-possible; it changes how local video is handled. Just report it.
- `mixed content` or a failed Jellyfin login — Step 2's argument did not
  take effect. Verify the environment is passed to
  `EnsureCoreWebView2Async`, then report.
- Playback rows failing while the environment rows pass is still a useful
  result. Report exactly what you see.

Also report: the WebView2 Runtime version installed, and the `user agent`
line the page prints.

## Step 5 — revert

Restore `webVideo.NavigateToString(html);` and, if you prefer, the original
`EnsureCoreWebView2Async()` call. Keep the `player/` folder — the real
integration will use it.
