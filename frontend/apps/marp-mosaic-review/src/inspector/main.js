/**
 * The Mosaic's video page (#181): one observation's source video, opened at its moment,
 * with the boxes of every observation in that video the Mosaic's current query matches.
 *
 * The Mosaic opens this page once and then keeps telling it which observation to show and,
 * when the query changes, what the query now is (`ui/video-window.js`), so the player stays
 * loaded: the same video is a seek and a different one is a load, never a cold start.
 *
 * **What is drawn** (Isaac, 2026-10-05): every observation in this video the query matches,
 * across all pages, each from its start keyframe to its end, interpolated between; the
 * opened one highlighted above the rest; the rest in their species colours, the annotation
 * GUI's. The observations come once, from `MarpApi.videoObservations`; their keyframes a
 * window of seconds at a time around the playhead, from `MarpApi.videoKeyframes` -- the
 * busiest video holds 47,736 keyframes, too many to load at once on a phone (A9).
 *
 * **The reviewer signs in to Jellyfin with their own account**, in this page, through the
 * player's own `JellyfinClient`, which keeps the session in the browser. MARP never sees
 * the password: it goes from this form to Jellyfin and nowhere else.
 */
import { MarpApi } from '../api/index.js';
import { VIDEO_WINDOW } from '../ui/video-window.js';
import { boxesAt, contentRect, playbackBlocker, pictureTime, firstSeekTarget } from '../model/video-boxes.js';
import { windowsAround, windowRange, observationsIn, windowsToDrop, speciesColour } from '../model/video-review.js';
import { createInspectorPlayer, applyBudgets } from './player-setup.js';

const $ = (id) => document.getElementById(id);

/* The opened observation's box. Every other box is its species' colour. */
const HIGHLIGHT = '#c7ff62';

/* The most observations one keyframe request names; the API takes up to 2,000. */
const IDS_PER_REQUEST = 1000;

const { player, budgets, quality } = createInspectorPlayer($('player'));

/* What is on screen: the opened observation, the query, its video, and the observations
   the query matches in it. */
let showing = null;

/* Keyframe windows held, by window index, and those being fetched. A new video or a new
   query starts a new generation, and a window fetched for an older one is thrown away. */
const held = new Map();
const pending = new Set();
let generation = 0;

/* The held keyframes, as the observations boxesAt draws: rebuilt when a window arrives or
   goes, not on every frame. */
let drawable = [];

/* The engine the frame loop is attached to, so a replaced engine is re-attached. */
let watchedEngine = null;

/* The newest request, so a slow load never overwrites a later click. */
let latest = 0;

/* The last observation asked for, so a changed query is followed even when its video
   could not be shown -- the new question may be answerable where the old one was not. */
let lastRequest = null;

/* When the picture on screen was taken, so a resize redraws the boxes for it. */
let shownAt = null;

/* The moment to step onto once the first seek -- a frame short of it -- has painted. */
let thenTo = null;

function status(text) {
  $('inspectStatus').textContent = text || '';
}

/* The overlay canvas sized and placed exactly over the picture's element. */
function fitOverlay(overlay, element) {
  const stage = $('player').parentElement.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  overlay.style.left = `${rect.left - stage.left}px`;
  overlay.style.top = `${rect.top - stage.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.width = Math.round(rect.width * ratio);
  overlay.height = Math.round(rect.height * ratio);
  const context = overlay.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  return { context, width: rect.width, height: rect.height };
}

/* Draw every box at time `t` over a picture of the given intrinsic size: the others first
   in their species' colours, the opened one last, on top, highlighted. */
function drawBoxes(overlay, element, pictureWidth, pictureHeight, t) {
  const { context, width, height } = fitOverlay(overlay, element);
  if (!showing) return;
  const area = contentRect(width, height, pictureWidth, pictureHeight);
  const boxes = boxesAt(drawable, t)
    .sort((a, b) => (a.observation_id === showing.observationId) - (b.observation_id === showing.observationId));
  for (const box of boxes) {
    const opened = box.observation_id === showing.observationId;
    const colour = opened ? HIGHLIGHT : speciesColour(box.comname);
    const left = area.left + (box.x - box.width / 2) * area.width;
    const top = area.top + (box.y - box.height / 2) * area.height;
    context.save();
    if (opened) {
      context.shadowColor = HIGHLIGHT;
      context.shadowBlur = 10;
    }
    context.strokeStyle = colour;
    context.lineWidth = opened ? 4 : 2;
    context.strokeRect(left, top, box.width * area.width, box.height * area.height);
    context.restore();
    context.font = opened ? 'bold 14px system-ui, sans-serif' : '13px system-ui, sans-serif';
    context.fillStyle = colour;
    const label = opened ? `${box.comname || 'Observation'} · ${box.observation_id}` : (box.comname || '');
    if (label) context.fillText(label, left, Math.max(13, top - 5));
  }
}

function redraw() {
  if (!showing || !player.engine) return;
  const canvas = $('player').querySelector('.marp-canvas');
  if (canvas) drawBoxes($('boxes'), canvas, canvas.width, canvas.height, shownAt ?? player.engine.currentTime);
}

/* The held windows' keyframes, gathered per observation. A keyframe held by two windows
   -- a neighbour either side of one is inside the next -- is drawn once. */
function rebuildDrawable() {
  const byObservation = new Map();
  for (const keyframes of held.values()) {
    for (const keyframe of keyframes) {
      if (!byObservation.has(keyframe.observation_id)) byObservation.set(keyframe.observation_id, new Map());
      byObservation.get(keyframe.observation_id).set(keyframe.keyframe_id, keyframe);
    }
  }
  drawable = [...byObservation].map(([id, keyframes]) => ({
    observation_id: id,
    comname: showing && showing.names.get(id),
    keyframes: [...keyframes.values()]
  }));
}

/* Hold the windows around `t`, fetching the missing ones and letting go of the rest. */
function followPlayhead(t) {
  if (!showing || !Number.isFinite(t)) return;
  const wanted = windowsAround(t);
  const dropped = windowsToDrop(held.keys(), wanted);
  for (const index of dropped) held.delete(index);
  if (dropped.length) rebuildDrawable();
  for (const index of wanted) {
    if (!held.has(index) && !pending.has(index)) loadWindow(index, generation);
  }
}

async function loadWindow(index, mine) {
  const range = windowRange(index);
  const ids = observationsIn(showing.observations, range);
  pending.add(index);
  try {
    const keyframes = [];
    for (let at = 0; at < ids.length; at += IDS_PER_REQUEST) {
      const answer = await MarpApi.videoKeyframes({
        observationIds: ids.slice(at, at + IDS_PER_REQUEST), from: range.from, to: range.to
      });
      keyframes.push(...answer.keyframes);
    }
    if (mine !== generation) return;
    held.set(index, keyframes);
    rebuildDrawable();
    redraw();
  } catch (error) {
    if (mine === generation) status(`Boxes could not be loaded: ${error.message}`);
  } finally {
    pending.delete(index);
  }
}

/* A new video or a new query: everything held is for the old one. */
function forgetKeyframes() {
  generation += 1;
  held.clear();
  pending.clear();
  drawable = [];
}

/* Follow the engine frame by frame: redraw the boxes for when the picture was really
   taken, keep the keyframe windows around it, and clear the status at the moment. */
function watch(engine) {
  if (!engine || engine === watchedEngine) return;
  watchedEngine = engine;
  const canvas = $('player').querySelector('.marp-canvas');
  const onFrame = (_now, metadata) => {
    if (engine !== watchedEngine) return;
    shownAt = pictureTime(metadata);
    if (thenTo && Math.abs(metadata.mediaTime - thenTo.from) < 0.1) {
      const to = thenTo.to;
      thenTo = null;
      engine.currentTime = to;
    }
    followPlayhead(shownAt);
    drawBoxes($('boxes'), canvas, canvas.width, canvas.height, shownAt);
    if (showing && Math.abs(shownAt - showing.moment) < 0.25) status('');
    engine.requestVideoFrameCallback(onFrame);
  };
  engine.requestVideoFrameCallback(onFrame);
}

/* The observations the query matches in the opened one's video. */
async function readObservations(observationId, filters) {
  const answer = await MarpApi.videoObservations({ observationId, filters });
  return {
    answer,
    names: new Map(answer.observations.map((row) => [row.observation_id, row.comname]))
  };
}

async function show(request) {
  const mine = ++latest;
  lastRequest = request;
  status('Finding the video…');

  let read;
  try {
    read = await readObservations(request.observationId, request.filters || {});
  } catch (error) {
    status(`The video could not be looked up: ${error.message}`);
    return;
  }
  if (mine !== latest) return;

  const { answer, names } = read;
  const { video } = answer;
  const comname = names.get(request.observationId);
  $('inspectTitle').textContent = `${comname || 'Observation'} · ${request.observationId}`;
  $('inspectDetail').textContent = video.video_source || '';

  if (!video.jellyfin_item_id) {
    status(video.unresolved_reason || 'This observation was not found.');
    return;
  }

  // Jellyfin through MARP's own address, so a secure page can reach it (#181).
  const server = answer.jellyfin_server ? new URL(answer.jellyfin_server, window.location.origin).href : null;
  forgetKeyframes();
  // Nothing is laid over the player while it loads or seeks: its own spinner and controls
  // are what the reviewer should see.
  showing = {
    observationId: request.observationId,
    filters: request.filters || {},
    video,
    observations: answer.observations,
    names,
    moment: answer.opened.moment_s,
    server
  };
  if (answer.truncated) status(`Only the first ${answer.observations.length} matching observations are drawn.`);
  // The boxes around the moment start loading now, so they are there when the picture is.
  followPlayhead(showing.moment);

  // On an insecure address the browser has no decoder, so there is nothing to play.
  const blocker = playbackBlocker({
    secureContext: window.isSecureContext,
    hasVideoDecoder: typeof window.VideoDecoder === 'function'
  });
  if (blocker) {
    status(blocker);
    return;
  }

  if (!player.jellyfinClient.isAuthenticated()) {
    askToSignIn();
    return;
  }

  await play(mine);
}

/* The query changed in the Mosaic: draw what it matches now, where the playhead is. */
async function followQuery(filters) {
  if (!showing) {
    if (lastRequest) show({ ...lastRequest, filters: filters || {} });
    return;
  }
  lastRequest = { ...lastRequest, filters: filters || {} };
  const mine = latest;
  let read;
  try {
    read = await readObservations(showing.observationId, filters || {});
  } catch (error) {
    status(`The boxes could not follow the Mosaic: ${error.message}`);
    return;
  }
  if (mine !== latest || !showing) return;
  forgetKeyframes();
  showing = { ...showing, filters: filters || {}, observations: read.answer.observations, names: read.names };
  followPlayhead(shownAt ?? (player.engine && player.engine.currentTime));
  redraw();
}

/* Open the video at the moment, or seek to it when that video is already open. */
async function play(mine) {
  const { video, moment } = showing;
  if (player.currentItemId !== video.jellyfin_item_id || !player.engine) {
    status('Opening the video…');
    // Opened at the moment itself, so the start of the dive is neither fetched nor shown
    // first. A phone opens a transcode rather than the original file, which it cannot hold.
    const engine = await player.loadItem(video.jellyfin_item_id, quality, { startTime: moment });
    if (mine !== latest) return;
    if (!engine) {
      status('The video could not be opened. The player\'s own log says why.');
      return;
    }
    applyBudgets(engine, budgets, player);
  }
  watch(player.engine);
  player.engine.pause();
  // A frame short of the moment first, then onto it once that has painted: the player paints
  // and reports only a new frame, and it opened on the moment before this page was watching.
  // Issued together, the second seek replaces the first and lands on the frame already shown.
  const first = firstSeekTarget(moment, video.frame_rate || 25);
  thenTo = { from: first, to: moment };
  player.engine.currentTime = first;
}

function askToSignIn() {
  status('');
  $('signIn').hidden = false;
  $('signIn').elements.username.focus();
}

$('signIn').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  $('signInError').textContent = '';
  try {
    await player.jellyfinClient.login(showing.server, form.elements.username.value, form.elements.password.value);
  } catch (error) {
    $('signInError').textContent = error.message;
    return;
  } finally {
    // The password is Jellyfin's to keep, not this page's.
    form.elements.password.value = '';
  }
  form.hidden = true;
  if (typeof player.updateLoginStatus === 'function') player.updateLoginStatus();
  await play(latest);
});

/* A hidden window stops fetching video for nobody. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && player.engine) player.engine.pause();
});

window.addEventListener('resize', redraw);

if (typeof BroadcastChannel !== 'undefined') {
  new BroadcastChannel(VIDEO_WINDOW).addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'show') show(event.data);
    if (event.data.type === 'query') followQuery(event.data.filters);
  });
}

/* The first request arrives in the hash, because the window was not listening yet. */
try {
  const first = JSON.parse(decodeURIComponent(window.location.hash.slice(1)) || 'null');
  if (first && first.type === 'show') show(first);
} catch {
  status('Open a video from the Mosaic.');
}
