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
import { boxesAt, tracksOf, trackTolerance, contentRect, playbackBlocker, pictureTime, firstSeekTarget } from '../model/video-boxes.js';
import { windowsAround, windowRange, observationsIn, windowsToDrop, speciesColour } from '../model/video-review.js';
import { createInspectorPlayer, applyBudgets } from './player-setup.js';
import { createBoxEditor } from './editing.js';
import { toScreen, trackKey, withEdit, withObservation, keyframeShown } from '../model/box-edit.js';
import { openSpeciesPopup, renderPanel } from './annotate-ui.js';
import { labelScale } from '../model/box-style.js';
import { drawBox } from './draw-boxes.js';

const $ = (id) => document.getElementById(id);

/* The most observations one keyframe request names; the API takes up to 2,000. */
const IDS_PER_REQUEST = 1000;

const { player, budgets, quality } = createInspectorPlayer($('player'));

/* The boxes and their menu live inside the player's own element, just above its picture
   and below its controls, so they go fullscreen with it. Beside it, they were left behind
   when the player's fullscreen button enlarged only the player (2026-10-06). */
const playerRoot = $('player').querySelector('.marp-player') || $('player');
const pictureCanvas = playerRoot.querySelector('.marp-canvas');
if (pictureCanvas) pictureCanvas.insertAdjacentElement('afterend', $('boxes'));
else playerRoot.appendChild($('boxes'));
playerRoot.appendChild($('boxMenu'));
// The add popup and the observation panel go fullscreen with the player too.
playerRoot.appendChild($('addPopup'));
playerRoot.appendChild($('obsPanel'));
/* Typing is not the player's; everything else still is.
   These panels sit inside the player's element, so a species name typed into the search used
   to reach its keyboard shortcuts and change the playback speed (2026-10-06). Stopping every
   key was too much: with focus on a panel button the arrow keys stopped stepping the video
   until the reviewer clicked the picture again (2026-10-14). So only keys aimed at something
   being typed into are held back. */
const typingIn = (target) => Boolean(target && (target.matches('input, textarea, select') || target.isContentEditable));

/* Give the keyboard back to the player, which is the element listening for its shortcuts.
   Called whenever one of our own surfaces takes focus and then goes away -- not while the
   reviewer is typing, which is theirs. */
function returnKeyboard() {
  if (!typingIn(document.activeElement)) playerRoot.focus({ preventScroll: true });
}
for (const id of ['addPopup', 'obsPanel', 'boxMenu']) {
  for (const type of ['keydown', 'keyup', 'keypress']) {
    $(id).addEventListener(type, (event) => { if (typingIn(event.target)) event.stopPropagation(); });
  }
}

/* What the reviewer may do beyond moving boxes: add, rename, count, merge (observations:write). */
let canAnnotate = false;
let canDelete = false;

/* A box drawn and not yet given a species: painted in the GUI's drawing colour, DeepPink. */
const DRAWING = '#ff1493';

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

/* What was last drawn, in draw order, and the picture's area: what a press is tested
   against. */
let drawnNow = { rects: [], area: null };

/* How long the last frame's boxes took to draw, for the console (`MARP_VIDEO.drawMs`). */
let drawMs = 0;

function status(text) {
  $('inspectStatus').textContent = text || '';
}

/* The overlay canvas sized and placed exactly over the picture's element.

   Its backing store is reallocated only when the picture's size changes. It used to be
   resized on every frame, which reallocates and clears a full-screen bitmap twenty-five
   times a second on the page's one thread -- the same thread the player renders on. */
function fitOverlay(overlay, element) {
  const host = overlay.offsetParent || playerRoot;
  const frame = host.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  const context = overlay.getContext('2d');
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  overlay.style.left = `${rect.left - frame.left}px`;
  overlay.style.top = `${rect.top - frame.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  return { context, width: rect.width, height: rect.height };
}

/* Draw every box at time `t` over a picture of the given intrinsic size, in the annotation
   GUI's style (`model/box-style.js`), lowest first: the others, then the one the page was
   opened from, then a box the reviewer has pressed. The halo marks the selected one. */
function drawBoxes(overlay, element, pictureWidth, pictureHeight, t) {
  const started = performance.now();
  const { context, width, height } = fitOverlay(overlay, element);
  drawnNow = { rects: [], area: null };
  if (!showing) return;
  const area = contentRect(width, height, pictureWidth, pictureHeight);
  const scale = labelScale(area.height);
  const rate = showing.video.frame_rate || 25;
  const entries = boxesAt(drawable, t, trackTolerance(rate)).map((box) => {
    const key = trackKey(box);
    const opened = box.observation_id === showing.observationId;
    const preview = editor.previewFor(key);
    return { key, box, opened, rect: preview ? preview.rect : toScreen(box, area) };
  }).sort((a, b) => editor.rankOf(a.key, a.opened) - editor.rankOf(b.key, b.opened));

  // The one the page was opened from starts selected, so the halo is on it before anything is
  // clicked -- and then it follows whatever is clicked instead.
  if (showing.selectOpened && !editor.selectedKey) {
    const own = entries.find((entry) => entry.opened);
    if (own) {
      showing.selectOpened = false;
      editor.select(own.key);
      return;
    }
  }

  for (const entry of entries) {
    const keyframe = keyframeShown(entry.box.keyframes, t, rate);
    drawBox(context, entry, {
      colour: speciesColour(entry.box.comname),
      type: keyframe ? keyframe.type : 'interpolated',
      selected: entry.key === editor.selectedKey,
      pressed: editor.pressFor(entry.key),
      scale
    });
  }
  const draft = editor.draftRect();
  if (draft) {
    context.save();
    context.strokeStyle = DRAWING;
    context.lineWidth = 3.5 * scale;
    context.setLineDash([6 * scale, 4 * scale]);
    context.strokeRect(draft.left, draft.top, draft.width, draft.height);
    context.restore();
  }
  drawnNow = { rects: entries, area };
  drawMs = performance.now() - started;
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
  drawable = [...byObservation].map(([id, keyframes]) => {
    const row = showing && showing.rows.get(id);
    return {
      observation_id: id,
      obs_id: row ? row.obs_id : null,
      comname: row ? row.comname : null,
      // Sorted here, once, rather than on every frame.
      tracks: tracksOf([...keyframes.values()])
    };
  });
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
    rows: new Map(answer.observations.map((row) => [row.observation_id, row]))
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

  const { answer, rows } = read;
  const { video } = answer;
  const comname = rows.has(request.observationId) ? rows.get(request.observationId).comname : null;
  $('inspectTitle').textContent = `${comname || 'Observation'} · ${request.observationId}`;
  openedTitle = $('inspectTitle').textContent;
  $('inspectDetail').textContent = video.video_source || '';

  if (!video.jellyfin_item_id) {
    status(video.unresolved_reason || 'This observation was not found.');
    return;
  }

  // Jellyfin through MARP's own address, so a secure page can reach it (#181).
  const server = answer.jellyfin_server ? new URL(answer.jellyfin_server, window.location.origin).href : null;
  forgetKeyframes();
  editor.reset();
  // Nothing is laid over the player while it loads or seeks: its own spinner and controls
  // are what the reviewer should see.
  showing = {
    observationId: request.observationId,
    filters: request.filters || {},
    video,
    observations: answer.observations,
    rows,
    moment: answer.opened.moment_s,
    selectOpened: true,
    sessions: answer.sessions || [],
    openedSession: answer.opened.session_id,
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
  showing = {
    ...showing, filters: filters || {}, observations: read.answer.observations, rows: read.rows,
    sessions: read.answer.sessions || showing.sessions
  };
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

/* Box editing (#181), for a reviewer who may write keyframes. */
const editor = createBoxEditor({
  stage: $('player').parentElement,
  overlay: $('boxes'),
  menu: $('boxMenu'),
  host: {
    drawn: () => drawnNow,
    time: () => shownAt ?? (player.engine ? player.engine.currentTime : 0),
    frameRate: () => (showing && showing.video.frame_rate) || 25,
    pause: () => { if (player.engine) player.engine.pause(); },
    redraw,
    status,
    apply(answer) {
      const next = withEdit(held, answer);
      held.clear();
      for (const [index, keyframes] of next) held.set(index, keyframes);
      // Whether the track still has no end decides both how it is drawn and whether later
      // windows ask for it, so it is re-derived from the keyframes rather than assumed: an
      // edit can have just added the end, or taken it away (2026-10-14).
      refreshOpenEnded(answer.observation_id);
      rebuildDrawable();
      // The panel lists the selected observation's keyframes, so an edit that adds or removes
      // one has to redraw it or the list is a stale answer (2026-10-14).
      updatePanel();
    },
    async deleteObservation(id) {
      const row = showing && showing.observations.find((o) => o.observation_id === id);
      if (!row) return;
      // The Mosaic's own delete, so it is the same permanent delete with the same check
      // that nobody changed the row since it was read.
      const answer = await MarpApi.commitPage({
        mode: 'delete', rows: [{ observation_id: id, version: row.version }], marks: new Map([[id, {}]])
      });
      const deleted = (answer.reviewed || []).some((r) => r.observation_id === id && r.outcome === 'deleted');
      if (!deleted) {
        status(`Observation ${id} was not deleted: it changed since this page read it. Open it again from the Mosaic.`);
        return;
      }
      forgetObservation(id);
      status(`Observation ${id} deleted.`);
    },
    /* Keyboard stepping belongs to the player, so it is given focus back after a gesture of
       ours -- except while something is being typed into, which is the reviewer's. */
    focusPlayer: returnKeyboard,
    usePicture,
    canDraw: () => canAnnotate,
    isPicture: (target) => target === pictureCanvas,
    onDrawn: openAdd,
    selectionChanged: () => updatePanel()
  }
});

/* An observation the page no longer holds: deleted, or merged into another. */
function forgetObservation(id) {
  showing = { ...showing, observations: showing.observations.filter((o) => o.observation_id !== id) };
  showing.rows.delete(id);
  const next = withObservation(held, id);
  held.clear();
  for (const [index, keyframes] of next) held.set(index, keyframes);
  if (editor.selectedKey && editor.selectedKey.startsWith(`${id}_`)) editor.select(null);
  rebuildDrawable();
  redraw();
  updatePanel();
}

/* The header names the observation the page was opened on until another is selected, and
   then names that one: it read as the wrong animal otherwise (2026-10-14). */
let openedTitle = '';

/* What the Mosaic-picture button is saying: 'working', 'done', or nothing. Held here rather
   than on the element, because the panel is redrawn from state and a re-render would
   otherwise throw the message away mid-cut (2026-10-14). */
let pictureState = null;

function showTitle() {
  const key = editor.selectedKey;
  const id = key ? Number(key.split('_')[0]) : null;
  const row = showing && id != null ? showing.rows.get(id) : null;
  $('inspectTitle').textContent = row
    ? `${row.comname || 'Observation'} · ${row.observation_id}`
    : openedTitle;
}

/* Whether an observation's track still lacks an end keyframe, from what the page holds. An
   unfinished one is drawn forward and is wanted by every window after its start. */
function refreshOpenEnded(id) {
  const row = showing && showing.rows.get(id);
  if (!row) return;
  const keyframes = [...held.values()].flat().filter((k) => k.observation_id === id);
  if (!keyframes.length) return;
  row.open_ended = !keyframes.some((k) => k.type === 'end');
  const span = showing.observations.find((o) => o.observation_id === id);
  if (span) span.open_ended = row.open_ended;
}

/* Widen an observation's span to cover a keyframe, so the windows still ask for it. */
function cover(id, t) {
  const row = showing.observations.find((o) => o.observation_id === id);
  if (row) {
    row.start_s = Math.min(row.start_s, t);
    row.end_s = Math.max(row.end_s, t);
  }
}

/* The box drawn on empty picture: a species makes it a new observation, or it joins the
   selected one (R1, R2). */
function openAdd({ rect, box, selectedKey }) {
  const t = shownAt ?? player.engine.currentTime;
  const overlay = $('boxes');
  const at = { left: rect.left + overlay.offsetLeft, top: rect.top + overlay.offsetTop, width: rect.width, height: rect.height };
  const selectedId = selectedKey ? Number(selectedKey.split('_')[0]) : null;
  const selected = selectedId != null ? showing.rows.get(selectedId) : null;
  const sessionId = showing.openedSession ?? (showing.sessions[0] && showing.sessions[0].session_id);
  openSpeciesPopup({
    popup: $('addPopup'),
    at,
    title: 'New observation',
    sessions: showing.sessions,
    sessionId,
    extendLabel: selected ? `Add to ${selected.obs_id ?? '?'} · ${selected.comname || 'Unknown'}` : null,
    onExtend: () => editor.save(async () => {
      const answer = await MarpApi.addKeyframe({ observationId: selectedId, subset: selectedKey.split('_')[1] || null, t, box });
      cover(selectedId, t);
      editor.clearDraft();
      return answer;
    }),
    onPick: ({ species, sessionId: chosen }) => editor.save(async () => {
      const answer = await MarpApi.createObservation({ openedId: showing.observationId, sessionId: chosen, speciesId: species.id, t, box });
      const row = answer.observation;
      showing.observations.push(row);
      showing.rows.set(row.observation_id, row);
      editor.clearDraft();
      status(`Added ${row.comname || 'an observation'}, obs ID ${row.obs_id}.`);
      setTimeout(() => editor.select(`${row.observation_id}_${answer.keyframes[0].subset}`), 0);
      return { observation_id: row.observation_id, changed: answer.keyframes, deleted: [] };
    }),
    onCancel: () => editor.clearDraft(),
    restoreFocus: returnKeyboard
  });
}

/* Cut the Mosaic picture from the box on this frame, saying so while it happens.
   It really goes and decodes the frame out of the video, which takes seconds, and silence
   there reads as a button that does nothing (2026-10-14). */
function usePicture(entry, t) {
  pictureState = 'working';
  status('Cutting the Mosaic picture from this frame. This takes a few seconds…');
  updatePanel();
  return editor.save(async () => {
    try {
      const answer = await MarpApi.usePicture(entry.box.observation_id, { t, subset: entry.box.subset, box: entry.box });
      status('The Mosaic picture is now cut from this frame. Reload the Mosaic to see it.');
      pictureState = 'done';
      setTimeout(() => { pictureState = null; updatePanel(); }, 2500);
      return answer;
    } catch (error) {
      // Reported here rather than rethrown: the queue's own handler would replace this with
      // a generic "the change was not saved", and the reason is the useful part.
      status(`The Mosaic picture was not cut: ${error.message}`);
      pictureState = null;
      updatePanel();
      return [];
    }
  });
}

/* The panel follows the selection: the selected observation, or nothing (R7). */
function updatePanel() {
  const key = editor.selectedKey;
  const id = key ? Number(key.split('_')[0]) : null;
  const row = showing && id != null ? showing.rows.get(id) : null;
  if (!row || !editor.enabled) {
    showTitle();
    renderPanel($('obsPanel'), null);
    return;
  }
  showTitle();
  const drawnRow = drawable.find((o) => o.observation_id === id);
  const keyframes = drawnRow ? drawnRow.tracks.flat().sort((a, b) => a.t - b.t) : [];
  renderPanel($('obsPanel'), {
    row,
    colour: speciesColour(row.comname),
    session: showing.sessions.find((s) => s.session_id === row.session_id),
    keyframes,
    canWrite: canAnnotate,
    canDelete,
    picture: pictureState
  }, {
    close: () => { editor.select(null); returnKeyboard(); },
    seek: (t) => {
      if (!player.engine) return;
      player.engine.pause();
      player.engine.currentTime = t;
      returnKeyboard();
    },
    count: (count) => editor.save(async () => {
      returnKeyboard();
      const answer = await MarpApi.setCount(id, count);
      row.count = answer.count;
      row.version = answer.version;
      status(`Count is ${answer.count}.`);
      updatePanel();
    }),
    rename: () => {
      const panel = $('obsPanel');
      const session = showing.sessions.find((s) => s.session_id === row.session_id);
      openSpeciesPopup({
        popup: $('addPopup'),
        at: { left: panel.offsetLeft - 8, top: panel.offsetTop, width: 0, height: 0 },
        title: 'Change species',
        list: session ? session.species_list : null,
        onPick: ({ species }) => editor.save(async () => {
          const answer = await MarpApi.setSpecies({ observationId: id, speciesId: species.id, version: row.version });
          if (!answer.ok) {
            status(answer.error === 'unchanged'
              ? 'That is already its species.'
              : 'Not renamed: it changed since this page read it. Open it again from the Mosaic.');
            return;
          }
          // The whole name changes, here as in the database (R3).
          row.comname = answer.observation.comname;
          row.species_id = answer.observation.species_id;
          row.version = answer.observation.version;
          rebuildDrawable();
          redraw();
          updatePanel();
          status(`Renamed to ${row.comname}.`);
        }),
        onCancel: () => {},
        restoreFocus: returnKeyboard
      });
    },
    picture: () => {
      const entry = editor.selectedEntry();
      if (!entry) {
        status("Go to a frame where this observation's box is drawn, then choose its picture.");
        return;
      }
      usePicture(entry, shownAt ?? player.engine.currentTime);
    },
    remove: () => editor.act('deleteObservation', editor.selectedEntry() || { box: { observation_id: id, comname: row.comname } }),
    merge: () => {
      const label = `${row.obs_id ?? '?'} · ${row.comname || 'Unknown'}`;
      status(`Click the observation to merge into ${label}. Escape cancels.`);
      editor.pick((entry) => {
        const fromId = entry.box.observation_id;
        const from = showing.rows.get(fromId);
        if (fromId === id) {
          status('Pick a different observation to merge into this one.');
          return;
        }
        const fromLabel = `${(from && from.obs_id) ?? '?'} · ${(from && from.comname) || 'Unknown'}`;
        if (!window.confirm(`Merge ${fromLabel} into ${label}? ${fromLabel} is deleted, and its boxes join ${label}.`)) {
          status('');
          return;
        }
        editor.save(async () => {
          const answer = await MarpApi.mergeObservations(id, fromId);
          forgetObservation(fromId);
          const next = withObservation(held, id, answer.keyframes);
          held.clear();
          for (const [index, keyframes] of next) held.set(index, keyframes);
          for (const keyframe of answer.keyframes) cover(id, keyframe.t);
          rebuildDrawable();
          // Paused, no new frame comes to draw it: the merged box is drawn now.
          redraw();
          updatePanel();
          status(`Merged ${fromLabel} into ${label}.`);
        });
      });
    }
  });
}

MarpApi.whoami().then((user) => {
  const permissions = (user && user.permissions) || [];
  if (permissions.includes('keyframes:write')) {
    canAnnotate = permissions.includes('observations:write');
    canDelete = canAnnotate;
    editor.enable({ deleteObservations: canDelete });
  }
}).catch(() => {
  // Not signed in to MARP, or it could not say: the boxes are shown and not edited.
});

/* For the console and the browser tier, as `window.MARP` is for the Mosaic: where each box
   was last drawn, and what is selected. Read-only. */
window.MARP_VIDEO = {
  get drawn() {
    const o = $('boxes').getBoundingClientRect();
    return drawnNow.rects.map(({ key, box, rect }) => ({
      key, observation_id: box.observation_id, comname: box.comname,
      rect: { left: rect.left + o.left, top: rect.top + o.top, width: rect.width, height: rect.height }
    }));
  },
  get selected() { return editor.selectedKey; },
  get editing() { return editor.enabled; },
  get time() { return shownAt; },
  /* Milliseconds the last frame's boxes took, and how many were drawn. */
  get drawMs() { return drawMs; },
  get scale() { return drawnNow.area ? labelScale(drawnNow.area.height) : null; },
  get paused() { return player.engine ? player.engine.paused : null; },
  get boxCount() { return drawnNow.rects.length; }
};

/* A hidden window stops fetching video for nobody. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && player.engine) player.engine.pause();
});

window.addEventListener('resize', redraw);
// Entering or leaving fullscreen moves the picture; redraw once the layout has settled.
document.addEventListener('fullscreenchange', () => requestAnimationFrame(redraw));

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
