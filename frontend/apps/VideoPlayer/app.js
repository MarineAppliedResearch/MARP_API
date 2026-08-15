/**
 * Page glue for the VideoPlayer engine test harness.
 *
 * Not part of the annotation tool -- a YouTube-familiar player chrome
 * (play/pause, scrub bar, time, mute/fullscreen icons) built specifically
 * so the engine's actual fetch/decode behavior can be watched and
 * debugged: the scrub bar shades each segment by fetched/decoded/pinned
 * status (see updateSegmentShading()), and q..\ hotkeys jump between
 * playback speeds instantly for scrubbing forward/backward from any point.
 *
 * Deliberately assigns the engine instance to window.marpVideo (not a
 * local variable) -- that global name is the actual integration contract
 * MareMediaElement.xaml.cs will eventually depend on, so the test harness
 * should exercise the exact same global surface, not just something
 * shaped like it.
 */

"use strict";

const logEl = document.getElementById("log");

/**
 * Appends a timestamped line to the on-page log panel.
 * Inputs: message string.
 * Output: none (writes to #log and the browser console).
 */
function log(message) {
  const timestamp = new Date().toISOString().split("T")[1].replace("Z", "");
  logEl.textContent += `[${timestamp}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(message);
}

/**
 * Formats seconds as m:ss.ss for the time display.
 * Inputs: seconds (number, possibly non-finite before load).
 * Output: formatted string.
 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "--:--";
  }
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

// Playback-rate hotkeys. q..y span -8x..-0.08x (reverse, slowing toward
// y); u..\ span 0.08x..16x (forward, speeding up toward \). One flat,
// easily-editable table -- change this object alone, nothing else needs
// to know the scheme. Pressing any of these also forces playback to
// start regardless of the current play/pause state (see the keydown
// handler below) -- these keys are for actively scrubbing through the
// video, not just arming a rate.
const SPEED_KEYMAP = {
  q: -8,
  w: -3,
  e: -1,
  r: -0.5,
  t: -0.2,
  y: -0.08,
  u: 0.08,
  i: 0.2,
  o: 0.5,
  p: 1,
  "[": 2.5,
  "]": 6,
  "\\": 16,
};

/** How long the controls bar stays visible after the pointer stops moving during playback, in ms. */
const CONTROLS_IDLE_HIDE_MS = 2500;

/** How often segment-state shading is re-read from the engine and redrawn, in ms -- a plain timer, not tied to frame presentation, since it doesn't need to be that responsive. */
const SEGMENT_SHADING_INTERVAL_MS = 250;

/** How far behind a landed seek's target the "behind" session starts its own transcode from, in seconds -- see prepareBehindSession. */
const BEHIND_SESSION_LOOK_BEHIND_SECONDS = 30;

const loadButton = document.getElementById("loadButton");
const itemIdInput = document.getElementById("itemIdInput");
const canvas = document.getElementById("canvas");
const playerContainer = document.getElementById("playerContainer");
const placeholderLogo = document.getElementById("placeholderLogo");
const centerPlayOverlay = document.getElementById("centerPlayOverlay");
const centerPlayButton = document.getElementById("centerPlayButton");
const bufferingSpinner = document.getElementById("bufferingSpinner");
const controlsBar = document.getElementById("controlsBar");
const scrubTrack = document.getElementById("scrubTrack");
const scrubTrackBg = document.getElementById("scrubTrackBg");
const scrubHandle = document.getElementById("scrubHandle");
const scrubTooltip = document.getElementById("scrubTooltip");
const playPauseButton = document.getElementById("playPauseButton");
const timeDisplay = document.getElementById("timeDisplay");
const speedDisplay = document.getElementById("speedDisplay");
const playerSettingsButton = document.getElementById("playerSettingsButton");
const playerSettingsMenu = document.getElementById("playerSettingsMenu");
const muteButton = document.getElementById("muteButton");
const fullscreenButton = document.getElementById("fullscreenButton");
const stepBackButton = document.getElementById("stepBackButton");
const stepForwardButton = document.getElementById("stepForwardButton");
const speedOverrideInput = document.getElementById("speedOverrideInput");
const rawCacheGiBInput = document.getElementById("rawCacheGiBInput");
const decodedCacheGiBInput = document.getElementById("decodedCacheGiBInput");
const applyCacheSettingsButton = document.getElementById("applyCacheSettingsButton");
const readCacheSettingsButton = document.getElementById("readCacheSettingsButton");
const dumpEngineStateButton = document.getElementById("dumpEngineStateButton");

const jellyfinServerUrlInput = document.getElementById("jellyfinServerUrlInput");
const jellyfinUsernameInput = document.getElementById("jellyfinUsernameInput");
const jellyfinPasswordInput = document.getElementById("jellyfinPasswordInput");
const jellyfinLoginButton = document.getElementById("jellyfinLoginButton");
const jellyfinLogoutButton = document.getElementById("jellyfinLogoutButton");
const loginStatus = document.getElementById("loginStatus");
const qualityOptionsList = document.getElementById("qualityOptionsList");

// Talks directly to Jellyfin -- no MARE_API involvement in playback at all
// (see agents_history.md's Phase 4 entry, issue #36). jellyfinClient holds
// its own session in localStorage; mediaSource wraps it for the engine's
// generic MediaSource seam (see media-source.js -- LocalFileMediaSource is
// a planned follow-up implementation of the same interface).
const jellyfinClient = new MarpVideoEngine.JellyfinClient();
const mediaSource = new MarpVideoEngine.JellyfinMediaSource(jellyfinClient);
let currentQualityOption = null;
let currentItemId = null;
// Bumped on every 'seeked' -- a behind-session renegotiation in flight
// when a newer seek lands must not apply its (now-stale) result.
let behindSessionGeneration = 0;

let scrubDragging = false;
let segmentShadingHandle = null;
let settingsMenuOpen = false;
// Which accordion section body is expanded (see applyOpenSettingsSection);
// null means all collapsed. Defaults to Login since signing in is the
// first thing a new session needs.
let openSettingsSectionId = "settingsLoginBody";
let lastFrameMetadata = null;

/**
 * Loads (or reloads, for a quality change) the current item id at a given
 * quality option, talking directly to Jellyfin via mediaSource -- no
 * MARE_API involved. Re-creates the engine each time; seamless mid-stream
 * quality switching (without a reload) is out of scope for this phase.
 * Inputs: itemId (string), qualityOption (from getQualityOptions, or null for the default/first tier).
 * Output: none (sets window.marpVideo, updates UI).
 */
async function loadItem(itemId, qualityOption) {
  // WebCodecs is only exposed in a secure context (https, or http on
  // localhost/127.0.0.1) -- reaching this dev server over plain http at a
  // LAN IP/hostname silently removes the global, which otherwise surfaces
  // as a bare "VideoDecoder is not defined" from deep inside the decoder.
  if (typeof VideoDecoder === "undefined") {
    log(
      `ERROR: WebCodecs (VideoDecoder) is unavailable at ${window.location.origin} ` +
        `(isSecureContext=${window.isSecureContext}). Open this page over https or via localhost/127.0.0.1.`
    );
    return;
  }

  if (!jellyfinClient.isAuthenticated()) {
    log("ERROR: sign in to a Jellyfin server first (Settings > Server / Login).");
    return;
  }

  loadButton.disabled = true;

  try {
    // Always re-probe the full tier list, even when reloading for a
    // specific quality pick -- qualityOption only decides which tier is
    // selected, not which tiers exist, otherwise the menu collapses down
    // to just the one tier that was picked on every reload.
    const options = await mediaSource.probeQualityOptions(itemId);
    if (options.length === 0) {
      throw new Error("Jellyfin reports this item cannot be transcoded.");
    }
    currentQualityOption = qualityOption || options[0];
    currentItemId = itemId;
    buildQualityOptionsMenu(options, currentQualityOption);

    const streamUrl = await mediaSource.resolveStreamUrl(itemId, currentQualityOption);
    const startupRawCacheGiB = parseFloat(rawCacheGiBInput.value);
    const startupRawCacheBytes = Math.floor(startupRawCacheGiB * 1024 * 1024 * 1024);

    log(`Loading ${streamUrl} (quality=${currentQualityOption.name}) ...`);

    stopPlaybackReporting();

    // Tear down the previous engine (if any) before replacing it --
    // without this, switching item/quality left the old scheduler's
    // render loop and cache-fill passes running in the background
    // indefinitely, launching its own segment fetches against Jellyfin
    // concurrently with the new engine's, which was enough to make the
    // transcoder itself start erroring/timing out on both sessions at once.
    if (window.marpVideo) {
      log("Closing previous engine before loading the new one...");
      window.marpVideo.close();
    }

    window.marpVideo = await MarpVideoEngine.createMarpVideoEngine(canvas, {
      streamUrl,
      rawSegmentCacheBudgetBytes: Number.isFinite(startupRawCacheBytes) ? startupRawCacheBytes : undefined,
      maxConcurrentFetches: mediaSource.maxConcurrentFetches,
    });
    wireVideoEvents();
    startPlaybackReporting(itemId);

    log(`Engine ready. duration=${window.marpVideo.duration.toFixed(3)}s, ${window.marpVideo.videoWidth}x${window.marpVideo.videoHeight}, ${window.marpVideo.fps}fps`);

    buildSegmentBlocks(window.marpVideo.getSegmentStates());
    if (segmentShadingHandle) {
      clearInterval(segmentShadingHandle);
    }
    segmentShadingHandle = setInterval(updateSegmentShading, SEGMENT_SHADING_INTERVAL_MS);

    [
      playPauseButton,
      centerPlayButton,
      stepBackButton,
      stepForwardButton,
      speedOverrideInput,
      muteButton,
      fullscreenButton,
      rawCacheGiBInput,
      decodedCacheGiBInput,
      applyCacheSettingsButton,
      readCacheSettingsButton,
      dumpEngineStateButton,
    ].forEach((el) => {
      el.disabled = false;
    });

    syncCacheSettingsFromEngine();

    playerContainer.focus();
  } catch (err) {
    log("ERROR loading: " + err.message);
    console.error(err);
  } finally {
    loadButton.disabled = false;
  }
}

loadButton.addEventListener("click", () => {
  const itemId = itemIdInput.value.trim();
  if (!itemId) {
    log("ERROR: enter a Jellyfin item id first.");
    return;
  }
  loadItem(itemId, null);
});

function syncCacheSettingsFromEngine() {
  if (!window.marpVideo || typeof window.marpVideo.getCacheConfig !== "function") {
    return;
  }

  const cache = window.marpVideo.getCacheConfig();
  rawCacheGiBInput.value = (cache.raw.maxRawCacheBytes / (1024 * 1024 * 1024)).toFixed(2);
  decodedCacheGiBInput.value = (cache.decoded.cacheBudgetBytes / (1024 * 1024 * 1024)).toFixed(2);
  log(
    `cache config raw=${(cache.raw.cachedRawBytes / (1024 * 1024 * 1024)).toFixed(2)}GiB/${(cache.raw.maxRawCacheBytes / (1024 * 1024 * 1024)).toFixed(2)}GiB ` +
      `decoded=${cache.decoded.cachedDecodedSegments}/${cache.decoded.maxSegmentsBuffered} ` +
      `budgetGiB=${(cache.decoded.cacheBudgetBytes / (1024 * 1024 * 1024)).toFixed(2)}`
  );
}

applyCacheSettingsButton.addEventListener("click", () => {
  if (!window.marpVideo) {
    return;
  }

  const rawGiB = parseFloat(rawCacheGiBInput.value);
  const rawBytes = Math.floor(rawGiB * 1024 * 1024 * 1024);
  const decodedGiB = parseFloat(decodedCacheGiBInput.value);
  const decodedBytes = Math.floor(decodedGiB * 1024 * 1024 * 1024);

  try {
    const rawConfig = window.marpVideo.setRawSegmentCacheBudgetBytes(rawBytes);
    const decodedConfig = window.marpVideo.setDecodedCacheBudgetBytes(decodedBytes);
    log(
      `cache settings applied raw=${(rawConfig.cachedRawBytes / (1024 * 1024 * 1024)).toFixed(2)}GiB/${(rawConfig.maxRawCacheBytes / (1024 * 1024 * 1024)).toFixed(2)}GiB ` +
        `decoded=${decodedConfig.cachedDecodedSegments}/${decodedConfig.maxSegmentsBuffered} ` +
        `budgetGiB=${(decodedConfig.cacheBudgetBytes / (1024 * 1024 * 1024)).toFixed(2)}`
    );
  } catch (err) {
    log(`ERROR applying cache settings: ${err.message}`);
  }
});

readCacheSettingsButton.addEventListener("click", () => {
  syncCacheSettingsFromEngine();
});

function listToRanges(indices) {
  if (!indices || indices.length === 0) {
    return [];
  }

  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = sorted[i];
    end = sorted[i];
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges;
}

function getCurrentSegmentNeighborhood(segmentStates, centerSegmentIndex, radius = 4) {
  if (!Number.isFinite(centerSegmentIndex)) {
    return [];
  }
  return segmentStates
    .filter((segment) => Math.abs(segment.index - centerSegmentIndex) <= radius)
    .map((segment) => ({
      index: segment.index,
      startTime: segment.startTime,
      endTime: segment.endTime,
      fetched: segment.fetched,
      decoded: segment.decoded,
      pinned: segment.pinned,
    }));
}

function dumpEngineState() {
  if (!window.marpVideo) {
    log("dump-state: no active engine");
    return;
  }

  const segmentStates = window.marpVideo.getSegmentStates();
  const fetchedSegments = segmentStates.filter((segment) => segment.fetched).map((segment) => segment.index);
  const decodedSegments = segmentStates.filter((segment) => segment.decoded).map((segment) => segment.index);
  const pinnedSegments = segmentStates.filter((segment) => segment.pinned).map((segment) => segment.index);

  // "Demuxed" and "decoded" are the same persistence tier currently.
  // Demux-only buffers are not retained as a separate cache.
  const demuxedSegments = [...decodedSegments];

  const cacheConfig =
    typeof window.marpVideo.getCacheConfig === "function"
      ? window.marpVideo.getCacheConfig()
      : { raw: null, decoded: null };

  const debugState =
    typeof window.marpVideo.getDebugState === "function"
      ? window.marpVideo.getDebugState()
      : null;

  const currentSegmentIndex =
    debugState && Number.isFinite(debugState.currentSegmentIndex)
      ? debugState.currentSegmentIndex
      : lastFrameMetadata && Number.isFinite(lastFrameMetadata.segmentIndex)
      ? lastFrameMetadata.segmentIndex
      : null;

  const snapshot = {
    takenAt: new Date().toISOString(),
    playback: {
      currentTime: window.marpVideo.currentTime,
      duration: window.marpVideo.duration,
      playbackRate: window.marpVideo.playbackRate,
      paused: window.marpVideo.paused,
      seeking: window.marpVideo.seeking,
      currentSegmentIndex,
      currentFrameIndex:
        debugState && Number.isFinite(debugState.currentFrameIdx)
          ? debugState.currentFrameIdx
          : lastFrameMetadata && Number.isFinite(lastFrameMetadata.frameIndex)
          ? lastFrameMetadata.frameIndex
          : null,
      currentRawFrameTime:
        debugState && Number.isFinite(debugState.currentRawFrameTime)
          ? debugState.currentRawFrameTime
          : lastFrameMetadata && Number.isFinite(lastFrameMetadata.rawFrameTime)
          ? lastFrameMetadata.rawFrameTime
          : null,
    },
    debugState,
    cacheConfig,
    segmentStateCounts: {
      total: segmentStates.length,
      fetched: fetchedSegments.length,
      decoded: decodedSegments.length,
      demuxed: demuxedSegments.length,
      pinned: pinnedSegments.length,
    },
    fetchedSegments,
    fetchedRanges: listToRanges(fetchedSegments),
    decodedSegments,
    decodedRanges: listToRanges(decodedSegments),
    demuxedSegments,
    demuxedRanges: listToRanges(demuxedSegments),
    pinnedSegments,
    pinnedRanges: listToRanges(pinnedSegments),
    neighborhood: getCurrentSegmentNeighborhood(segmentStates, currentSegmentIndex, 5),
  };

  log("dump-state: BEGIN");
  log(JSON.stringify(snapshot, null, 2));
  log("dump-state: END");
  console.log("dump-state", snapshot);
}

dumpEngineStateButton.addEventListener("click", () => {
  dumpEngineState();
});

/**
 * Shows the currently-open accordion section's body and hides every other
 * one -- the gear menu's only navigation model: a flat stack of sections,
 * each expanded/collapsed in place by clicking its own header. No separate
 * "back" step exists because nothing ever replaces anything else.
 * Inputs: none (reads openSettingsSectionId).
 * Output: none.
 */
function applyOpenSettingsSection() {
  document.querySelectorAll("#playerSettingsMenu .settings-section-body").forEach((body) => {
    body.classList.toggle("hidden", body.id !== openSettingsSectionId);
  });
  document.querySelectorAll("#playerSettingsMenu .settings-section-header").forEach((header) => {
    header.classList.toggle("expanded", header.dataset.section === openSettingsSectionId);
  });
}

function openSettingsMenu() {
  // Keep the transport visible while the menu is open.
  settingsMenuOpen = true;
  playerSettingsMenu.classList.add("open");
  applyOpenSettingsSection();
  showControlsBar();
}

function closeSettingsMenu() {
  settingsMenuOpen = false;
  playerSettingsMenu.classList.remove("open");
}

function toggleSettingsMenu() {
  if (settingsMenuOpen) {
    closeSettingsMenu();
    return;
  }
  openSettingsMenu();
}

playerSettingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleSettingsMenu();
});

playerSettingsMenu.addEventListener("click", (event) => {
  // Keep clicks inside the menu from bubbling up to the player.
  event.stopPropagation();
});

document.addEventListener("pointerdown", (event) => {
  if (!settingsMenuOpen) {
    return;
  }

  if (playerSettingsMenu.contains(event.target) || playerSettingsButton.contains(event.target)) {
    return;
  }

  closeSettingsMenu();
});

document.querySelectorAll(".settings-section-header").forEach((header) => {
  header.addEventListener("click", () => {
    openSettingsSectionId = header.dataset.section === openSettingsSectionId ? null : header.dataset.section;
    applyOpenSettingsSection();
  });
});

/**
 * Reflects the client's current Jellyfin session in the login panel.
 * Inputs: none (reads jellyfinClient).
 * Output: none (updates #loginStatus and pre-fills the server URL field).
 */
function updateLoginStatus() {
  if (jellyfinClient.isAuthenticated()) {
    loginStatus.textContent = `Signed in to ${jellyfinClient.serverUrl}`;
    jellyfinServerUrlInput.value = jellyfinClient.serverUrl;
  } else {
    loginStatus.textContent = "Not signed in.";
  }
}

updateLoginStatus();

jellyfinLoginButton.addEventListener("click", async () => {
  const serverUrl = jellyfinServerUrlInput.value.trim();
  const username = jellyfinUsernameInput.value.trim();
  const password = jellyfinPasswordInput.value;

  if (!serverUrl || !username || !password) {
    log("ERROR: server URL, username, and password are all required.");
    return;
  }

  try {
    await jellyfinClient.login(serverUrl, username, password);
    jellyfinPasswordInput.value = "";
    updateLoginStatus();
    log(`Signed in to ${serverUrl} as ${username}.`);
  } catch (err) {
    log(`ERROR signing in: ${err.message}`);
  }
});

jellyfinLogoutButton.addEventListener("click", () => {
  jellyfinClient.logout();
  updateLoginStatus();
  log("Signed out.");
});

/**
 * Renders the quality-tier picker for the item just probed/loaded.
 * Inputs: options (array from getQualityOptions), selected (the currently active option).
 * Output: none (populates #qualityOptionsList; clicking a tier reloads the current item at it).
 */
function buildQualityOptionsMenu(options, selected) {
  qualityOptionsList.innerHTML = "";

  for (const option of options) {
    const button = document.createElement("button");
    button.className = "quality-option";
    button.classList.toggle("selected", option.name === (selected && selected.name));
    button.textContent = option.name;
    button.addEventListener("click", () => {
      const itemId = itemIdInput.value.trim();
      if (itemId) {
        loadItem(itemId, option);
      }
    });
    qualityOptionsList.appendChild(button);
  }
}

// --- Playback reporting: tells Jellyfin this real user's own account is
// watching, so its native "continue watching"/resume-position features
// work normally -- matches jellyfin-web's own 10s progress cadence
// (playbackmanager.js's onPlayerProgressInterval). ---

const PLAYBACK_REPORT_INTERVAL_MS = 10_000;
const TICKS_PER_SECOND = 10_000_000;

let playbackReportItemId = null;
let playbackReportHandle = null;

/**
 * Builds the {positionTicks, isPaused} context every playback-report call needs.
 * Inputs: none (uses window.marpVideo).
 * Output: report context object.
 */
function currentPlaybackReportContext() {
  return {
    positionTicks: Math.round((window.marpVideo ? window.marpVideo.currentTime : 0) * TICKS_PER_SECOND),
    isPaused: window.marpVideo ? window.marpVideo.paused : true,
  };
}

/**
 * Starts reporting playback state for itemId to Jellyfin -- an immediate
 * "started" report, then "progress" every PLAYBACK_REPORT_INTERVAL_MS.
 * Inputs: itemId (string).
 * Output: none.
 */
function startPlaybackReporting(itemId) {
  playbackReportItemId = itemId;
  mediaSource.reportPlaybackStarted(itemId, currentPlaybackReportContext()).catch((err) => log(`ERROR reporting playback start: ${err.message}`));

  if (playbackReportHandle) {
    clearInterval(playbackReportHandle);
  }
  playbackReportHandle = setInterval(() => {
    mediaSource.reportPlaybackProgress(playbackReportItemId, currentPlaybackReportContext()).catch((err) => log(`ERROR reporting playback progress: ${err.message}`));
  }, PLAYBACK_REPORT_INTERVAL_MS);
}

/**
 * Stops the progress-reporting interval and sends a final "stopped" report
 * for whichever item was being reported on, if any -- called before
 * loading a new item/quality and on page unload.
 * Inputs: none.
 * Output: none.
 */
function stopPlaybackReporting() {
  if (playbackReportHandle) {
    clearInterval(playbackReportHandle);
    playbackReportHandle = null;
  }
  if (playbackReportItemId) {
    mediaSource.reportPlaybackStopped(playbackReportItemId, currentPlaybackReportContext()).catch((err) => log(`ERROR reporting playback stop: ${err.message}`));
    playbackReportItemId = null;
  }
}

window.addEventListener("beforeunload", stopPlaybackReporting);

/**
 * Applies the UI state a freshly-loaded (and, today, always-paused-until-
 * play()) engine should show: hides the placeholder logo, reveals the
 * center-play overlay, and shows the real initial time/duration instead
 * of the pre-load "--:--" placeholder text.
 * Inputs: none (uses window.marpVideo).
 * Output: none.
 */
function applyLoadedUiState() {
  placeholderLogo.style.display = "none";
  centerPlayOverlay.classList.remove("hidden");
  timeDisplay.textContent = `${formatTime(window.marpVideo.currentTime)} / ${formatTime(window.marpVideo.duration)}`;
  updateScrubHandle(window.marpVideo.currentTime);
}

/**
 * Negotiates a fresh "behind" session anchored BEHIND_SESSION_LOOK_BEHIND_SECONDS
 * before a just-landed seek's position, so that region is pre-cached via
 * one continuous forward transcode sweep instead of ever asking a
 * session to move backward (see media-source.js's resolveBehindStreamUrl
 * and index.js's setBehindSession for why). Fire-and-forget from the
 * seek's own point of view -- rewinding immediately after a seek can
 * still stall while this negotiation/sweep is in flight, but every seek
 * kicks it off immediately rather than waiting for the user to actually
 * start rewinding, maximizing how much of a head start it gets.
 * Inputs: landedTimeSeconds (where the seek that just fired 'seeked' landed).
 * Output: none (calls window.marpVideo.setBehindSession once resolved).
 */
function prepareBehindSession(landedTimeSeconds) {
  if (typeof mediaSource.resolveBehindStreamUrl !== "function" || !currentItemId) {
    return;
  }

  const generation = ++behindSessionGeneration;
  const behindStartTimeSeconds = Math.max(0, landedTimeSeconds - BEHIND_SESSION_LOOK_BEHIND_SECONDS);

  mediaSource
    .resolveBehindStreamUrl(currentItemId, currentQualityOption, behindStartTimeSeconds)
    .then((behindStreamUrl) => {
      if (!behindStreamUrl || generation !== behindSessionGeneration || !window.marpVideo) {
        // Superseded by a newer seek (or this source has no dual-session
        // support) -- discard silently, matching Scheduler#seek's own
        // stale-result handling.
        return;
      }
      return window.marpVideo.setBehindSession(behindStreamUrl, behindStartTimeSeconds);
    })
    .then(() => {
      if (generation === behindSessionGeneration) {
        log(`behind-session ready: sweeping forward from ${behindStartTimeSeconds.toFixed(1)}s`);
      }
    })
    .catch((err) => log(`ERROR preparing behind session: ${err.message}`));
}

/**
 * Wires window.marpVideo's events and frame-callback loop to the log
 * panel, transport controls, and scrub bar.
 * Inputs: none (uses window.marpVideo).
 * Output: none.
 * Usage: called once, right after createMarpVideoEngine() resolves.
 */
function wireVideoEvents() {
  ["loadedmetadata", "durationchange", "resize", "playing", "pause"].forEach((type) => {
    window.marpVideo.addEventListener(type, () => log(`event: ${type}`));
  });

  // seeking/seeked now carry where the seek is headed/landed (target
  // time, resolved segment, and -- once landed -- the actual presented
  // frame) -- printed here so "did the seek land somewhere unexpected"
  // is visible directly in the log instead of needing DevTools.
  window.marpVideo.addEventListener("seeking", (event) => {
    log(`event: seeking targetTime=${event.targetTime.toFixed(3)} targetSegment=${event.segmentIndex}`);
  });
  window.marpVideo.addEventListener("seeked", (event) => {
    log(
      `event: seeked targetTime=${event.targetTime.toFixed(3)} landedTime=${event.currentTime.toFixed(3)} ` +
        `segment=${event.segmentIndex} frameIndex=${event.frameIndex}`
    );
    prepareBehindSession(event.currentTime);
  });

  // Buffering spinner: shown whenever playback/seek is blocked on Tier 1
  // (network) or Tier 2 (decode), colored to match the scrub bar's own
  // fetched=blue/decoded=green convention. Hidden again on the next
  // "playing" (which now also fires on resume-from-waiting, not just on
  // an explicit play()).
  window.marpVideo.addEventListener("waiting", (event) => {
    log(`event: waiting reason=${event.reason}`);
    bufferingSpinner.classList.remove("hidden");
    bufferingSpinner.classList.toggle("decoding", event.reason === "decoding");
  });

  // Logs the real Error's message, not just "event: error" -- the shim
  // dispatches the actual error object (see index.js's emit callback), so
  // discarding it here was hiding exactly the detail needed to tell a
  // real failure apart from another one.
  window.marpVideo.addEventListener("error", (event) => {
    log(`event: error -- ${event.error ? event.error.message : "(no detail)"}`);
  });

  // Segment fetch/decode progress and failures, straight from
  // frame-store.js -- see index.js's onDebug wiring. Answers "which
  // segment is being downloaded/decoded right now" without needing
  // DevTools open.
  window.marpVideo.addEventListener("debug", (event) => log(event.message));

  // NOT solely via addEventListener("loadedmetadata", ...): createMarpVideoEngine()
  // dispatches loadedmetadata/durationchange/resize internally, before it
  // ever returns the shim to its caller -- by the time wireVideoEvents()
  // runs (after that promise resolves) and attaches this listener, the
  // event has already fired and is gone for good, matching real
  // EventTarget semantics (no replay for late listeners). Confirmed live:
  // the placeholder logo and center-play overlay never appeared without
  // this direct call. The listener stays registered too, for any later
  // re-fire (e.g. a hypothetical future profile-switch reload) that
  // happens after listeners are already attached.
  applyLoadedUiState();
  window.marpVideo.addEventListener("loadedmetadata", applyLoadedUiState);

  window.marpVideo.addEventListener("playing", () => {
    playPauseButton.innerHTML = "&#10074;&#10074;";
    centerPlayOverlay.classList.add("hidden");
    bufferingSpinner.classList.add("hidden");
    if (playbackReportItemId) {
      mediaSource.reportPlaybackProgress(playbackReportItemId, currentPlaybackReportContext()).catch((err) => log(`ERROR reporting playback progress: ${err.message}`));
    }
  });

  window.marpVideo.addEventListener("pause", () => {
    playPauseButton.innerHTML = "&#9654;";
    centerPlayOverlay.classList.remove("hidden");
    showControlsBar();
    if (playbackReportItemId) {
      mediaSource.reportPlaybackProgress(playbackReportItemId, currentPlaybackReportContext()).catch((err) => log(`ERROR reporting playback progress: ${err.message}`));
    }
  });

  let frameLogCounter = 0;

  function onFrame(now, metadata) {
    lastFrameMetadata = metadata;
    frameLogCounter += 1;
    if (frameLogCounter % 10 === 0) {
      log(
        `frame #${metadata.presentedFrames} mediaTime=${metadata.mediaTime.toFixed(3)} ` +
          `raw=${Number.isFinite(metadata.rawFrameTime) ? metadata.rawFrameTime.toFixed(3) : "na"} ` +
          `segment=${metadata.segmentIndex} frameIdx=${metadata.frameIndex} rate=${window.marpVideo.playbackRate}`
      );
    }

    if (!scrubDragging) {
      updateScrubHandle(metadata.mediaTime);
    }
    timeDisplay.textContent = `${formatTime(metadata.mediaTime)} / ${formatTime(window.marpVideo.duration)}`;

    window.marpVideo.requestVideoFrameCallback(onFrame);
  }

  window.marpVideo.requestVideoFrameCallback(onFrame);
}

/**
 * Moves the scrub handle to the given media time.
 * Inputs: mediaTime (seconds).
 * Output: none (updates #scrubHandle's position).
 */
function updateScrubHandle(mediaTime) {
  const duration = window.marpVideo.duration;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, mediaTime / duration)) : 0;
  scrubHandle.style.left = `${fraction * 100}%`;
}

/**
 * Builds one absolutely-positioned div per segment on the scrub track,
 * sized by each segment's real (non-uniform-safe) duration -- called
 * once per load, since segment count/durations never change afterward.
 * Inputs: segmentStates (array from getSegmentStates()).
 * Output: none (populates #scrubTrackBg).
 */
function buildSegmentBlocks(segmentStates) {
  scrubTrackBg.innerHTML = "";
  const duration = window.marpVideo.duration;

  for (const segment of segmentStates) {
    const block = document.createElement("div");
    block.className = "segment-block";
    block.dataset.index = String(segment.index);
    block.style.left = `${(segment.startTime / duration) * 100}%`;
    block.style.width = `${((segment.endTime - segment.startTime) / duration) * 100}%`;
    scrubTrackBg.appendChild(block);
  }
}

/**
 * Re-reads segment fetch/decode/pin status from the engine and updates
 * each segment block's shading -- run on a plain timer (see
 * SEGMENT_SHADING_INTERVAL_MS), independent of frame presentation.
 * Inputs: none (uses window.marpVideo).
 * Output: none (updates .segment-block classes).
 */
function updateSegmentShading() {
  if (!window.marpVideo) {
    return;
  }

  for (const segment of window.marpVideo.getSegmentStates()) {
    const block = scrubTrackBg.querySelector(`[data-index="${segment.index}"]`);
    if (!block) {
      continue;
    }
    block.classList.toggle("fetched", segment.fetched);
    block.classList.toggle("decoded", segment.decoded);
    block.classList.toggle("pinned", segment.pinned);
  }
}

/**
 * Converts a pointer event's x position on the scrub track into a media time.
 * Inputs: pointer event.
 * Output: time in seconds, clamped to [0, duration].
 */
function scrubEventToTime(event) {
  const rect = scrubTrackBg.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return fraction * window.marpVideo.duration;
}

// Commit-on-release: dragging only updates the handle/tooltip visually;
// the real seek fires once, on pointerup, using wherever the pointer
// ended up. Deliberately NOT a continuous seek-per-pointermove (that was
// tried first) -- with no trickplay preview built yet (that's a later
// phase), a mid-drag seek buys no visual benefit at all, only cost: real
// fetch/decode work kicked off for every position dragged over, and
// engine-side cancellation logic complex enough to have its own sharp
// edges (a same-segment reordering bug was found and fixed here, then a
// second, still-unexplained burst of errors appeared right after
// pressing play post-drag). Matches the real annotation tool's own
// established slider UX besides (commits only on drag-release, per
// VideoPlayer.xaml.cs's sliProgress_DragCompleted).
let lastScrubTime = 0;

scrubTrack.addEventListener("pointerdown", (event) => {
  if (!window.marpVideo) {
    return;
  }
  scrubDragging = true;
  scrubTrack.setPointerCapture(event.pointerId);
  lastScrubTime = scrubEventToTime(event);
  updateScrubHandle(lastScrubTime);
});

scrubTrack.addEventListener("pointermove", (event) => {
  if (!window.marpVideo) {
    return;
  }
  const time = scrubEventToTime(event);

  scrubTooltip.style.display = "block";
  scrubTooltip.style.left = `${((event.clientX - scrubTrackBg.getBoundingClientRect().left) / scrubTrackBg.getBoundingClientRect().width) * 100}%`;
  scrubTooltip.textContent = formatTime(time);

  if (scrubDragging) {
    lastScrubTime = time;
    updateScrubHandle(time);
  }
});

scrubTrack.addEventListener("pointerleave", () => {
  scrubTooltip.style.display = "none";
});

scrubTrack.addEventListener("pointerup", (event) => {
  scrubDragging = false;
  scrubTrack.releasePointerCapture(event.pointerId);
  if (!window.marpVideo) {
    return;
  }
  window.marpVideo.currentTime = lastScrubTime;
});

/**
 * Toggles play/pause, matching a YouTube-familiar single control shared
 * by the small transport button and the big center overlay button.
 * Inputs: none (uses window.marpVideo).
 * Output: none.
 */
function togglePlayPause() {
  if (!window.marpVideo) {
    return;
  }
  if (window.marpVideo.paused) {
    window.marpVideo.play();
  } else {
    window.marpVideo.pause();
  }
}

playPauseButton.addEventListener("click", togglePlayPause);
centerPlayButton.addEventListener("click", togglePlayPause);
canvas.addEventListener("click", togglePlayPause);

stepForwardButton.addEventListener("click", () => {
  if (!window.marpVideo) {
    return;
  }
  window.marpVideo.currentTime = window.marpVideo.currentTime + 1 / window.marpVideo.fps;
});

stepBackButton.addEventListener("click", () => {
  if (!window.marpVideo) {
    return;
  }
  window.marpVideo.currentTime = Math.max(0, window.marpVideo.currentTime - 1 / window.marpVideo.fps);
});

/**
 * Applies a new playbackRate and updates the speed readout -- the one
 * choke point both the hotkeys and the manual override input go through.
 * Inputs: rate (number).
 * Output: none.
 */
function setPlaybackRate(rate) {
  if (!window.marpVideo) {
    return;
  }
  window.marpVideo.playbackRate = rate;
  speedDisplay.textContent = `${rate}x`;
  speedOverrideInput.value = String(rate);
  log(`playbackRate set to ${rate}`);
}

speedOverrideInput.addEventListener("change", (event) => {
  const rate = parseFloat(event.target.value);
  if (!Number.isNaN(rate)) {
    setPlaybackRate(rate);
  }
});

muteButton.addEventListener("click", () => {
  if (!window.marpVideo) {
    return;
  }
  // Inert today (audio decode/playback isn't implemented yet -- see
  // marp-video-shim.js), but wired through to marpVideo.muted now so
  // this button needs no changes once audio lands.
  window.marpVideo.muted = !window.marpVideo.muted;
  muteButton.innerHTML = window.marpVideo.muted ? "&#128263;" : "&#128266;";
});

fullscreenButton.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    playerContainer.requestFullscreen();
  }
});

// --- Controls bar auto-hide: always visible while paused or while the
// pointer is over the bar itself; fades out after CONTROLS_IDLE_HIDE_MS
// of no pointer movement during playback. ---

let controlsHideTimer = null;
let pointerOverControlsBar = false;

/** Shows the controls bar and (re)starts the idle-hide timer if playing. */
function showControlsBar() {
  controlsBar.classList.remove("hidden");
  if (controlsHideTimer) {
    clearTimeout(controlsHideTimer);
  }
  if (window.marpVideo && !window.marpVideo.paused) {
    controlsHideTimer = setTimeout(() => {
      if (!pointerOverControlsBar && !settingsMenuOpen) {
        controlsBar.classList.add("hidden");
      }
    }, CONTROLS_IDLE_HIDE_MS);
  }
}

playerContainer.addEventListener("pointermove", showControlsBar);
controlsBar.addEventListener("pointerenter", () => {
  pointerOverControlsBar = true;
  showControlsBar();
});
controlsBar.addEventListener("pointerleave", () => {
  pointerOverControlsBar = false;
  showControlsBar();
});

// --- Speed hotkeys: only while the player itself has focus (see
// #playerContainer's tabindex="0" in index.html), so typing in the
// item-id/token fields above is never hijacked. ---
playerContainer.addEventListener("keydown", (event) => {
  if (!window.marpVideo) {
    return;
  }

  if (event.key === "Escape" && settingsMenuOpen) {
    closeSettingsMenu();
    return;
  }

  if (event.key === " ") {
    event.preventDefault();
    togglePlayPause();
    return;
  }

  const rate = SPEED_KEYMAP[event.key];
  if (rate !== undefined) {
    event.preventDefault();
    setPlaybackRate(rate);
    // A speed hotkey always starts playback, regardless of the current
    // paused state -- these keys are for actively scrubbing through the
    // video at that rate, not just arming a rate for later. Deliberately
    // scoped to the hotkeys only, not setPlaybackRate() itself, so the
    // manual speed-override input's existing behavior (set the rate,
    // leave play state alone) doesn't change.
    window.marpVideo.play();
  }
});
