/**
 * The filter rail, drawn from `model/dimensions.js`.
 *
 * Ten controls in one column is a list, not a rail, so they are grouped by the question
 * each answers — where it came from, what it is, when, who. A reviewer looking for the
 * dive filter reads one group heading rather than ten labels.
 *
 * Nothing here names a dimension. Adding one is an entry in the declaration; this file
 * draws whatever is there.
 */

import { DIMENSIONS, DIMENSION, KIND, dimensionGroups, isActive } from '../model/dimensions.js';
import { state, actions } from '../store.js';
import { $, el } from './dom.js';
import { dimensionMenu, closeMenus, isMenuOpenFor } from './menus.js';

/** What the button says: the selection, or the dimension's "all" text. */
function summarise(dimension, value) {
  if (!isActive(dimension, value)) return dimension.all || 'Any';

  if (dimension.kind === KIND.SET) {
    /* Two names fit; more would truncate into meaninglessness, and the count is the
       useful thing at that point. */
    if (value.length <= 2) return value.map(dimension.one).join(', ');
    return `${value.length} ${dimension.label}s`;
  }

  const fmt = dimension.format || ((v) => String(v));
  const from = value.from != null ? fmt(value.from) : '';
  const to = value.to != null ? fmt(value.to) : '';
  if (from && to) return `${from} – ${to}`;
  return from ? `from ${from}` : `up to ${to}`;
}

function control(dimension) {
  const value = state.filters[dimension.key];
  const active = isActive(dimension, value);

  if (dimension.kind === KIND.SET) {
    return `
      <div class="lbl">${dimension.label}</div>
      <div class="menuwrap"><button class="sel${active ? ' on' : ''}"
        data-dim="${dimension.key}" title="Filter by ${dimension.label}">
        <span>${summarise(dimension, value)}</span><span>&#9662;</span></button></div>`;
  }

  if (dimension.kind === KIND.WINDOW) {
    return `
      <div class="lbl">${dimension.label}</div>
      <div class="span" data-span="${dimension.key}">
        <input type="time" data-end="from" value="${(value && value.from) || ''}"
               aria-label="${dimension.label} from">
        <span class="dash">&ndash;</span>
        <input type="time" data-end="to" value="${(value && value.to) || ''}"
               aria-label="${dimension.label} to">
      </div>`;
  }

  /* RANGE. Date takes two dates; anything else takes two numbers on one slider. */
  if (dimension.key === 'date') {
    return `
      <div class="lbl">${dimension.label}</div>
      <div class="span" data-span="${dimension.key}">
        <input type="date" data-end="from" value="${(value && value.from) || ''}"
               aria-label="date from">
        <span class="dash">&ndash;</span>
        <input type="date" data-end="to" value="${(value && value.to) || ''}"
               aria-label="date to">
      </div>
      <div class="span-note" data-note="${dimension.key}" hidden></div>`;
  }

  const [lo, hi] = dimension.bounds;
  const from = value && value.from != null ? value.from : lo;
  const to = value && value.to != null ? value.to : hi;
  return `
    <div class="lbl">${dimension.label}
      <b class="span-val">${dimension.format(from)} – ${dimension.format(to)}</b></div>
    <div class="dual" data-span="${dimension.key}">
      <input type="range" data-end="from" min="${lo}" max="${hi}"
             step="${dimension.step}" value="${from}" aria-label="minimum ${dimension.label}">
      <input type="range" data-end="to" min="${lo}" max="${hi}"
             step="${dimension.step}" value="${to}" aria-label="maximum ${dimension.label}">
    </div>`;
}

export function renderRail() {
  const host = $('#railDimensions');
  if (!host) return;

  /* Redrawn whole, like everything else here. A control the reviewer is typing into is
     the one exception -- replacing it under them would eat the keystroke. */
  const typing = document.activeElement;
  const held = typing && typing.closest && typing.closest('[data-span]')
    ? { key: typing.closest('[data-span]').dataset.span, end: typing.dataset.end }
    : null;

  host.innerHTML = dimensionGroups().map((group) => `
    <div class="railgroup">
      <div class="railgroup__title">${group.title}</div>
      ${group.dimensions.map(control).join('')}
    </div>`).join('');

  if (held) {
    const back = host.querySelector(`[data-span="${held.key}"] [data-end="${held.end}"]`);
    if (back) back.focus();
  }

  const note = host.querySelector('[data-note="date"]');
  if (note) {
    const n = state.excludedForNoDate || 0;
    note.hidden = !n || !isActive(DIMENSION.date, state.filters.date);
    note.textContent = n
      ? `${n} observation${n === 1 ? '' : 's'} have no recorded date and are not shown.`
      : '';
  }
}

export function wireRail() {
  const host = $('#railDimensions');
  if (!host) return;

  host.addEventListener('click', (e) => {
    const button = e.target.closest('[data-dim]');
    if (!button) return;
    e.stopPropagation();
    /* A second click on the button that opened the menu closes it, the way every other
       dropdown on every other platform does. It used to close and immediately reopen,
       which reads as the button doing nothing at all -- #81 B2. */
    if (isMenuOpenFor(button)) { closeMenus(); return; }
    dimensionMenu(button, button.dataset.dim);
  });

  /* `change` rather than `input` for the two-ended controls: a slider fires input on
     every pixel, and each one would re-query. */
  host.addEventListener('change', (e) => {
    const span = e.target.closest('[data-span]');
    if (!span) return;
    const key = span.dataset.span;
    const dimension = DIMENSION[key];
    const read = (end) => {
      const el = span.querySelector(`[data-end="${end}"]`);
      if (!el || el.value === '') return null;
      return dimension.kind === KIND.RANGE && key !== 'date' ? Number(el.value) : el.value;
    };

    let from = read('from');
    let to = read('to');

    /* Two handles on one track can be dragged past each other. Swapping is kinder than
       refusing: the reviewer meant the range between them either way. A time window is
       the exception -- there, from later than to is a wrap past midnight and is meant. */
    if (dimension.kind === KIND.RANGE && from != null && to != null && from > to) {
      [from, to] = [to, from];
    }

    /* A range covering the whole of its bounds is not filtering anything. */
    if (dimension.kind === KIND.RANGE && dimension.bounds
        && from === dimension.bounds[0] && to === dimension.bounds[1]) {
      from = null; to = null;
    }
    actions.setSpan(key, from, to);
  });
}
