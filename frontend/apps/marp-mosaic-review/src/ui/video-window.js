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

/* The channel the inspector listens on, opened once. */
function videoChannel() {
  if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(VIDEO_WINDOW);
  return channel;
}

/**
 * Show one observation in the inspector, with the rest of its page for context.
 * `pageIds` are the observations on the current page, whose boxes are drawn too.
 */
export function openVideoWindow(observationId, pageIds) {
  const request = { type: 'show', observationId, pageIds: [...new Set(pageIds || [])] };
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
