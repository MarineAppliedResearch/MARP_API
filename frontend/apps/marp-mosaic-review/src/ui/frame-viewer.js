/** Full-viewport inspection of the native frame behind one Mosaic thumbnail. */
import { state, actions } from '../store.js';
import { MarpBackend } from '../backend.js';
import { fittedWidth, overlayRect } from '../model/frame-viewer.js';
import { $, el } from './dom.js';

let restoreFocus = null;

const percent = (value) => `${value * 100}%`;

function wirePan(viewport) {
  let drag = null;
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  });
  const finish = () => { drag = null; viewport.classList.remove('dragging'); };
  viewport.addEventListener('pointerup', finish);
  viewport.addEventListener('pointercancel', finish);
  viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    actions.setFullFrameZoom(state.frameViewer.zoom + (event.deltaY < 0 ? 0.5 : -0.5));
  }, { passive: false });
}

export function renderFrameViewer() {
  const host = $('#frameViewer');
  if (!state.frameViewer) {
    const wasOpen = !host.hidden;
    host.hidden = true;
    host.innerHTML = '';
    delete host.dataset.focused;
    if (wasOpen && restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
    restoreFocus = null;
    return;
  }
  const row = state.rows.find((item) => item.observation_id === state.frameViewer.id);
  if (!row || row.full_frame_status !== 'ready') { actions.closeFullFrame(); return; }

  const active = document.activeElement;
  if (host.hidden) restoreFocus = active;
  host.hidden = false;
  const zoom = state.frameViewer.zoom;
  const box = overlayRect(row.full_frame_box);
  const previousViewport = host.querySelector('.frame-viewer__viewport');
  const scroll = previousViewport
    ? { left: previousViewport.scrollLeft, top: previousViewport.scrollTop } : null;
  const focusedAction = active && active.closest && active.closest('[data-frame-act]');
  const viewportFocused = active === previousViewport;
  const dialog = el(`<div class="frame-viewer" role="dialog" aria-modal="true"
      aria-label="Full frame for observation ${row.observation_id}">
    <header class="frame-viewer__bar">
      <strong>Observation ${row.observation_id} · full frame</strong>
      <div class="frame-viewer__controls">
        <button type="button" data-frame-act="minus" aria-label="Zoom out">−</button>
        <output>${Math.round(zoom * 100)}%</output>
        <button type="button" data-frame-act="plus" aria-label="Zoom in">+</button>
        <button type="button" data-frame-act="fit">Fit</button>
        <button type="button" data-frame-act="box" aria-pressed="${state.frameViewer.overlay}">
          ${state.frameViewer.overlay ? 'Hide' : 'Show'} box</button>
        <button type="button" data-frame-act="close">Close</button>
      </div>
    </header>
    <div class="frame-viewer__viewport" tabindex="0" aria-label="Frame; drag to pan when zoomed">
      <div class="frame-viewer__image">
        <img src="${MarpBackend.fullFrameUrl(row)}" alt="Complete video frame for observation ${row.observation_id}">
        ${box && state.frameViewer.overlay ? `<span class="frame-viewer__box" style="left:${percent(box.left)};top:${percent(box.top)};width:${percent(box.width)};height:${percent(box.height)}"></span>` : ''}
      </div>
    </div>
  </div>`);
  host.replaceChildren(dialog);
  dialog.querySelector('[data-frame-act="close"]').addEventListener('click', actions.closeFullFrame);
  dialog.querySelector('[data-frame-act="box"]').addEventListener('click', actions.toggleFullFrameBox);
  dialog.querySelector('[data-frame-act="fit"]').addEventListener('click', () => actions.setFullFrameZoom(1));
  dialog.querySelector('[data-frame-act="minus"]').addEventListener('click', () => actions.setFullFrameZoom(zoom - 0.5));
  dialog.querySelector('[data-frame-act="plus"]').addEventListener('click', () => actions.setFullFrameZoom(zoom + 0.5));
  const viewport = dialog.querySelector('.frame-viewer__viewport');
  const image = dialog.querySelector('.frame-viewer__image');
  image.style.width = `${fittedWidth(viewport.clientWidth, viewport.clientHeight,
    row.full_frame_width, row.full_frame_height) * zoom}px`;
  if (scroll) { viewport.scrollLeft = scroll.left; viewport.scrollTop = scroll.top; }
  wirePan(viewport);
  if (focusedAction) {
    dialog.querySelector(`[data-frame-act="${focusedAction.dataset.frameAct}"]`).focus();
  } else if (viewportFocused) {
    viewport.focus();
  } else if (host.dataset.focused !== 'yes') {
    host.dataset.focused = 'yes';
    dialog.querySelector('[data-frame-act="close"]').focus();
  }
}

export function wireFrameViewer() {
  const host = $('#frameViewer');
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); actions.closeFullFrame(); return;
    }
    if (event.key === 'Tab') {
      const controls = [...host.querySelectorAll('button, [tabindex="0"]')];
      if (!controls.length) return;
      const at = controls.indexOf(document.activeElement);
      const next = event.shiftKey ? (at <= 0 ? controls.length - 1 : at - 1)
        : (at === controls.length - 1 ? 0 : at + 1);
      event.preventDefault(); controls[next].focus(); return;
    }
    const viewport = host.querySelector('.frame-viewer__viewport');
    if (document.activeElement === viewport && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const dx = event.key === 'ArrowLeft' ? -80 : event.key === 'ArrowRight' ? 80 : 0;
      const dy = event.key === 'ArrowUp' ? -80 : event.key === 'ArrowDown' ? 80 : 0;
      viewport.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
      return;
    }
    if (event.key === '+' || event.key === '=') actions.setFullFrameZoom(state.frameViewer.zoom + 0.5);
    if (event.key === '-') actions.setFullFrameZoom(state.frameViewer.zoom - 0.5);
  });
  window.addEventListener('resize', renderFrameViewer);
}
