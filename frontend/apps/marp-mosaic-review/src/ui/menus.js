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
      closeMenus();
      if (item && item.onPick) item.onPick(item.value);
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

/** A filter menu over a list, with an "all" entry that clears the filter. */
function filterMenu(anchor, { head, allLabel, key, options, labelOf }) {
  const items = [{ head },
    { value: '', label: allLabel, on: !state.filters[key],
      onPick: () => actions.setFilter(key, null) }];
  options.forEach((o) => {
    const label = labelOf(o);
    items.push({
      value: label, label, on: state.filters[key] === label,
      onPick: (v) => actions.setFilter(key, v)
    });
  });
  menu(anchor, items, { search: true });
}

export const speciesMenu = (anchor) => filterMenu(anchor, {
  head: 'Species', allLabel: 'All species', key: 'species',
  options: MarpData.species(), labelOf: (s) => s.comname
});

export const projectMenu = (anchor) => filterMenu(anchor, {
  head: 'Project', allLabel: 'All projects', key: 'project',
  options: MarpData.projects(), labelOf: (p) => p.name
});

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
