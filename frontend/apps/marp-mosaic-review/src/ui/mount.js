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
import { renderConfirm, wireConfirm } from './confirm.js';
import { resolveKey } from '../model/keys.js';
import { renderChrome, renderLog } from './chrome.js';
import {
  closeMenus, isMenuOpen, speciesMenu, projectMenu, diveMenu, lineMenu,
  modelMenu, sortMenu, userMenu
} from './menus.js';

export { computeLayout };

/**
 * The buttons a page state offers. Delegated from the grid, because the grid is rewritten
 * on every render and a listener bound to the button itself would not survive it.
 */
function wirePageStates() {
  $('#grid').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'clear-filters') { e.stopPropagation(); actions.clearFilters(); }
    if (act.dataset.act === 'retry-thumbnails') { e.stopPropagation(); actions.retryFailedThumbnails(); }
  });
}

function wireGrid() {
  $('#grid').addEventListener('click', (e) => {
    /* The badge opens the panel; the tile itself marks. Marking must stay a single
       uninterrupted gesture, so opening the panel is a separate target. */
    const badge = e.target.closest('[data-badge]');
    if (badge) { e.stopPropagation(); actions.openPicker(Number(badge.dataset.badge)); return; }

    const chip = e.target.closest('[data-changed]');
    if (chip) { e.stopPropagation(); actions.openCorrection(Number(chip.dataset.changed)); return; }

    const tileEl = e.target.closest('.tile');
    if (!tileEl) return;

    /* While the panel is open, the first click anywhere only dismisses it. Acting
       as well would silently undo the mark the panel belongs to — which is exactly
       what happened: clicking away after choosing a reason unmarked the tile, and
       nothing was excluded by the time the page was committed. */
    if (state.picker) { actions.closePicker(); return; }

    /* No stopPropagation: the document handler still needs to close open menus. */
    actions.toggleMark(Number(tileEl.dataset.id));
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
  anchor('#selDiveBtn', diveMenu);
  anchor('#selLineBtn', lineMenu);
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
    if (e.key === 'Escape') { actions.closePicker(); closeMenus(); return; }

    /* One listener, consulting one rule. The Escape handling above shows how quickly
       scattered key handling spreads; `model/keys.js` owns what a key means so the
       awkward cases -- typing in the species search, a dialog holding the keyboard --
       are answered in one place and testable without a browser. */
    const target = e.target || {};
    const action = resolveKey(e, {
      tagName: target.tagName,
      isEditable: Boolean(target.isContentEditable),
      modalOpen: Boolean(state.confirm),
    });
    if (!action) return;

    e.preventDefault();
    runShortcut(action);
  });
}

/**
 * What each shortcut does.
 *
 * Kept beside the listener rather than in the model: the model decides *what a key
 * means*, which is a rule; this decides what to do about it, which is wiring.
 */
function runShortcut(action) {
  switch (action) {
    case 'nextPage': return actions.goToPage(state.page + 1);
    case 'prevPage': return actions.goToPage(state.page - 1);
    case 'clearMarks': return actions.clearMarks();
    case 'modeScientific': return actions.setMode('scientific');
    case 'modeTraining': return actions.setMode('training');
    case 'modeDelete': return actions.setMode('delete');
    case 'commitPage': {
      const commit = $('#commit');
      /* A shortcut that appears to do nothing reads as broken and gets pressed again.
         The disabled button already carries the reason, so point at it rather than
         inventing a second place for the same message. */
      if (commit && commit.disabled) {
        commit.classList.remove('nudge');
        void commit.offsetWidth;                 // restart the animation
        commit.classList.add('nudge');
        return;
      }
      return actions.commitPage();
    }
    default: return undefined;
  }
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
  wirePageStates();
  wirePager();
  wireMenus();
  wireConfirm();
  wireDismissal();
  wireLayout();

  /* Re-measure after every render: a single measurement is unreliable because the
     field settles after layout, and setPageSize no-ops when nothing changed, so this
     converges in one extra pass rather than looping. */
  subscribe(() => {
    renderChrome();
    renderGrid();
    renderPicker();
    renderConfirm();
    requestAnimationFrame(computeLayout);
  });
  onLog(renderLog);
}
