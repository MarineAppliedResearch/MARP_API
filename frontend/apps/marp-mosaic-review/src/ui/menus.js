/**
 * Dropdown menus.
 *
 * **Appended to the body and positioned against the viewport, never drawn inside the
 * control that opened them.** Two reasons, and the second one is newer than the first:
 * `.rail` is `overflow: hidden`, which clipped menus at its edge; and since #81 L7 the
 * rail body scrolls, so a menu that lived inside it would scroll away with the filters
 * while the reviewer was reading it.
 *
 * Filter lists can get long — projects and taxonomy especially — so they filter as you
 * type, and a menu that stays open after a pick restates every entry rather than the one
 * that was clicked.
 */
import { state, actions } from '../store.js';
import { MarpData } from '../data.js';
import { SORT_FIELDS, SORT_DIRS, sortField, sortArrow } from '../model/filters.js';
import { DIMENSION } from '../model/dimensions.js';
import { el, ICON, ME } from './dom.js';

let openMenuEl = null;
let openAnchorKey = null;

/**
 * Which control a menu belongs to, by name rather than by node.
 *
 * The rail is redrawn from state on every change, so the button that opened a menu is
 * routinely replaced by an identical one while the menu is still up. Holding the element
 * would make the second click on that button read as a click on a different control.
 */
const anchorKey = (el) =>
  (el && (el.dataset.dim || el.dataset.span || el.id)) || null;

export const isMenuOpen = () => Boolean(openMenuEl);

/** Is the open menu this control's own? A second click on it closes it — #81 B2. */
export const isMenuOpenFor = (anchor) =>
  Boolean(openMenuEl) && anchorKey(anchor) != null && anchorKey(anchor) === openAnchorKey;

export function closeMenus() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; openAnchorKey = null; }
}

/* The direction phrases read as part of a sentence in the model ("longest first") and as
   a label of their own in the menu, so the capital belongs here rather than there. */
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function itemMarkup(items, filter) {
  const f = (filter || '').trim().toLowerCase();
  const shown = items.filter((i) => {
    if (i.head || i.hr) return !f;                   // headings only when unfiltered
    return !f || String(i.label).toLowerCase().includes(f);
  });
  if (!shown.some((i) => !i.head && !i.hr)) return '<div class="mhead">No matches</div>';
  return shown.map((i) => {
    if (i.head) return `<div class="mhead">${i.head}</div>`;
    if (i.hr) return '<hr>';
    return `<button data-v="${i.value}" class="${i.on ? 'on' : ''}">
      <span class="tick">${i.on ? ICON.tick : ''}</span>${i.label}</button>`;
  }).join('');
}

function place(menuEl, anchor, align) {
  const a = anchor.getBoundingClientRect();
  menuEl.style.position = 'fixed';
  menuEl.style.minWidth = Math.max(190, a.width) + 'px';
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight, EDGE = 8;
  let left = align === 'right' ? a.right - w : a.left;
  left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE);
  const below = a.bottom + 6;
  menuEl.style.left = left + 'px';
  menuEl.style.top = (below + h <= window.innerHeight - EDGE
    ? below : Math.max(EDGE, a.top - h - 6)) + 'px';
}

/**
 * `rebuild` returns a fresh item list, and is what makes a menu that stays open honest.
 * See the note on the redraw below — without it, only the clicked entry restates itself.
 */
export function menu(anchor, items, { align = 'left', search = false, rebuild = null } = {}) {
  closeMenus();
  let list = items;
  const picks = () => list.filter((i) => !i.head && !i.hr);

  const m = el(`<div class="menu">
      ${search ? '<input class="msearch" placeholder="Type to filter&hellip;" autocomplete="off">' : ''}
      <div class="mbody">${itemMarkup(items, '')}</div>
    </div>`);
  document.body.appendChild(m);
  place(m, anchor, align);

  const filterText = () => {
    const box = m.querySelector('.msearch');
    return box ? box.value : '';
  };

  /**
   * Redraw the whole body from the current list.
   *
   * The scroll position and the focused entry are carried across, because a long
   * taxonomy list that jumped back to the top on every pick would be worse than the
   * bug this fixes.
   */
  const draw = (keepFocus) => {
    const body = m.querySelector('.mbody');
    const top = body.scrollTop;
    body.innerHTML = itemMarkup(list, filterText());
    body.scrollTop = top;
    bind();
    if (keepFocus != null) {
      const back = body.querySelector(`[data-v="${CSS.escape(keepFocus)}"]`);
      if (back) back.focus();
    }
  };

  const bind = () => m.querySelectorAll('[data-v]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = picks().find((i) => String(i.value) === b.dataset.v);
      if (!item) return;

      /* A multi-select menu stays open: choosing three dives should be three clicks,
         not three round trips through the rail. */
      if (item.keepOpen) {
        item.on = !item.on;
        item.onPick(item.value);
        /* Every entry restates itself, not just the one that was clicked. Toggling the
           clicked tick in place left the "All …" entry wearing the tick it was built
           with, so the menu claimed "All projects" and one project at the same time --
           #81 B1. The list is rebuilt from state where the caller can supply it. */
        if (rebuild) list = rebuild();
        draw(b.dataset.v);
        return;
      }

      closeMenus();
      if (item.onPick) item.onPick(item.value);
    }));
  bind();

  const input = m.querySelector('.msearch');
  if (input) {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', () => draw());
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = m.querySelector('[data-v]');
      if (first) first.click();
    });
    setTimeout(() => input.focus(), 0);
  }
  openMenuEl = m;
  openAnchorKey = anchorKey(anchor);
}

/**
 * A menu that is a small panel of controls rather than a list of choices.
 *
 * The two-ended filters need this. Two native inputs will not fit side by side in a 158px
 * rail column, so they stacked, and time and date took three rows between them — #81 L5.
 * Behind a summary button they take one row each and the popover has the width the
 * controls actually need. It is a `.menu` so that Escape and a click elsewhere dismiss it
 * exactly like every other menu here, and so two cannot be open at once.
 */
export function panelMenu(anchor, html, { align = 'left', wire = null } = {}) {
  closeMenus();
  const m = el(`<div class="menu menu--panel">${html}</div>`);
  document.body.appendChild(m);
  place(m, anchor, align);
  /* A click inside is somebody using a control, never a pick. */
  m.addEventListener('click', (e) => e.stopPropagation());
  if (wire) wire(m);
  openMenuEl = m;
  openAnchorKey = anchorKey(anchor);
}

/* ------------------------------------------------------------- the menus */

/**
 * A menu for one set dimension, read from its declaration.
 *
 * Multi-select: picking a value toggles it and the menu stays open, because choosing
 * three dives should be three clicks rather than three round trips. "All" clears the
 * selection, which means the dimension stops filtering rather than matching nothing.
 *
 * There is one of these rather than one per dimension. Adding a dimension is an entry in
 * `model/dimensions.js` and nothing here.
 */
export function dimensionMenu(anchor, key) {
  const dimension = DIMENSION[key];
  if (!dimension) return;

  /* Built from state each time it is asked for, so a pick that stays open can restate
     the whole list -- including the "All …" entry, which is what B1 was about. */
  const build = () => {
    const chosen = state.filters[key] || [];
    const options = MarpData.optionsFor(key, state.filters);

    /* Scoped dimensions say what they are scoped by, so an empty dive list reads as
       "this project has none" rather than as a broken control. */
    const head = dimension.nestsUnder && (state.filters[dimension.nestsUnder] || []).length
      ? `${dimension.label} · ${(state.filters[dimension.nestsUnder] || []).join(', ')}`
      : dimension.label;

    const items = [{ head }, {
      value: '', label: dimension.all, on: !chosen.length,
      onPick: () => actions.clearDimension(key),
    }];

    options.forEach((value) => {
      items.push({
        value: String(value), label: dimension.one(value), on: chosen.includes(value),
        keepOpen: true,
        onPick: () => actions.toggleDimension(key, value),
      });
    });

    if (!options.length) items.push({ head: 'nothing under the current filters' });
    return items;
  };

  menu(anchor, build(), { search: Boolean(dimension.searchable), rebuild: build });
}

/** No column links an observation to the model that produced it — see #68. */
export const modelMenu = (anchor) => menu(anchor, [
  { head: 'Model — not yet in the schema' },
  { value: 'v3.2', label: 'BatStarNet v3.2', on: true, onPick: () => {} },
  { value: 'v3.1', label: 'BatStarNet v3.1', onPick: () => {} },
  { value: 'any', label: 'Any model', onPick: () => {} }
], { search: true });

/**
 * The sort: a field and a direction, and then a second field and direction for the ties.
 *
 * Four questions in one menu -- #81 M1 and M2 -- and it stays open between them, because
 * "confidence, low first, and break the ties by track length" is one thought rather than
 * four errands. Each direction pair is worded for the field it belongs to, so the whole
 * thing reads as a sentence.
 *
 * The secondary never offers the primary's own field: a term that can never be reached is
 * not a sort, and the rail already refuses to offer a filter that returns nothing.
 */
export const sortMenu = (anchor) => {
  const build = () => {
    const field = sortField(state.sort);
    const then = state.sort.then;
    const items = [{ head: 'Sort by' }];

    SORT_FIELDS.forEach((s) => items.push({
      value: s.field, label: s.label, on: s.field === field.field, keepOpen: true,
      /* Picking what is already applied is not a new question, so it does not re-query. */
      onPick: () => { if (s.field !== state.sort.field) actions.setSort(s.field, state.sort.dir); },
    }));

    items.push({ hr: true }, { head: `${field.label}, in which order` });
    SORT_DIRS.forEach((dir) => items.push({
      value: dir, label: `${sortArrow(dir)} ${sentence(field[dir])}`,
      on: state.sort.dir === dir, keepOpen: true,
      onPick: () => { if (dir !== state.sort.dir) actions.setSort(state.sort.field, dir); },
    }));

    /* The values are prefixed because one menu now holds two field lists and two
       direction pairs, and `data-v` has to tell them apart. */
    items.push({ hr: true }, { head: 'Then, where that ties' });
    items.push({
      value: 'then:none', label: 'Nothing — leave the order there',
      on: !then, keepOpen: true,
      onPick: () => { if (then) actions.setSortThen(null); },
    });
    SORT_FIELDS.filter((s) => s.field !== field.field).forEach((s) => items.push({
      value: `then:${s.field}`, label: s.label,
      on: Boolean(then) && then.field === s.field, keepOpen: true,
      onPick: () => {
        if (!then || then.field !== s.field) actions.setSortThen(s.field, (then && then.dir) || 'asc');
      },
    }));

    if (then) {
      const second = sortField(then);
      items.push({ head: `${second.label}, in which order` });
      SORT_DIRS.forEach((dir) => items.push({
        value: `then:${dir}`, label: `${sortArrow(dir)} ${sentence(second[dir])}`,
        on: then.dir === dir, keepOpen: true,
        onPick: () => { if (dir !== then.dir) actions.setSortThen(then.field, dir); },
      }));
    }

    return items;
  };
  menu(anchor, build(), { align: 'right', rebuild: build });
};

export const userMenu = (anchor) => menu(anchor, [
  { head: `Signed in as ${ME}` },
  { value: 'prefs', label: 'Preferences', onPick: () => {} },
  { value: 'keys', label: 'Keyboard shortcuts', onPick: () => {} },
  { value: 'density', label: 'Tile density', onPick: () => {} },
  { hr: true },
  { value: 'out', label: 'Sign out', onPick: () => {} }
], { align: 'right' });
