# MARP video player, as the browser applications use it

The player built in
[marp-video-player](https://github.com/MarineAppliedResearch/marp-video-player), installed
here from a released archive. The Mosaic's source-video inspector loads it from
`/shared/vendor/marp-video-player/dist/marp-video-player.standalone.js`.

**Do not edit these files by hand.** `PLAYER_VERSION` records which release is installed;
editing the files makes that record false, and it is the only way to know what was served.
This is the same mechanism VIDEO_PROCESSING_GUI uses for its embedded player
(`MAREGUI_PROOFofCONCEPT/player/`), so the two are updated the same way.

## Updating

```powershell
.\update-player.ps1 -Version 0.4.0
.\update-player.ps1 -Latest
```

It downloads the host archive from the release, unpacks it here, and writes the version
to `PLAYER_VERSION`. Then open a video from the Mosaic and check playback, frame stepping
and reverse.

## What is here

| File | Comes from |
| --- | --- |
| `dist/` | the release. The bundle the inspector loads |
| `player.html` | the release. The player's own page; the inspector does not use it |
| `VERSION`, `LICENSE`, `NOTICE` | the release |
| `PLAYER_VERSION` | this repository. What the update script installed |
| `update-player.ps1`, `README.md` | this repository |
