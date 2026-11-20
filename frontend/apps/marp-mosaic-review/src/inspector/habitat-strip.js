/**
 * The video page's habitat timeline (#287, R3-R7): every stretch of the opened observation's
 * habitat session as a bar along the video, in the annotation GUI's lanes and colours.
 *
 * - **Click the strip** to go there; **click a bar** to go to that point in it and select it.
 * - **Each bar shows its review** (R4): an outline until it is reviewed, solid once it is,
 *   solid and striped amber when flagged, with the reason on hover. The review used to be a
 *   fade and a thin line, which could not be told apart at a glance (Isaac, 2026-11-20).
 * - **Drag an end** (R5) to change when the stretch starts or ends. The video follows the end
 *   being dragged, so the frame it will land on is on screen; a stretch of the same substrate
 *   the drag reaches is outlined, because letting go merges it in (A4). Escape cancels.
 * - **Zoom** (R6): the wheel zooms around the pointer, a pinch on a touch screen; dragging an
 *   empty part pans; a double click on an empty part shows the whole video. Zoomed in, a thin
 *   track above the lanes shows which part of the video is on screen.
 * - **Zoomed in, it follows the playhead** (R7) while the video plays.
 *
 * Bars are placed in percentages of the part of the video on screen, so a resize costs nothing.
 */

import {
  stripLayout, dragTo, mergesInto, edgeAt, wholeView, zoomView, panView, followView, isWhole
} from '../model/habitat-timeline.js';

/* Pixels either side of a bar's end that pick it up: more for a finger than a mouse. */
const GRAB_MOUSE = 6;
const GRAB_TOUCH = 14;
/* A press that moves less than this is a click, not a drag. */
const DRAG_PIXELS = 3;
/* At most one seek this often while dragging, so the player is not asked faster than it decodes. */
const PREVIEW_MS = 120;
/* How far one notch of the wheel zooms: about a fifth. */
const WHEEL_ZOOM = 0.0015;

/**
 * @param {HTMLElement} root - Where the strip is drawn.
 * @param {Object} host
 * @param {Function} host.duration - The video's length in seconds, or NaN before it is known.
 * @param {Function} host.playing - Whether the video is playing, which is when the strip follows it.
 * @param {Function} host.seek - `(t)`: go to `t` and pause.
 * @param {Function} host.select - `(id)`: select that observation, if the page has it.
 * @param {Function} host.canDrag - Whether this reviewer may change stretches.
 * @param {Function} host.save - `(bar, {start, end}, merging)`: write the new span; resolves when done.
 * @returns {Object} `{ set, playhead, review, selected }`.
 */
export function createHabitatStrip(root, host) {
  let habitat = null;
  let layout = { rows: [], bars: [] };
  let drawnFor = NaN;
  let view = null;
  let selectedId = null;
  let playheadAt = NaN;
  let drag = null;
  let lastPreview = 0;
  // Every pointer down on the strip, for a pinch.
  const pointers = new Map();
  let pinch = null;

  const overview = document.createElement('div');
  overview.className = 'hstrip-overview';
  const shown = document.createElement('div');
  shown.className = 'hstrip-window';
  overview.append(shown);
  const lanes = document.createElement('div');
  lanes.className = 'hstrip-lanes';
  const playhead = document.createElement('div');
  playhead.className = 'hstrip-playhead';
  root.append(overview, lanes);

  const duration = () => host.duration();
  const at = (t) => (100 * (t - view.from)) / (view.to - view.from);

  function place(element, start, end) {
    element.style.left = `${at(start)}%`;
    // An instant still shows, as the GUI draws its shortest bar.
    element.style.width = `max(3px, ${at(end) - at(start)}%)`;
  }

  function describe(bar) {
    const review = bar.review === 'reviewed' ? 'reviewed'
      : bar.review === 'flagged' ? `flagged${bar.reason ? `: ${bar.reason}` : ''}` : 'not reviewed';
    return `${bar.obsId != null ? `${bar.obsId} · ` : ''}${bar.name} -- ${review}`;
  }

  function placePlayhead() {
    const visible = Number.isFinite(playheadAt) && view && playheadAt >= view.from && playheadAt <= view.to;
    playhead.hidden = !visible;
    if (visible) playhead.style.left = `${at(playheadAt)}%`;
  }

  /* The whole strip, outright: a session holds tens to hundreds of stretches. */
  function render() {
    const length = duration();
    // A different video, or its length learned: start from the whole of it.
    if (length !== drawnFor) view = Number.isFinite(length) && length > 0 ? wholeView(length) : null;
    drawnFor = length;
    lanes.replaceChildren();
    // Nothing on screen until there are bars to draw: no empty band while the video loads.
    root.hidden = !habitat || !view;
    if (root.hidden) return;

    overview.hidden = isWhole(view, length);
    shown.style.left = `${(100 * view.from) / length}%`;
    shown.style.width = `${(100 * (view.to - view.from)) / length}%`;

    lanes.style.setProperty('--rows', layout.rows.length);
    for (let row = 0; row < layout.rows.length; row += 2) {
      const stripe = document.createElement('div');
      stripe.className = 'hstrip-stripe';
      stripe.style.setProperty('--row', row);
      lanes.append(stripe);
    }
    for (const bar of layout.bars) {
      if (bar.row < 0 || bar.end < view.from || bar.start > view.to) continue;
      const element = document.createElement('div');
      element.className = `hstrip-bar ${bar.review}${bar.id === selectedId ? ' selected' : ''}`;
      element.dataset.id = bar.id;
      element.style.setProperty('--row', bar.row);
      element.style.setProperty('--colour', bar.colour);
      element.title = describe(bar);
      place(element, bar.start, bar.end);
      lanes.append(element);
    }
    lanes.append(playhead);
    placePlayhead();
  }

  function timeAt(clientX) {
    const rect = lanes.getBoundingClientRect();
    const along = Math.min(Math.max(clientX - rect.left, 0), rect.width) / rect.width;
    return view.from + along * (view.to - view.from);
  }

  function setView(next) {
    if (next.from === view.from && next.to === view.to) return;
    view = next;
    render();
    // A drag in progress keeps its bar where the pointer has it.
    if (drag && drag.edge) showDrag();
  }

  function barAt(target) {
    const element = target.closest('.hstrip-bar');
    return element ? { element, bar: layout.bars.find((b) => b.id === Number(element.dataset.id)) } : { element: null, bar: null };
  }

  function grabOf(event) {
    return event.pointerType === 'touch' ? GRAB_TOUCH : GRAB_MOUSE;
  }

  function preview(t) {
    const now = performance.now();
    if (now - lastPreview < PREVIEW_MS) return;
    lastPreview = now;
    host.seek(t);
  }

  function showDrag() {
    const element = lanes.querySelector(`.hstrip-bar[data-id="${drag.bar.id}"]`);
    if (element) place(element, drag.span.start, drag.span.end);
    const merging = new Set(mergesInto(layout.bars, drag.bar, drag.span));
    for (const other of lanes.querySelectorAll('.hstrip-bar')) {
      other.classList.toggle('merging', merging.has(Number(other.dataset.id)));
    }
    drag.merging = merging.size;
  }

  function endDrag() {
    if (drag && lanes.hasPointerCapture(drag.pointer)) lanes.releasePointerCapture(drag.pointer);
    drag = null;
    lanes.classList.remove('dragging', 'panning');
  }

  /* -------------------------------------------------------------- zooming (R6) */

  lanes.addEventListener('wheel', (event) => {
    if (!view) return;
    event.preventDefault();
    const length = duration();
    // A trackpad's sideways swipe pans; the wheel, or an up-and-down swipe, zooms.
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const rect = lanes.getBoundingClientRect();
      setView(panView(view, length, (event.deltaX / rect.width) * (view.to - view.from)));
      return;
    }
    setView(zoomView(view, length, timeAt(event.clientX), Math.exp(event.deltaY * WHEEL_ZOOM)));
  }, { passive: false });

  lanes.addEventListener('dblclick', (event) => {
    if (!view || barAt(event.target).bar) return;
    setView(wholeView(duration()));
  });

  function pinchSpread() {
    const [a, b] = [...pointers.values()];
    return { width: Math.abs(a.x - b.x), middle: (a.x + b.x) / 2 };
  }

  /* -------------------------------------------------------------- pressing */

  lanes.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !view) return;
    pointers.set(event.pointerId, { x: event.clientX });
    lanes.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (pointers.size === 2) {
      // A second finger: a pinch, and whatever the first one started is let go.
      if (drag) render();
      drag = null;
      // The moment between the fingers is what stays between them.
      const spread = pinchSpread();
      pinch = { ...spread, view, anchor: timeAt(spread.middle) };
      return;
    }
    const { element, bar } = barAt(event.target);
    const edge = bar && bar.draggable && host.canDrag() ? edgeAt(element.getBoundingClientRect(), event.clientX, grabOf(event)) : null;
    drag = {
      pointer: event.pointerId, x: event.clientX, bar, edge, view,
      span: bar ? { start: bar.start, end: bar.end } : null, moved: false
    };
  });

  lanes.addEventListener('pointermove', (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX });
    if (pinch && pointers.size === 2) {
      const now = pinchSpread();
      if (now.width > 0 && pinch.width > 0) {
        setView(zoomView(pinch.view, duration(), pinch.anchor, pinch.width / now.width));
      }
      return;
    }
    if (!drag) {
      // What a press would do here: a resize arrow over a draggable end.
      const { element, bar } = barAt(event.target);
      const onEdge = bar && bar.draggable && host.canDrag() && edgeAt(element.getBoundingClientRect(), event.clientX, grabOf(event));
      lanes.classList.toggle('over-edge', Boolean(onEdge));
      return;
    }
    if (!drag.moved && Math.abs(event.clientX - drag.x) < DRAG_PIXELS) return;
    drag.moved = true;
    if (!drag.edge) {
      // Pressed on the strip, not an end: pan, the strip moving with the pointer.
      lanes.classList.add('panning');
      const rect = lanes.getBoundingClientRect();
      const seconds = ((drag.x - event.clientX) / rect.width) * (drag.view.to - drag.view.from);
      setView(panView(drag.view, duration(), seconds));
      return;
    }
    lanes.classList.add('dragging');
    drag.span = dragTo(drag.bar, drag.edge, timeAt(event.clientX), duration());
    showDrag();
    preview(drag.edge === 'start' ? drag.span.start : drag.span.end);
  });

  async function release(event) {
    pointers.delete(event.pointerId);
    if (pinch) {
      if (pointers.size === 0) pinch = null;
      return;
    }
    if (!drag) return;
    const { bar, edge, span, moved, merging } = drag;
    const t = timeAt(event.clientX);
    endDrag();
    if (!moved) {
      // A click: there, and the stretch under it selected.
      host.seek(t);
      if (bar) {
        selectedId = bar.id;
        host.select(bar.id);
        render();
      }
      return;
    }
    // A pan has already done what it does.
    if (!edge) return;
    host.seek(edge === 'start' ? span.start : span.end);
    if (span.start === bar.start && span.end === bar.end) return;
    try {
      await host.save(bar, span, merging);
    } catch {
      // The host has said why; the bar goes back to where the record has it.
    }
    render();
  }

  lanes.addEventListener('pointerup', release);
  lanes.addEventListener('pointercancel', (event) => {
    pointers.delete(event.pointerId);
    pinch = null;
    endDrag();
    render();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !drag) return;
    // Only the drag is cancelled, not the selection behind it.
    event.stopPropagation();
    endDrag();
    render();
  }, true);

  return {
    /** The video read's `habitat`, or null when the opened observation is not in one. */
    set(next) {
      habitat = next || null;
      layout = stripLayout(habitat ? habitat.stretches : []);
      // The zoom is kept: a drag saved and read again must not throw the reviewer back out.
      render();
    },
    /** Every frame: move the playhead, and draw the bars once the video's length is known. */
    playhead(t) {
      if (!habitat) return;
      playheadAt = t;
      if (duration() !== drawnFor) render();
      if (!view) return;
      // Zoomed in and playing: page along with it (R7). Not while paused, or a pan away
      // to look at something would be undone by the next redraw.
      if (host.playing() && !drag && Number.isFinite(t)) {
        const next = followView(view, duration(), t);
        if (next !== view) {
          view = next;
          render();
          return;
        }
      }
      placePlayhead();
    },
    /** A review made on this page (R4): the bar shows it at once. */
    review(id, decision, reason) {
      const stretch = habitat && habitat.stretches.find((s) => s.observation_id === id);
      if (!stretch) return;
      stretch.review_decision = decision;
      stretch.flag_reason = reason;
      layout = stripLayout(habitat.stretches);
      if (!drag) render();
    },
    /** The page's selection changed: outline that stretch, if it is one. */
    selected(id) {
      if (id === selectedId) return;
      selectedId = id;
      if (!drag) render();
    }
  };
}
