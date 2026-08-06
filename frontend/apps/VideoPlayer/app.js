/**
 * Page glue for the VideoPlayer engine test harness.
 *
 * Not part of the annotation tool -- just enough UI (item id field,
 * paste-in Bearer token, minimal transport controls) to validate the
 * engine itself.
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

let seekBarDragging = false;

const loadButton = document.getElementById("loadButton");
const itemIdInput = document.getElementById("itemIdInput");
const tokenInput = document.getElementById("tokenInput");
const canvas = document.getElementById("canvas");
const playPauseButton = document.getElementById("playPauseButton");
const stepBackButton = document.getElementById("stepBackButton");
const stepForwardButton = document.getElementById("stepForwardButton");
const speedInput = document.getElementById("speedInput");
const timeDisplay = document.getElementById("timeDisplay");
const seekBar = document.getElementById("seekBar");

loadButton.addEventListener("click", async () => {
  const itemId = itemIdInput.value.trim();
  if (!itemId) {
    log("ERROR: enter a Jellyfin item id first.");
    return;
  }

  const token = tokenInput.value.trim();
  const fetchOptions = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  const streamUrl = `/api/v2/jellyfin/items/${itemId}/stream?mode=Transcode`;

  loadButton.disabled = true;
  log(`Loading ${streamUrl} ...`);

  try {
    window.marpVideo = await MarpVideoEngine.createMarpVideoEngine(canvas, { streamUrl, fetchOptions });
    wireVideoEvents();

    log(`Engine ready. duration=${window.marpVideo.duration.toFixed(3)}s, ${window.marpVideo.videoWidth}x${window.marpVideo.videoHeight}, ${window.marpVideo.fps}fps`);

    seekBar.max = String(Math.floor(window.marpVideo.duration * 1000));
    [playPauseButton, stepBackButton, stepForwardButton, speedInput, seekBar].forEach((el) => {
      el.disabled = false;
    });
  } catch (err) {
    log("ERROR loading: " + err.message);
    console.error(err);
    loadButton.disabled = false;
  }
});

/**
 * Wires window.marpVideo's events and frame-callback loop to the log
 * panel and transport-control UI.
 * Inputs: none (uses window.marpVideo).
 * Output: none.
 * Usage: called once, right after createMarpVideoEngine() resolves.
 */
function wireVideoEvents() {
  ["loadedmetadata", "durationchange", "resize", "error", "playing", "pause", "seeking", "seeked"].forEach((type) => {
    window.marpVideo.addEventListener(type, () => log(`event: ${type}`));
  });

  let frameLogCounter = 0;

  function onFrame(now, metadata) {
    frameLogCounter += 1;
    if (frameLogCounter % 10 === 0) {
      log(`frame #${metadata.presentedFrames} mediaTime=${metadata.mediaTime.toFixed(3)} segment=${metadata.segmentIndex}`);
    }

    if (!seekBarDragging) {
      seekBar.value = String(Math.floor(metadata.mediaTime * 1000));
    }
    timeDisplay.textContent = `${formatTime(metadata.mediaTime)} / ${formatTime(window.marpVideo.duration)}`;

    window.marpVideo.requestVideoFrameCallback(onFrame);
  }

  window.marpVideo.requestVideoFrameCallback(onFrame);
}

playPauseButton.addEventListener("click", () => {
  if (!window.marpVideo) {
    return;
  }
  if (window.marpVideo.paused) {
    window.marpVideo.play();
    playPauseButton.textContent = "Pause";
  } else {
    window.marpVideo.pause();
    playPauseButton.textContent = "Play";
  }
});

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

speedInput.addEventListener("change", (event) => {
  if (!window.marpVideo) {
    return;
  }
  const rate = parseFloat(event.target.value);
  if (!Number.isNaN(rate)) {
    window.marpVideo.playbackRate = rate;
    log(`playbackRate set to ${rate}`);
  }
});

// Commit-on-release, matching the real annotation tool's confirmed slider
// behavior (sliProgress_ValueChanged only previews; the real seek commits
// once in sliProgress_DragCompleted) -- 'change' fires on release, not on
// every intermediate value like 'input' would.
seekBar.addEventListener("pointerdown", () => {
  seekBarDragging = true;
});

seekBar.addEventListener("change", () => {
  seekBarDragging = false;
  if (!window.marpVideo) {
    return;
  }
  window.marpVideo.currentTime = Number(seekBar.value) / 1000;
});
