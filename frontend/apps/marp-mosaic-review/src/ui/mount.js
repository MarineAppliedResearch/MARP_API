/**
 * Wiring. The only place that attaches event listeners.
 *
 * Every listener calls a named action — nothing here changes state directly, and
 * nothing here decides what a gesture means. That lives in `model/`.
 */
import { state, actions, subscribe, onLog } from '../store.js';
import { $ } from './dom.js';
import { renderGrid, computeLayout } from './grid.js';
import { renderPicker } from './picker.js';
import { renderChrome, renderLog } from './chrome.js';
import {
  closeMenus, isMenuOpen, speciesMenu, projectMenu, modelMenu, sortMenu, userMenu
} from './menus.js';

export { computeLayout };

function wireGrid() {
  $('#grid').addEventListener('click', (e) => {
    /* The badge opens the panel; the tile itself marks. Marking must stay a single
       uninterrupted gesture, so opening the panel is a separate target. */
    const badge = e.target.closest('[data-badge]');
    if (badge) { e.stopPropagation(); actions.openPicker(Number(badge.dataset.badge)); return; }

    const chip = e.target.closest('[data-changed]');
    if (chip) { e.stopPropagation(); actions.openCorrection(Number(chip.dataset.changed)); return; }

    const tileEl = e.target.closest('.tile');
    /* No stopPropagation: the document handler still needs to close an open panel. */
    if (tileEl) actions.toggleMark(Number(tileEl.dataset.id));
  });
}

function wirePager() {
  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    const v = b.dataset.page;
    actions.goToPage(v === 'prev' ? state.page - 1
      : v === 'next' ? state.page + 1
      : Number(v));
  });
  $('#pager').addEventListener('change', (e) => {
    if (e.target.id === 'pageInput') actions.goToPage(Number(e.target.value));
  });
}

function wireMenus() {
  const anchor = (id, open) => $(id).addEventListener('click', (e) => {
    e.stopPropagation();
    if (isMenuOpen()) { closeMenus(); return; }     // a second click closes it
    open(e.currentTarget);
  });
  anchor('#selSpeciesBtn', speciesMenu);
  anchor('#selProjectBtn', projectMenu);
  anchor('#selModelBtn', modelMenu);
  anchor('#sortBtn', sortMenu);
  anchor('#userBtn', userMenu);
}

function wireDismissal() {
  /* Clicking anywhere outside dismisses the panel and any open menu. */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pick')) actions.closePicker();
    if (!e.target.closest('.menu')) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { actions.closePicker(); closeMenus(); }
  });
}

function wireLayout() {
  /* The field's real size is the only reliable input, and it changes on window
     resize and on rail collapse alike — so observe it rather than guessing when
     layout has settled. */
  let timer;
  const ro = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(computeLayout, 90);
  });
  ro.observe($('#field'));
}

export function mount() {
  document.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => actions.setMode(b.dataset.mode)));

  $('#railbtn').addEventListener('click', () => actions.toggleRail());
  $('#markAll').addEventListener('click', () => actions.markAllOnPage());
  $('#clearMarks').addEventListener('click', () => actions.clearMarks());
  $('#commit').addEventListener('click', () => actions.commitPage());

  $('#logbtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const log = $('#log');
    log.hidden = !log.hidden;
    $('#logbtn').textContent = log.hidden ? 'Action log' : 'Hide log';
  });

  wireGrid();
  wirePager();
  wireMenus();
  wireDismissal();
  wireLayout();

  /* Re-measure after every render: a single measurement is unreliable because the
     field settles after layout, and setPageSize no-ops when nothing changed, so this
     converges in one extra pass rather than looping. */
  subscribe(() => {
    renderChrome();
    renderGrid();
    renderPicker();
    requestAnimationFrame(computeLayout);
  });
  onLog(renderLog);
}
