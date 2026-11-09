/**
 * Opens the source-video inspector in its own window, and keeps reusing it (#181).
 *
 * **One named window, never reloaded.** `window.open(url, name)` on a window that is
 * already open navigates it, which throws away the loaded player -- the cold start the
 * inspector exists to avoid. So the window is looked up by name without a url first: a
 * fresh one comes back blank and is sent to the page with the request in its hash, and
 * one that is already showing the inspector is told the next observation over a
 * `BroadcastChannel` and brought forward.
 */

import { state, actions } from '../store.js';
import { queryFilters } from '../model/filters.js';
import { $ } from './dom.js';

/* The window's name and the channel's, one for both so they cannot drift. */
import { VIDEO_WINDOW } from '../model/video-review.js';
export { VIDEO_WINDOW };

/* The page, beside the Mosaic's own. */
const PAGE = 'inspect.html';

let channel = null;

/* The query the window was last told, so an unchanged one is not sent again. */
let toldQuery = null;

/* The channel the inspector listens on, opened once. */
function videoChannel() {
  if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(VIDEO_WINDOW);
  return channel;
}

/**
 * Show one observation in the video page, with every other observation in its video that
 * the Mosaic's query matches. `filters` is that query, as the grid's own page request
 * sends it.
 */
export function openVideoWindow(observationId, filters) {
  const request = { type: 'show', observationId, filters: filters || {} };
  toldQuery = JSON.stringify(request.filters);
  const existing = window.open('', VIDEO_WINDOW);

  if (!existing) return false;

  let showingInspector = false;
  try {
    showingInspector = existing.location.pathname.endsWith(`/${PAGE}`);
  } catch {
    showingInspector = false;
  }

  if (showingInspector) {
    const open = videoChannel();
    if (open) open.postMessage(request);
    existing.focus();
    return true;
  }

  const url = new URL(PAGE, window.location.href);
  url.hash = encodeURIComponent(JSON.stringify(request));
  existing.location.href = url.toString();
  existing.focus();
  return true;
}

/**
 * Tell an open video page the Mosaic's query has changed, so its boxes follow it (R9). Only
 * once a page has been opened this session, and only when the query is not the one it has.
 */
/**
 * Call `handler` with each scientific review the video page records (#337), so the tile
 * that observation belongs to can show it without a reload.
 *
 * @param {Function} handler - `({observationId, decision, reason})`.
 */
/**
 * Open the video for one observation with the Mosaic's current query, and **say so when the
 * browser refuses** (#341). `window.open` returns nothing when a pop-up is blocked, and this
 * used to be ignored, so the click did nothing at all.
 *
 * @param {number} id - The observation.
 */
export function showInVideoWindow(id) {
  const filters = queryFilters(state.mode, state.filters);
  if (openVideoWindow(id, filters)) {
    if (state.videoBlocked) actions.dismissVideoBlocked();
    actions.openVideo(id);
    return;
  }
  const url = new URL(PAGE, window.location.href);
  url.hash = encodeURIComponent(JSON.stringify({ type: 'show', observationId: id, filters }));
  actions.videoBlocked(id, url.toString());
}

/** The bar that says the video window was refused, and opens it as a link instead. */
export function renderVideoBlocked() {
  const host = $('#videoBlocked');
  if (!host) return;
  const blocked = state.videoBlocked;
  host.hidden = !blocked;
  if (!blocked) {
    host.innerHTML = '';
    return;
  }
  /* A link the reviewer clicks is opened where a script's window was refused, and naming
     the same window means the next observation is sent to it like any other. */
  host.innerHTML = `<span>Your browser blocked the video window.</span>
    <a href="${blocked.address}" target="${VIDEO_WINDOW}" data-video-link>Open the video</a>
    <span class="muted">or allow pop-ups for this site.</span>
    <button type="button" data-act="dismiss-video-blocked" aria-label="Dismiss">×</button>`;
}

export function onVideoWindowReview(handler) {
  const open = videoChannel();
  if (!open) return;
  open.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'reviewed' && Number.isInteger(message.observationId)) handler(message);
  });
}

export function followQueryInVideoWindow(filters) {
  if (toldQuery === null) return;
  const text = JSON.stringify(filters || {});
  if (text === toldQuery) return;
  toldQuery = text;
  const open = videoChannel();
  if (open) open.postMessage({ type: 'query', filters: filters || {} });
}
