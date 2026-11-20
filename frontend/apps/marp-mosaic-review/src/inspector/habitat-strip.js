/**
 * The video page's habitat timeline (#287, R3-R5): every stretch of the opened observation's
 * habitat session as a bar along the video, in the annotation GUI's lanes and colours.
 *
 * - **Click the strip** to go there; **click a bar** to go to that point in it and select it.
 * - **Each bar shows its review** (R4): faded until reviewed, a green line once reviewed, an
 *   amber one when flagged, with the reason on hover.
 * - **Drag an end** (R5) to change when the stretch starts or ends. The video follows the end
 *   being dragged, so the frame it will land on is on screen; a stretch of the same substrate
 *   the drag reaches is outlined, because letting go merges it in (A4). Escape cancels.
 *
 * The bars are placed in percentages of the video's length, so a resize costs nothing.
 */

import { stripLayout, dragTo, mergesInto, edgeAt } from '../model/habitat-timeline.js';

/* Pixels either side of a bar's end that pick it up: more for a finger than a mouse. */
const GRAB_MOUSE = 6;
const GRAB_TOUCH = 14;
/* A press that moves less than this is a click, not a drag. */
const DRAG_PIXELS = 3;
/* At most one seek this often while dragging, so the player is not asked faster than it decodes. */
const PREVIEW_MS = 120;

/**
 * @param {HTMLElement} root - Where the strip is drawn.
 * @param {Object} host
 * @param {Function} host.duration - The video's length in seconds, or NaN before it is known.
 * @param {Function} host.seek - `(t)`: go to `t` and pause.
 * @param {Function} host.select - `(id)`: select that observation, if the page has it.
 * @param {Function} host.canDrag - Whether this reviewer may change stretches.
 * @param {Function} host.save - `(bar, {start, end})`: write the new span; resolves when done.
 * @returns {Object} `{ set, playhead, selected }`.
 */
export function createHabitatStrip(root, host) {
  let habitat = null;
  let layout = { rows: [], bars: [] };
  let drawnFor = NaN;
  let selectedId = null;
  let drag = null;
  let lastPreview = 0;

  const lanes = document.createElement('div');
  lanes.className = 'hstrip-lanes';
  const playhead = document.createElement('div');
  playhead.className = 'hstrip-playhead';
  const legend = document.createElement('p');
  legend.className = 'hstrip-legend';
  root.append(lanes, legend);

  const duration = () => host.duration();
  const percent = (t) => `${(100 * t) / duration()}%`;

  function place(element, start, end) {
    element.style.left = percent(start);
    // An instant still shows, as the GUI draws its shortest bar.
    element.style.width = `max(3px, ${percent(Math.max(0, end - start))})`;
  }

  function describe(bar) {
    const review = bar.review === 'reviewed' ? 'reviewed'
      : bar.review === 'flagged' ? `flagged${bar.reason ? `: ${bar.reason}` : ''}` : 'not reviewed';
    return `${bar.obsId != null ? `${bar.obsId} · ` : ''}${bar.name} -- ${review}`;
  }

  /* The whole strip, outright: a session holds tens to hundreds of stretches. */
  function render() {
    drawnFor = duration();
    lanes.replaceChildren();
    root.hidden = !habitat;
    if (!habitat || !Number.isFinite(drawnFor) || drawnFor <= 0) return;
    lanes.style.setProperty('--rows', layout.rows.length);
    for (let row = 0; row < layout.rows.length; row += 2) {
      const stripe = document.createElement('div');
      stripe.className = 'hstrip-stripe';
      stripe.style.setProperty('--row', row);
      lanes.append(stripe);
    }
    for (const bar of layout.bars) {
      if (bar.row < 0) continue;
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
    legend.textContent = `${habitat.stretches.length} stretches in this session · faded: not reviewed · `
      + 'green line: reviewed · amber line: flagged'
      + (host.canDrag() ? ' · drag a bar\'s end to change its times' : '');
  }

  function timeAt(clientX) {
    const rect = lanes.getBoundingClientRect();
    return (Math.min(Math.max(clientX - rect.left, 0), rect.width) / rect.width) * duration();
  }

  function barElement(id) {
    return lanes.querySelector(`.hstrip-bar[data-id="${id}"]`);
  }

  function preview(t) {
    const now = performance.now();
    if (now - lastPreview < PREVIEW_MS) return;
    lastPreview = now;
    host.seek(t);
  }

  function showDrag() {
    const element = barElement(drag.bar.id);
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
    lanes.classList.remove('dragging');
  }

  lanes.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !Number.isFinite(duration())) return;
    const element = event.target.closest('.hstrip-bar');
    const bar = element ? layout.bars.find((b) => b.id === Number(element.dataset.id)) : null;
    const grab = event.pointerType === 'touch' ? GRAB_TOUCH : GRAB_MOUSE;
    const edge = bar && bar.draggable && host.canDrag() ? edgeAt(element.getBoundingClientRect(), event.clientX, grab) : null;
    drag = { pointer: event.pointerId, x: event.clientX, bar, edge, span: bar ? { start: bar.start, end: bar.end } : null, moved: false };
    lanes.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  lanes.addEventListener('pointermove', (event) => {
    if (!drag) {
      // What a press would do here: a resize arrow over a draggable end.
      const element = event.target.closest('.hstrip-bar');
      const bar = element ? layout.bars.find((b) => b.id === Number(element.dataset.id)) : null;
      const onEdge = bar && bar.draggable && host.canDrag()
        && edgeAt(element.getBoundingClientRect(), event.clientX, event.pointerType === 'touch' ? GRAB_TOUCH : GRAB_MOUSE);
      lanes.classList.toggle('over-edge', Boolean(onEdge));
      return;
    }
    if (!drag.moved && Math.abs(event.clientX - drag.x) < DRAG_PIXELS) return;
    drag.moved = true;
    const t = timeAt(event.clientX);
    if (!drag.edge) {
      // Pressed on the strip, not an end: scrub.
      preview(t);
      return;
    }
    lanes.classList.add('dragging');
    drag.span = dragTo(drag.bar, drag.edge, t, duration());
    showDrag();
    preview(drag.edge === 'start' ? drag.span.start : drag.span.end);
  });

  lanes.addEventListener('pointerup', async (event) => {
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
    if (!edge) {
      host.seek(t);
      return;
    }
    host.seek(edge === 'start' ? span.start : span.end);
    if (span.start === bar.start && span.end === bar.end) return;
    try {
      await host.save(bar, span, merging);
    } catch {
      // The host has said why; the bar goes back to where the record has it.
    }
    render();
  });

  lanes.addEventListener('pointercancel', () => {
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
      render();
    },
    /** Every frame: move the playhead, and draw the bars once the video's length is known. */
    playhead(t) {
      if (!habitat) return;
      if (duration() !== drawnFor) render();
      if (Number.isFinite(t) && Number.isFinite(drawnFor) && drawnFor > 0) playhead.style.left = percent(t);
    },
    /** The page's selection changed: outline that stretch, if it is one. */
    selected(id) {
      if (id === selectedId) return;
      selectedId = id;
      if (!drag) render();
    }
  };
}
