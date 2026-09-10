/**
 * The shared components, as builders.
 *
 * DESIGN.md describes the vocabulary; this is it in code. Three people drawing
 * eight tabs will otherwise write three status cells that disagree about what
 * "Completed (Issues)" looks like, and the point of this phase is that they
 * cannot. If a tab needs something that is not here, it belongs here.
 */
import { h, frag } from './dom.js';
import icon from './icons.js';
import { fmt, frac } from './fmt.js';

/* ------------------------------------------------------------------ panels */

/**
 * panel({ title, count, tools, tone, flush, foot }, ...body)
 * `tools` is the right-hand cluster in the header; `foot` the footer row.
 */
export function panel(o, ...body) {
  const opts = o || {};
  return h('section', { class: 'panel', dataTone: opts.tone },
    (opts.title || opts.tools) && h('header', { class: 'panel-hd' },
      opts.title && h('h2', {}, opts.title,
        opts.count !== undefined && h('span', { class: 'count' }, ` (${fmt.int(opts.count)})`)),
      opts.tools && h('div', { class: 'panel-tools' }, opts.tools)),
    h('div', { class: 'panel-bd' + (opts.flush ? ' flush' : '') }, ...body),
    opts.foot && h('footer', { class: 'panel-ft' }, opts.foot));
}

/** A row of panels. cols is 2, 3, 4 or 'wide-narrow'. */
export const panelRow = (cols, ...kids) => h('div', { class: 'panel-row', dataCols: cols }, ...kids);

/** The "View All ->" link a panel header carries. */
export const moreLink = (text, onclick) =>
  h('button', { class: 'btn ghost sm more', onclick }, text, icon('arrowRight'));

/* ------------------------------------------------------------- stat cards */

/**
 * stat({ label, value, of, sub, state, ico, onclick })
 * `of` draws "124 / 143"; `sub` is an array of [number, word] pairs.
 */
export function stat(o) {
  return h('div', {
    class: 'stat' + (o.onclick ? ' link' : ''), dataState: o.state || 'idle',
    onclick: o.onclick, role: o.onclick ? 'button' : null, tabindex: o.onclick ? 0 : null,
    onkeydown: o.onclick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onclick(e); } } : null,
  },
    h('span', { class: 'stat-ico' }, icon(o.ico || 'chip')),
    h('span', { class: 'stat-lab' }, o.label),
    h('b', { class: 'stat-num' }, o.value, o.of !== undefined && h('span', { class: 'of' }, ` / ${o.of}`)),
    h('span', { class: 'stat-sub' }, (o.sub || []).map(([n, w]) => h('span', {}, h('i', {}, n), ' ' + w))));
}

export const statRow = (...kids) => h('div', { class: 'stat-row' }, ...kids);

/* ------------------------------------------------------------------ state */

/** A dot plus its label. The only way this app draws a state in a table. */
export const st = (state) =>
  h('span', { class: 'st', dataState: state }, h('span', { class: 'dot' }), fmt.label(state));

/** The same state as a filled chip, for a heading or a card corner. */
export const pill = (state, text) =>
  h('span', { class: 'pill', dataState: state }, h('span', { class: 'dot' }), text || fmt.label(state));

export const tag = (text, cls) => h('span', { class: 'tag' + (cls ? ' ' + cls : '') }, text);

/** The job-kind chip, so inference and training read the same everywhere. */
export const kindTag = (kind) => tag(kind === 'training' ? 'Training' : 'Inference', 'kind-' + kind);

/** A name cell with its kind icon in front of it. */
export const nameCell = (kind, text) =>
  h('span', { class: 'rowico' },
    icon(kind === 'training' ? 'training' : 'inference', 'kind-' + kind),
    h('span', {}, text));

/* --------------------------------------------------------------- progress */

/**
 * A progress cell. Draws an em dash rather than a 0% bar when there is no
 * measurement yet -- progress is legitimately null before the first heartbeat
 * (#104), and a 0% bar claims a measurement that does not exist.
 */
export function progress(job) {
  const f = frac(job.progress);
  if (f === null) return h('span', { class: 'dash' }, '—');
  const n = Math.round(f * 100);
  return h('span', { class: 'progcell', dataState: job.state },
    h('span', { class: 'bar', role: 'progressbar', ariaValuenow: n, ariaValuemin: 0, ariaValuemax: 100 },
      h('i', { style: `width:${n}%` })),
    h('span', { class: 'pct' }, n + '%'));
}

/** A wide bar with no number, for a detail panel. */
export function bar(fraction, state) {
  const n = Math.round((fraction || 0) * 100);
  return h('span', { class: 'bar wide', dataState: state, role: 'progressbar', ariaValuenow: n },
    h('i', { style: `width:${n}%` }));
}

/* --------------------------------------------------------------- controls */

/** btn('Run', { primary: true, ico: 'play', onclick }) */
export function btn(text, o) {
  const opts = o || {};
  const cls = ['btn'];
  for (const k of ['primary', 'accent', 'ghost', 'danger', 'icon', 'sm', 'big', 'block']) {
    if (opts[k]) cls.push(k);
  }
  return h('button', {
    class: cls.join(' '), onclick: opts.onclick, disabled: opts.disabled,
    title: opts.title, ariaLabel: opts.ariaLabel || (opts.icon ? text : null), type: 'button',
  }, opts.ico && icon(opts.ico), !opts.icon && text, opts.icoAfter && icon(opts.icoAfter));
}

/** An icon-only button. Always needs a label, because it has no text. */
export const iconBtn = (ico, label, onclick, o) =>
  h('button', {
    class: 'btn icon' + (o && o.sm ? ' sm' : '') + (o && o.danger ? ' danger' : ''),
    ariaLabel: label, title: label, onclick, disabled: o && o.disabled, type: 'button',
  }, icon(ico));

/**
 * select(options, { value, onchange, wide, label })
 * `options` is an array of strings, or of [value, text] pairs.
 */
export function select(options, o) {
  const opts = o || {};
  return h('select', {
    class: 'sel' + (opts.wide ? ' wide' : ''), onchange: opts.onchange,
    ariaLabel: opts.label, value: opts.value,
  }, options.map((it) => {
    const [v, t] = Array.isArray(it) ? it : [it, it];
    return h('option', { value: v, selected: String(v) === String(opts.value) }, t);
  }));
}

export const input = (o) => h('input', {
  class: 'inp' + (o && o.wide ? ' wide' : ''), type: (o && o.type) || 'text',
  placeholder: o && o.placeholder, value: o && o.value, oninput: o && o.oninput,
  ariaLabel: o && o.label, min: o && o.min, max: o && o.max, step: o && o.step,
});

/** A search box with its leading icon. */
export const search = (placeholder, oninput) =>
  h('span', { class: 'search' }, icon('search'),
    h('input', { class: 'inp', type: 'search', placeholder, oninput, ariaLabel: placeholder }));

/**
 * seg([{ id, text, ico }], { value, onchange })
 * The Mosaic Reviewer's segmented control, same markup, so the two apps are
 * the same object rather than two things that look alike.
 */
export function seg(items, o) {
  const wrap = h('nav', { class: 'seg', ariaLabel: o.label || 'Choose one' });
  for (const it of items) {
    wrap.appendChild(h('button', {
      class: it.id === o.value ? 'on' : '', type: 'button',
      ariaPressed: it.id === o.value, disabled: it.disabled,
      onclick: () => o.onchange(it.id),
    }, it.ico && icon(it.ico), it.text));
  }
  return wrap;
}

/**
 * tabstrip([{ id, text, ico, disabled, later }], { value, onchange })
 * `later` draws the milestone badge on a sub-tab nothing implements yet, so a
 * disabled control reads as deferred rather than broken.
 */
export function tabstrip(items, o) {
  const wrap = h('nav', { class: 'tabstrip', ariaLabel: o.label || 'Section' });
  for (const it of items) {
    wrap.appendChild(h('button', {
      class: it.id === o.value ? 'on' : '', type: 'button',
      disabled: it.disabled, dataLater: it.later, dataTab: it.id,
      ariaCurrent: it.id === o.value ? 'true' : null,
      title: it.disabled && it.later ? `${it.text} is not built yet` : null,
      onclick: () => o.onchange(it.id),
    }, it.ico && icon(it.ico), it.text));
  }
  return wrap;
}

/** field('Model', control, { req, hint }) */
export const field = (label, control, o) =>
  h('div', { class: 'field' + (o && o.req ? ' req' : '') },
    label && h('label', {}, label), control, o && o.hint && h('span', { class: 'hint' }, o.hint));

export const fieldRow = (...kids) => h('div', { class: 'fieldrow' }, ...kids);

/**
 * A range with a bound read-out. Both directions: dragging updates the box and
 * typing in the box moves the handle, because a read-out that only reads is a
 * label pretending to be a control.
 */
export function slider(o) {
  const out = h('input', { class: 'inp slider-out', type: 'number', value: o.value,
    min: o.min, max: o.max, step: o.step, ariaLabel: (o.label || 'Value') + ' (number)' });
  const range = h('input', { type: 'range', value: o.value, min: o.min, max: o.max,
    step: o.step, ariaLabel: o.label });
  const push = (v) => { range.value = v; out.value = v; if (o.onchange) o.onchange(Number(v)); };
  range.addEventListener('input', () => push(range.value));
  out.addEventListener('change', () => {
    const v = Math.min(o.max, Math.max(o.min, Number(out.value) || 0));
    push(v);
  });
  return h('div', {},
    h('div', { class: 'slider' }, range, out),
    h('div', { class: 'slider-ends' }, h('span', {}, o.min), h('span', {}, o.max)));
}

/** check('Save detections to database', true, onchange) */
export const check = (text, checked, onchange) =>
  h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: onchange && ((e) => onchange(e.target.checked)) }),
    h('span', {}, text));

export const checks = (...kids) => h('div', { class: 'checks' }, ...kids);

/* ----------------------------------------------------------------- tables */

/**
 * table({ cols, rows, sort, onsort, rowlink, compact, empty })
 *
 * `cols` is [{ key, text, num, chk, width, sortable }]; `rows` is an array of
 * arrays of cells, or of { cells, cls, onclick, state }.
 */
export function table(o) {
  const cols = o.cols || [];
  const head = h('tr', {}, cols.map((c) => h('th', {
    class: [c.num && 'num', c.chk && 'chk', c.sortable && 'sortable'].filter(Boolean).join(' ') || null,
    style: c.width ? `width:${c.width}` : null,
    ariaSort: o.sort && o.sort.key === c.key ? o.sort.dir : (c.sortable ? 'none' : null),
    onclick: c.sortable && o.onsort ? () => o.onsort(c.key) : null,
  }, c.text)));

  const body = h('tbody', {});
  for (const r of (o.rows || [])) {
    const row = Array.isArray(r) ? { cells: r } : r;
    body.appendChild(h('tr', {
      class: row.cls, onclick: row.onclick, dataState: row.state, dataRowId: row.id,
    }, row.cells.map((cell, i) => h('td', {
      class: [cols[i] && cols[i].num && 'num', cols[i] && cols[i].chk && 'chk',
        cols[i] && cols[i].name && 'name'].filter(Boolean).join(' ') || null,
    }, cell))));
  }

  if (!(o.rows || []).length) {
    return h('div', { class: 'tblwrap' }, empty(o.empty));
  }
  return h('div', { class: 'tblwrap' },
    h('table', {
      class: 'tbl' + (o.rowlink ? ' rowlink' : '') + (o.compact ? ' compact' : ''),
    }, h('thead', {}, head), body));
}

/** Every table has one of these. A table that can filter and cannot say
 *  "nothing matched" reads as broken rather than as empty. */
export const empty = (o) => {
  const opts = typeof o === 'string' ? { title: o } : (o || {});
  return h('div', { class: 'empty' },
    h('b', {}, opts.title || 'Nothing here'),
    h('span', {}, opts.note || 'No rows match the filters above.'));
};

/**
 * pager({ page, pages, rows, onpage, onrows, total, shown })
 * The footer row every long table carries.
 */
export function pager(o) {
  const nums = [];
  const first = Math.max(1, Math.min(o.page - 2, o.pages - 4));
  for (let p = first; p <= Math.min(o.pages, first + 4); p++) nums.push(p);
  return frag(
    h('span', {}, o.shown || `Showing ${o.total} rows`),
    h('span', { class: 'pager', style: 'margin-left:auto' },
      iconBtn('chevronLeft', 'Previous page', () => o.onpage(o.page - 1),
        { sm: true, disabled: o.page <= 1 }),
      h('span', { class: 'pages' }, nums.map((p) => h('button', {
        class: p === o.page ? 'on' : '', type: 'button',
        ariaCurrent: p === o.page ? 'page' : null, onclick: () => o.onpage(p),
      }, p))),
      iconBtn('chevronRight', 'Next page', () => o.onpage(o.page + 1),
        { sm: true, disabled: o.page >= o.pages }),
      o.onrows && h('span', { class: 'rpp' }, 'Rows per page',
        select([10, 25, 50, 100], { value: o.rows, onchange: (e) => o.onrows(Number(e.target.value)), label: 'Rows per page' }))));
}

/* ------------------------------------------------------------------ detail */

/** A definition list. kv([['Model', 'MARP-Det-v3'], ...]) */
export const kv = (pairs) => h('dl', { class: 'kv' },
  pairs.filter(Boolean).map(([k, v]) => frag(h('dt', {}, k), h('dd', {}, v))));

/** The numbered panel heading the Inference and Training mockups use. */
export const stepTitle = (n, text) => h('span', { class: 'stepnum' }, h('b', {}, n + '.'), text);

/**
 * A right-hand slide-over. Returns { el, close }. The caller appends `el` to
 * the document and calls close() or lets the scrim and Escape do it.
 */
export function drawer(o) {
  const scrim = h('div', { class: 'drawer-scrim' });
  const panelEl = h('aside', { class: 'drawer', role: 'dialog', ariaModal: 'true', ariaLabel: o.title },
    h('header', { class: 'drawer-hd' },
      h('h2', {}, o.title), o.badge, iconBtn('x', 'Close', () => close())),
    h('div', { class: 'drawer-bd' }, o.body),
    o.actions && h('footer', { class: 'drawer-ft' }, o.actions));
  const el = frag(scrim, panelEl);
  const holder = h('div', {}, el);

  function close() {
    holder.remove();
    document.removeEventListener('keydown', esc);
    if (o.onclose) o.onclose();
  }
  function esc(e) { if (e.key === 'Escape') close(); }
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', esc);
  return { el: holder, close };
}

/**
 * The note pinned to a surface with no API behind it. `n` is the numbered item
 * in DESIGN.md's "What has no API behind it", so a reader can find the detail
 * rather than rediscovering the gap.
 */
export const gapNote = (n, text) =>
  h('p', { class: 'gapnote' }, icon('info'),
    h('span', {}, h('b', {}, `Not wired (DESIGN.md ${n}) `), text));

/** A log pane, fed from the fixture's `events`. */
export const logPane = (lines) => h('div', { class: 'log' },
  lines.map((e) => h('div', {},
    h('span', { class: 't' }, fmt.clock(e.at)),
    h('span', { class: 'l', dataLvl: e.level }, e.level),
    h('span', { class: 'm' }, e.message))));

export const sectTitle = (text) => h('div', { class: 'sect' }, text);
