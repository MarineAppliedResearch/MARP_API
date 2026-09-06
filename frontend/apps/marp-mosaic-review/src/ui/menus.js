/**
 * Dropdown menus.
 *
 * Anchored against the viewport rather than the parent: the filter rail has
 * overflow:hidden and was clipping menus off the left edge. Filter lists can get
 * long — projects and taxonomy especially — so they filter as you type.
 */
import { state, actions } from '../store.js';
import { MarpData } from '../data.js';
import { SORTS } from '../model/filters.js';
import { DIMENSION } from '../model/dimensions.js';
import { el, ICON, ME } from './dom.js';

let openMenuEl = null;

export const isMenuOpen = () => Boolean(openMenuEl);
export function closeMenus() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
}

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

export function menu(anchor, items, { align = 'left', search = false } = {}) {
  closeMenus();
  const picks = () => items.filter((i) => !i.head && !i.hr);

  const m = el(`<div class="menu">
      ${search ? '<input class="msearch" placeholder="Type to filter&hellip;" autocomplete="off">' : ''}
      <div class="mbody">${itemMarkup(items, '')}</div>
    </div>`);
  document.body.appendChild(m);
  place(m, anchor, align);

  const bind = () => m.querySelectorAll('[data-v]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = picks().find((i) => String(i.value) === b.dataset.v);
      if (!item) return;

      /* A multi-select menu stays open: choosing three dives should be three clicks,
         not three round trips through the rail. The tick redraws in place so the menu
         keeps saying what is chosen. */
      if (item.keepOpen) {
        item.on = !item.on;
        item.onPick(item.value);
        b.classList.toggle('on', item.on);
        const tick = b.querySelector('.tick');
        if (tick) tick.innerHTML = item.on ? ICON.tick : '';
        return;
      }

      closeMenus();
      if (item.onPick) item.onPick(item.value);
    }));
  bind();

  const input = m.querySelector('.msearch');
  if (input) {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      m.querySelector('.mbody').innerHTML = itemMarkup(items, input.value);
      bind();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = m.querySelector('[data-v]');
      if (first) first.click();
    });
    setTimeout(() => input.focus(), 0);
  }
  openMenuEl = m;
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
  menu(anchor, items, { search: Boolean(dimension.searchable) });
}

/** No column links an observation to the model that produced it — see #68. */
export const modelMenu = (anchor) => menu(anchor, [
  { head: 'Model — not yet in the schema' },
  { value: 'v3.2', label: 'BatStarNet v3.2', on: true, onPick: () => {} },
  { value: 'v3.1', label: 'BatStarNet v3.1', onPick: () => {} },
  { value: 'any', label: 'Any model', onPick: () => {} }
], { search: true });

export const sortMenu = (anchor) => menu(anchor,
  [{ head: 'Sort by' }].concat(SORTS.map((s) => ({
    value: `${s.field}:${s.dir}`, label: s.label,
    on: state.sort.field === s.field && state.sort.dir === s.dir,
    onPick: (v) => { const [f, d] = v.split(':'); actions.setSort(f, d); }
  }))), { align: 'right' });

export const userMenu = (anchor) => menu(anchor, [
  { head: `Signed in as ${ME}` },
  { value: 'prefs', label: 'Preferences', onPick: () => {} },
  { value: 'keys', label: 'Keyboard shortcuts', onPick: () => {} },
  { value: 'density', label: 'Tile density', onPick: () => {} },
  { hr: true },
  { value: 'out', label: 'Sign out', onPick: () => {} }
], { align: 'right' });
