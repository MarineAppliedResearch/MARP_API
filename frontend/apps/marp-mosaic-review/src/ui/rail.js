/**
 * The filter rail, drawn from `model/dimensions.js`.
 *
 * One control per dimension, in declared order, and nothing else. #77 grouped them under
 * four headings; #81 dropped the headings, because four heading rows in a rail that was
 * already clipping its own status filters is the crowding rather than a cure for it.
 *
 * Nothing here names a dimension. Adding one is an entry in the declaration; this file
 * draws whatever is there.
 */

import { DIMENSIONS, DIMENSION, KIND, isActive, optionLabel } from '../model/dimensions.js';
import { normaliseClock } from '../model/match.js';
import { state, actions } from '../store.js';
import { $, el } from './dom.js';
import { dimensionMenu, panelMenu, closeMenus, isMenuOpenFor } from './menus.js';

/** What the button says: the selection, or the dimension's "all" text. */
function summarise(dimension, value) {
  if (!isActive(dimension, value)) return dimension.all || 'Any';

  if (dimension.kind === KIND.SET) {
    /* Two names fit; more would truncate into meaninglessness, and the count is the
       useful thing at that point. Through `optionLabel`, because a key-valued dimension
       would otherwise summarise itself as "775" (A10a). */
    if (value.length <= 2) {
      return value.map((v) => optionLabel(dimension, v, state.facets)).join(', ');
    }
    return `${value.length} ${dimension.label}s`;
  }

  const fmt = dimension.format || ((v) => String(v));
  const from = value.from != null ? fmt(value.from) : '';
  const to = value.to != null ? fmt(value.to) : '';
  if (from && to) return `${from} – ${to}`;
  return from ? `from ${from}` : `up to ${to}`;
}

/** A slider's two ends as percentages of its track, for the fill between them. */
const pctOf = (dimension, v) => {
  const [lo, hi] = dimension.bounds;
  return `${((v - lo) / (hi - lo)) * 100}%`;
};

function control(dimension) {
  const value = state.filters[dimension.key];
  const active = isActive(dimension, value);

  /* One row: a label, and a button saying what is chosen. Everything except the slider
     is drawn this way, including the two-ended time and date filters -- their controls
     live in the popover the button opens. Two native inputs each did not fit side by side
     in the rail column, so they wrapped and took three rows between them. #81 L5.

     A range with declared bounds is what can be a slider; one without them is not, which
     is the difference between confidence and date. Asking the declaration rather than
     naming `date` is what keeps a dimension one entry there and nothing here. */
  if (dimension.kind !== KIND.RANGE || !dimension.bounds) {
    return `
      <div class="lbl">${dimension.label}</div>
      <div class="menuwrap"><button class="sel${active ? ' on' : ''}"
        data-dim="${dimension.key}" title="Filter by ${dimension.label}">
        <span>${summarise(dimension, value)}</span><span>&#9662;</span></button></div>`
      + (dimension.reportsExclusions
          ? `<div class="span-note" data-note="${dimension.key}" hidden></div>` : '');
  }

  /* A number range: one track carrying both handles. Two stacked sliders said the same
     thing in twice the height and read as two independent numbers rather than one
     range -- #81 L4. The percentages drive the fill, in CSS, so nothing measures. */
  const [lo, hi] = dimension.bounds;
  const from = value && value.from != null ? value.from : lo;
  const to = value && value.to != null ? value.to : hi;
  return `
    <div class="lbl">${dimension.label}
      <b class="span-val">${dimension.format(from)} &ndash; ${dimension.format(to)}</b></div>
    <div class="dual" data-span="${dimension.key}"
         style="--from:${pctOf(dimension, from)};--to:${pctOf(dimension, to)}">
      <div class="dual__track"><i class="dual__fill"></i></div>
      <input type="range" data-end="from" min="${lo}" max="${hi}"
             step="${dimension.step}" value="${from}" aria-label="minimum ${dimension.label}">
      <input type="range" data-end="to" min="${lo}" max="${hi}"
             step="${dimension.step}" value="${to}" aria-label="maximum ${dimension.label}">
    </div>`;
}

/**
 * The two ends of a span, drawn into the popover its button opens.
 *
 * The time ends are text and not `<input type="time">`: a native time input renders from
 * the browser locale and there is no attribute for it, so it cannot be made 24-hour. See
 * `normaliseClock`, which is what turns what was typed into a value.
 */
function spanPanel(dimension) {
  const value = state.filters[dimension.key];
  const from = (value && value.from) || '';
  const to = (value && value.to) || '';

  /* Text rather than `<input type="time">`: a native time input renders from the browser
     locale and no attribute overrides it -- `lang="en-GB"` still draws `01:30 PM` in
     Chromium, and MARP writes 24-hour everywhere (#81 B3). Both the window and the clock
     range use it, and they differ only in what the note says. */
  if (dimension.kind === KIND.WINDOW || dimension.clock) {
    const wraps = dimension.kind === KIND.WINDOW;
    return `
      <div class="mhead">${dimension.label}</div>
      <div class="span" data-span="${dimension.key}">
        <input type="text" class="clock" data-end="from" value="${from}" placeholder="HH:MM"
               inputmode="numeric" maxlength="5" aria-label="${dimension.label} from">
        <span class="dash">&ndash;</span>
        <input type="text" class="clock" data-end="to" value="${to}" placeholder="HH:MM"
               inputmode="numeric" maxlength="5" aria-label="${dimension.label} to">
      </div>
      <div class="mnote">${wraps
        ? '24-hour. A start later than the end is a window across midnight.'
        : `24-hour. <b>${dimension.label}</b> reads the recorded time; it will read dates too
           once observations carry one.`}</div>`;
  }

  return `
    <div class="mhead">${dimension.label}</div>
    <div class="span" data-span="${dimension.key}">
      <input type="date" data-end="from" value="${from}" aria-label="${dimension.label} from">
      <span class="dash">&ndash;</span>
      <input type="date" data-end="to" value="${to}" aria-label="${dimension.label} to">
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

  host.innerHTML = DIMENSIONS.map(control).join('');

  if (held) {
    const back = host.querySelector(`[data-span="${held.key}"] [data-end="${held.end}"]`);
    if (back) back.focus();
  }

  /* A dimension that says it cannot always answer reports what it had to leave out. Only
     the date does today, and it is found through the declaration rather than by name --
     naming it here would be the second place a dimension lives. The count itself is still
     date-shaped, in `state.excludedForNoDate`; see #76. */
  for (const dimension of DIMENSIONS.filter((d) => d.reportsExclusions)) {
    const note = host.querySelector(`[data-note="${dimension.key}"]`);
    if (!note) continue;
    const n = state.excludedForNoDate || 0;
    note.hidden = !n || !isActive(dimension, state.filters[dimension.key]);
    note.textContent = n
      ? `${n} observation${n === 1 ? '' : 's'} have no recorded date and are not shown.`
      : '';
  }
}

/** Is this pair what the rail is already filtering on? */
function sameSpan(key, from, to) {
  const now = state.filters[key];
  if (from == null && to == null) return now == null;
  return Boolean(now) && now.from === from && now.to === to;
}

/**
 * Read both ends of a span control and tell the store what was asked for.
 *
 * Shared, because the slider lives in the rail and the time and date ends live in a
 * popover, and a second copy of these rules would be a second place for them to disagree.
 */
function applySpan(span) {
  const key = span.dataset.span;
  const dimension = DIMENSION[key];
  const numeric = dimension.kind === KIND.RANGE && Boolean(dimension.bounds);

  const read = (end) => {
    const box = span.querySelector(`[data-end="${end}"]`);
    if (!box) return null;
    if (dimension.kind === KIND.WINDOW || dimension.clock) {
      /* Written back, so the field shows what was understood rather than what was typed:
         `930` becomes `09:30`, and something that is not a time at all clears. */
      const clock = normaliseClock(box.value);
      box.value = clock || '';
      return clock;
    }
    if (box.value === '') return null;
    return numeric ? Number(box.value) : box.value;
  };

  let from = read('from');
  let to = read('to');

  /* Two handles on one track can be dragged past each other. Swapping is kinder than
     refusing: the reviewer meant the range between them either way. A time window is
     the exception -- there, from later than to is a wrap past midnight and is meant.
     A `clock` range is swapped like any other range: it does not wrap, so an
     out-of-order pair is a mistake rather than a night. */
  if (dimension.kind === KIND.RANGE && from != null && to != null && from > to) {
    [from, to] = [to, from];
  }

  /* A range covering the whole of its bounds is not filtering anything. */
  if (dimension.kind === KIND.RANGE && dimension.bounds
      && from === dimension.bounds[0] && to === dimension.bounds[1]) {
    from = null; to = null;
  }

  /* Nothing new to ask for. Worth checking, because the ends are read on three different
     events and two of them routinely fire for one gesture. */
  if (sameSpan(key, from, to)) return;
  actions.setSpan(key, from, to);
}

/**
 * The ends of a span, wherever they are drawn.
 *
 * Three events, because one is not enough. `change` is the native one and covers tabbing
 * away and the date picker. `focusout` covers clicking straight out into the mosaic,
 * which dismisses the popover — the typed time would otherwise be thrown away with it,
 * since the element is removed before it can ever blur. Enter is what somebody presses
 * after typing a time and expects to mean *go*. Applying twice costs nothing, because
 * `applySpan` ignores a pair it has already been given.
 */
function wireSpanPanel(panel) {
  const apply = (target) => {
    const span = target && target.closest && target.closest('[data-span]');
    if (span) applySpan(span);
  };
  panel.addEventListener('change', (e) => apply(e.target));
  panel.addEventListener('focusout', (e) => apply(e.target));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(e.target); });
}

/**
 * Repaint a slider from its own handles, without asking anything of the store.
 *
 * A drag fires `input` on every pixel and `change` only at the end, so without this the
 * fill and the numbers sit a whole drag behind the handles. It writes DOM and never state,
 * which is the rule this layer keeps.
 */
function paintDual(dual) {
  const dimension = DIMENSION[dual.dataset.span];
  const value = (end) => Number(dual.querySelector(`[data-end="${end}"]`).value);
  const lo = Math.min(value('from'), value('to'));
  const hi = Math.max(value('from'), value('to'));
  dual.style.setProperty('--from', pctOf(dimension, lo));
  dual.style.setProperty('--to', pctOf(dimension, hi));
  /* The label immediately above this track, not the first one in the rail: a second
     range dimension would otherwise repaint the first one's numbers. */
  const label = dual.previousElementSibling;
  const shown = label && label.querySelector('.span-val');
  if (shown) shown.textContent = `${dimension.format(lo)} – ${dimension.format(hi)}`;
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

    const dimension = DIMENSION[button.dataset.dim];
    if (!dimension) return;
    /* A list of values gets a list; two ends get a panel holding them. */
    if (dimension.kind === KIND.SET) { dimensionMenu(button, dimension.key); return; }
    panelMenu(button, spanPanel(dimension), { wire: wireSpanPanel });
  });

  /* `change` rather than `input` for the slider: a drag fires input on every pixel, and
     each one would re-query. `input` only repaints, below. */
  host.addEventListener('change', (e) => {
    const span = e.target.closest('[data-span]');
    if (span) applySpan(span);
  });

  host.addEventListener('input', (e) => {
    const dual = e.target.closest('.dual');
    if (dual) paintDual(dual);
  });
}
