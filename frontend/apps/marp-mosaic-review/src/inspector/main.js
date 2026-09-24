/**
 * The source-video inspector (#181): one observation in its source video, with the boxes
 * of the rest of its Mosaic page drawn over it.
 *
 * The Mosaic opens this page once and then keeps telling it which observation to show
 * (`ui/video-window.js`), so the player stays loaded: the same video is a seek and a
 * different one is a load, never a cold start of the page. Everything it needs about the
 * page's observations comes from one read, `MarpApi.videoContext`, fetched once per page.
 *
 * **The reviewer signs in to Jellyfin with their own account**, in this page, through the
 * player's own `JellyfinClient`, which keeps the session in the browser. MARP never sees
 * the password: it goes from this form to Jellyfin and nowhere else.
 */
import { MarpApi } from '../api/index.js';
import { VIDEO_WINDOW } from '../ui/video-window.js';
import { boxesAt, contentRect } from '../model/video-boxes.js';

const $ = (id) => document.getElementById(id);

/* The opened observation's box, and everyone else's. */
const TARGET = '#c7ff62';
const OTHERS = 'rgba(100, 246, 242, 0.85)';

const player = window.MarpVideoEngine.createMarpVideoPlayer($('player'), {});

/* Video context per page, keyed by its sorted ids, so reopening a page asks nothing. */
const contexts = new Map();

/* What is on screen: the request, its video's entry and the opened observation. */
let showing = null;

/* The engine the frame loop is attached to, so a replaced engine is re-attached. */
let watchedEngine = null;

/* The newest request, so a slow load never overwrites a later click. */
let latest = 0;

function status(text) {
  $('inspectStatus').textContent = text || '';
}

function pageContext(ids) {
  const key = [...ids].sort((a, b) => a - b).join(',');
  if (!contexts.has(key)) {
    const pending = MarpApi.videoContext(ids);
    contexts.set(key, pending);
    pending.catch(() => contexts.delete(key));
  }
  return contexts.get(key);
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

/* Draw every box at time `t` over a picture of the given intrinsic size. */
function drawBoxes(overlay, element, pictureWidth, pictureHeight, t) {
  const { context, width, height } = fitOverlay(overlay, element);
  if (!showing) return;
  const area = contentRect(width, height, pictureWidth, pictureHeight);
  context.font = '13px system-ui, sans-serif';
  for (const box of boxesAt(showing.video.observations, t)) {
    const opened = box.observation_id === showing.observationId;
    const left = area.left + (box.x - box.width / 2) * area.width;
    const top = area.top + (box.y - box.height / 2) * area.height;
    context.strokeStyle = opened ? TARGET : OTHERS;
    context.lineWidth = opened ? 3 : 1.5;
    context.strokeRect(left, top, box.width * area.width, box.height * area.height);
    if (box.comname) {
      context.fillStyle = opened ? TARGET : OTHERS;
      context.fillText(box.comname, left, Math.max(12, top - 4));
    }
  }
}

/* Follow the engine frame by frame: redraw the boxes, and drop the poster once the
   video is showing the moment it was opened at. */
function watch(engine) {
  if (!engine || engine === watchedEngine) return;
  watchedEngine = engine;
  const canvas = $('player').querySelector('.marp-canvas');
  const onFrame = (_now, metadata) => {
    if (engine !== watchedEngine) return;
    drawBoxes($('boxes'), canvas, canvas.width, canvas.height, metadata.mediaTime);
    if (showing && !$('poster').hidden && Math.abs(metadata.mediaTime - showing.moment) < 0.25) {
      $('poster').hidden = true;
      status('');
    }
    engine.requestVideoFrameCallback(onFrame);
  };
  engine.requestVideoFrameCallback(onFrame);
}

/* The extracted full frame with the opened box, at once, while the video loads. */
function showPoster() {
  const image = $('posterImage');
  $('poster').hidden = false;
  image.onload = () => drawBoxes($('posterBoxes'), image, image.naturalWidth, image.naturalHeight, showing.moment);
  image.onerror = () => { $('poster').hidden = true; };
  image.src = MarpApi.fullFrameUrl({ observation_id: showing.observationId });
}

async function show(request) {
  const mine = ++latest;
  const ids = [...new Set([request.observationId, ...(request.pageIds || [])])];
  status('Finding the video…');

  let answer;
  try {
    answer = await pageContext(ids);
  } catch (error) {
    status(`The video could not be looked up: ${error.message}`);
    return;
  }
  if (mine !== latest) return;

  const video = (answer.videos || []).find((entry) =>
    entry.observations.some((row) => row.observation_id === request.observationId));
  const row = video && video.observations.find((entry) => entry.observation_id === request.observationId);

  $('inspectTitle').textContent = row ? `${row.comname || 'Observation'} · ${request.observationId}` : 'Source video';
  $('inspectDetail').textContent = video ? (video.video_source || '') : '';

  if (!video || !video.jellyfin_item_id) {
    status(video ? video.unresolved_reason : 'This observation was not found.');
    return;
  }

  showing = { request, video, observationId: request.observationId, moment: row.moment_s, server: answer.jellyfin_server };
  showPoster();

  if (!player.jellyfinClient.isAuthenticated()) {
    askToSignIn();
    return;
  }

  await play(mine);
}

/* Load the video if it is not the one already open, then seek to the moment. */
async function play(mine) {
  const { video, moment } = showing;
  if (player.currentItemId !== video.jellyfin_item_id || !player.engine) {
    status('Opening the video…');
    const engine = await player.loadItem(video.jellyfin_item_id);
    if (mine !== latest) return;
    if (!engine) {
      status('The video could not be opened. The player\'s own log says why.');
      return;
    }
  }
  watch(player.engine);
  player.engine.pause();
  status('Seeking…');
  player.engine.currentTime = moment;
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

window.addEventListener('resize', () => {
  if (showing && player.engine) {
    const canvas = $('player').querySelector('.marp-canvas');
    drawBoxes($('boxes'), canvas, canvas.width, canvas.height, player.engine.currentTime);
  }
});

if (typeof BroadcastChannel !== 'undefined') {
  new BroadcastChannel(VIDEO_WINDOW).addEventListener('message', (event) => {
    if (event.data && event.data.type === 'show') show(event.data);
  });
}

/* The first request arrives in the hash, because the window was not listening yet. */
try {
  const first = JSON.parse(decodeURIComponent(window.location.hash.slice(1)) || 'null');
  if (first && first.type === 'show') show(first);
} catch {
  status('Open a video from the Mosaic.');
}
