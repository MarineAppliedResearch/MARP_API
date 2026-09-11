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
import { renderRail, wireRail } from './rail.js';
import { resolveKey } from '../model/keys.js';
import { renderChrome, renderLog } from './chrome.js';
import { renderFailure, wireFailure } from './failure.js';
import {
  closeMenus, isMenuOpenFor,
  sortMenu, userMenu
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
    /* Offered after a version conflict: the annotation moved underneath the page and
       nothing was written, so re-reading is the way forward (R9). */
    if (act.dataset.act === 'reread') { e.stopPropagation(); actions.rereadAfterConflict(); }
  });
}

/**
 * How long after a tap a second one is still the same gesture (#126 A1).
 *
 * The human's call was *"A1 might be a double tap, and if it can't be a double tap, then a
 * long tap will be okay for now"*, so double tap is what this is. Three hundred and twenty
 * milliseconds is the usual double-click threshold and it is the number to move if the
 * gesture feels wrong: shorter and a deliberate double tap misses, longer and two separate
 * marks on the same tile start merging into one.
 */
const DOUBLE_TAP_MS = 320;

/** The last tap, so the next one can tell whether it is the second half of a double. */
let lastTap = { id: null, at: 0 };

/**
 * What kind of pointer is driving, read at `pointerdown`.
 *
 * **Not from the click event.** A `click` is a `PointerEvent` in Chromium and a plain
 * `MouseEvent` elsewhere, so `e.pointerType` on a click is present in one browser and
 * undefined in another -- and an undefined there would make every fast double click on a
 * desktop mouse read as a touch double tap, which would take the right-click gesture's job
 * away from it. `pointerdown` carries it everywhere.
 */
let lastPointerType = 'mouse';

function wireGrid() {
  $('#grid').addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType || 'mouse';
  });

  /**
   * The accept gesture on a pointer: **right click** (#126 R2).
   *
   * `preventDefault` so the browser's own menu does not come up over the mosaic, and it is
   * called for any click inside the grid rather than only on a tile -- a context menu
   * appearing on the gap between tiles while the gesture means something else on the tiles
   * themselves is worse than not having one at all.
   */
  $('#grid').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const tileEl = e.target.closest('.tile');
    if (!tileEl) return;
    if (state.picker) { actions.closePicker(); return; }
    actions.acceptMark(Number(tileEl.dataset.id));
  });

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

    const id = Number(tileEl.dataset.id);

    /**
     * The accept gesture on a touch screen: **double tap** (#126 A1).
     *
     * The first tap is **not** deferred, and that is the whole design. Waiting out the
     * window before acting would put a third of a second between every mark and the tile
     * changing, on the gesture a reviewer repeats hundreds of times a page -- which is the
     * badly tuned timing window A1 warned about. So the first tap marks the exception at
     * once and a second tap inside the window turns it into an acceptance.
     *
     * The cost is named rather than hidden: on touch, un-marking a tile you have just
     * marked means waiting out the window first. Marking and immediately un-marking the
     * same tile is rare; accepting is the gesture the human said they would use most.
     *
     * Touch only. A desktop has right click, and a fast double click there must keep
     * meaning two clicks.
     */
    if (lastPointerType === 'touch') {
      const now = Date.now();
      if (lastTap.id === id && now - lastTap.at < DOUBLE_TAP_MS) {
        lastTap = { id: null, at: 0 };
        actions.acceptMark(id);
        return;
      }
      lastTap = { id, at: now };
    }

    /* No stopPropagation: the document handler still needs to close open menus. */
    actions.toggleMark(id);
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
  /* Null-safe: one missing control used to throw here during wiring, which aborted the
     rest of mount() and left the whole application blank. A missing button should cost
     that button, not the app. */
  const anchor = (id, open) => $(id)?.addEventListener('click', (e) => {
    e.stopPropagation();
    /* A second click on *this* control closes its menu. It used to close whichever menu
       was open and stop there, so clicking the sort button while the species list was up
       did nothing visible either -- the other half of #81 B2. */
    if (isMenuOpenFor(e.currentTarget)) { closeMenus(); return; }
    open(e.currentTarget);
  });
  /* The dimension buttons are drawn by ui/rail.js and wired there, because they do not
     exist until it has run. Only the fixed controls are anchored here. */
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

  $('#railReset').addEventListener('click', () => actions.clearFilters());
  $('#railbtn').addEventListener('click', () => actions.toggleRail());
  $('#markAll').addEventListener('click', () => actions.markAllOnPage());
  $('#clearMarks').addEventListener('click', () => actions.clearMarks());
  /* The main button (#126 R3, R5): only what was marked, each tile by its own kind. */
  $('#commitMarked').addEventListener('click', () => actions.commitMarked());
  $('#commit').addEventListener('click', () => actions.commitPage());

  $('#logbtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const log = $('#log');
    log.hidden = !log.hidden;
    $('#logbtn').textContent = log.hidden ? 'Action log' : 'Hide log';
  });

  wireGrid();
  wireFailure();
  wirePageStates();
  wirePager();
  wireMenus();
  wireConfirm();
  wireRail();
  wireDismissal();
  wireLayout();

  /* Re-measure after every render: a single measurement is unreliable because the
     field settles after layout, and setPageSize no-ops when nothing changed, so this
     converges in one extra pass rather than looping. */
  subscribe(() => {
    renderChrome();
    renderFailure();
    renderGrid();
    renderPicker();
    renderConfirm();
    renderRail();
    requestAnimationFrame(computeLayout);
  });
  onLog(renderLog);
}
