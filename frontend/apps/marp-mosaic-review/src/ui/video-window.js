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

/* The window's name and the channel's, one for both so they cannot drift. */
export const VIDEO_WINDOW = 'marp-mosaic-video';

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
export function followQueryInVideoWindow(filters) {
  if (toldQuery === null) return;
  const text = JSON.stringify(filters || {});
  if (text === toldQuery) return;
  toldQuery = text;
  const open = videoChannel();
  if (open) open.postMessage({ type: 'query', filters: filters || {} });
}
