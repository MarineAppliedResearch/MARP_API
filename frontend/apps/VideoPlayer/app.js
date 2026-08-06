/**
 * Page glue for the VideoPlayer engine test harness.
 *
 * Not part of the annotation tool -- just enough UI (item id field,
 * paste-in Bearer token, minimal transport controls) to validate the
 * engine itself.
 *
 * Deliberately assigns the engine instance to window.mareVideo (not a
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
    window.mareVideo = await MareVideoEngine.createMareVideoEngine(canvas, { streamUrl, fetchOptions });
    wireVideoEvents();

    log(`Engine ready. duration=${window.mareVideo.duration.toFixed(3)}s, ${window.mareVideo.videoWidth}x${window.mareVideo.videoHeight}, ${window.mareVideo.fps}fps`);

    seekBar.max = String(Math.floor(window.mareVideo.duration * 1000));
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
 * Wires window.mareVideo's events and frame-callback loop to the log
 * panel and transport-control UI.
 * Inputs: none (uses window.mareVideo).
 * Output: none.
 * Usage: called once, right after createMareVideoEngine() resolves.
 */
function wireVideoEvents() {
  ["loadedmetadata", "durationchange", "resize", "error", "playing", "pause", "seeking", "seeked"].forEach((type) => {
    window.mareVideo.addEventListener(type, () => log(`event: ${type}`));
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
    timeDisplay.textContent = `${formatTime(metadata.mediaTime)} / ${formatTime(window.mareVideo.duration)}`;

    window.mareVideo.requestVideoFrameCallback(onFrame);
  }

  window.mareVideo.requestVideoFrameCallback(onFrame);
}

playPauseButton.addEventListener("click", () => {
  if (!window.mareVideo) {
    return;
  }
  if (window.mareVideo.paused) {
    window.mareVideo.play();
    playPauseButton.textContent = "Pause";
  } else {
    window.mareVideo.pause();
    playPauseButton.textContent = "Play";
  }
});

stepForwardButton.addEventListener("click", () => {
  if (!window.mareVideo) {
    return;
  }
  window.mareVideo.currentTime = window.mareVideo.currentTime + 1 / window.mareVideo.fps;
});

stepBackButton.addEventListener("click", () => {
  if (!window.mareVideo) {
    return;
  }
  window.mareVideo.currentTime = Math.max(0, window.mareVideo.currentTime - 1 / window.mareVideo.fps);
});

speedInput.addEventListener("change", (event) => {
  if (!window.mareVideo) {
    return;
  }
  const rate = parseFloat(event.target.value);
  if (!Number.isNaN(rate)) {
    window.mareVideo.playbackRate = rate;
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
  if (!window.mareVideo) {
    return;
  }
  window.mareVideo.currentTime = Number(seekBar.value) / 1000;
});
