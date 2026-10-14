<#
.SYNOPSIS
    Updates the MARP video player the browser applications use to a released version.

.DESCRIPTION
    Downloads the host archive from a marp-video-player GitHub release and
    unpacks it into this folder, replacing player.html and dist/.

    The same mechanism VIDEO_PROCESSING_GUI uses for its embedded player, so the two
    consumers of the player are updated the same way. PLAYER_VERSION records which
    release is installed, and this script is the only way the files should change.

    The downloaded files stay committed to this repository so a checkout serves the
    player without network access, and so the exact bytes any build served are
    recoverable from history.

.PARAMETER Version
    Release to install, with or without the leading "v". Defaults to the
    version recorded in PLAYER_VERSION.

.PARAMETER Latest
    Install the newest release instead of a specific version.

.EXAMPLE
    .\update-player.ps1 -Version 0.4.0

.EXAMPLE
    .\update-player.ps1 -Latest

.NOTES
    After running, open a video from the Mosaic and check playback, frame stepping
    and reverse. A major version bump means the host contract changed.
#>

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$Latest
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$versionFile = Join-Path $here 'PLAYER_VERSION'
$repo = 'MarineAppliedResearch/marp-video-player'

if ($Latest) {
    Write-Host 'Resolving the latest release...'
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'marp-api' }
    $Version = $release.tag_name -replace '^v', ''
}
elseif (-not $Version) {
    if (-not (Test-Path $versionFile)) {
        throw "No -Version given and no PLAYER_VERSION file. Use -Version <x.y.z> or -Latest."
    }
    $Version = (Get-Content $versionFile -Raw).Trim()
}

$Version = $Version -replace '^v', ''
$asset = "marp-video-player-$Version-host.zip"
$url = "https://github.com/$repo/releases/download/v$Version/$asset"

Write-Host "Installing marp-video-player $Version"

$temp = Join-Path ([System.IO.Path]::GetTempPath()) "marp-api-player-$Version"
if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
New-Item -ItemType Directory -Path $temp | Out-Null

$zip = Join-Path $temp $asset
try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}
catch {
    throw "Could not download $url`n$($_.Exception.Message)`nCheck that release v$Version exists and has a host archive attached."
}

Expand-Archive -Path $zip -DestinationPath (Join-Path $temp 'unpacked') -Force
$unpacked = Join-Path $temp 'unpacked'

# Sanity-check before touching anything: a partial or wrong archive should not
# half-replace a working player.
foreach ($required in @('player.html', 'dist')) {
    if (-not (Test-Path (Join-Path $unpacked $required))) {
        throw "Archive is missing $required. Not replacing the current player."
    }
}

# Replace only what the archive owns.
Remove-Item -Recurse -Force (Join-Path $here 'dist') -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $unpacked 'dist') -Destination $here -Recurse -Force
Copy-Item -Path (Join-Path $unpacked 'player.html') -Destination $here -Force

foreach ($extra in @('VERSION', 'LICENSE', 'NOTICE')) {
    $src = Join-Path $unpacked $extra
    if (Test-Path $src) { Copy-Item -Path $src -Destination $here -Force }
}

Set-Content -Path $versionFile -Value $Version -Encoding ascii -NoNewline

Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "Installed $Version into $here"
Get-ChildItem $here -Recurse -File |
    ForEach-Object { '  ' + $_.FullName.Substring($here.Length + 1) }
