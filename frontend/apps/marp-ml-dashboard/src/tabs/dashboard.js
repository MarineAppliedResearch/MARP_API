/**
 * Dashboard — the landing surface.
 *
 * #104 is emphatic that this is a job-control surface first: the question it
 * answers is "what ML work is running, queued, finished, or needs attention?"
 * Worker capacity is second, and there are no decorative panels, no generic
 * quick actions and no activity feed, because that issue rules all three out.
 *
 * Every number on it is derived from the fixture rows rather than read from the
 * precomputed `counts`, so a job paused or cancelled on the Jobs tab does not
 * leave a card disagreeing with the table under it.
 */
import { h, frag, fill } from '../lib/dom.js';
import icon from '../lib/icons.js';
import { fmt } from '../lib/fmt.js';
import {
  panel, panelRow, statRow, stat, st, kindTag, nameCell, progress,
  btn, select, search, table, pager, moreLink, sectTitle,
} from '../lib/parts.js';
import { ATTN } from '../data.js';
import {
  nowOf, inProject, matchText, ageDays, matchState, sortRows, nextSort,
  projectOptions, scopeCell, modelCell, KIND_OPTIONS, STATUS_OPTIONS, RANGE_OPTIONS,
} from './jobs.js';

export const meta = {
  id: 'dashboard',
  title: 'Machine Learning Dashboard',
  subtitle: 'What the GPU pool is running, queued, and struggling with',
};

const S = {
  q: '', kind: 'all', status: 'all', project: 'all', range: '7', more: false,
  sort: { key: 'updated_at', dir: 'descending' },
  page: 1, rows: 10,
};

let CTX = null;
let COUNT = null;
let TABLE = null;
let FOOT = null;
let SIDE = null;
let BOTTOM = null;
const CTL = {};

/* ------------------------------------------------------------------ render */

export function render(ctx) {
  CTX = ctx;

  COUNT = h('span', { class: 'count' });
  TABLE = h('div', { class: 'rowhost' });
  FOOT = h('div', { class: 'foothost' });
  SIDE = h('div', { class: 'stack' });
  BOTTOM = h('div', {});

  const host = h('div', { class: 'tabgrid' },
    cards(),
    panelRow('wide-narrow',
      panel({ title: frag('Active and Recent Jobs', COUNT), tools: toolbar(), flush: true, foot: FOOT }, TABLE),
      SIDE),
    BOTTOM);

  paint();
  return host;
}

/* ------------------------------------------------------------- stat cards */

function cards() {
  const d = CTX.data;
  const jobs = d.jobs || [];
  const workers = d.workers || [];
  const n = (fn) => jobs.filter(fn).length;
  const kind = (state, k) => n((j) => j.state === state && j.kind === k);

  const pool = poolCounts(workers);
  const slots = slotCounts(workers);

  return statRow(
    stat({
      label: 'Running Jobs', ico: 'play', state: 'running',
      value: fmt.int(n((j) => j.state === 'running')),
      sub: [[kind('running', 'training'), 'training'], [kind('running', 'inference'), 'inference']],
      onclick: () => CTX.nav('jobs', { state: 'running' }),
    }),
    stat({
      label: 'Queued Jobs', ico: 'queue', state: 'queued',
      value: fmt.int(n((j) => j.state === 'queued')),
      sub: [[kind('queued', 'training'), 'training'], [kind('queued', 'inference'), 'inference']],
      onclick: () => CTX.nav('jobs', { state: 'queued' }),
    }),
    stat({
      label: 'Needs Attention', ico: 'alert', state: 'failed',
      value: fmt.int(n((j) => ATTN.has(j.state))),
      sub: [[n((j) => j.state === 'failed'), 'failed'], [n((j) => j.state === 'issues'), 'with issues']],
      onclick: () => CTX.nav('jobs', { state: 'attention' }),
    }),
    stat({
      label: 'Active Workers', ico: 'workers', state: 'online',
      value: fmt.int(pool.reachable), of: fmt.int(pool.total),
      sub: [[fmt.pct(pool.total ? pool.reachable / pool.total : 0), 'reachable'], [pool.busy, 'busy']],
      onclick: () => CTX.nav('workers'),
    }),
    stat({
      label: 'Available GPU Slots', ico: 'gpu', state: 'idle',
      value: fmt.int(slots.free), of: fmt.int(slots.total),
      sub: [[fmt.pct(slots.total ? slots.used / slots.total : 0), 'in use']],
      onclick: () => CTX.nav('workers'),
    }));
}

/** Busy, idle, paused and offline partition the pool; "reachable" is the three
 *  that are not offline, which is what the mockup calls Online. */
function poolCounts(workers) {
  const c = { total: workers.length, busy: 0, idle: 0, paused: 0, offline: 0 };
  for (const w of workers) {
    if (c[w.activity] !== undefined) c[w.activity] += 1;
  }
  c.reachable = c.busy + c.idle + c.paused;
  return c;
}

/** Slots, counted from the pool rather than from `counts`, so the number moves
 *  with the rows the table is drawing. */
function slotCounts(workers) {
  let total = 0, used = 0;
  for (const w of workers) {
    total += w.slot_count || 0;
    used += (w.attempts || []).length;
  }
  return { total, used, free: total - used };
}

/* ---------------------------------------------------------------- toolbar */

function toolbar() {
  CTL.kind = select(KIND_OPTIONS, { value: S.kind, label: 'Job type', onchange: (e) => set('kind', e.target.value) });
  CTL.status = select(STATUS_OPTIONS, { value: S.status, label: 'Status', onchange: (e) => set('status', e.target.value) });
  CTL.project = select(projectOptions(CTX.data), { value: S.project, label: 'Project', onchange: (e) => set('project', e.target.value) });
  CTL.range = select(RANGE_OPTIONS, { value: S.range, label: 'Date range', onchange: (e) => set('range', e.target.value) });

  const box = search('Search these jobs...', (e) => set('q', e.target.value));
  CTL.q = box.querySelector('input');
  CTL.q.value = S.q;

  const more = h('div', { class: 'morefilters', hidden: !S.more },
    box, btn('Clear all filters', { ghost: true, sm: true, onclick: clearAll }));

  return frag(
    CTL.kind, CTL.status, CTL.project,
    h('span', { class: 'rangesel' }, icon('calendar'), CTL.range),
    btn('More Filters', {
      ghost: true, ico: 'filter',
      onclick: (e) => {
        S.more = !S.more;
        more.hidden = !S.more;
        e.currentTarget.classList.toggle('on', S.more);
        if (S.more) CTL.q.focus();
      },
    }),
    more);
}

function set(key, value) {
  S[key] = value;
  S.page = 1;
  paintRows();
}

function clearAll() {
  Object.assign(S, { q: '', kind: 'all', status: 'all', project: 'all', range: '7', page: 1 });
  for (const key of ['kind', 'status', 'project', 'range', 'q']) {
    if (CTL[key]) CTL[key].value = S[key];
  }
  paintRows();
}

/* ------------------------------------------------------------------ filter */

/** Active and recent: everything still moving, plus whatever stopped inside the
 *  chosen window. A landing page that showed the whole table would be the thing
 *  #104 forbids. */
function activeAndRecent() {
  const d = CTX.data;
  const now = nowOf(d);
  const days = S.range === 'all' ? Infinity : Number(S.range);
  return (d.jobs || []).filter((j) => {
    const moving = !j.finished_at;
    return (moving || ageDays(j, now) <= days)
      && matchState(j, S.status)
      && (S.kind === 'all' || j.kind === S.kind)
      && inProject(j, d, S.project)
      && inProject(j, d, CTX.project)
      && matchText(j, S.q)
      && matchText(j, CTX.query);
  });
}

/* ------------------------------------------------------------------- paint */

function paint() {
  paintRows();
  fill(SIDE, poolPanel(), attentionPanel());
  fill(BOTTOM, completedPanel());
}

function paintRows() {
  const rows = sortRows(activeAndRecent(), S.sort);
  const pages = Math.max(1, Math.ceil(rows.length / S.rows));
  if (S.page > pages) S.page = pages;
  const start = (S.page - 1) * S.rows;
  const page = rows.slice(start, start + S.rows);

  fill(COUNT, ` (${fmt.int(rows.length)})`);
  fill(TABLE, table({
    rowlink: true,
    sort: S.sort,
    onsort: (key) => { S.sort = nextSort(S.sort, key); paintRows(); },
    empty: {
      title: 'No active or recent jobs match',
      note: 'Widen the date range, or clear the status and project filters.',
    },
    cols: [
      { key: 'name', text: 'Job Name', sortable: true, name: true },
      { key: 'kind', text: 'Type', sortable: true },
      { key: 'scope', text: 'Scope', sortable: true },
      { key: 'model', text: 'Model', sortable: true },
      { key: 'state', text: 'Status', sortable: true },
      { key: 'progress', text: 'Progress', sortable: true },
      { key: 'workers', text: 'Workers', num: true, sortable: true },
      { key: 'updated_at', text: 'Updated', sortable: true },
    ],
    rows: page.map((job) => ({
      id: job.id,
      cls: ATTN.has(job.state) ? 'attn' : null,
      // The detail drawer belongs to Jobs, and ctx.nav is the only way a tab
      // reaches another tab -- so the row deep-links into it.
      onclick: () => CTX.nav('jobs', { job: job.id }),
      cells: [
        nameCell(job.kind, job.name),
        kindTag(job.kind),
        scopeCell(job),
        modelCell(job),
        st(job.state),
        progress(job),
        job.workers ? `${job.workers.using} / ${job.workers.cap}` : '—',
        fmt.when(job.updated_at),
      ],
    })),
  }));

  fill(FOOT, rows.length
    ? pager({
      page: S.page, pages, rows: S.rows,
      shown: `Showing ${fmt.int(start + 1)}–${fmt.int(start + page.length)} of ${fmt.int(rows.length)} jobs`,
      onpage: (p) => { S.page = Math.min(pages, Math.max(1, p)); paintRows(); },
      onrows: (n) => { S.rows = n; S.page = 1; paintRows(); },
    })
    : h('span', {}, 'No jobs match the filters above.'));
}

/* --------------------------------------------------------- the worker pool */

function poolPanel() {
  const d = CTX.data;
  const workers = d.workers || [];
  const pool = poolCounts(workers);
  const slots = slotCounts(workers);

  const legend = [
    ['busy', 'Busy', pool.busy],
    ['idle', 'Idle', pool.idle],
    ['paused', 'Paused', pool.paused],
    ['offline', 'Offline', pool.offline],
  ];

  // A handful of the pool, most interesting first. #104: the full pool is
  // hundreds of machines and must never be drawn as a fixed set of cards.
  const rank = { busy: 0, idle: 1, paused: 2, offline: 3 };
  const active = workers.slice()
    .sort((a, b) => (rank[a.activity] - rank[b.activity]) || a.name.localeCompare(b.name))
    .slice(0, 6);

  return panel({
    title: 'Worker Pool Summary',
    tools: moreLink('View All Workers', () => CTX.nav('workers')),
  },
  h('div', { class: 'poolrow' },
    donut(legend, pool.total),
    h('div', { class: 'legend' }, legend.map(([state, label, n]) => h('div', { class: 'lg', dataState: state },
      h('span', { class: 'dot' }),
      h('span', { class: 'lg-lab' }, label),
      h('b', {}, fmt.int(n)),
      h('span', { class: 'faint' }, fmt.pct(pool.total ? n / pool.total : 0)))))),
  h('div', { class: 'poolnote muted' },
    `${fmt.int(pool.reachable)} of ${fmt.int(pool.total)} reachable `
    + `(${fmt.pct(pool.total ? pool.reachable / pool.total : 0)}). `
    + 'Paused workers are reachable and taking no work.'),
  h('div', { class: 'slotbox' },
    h('span', { class: 'slot-ico', dataState: 'idle' }, icon('gpu')),
    h('div', {}, h('span', { class: 'muted' }, 'Total GPU Slots'), h('b', {}, fmt.int(slots.total))),
    h('div', { class: 'slotnums' },
      h('div', {}, h('span', { class: 'muted' }, 'In use'),
        h('b', {}, fmt.int(slots.used)), h('span', { class: 'faint' }, fmt.pct(slots.total ? slots.used / slots.total : 0))),
      h('div', {}, h('span', { class: 'muted' }, 'Available'),
        h('b', {}, fmt.int(slots.free)), h('span', { class: 'faint' }, fmt.pct(slots.total ? slots.free / slots.total : 0))))),
  sectTitle(`Active Workers (${fmt.int(active.length)} of ${fmt.int(pool.total)})`),
  table({
    compact: true, rowlink: true,
    empty: { title: 'No workers enrolled', note: 'Nothing has registered with the coordinator.' },
    cols: [{ key: 'name', text: 'Worker', name: true }, { key: 'state', text: 'Status' },
      { key: 'slots', text: 'Slots', num: true }, { key: 'job', text: 'Current Job' }],
    rows: active.map((w) => ({
      onclick: () => CTX.nav('workers', { worker: w.worker_id }),
      cells: [
        w.name,
        st(w.activity),
        `${(w.attempts || []).length} / ${w.slot_count}`,
        w.current_job
          ? h('span', { class: 'clip' }, w.current_job.name)
          : h('span', { class: 'dash' }, '—'),
      ],
    })),
  }));
}

/**
 * The donut, as inline SVG. Stroked arcs on one circle each, offset by the arcs
 * before them, rotated so the first segment starts at twelve o'clock.
 *
 * Built as markup because `document.createElement` cannot make SVG elements --
 * the same reason icons.js authors its markup by hand. Only numbers and states
 * from the list above reach the string, never a field from the fixture.
 */
function donut(legend, total) {
  const R = 40, W = 13, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = legend.filter(([, , n]) => n > 0).map(([state, , n]) => {
    const len = (n / (total || 1)) * C;
    const seg = `<circle class="seg" data-state="${state}" cx="52" cy="52" r="${R}"`
      + ` stroke-width="${W}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"`
      + ` stroke-dashoffset="${(-off).toFixed(2)}"/>`;
    off += len;
    return seg;
  }).join('');

  return h('div', {
    class: 'donut',
    role: 'img',
    ariaLabel: legend.map(([, label, n]) => `${label} ${n}`).join(', ') + `, of ${total} workers`,
    html: `<svg viewBox="0 0 104 104" width="104" height="104" fill="none">`
      + `<circle class="track" cx="52" cy="52" r="${R}" stroke-width="${W}"/>`
      + `<g transform="rotate(-90 52 52)">${arcs}</g>`
      + `<text class="big" x="52" y="50" text-anchor="middle">${total}</text>`
      + `<text class="lab" x="52" y="64" text-anchor="middle">Total</text></svg>`,
  });
}

/* ------------------------------------------------------- needs attention */

function attentionPanel() {
  const d = CTX.data;
  const rows = sortRows((d.jobs || []).filter((j) => ATTN.has(j.state)
    && inProject(j, d, CTX.project) && matchText(j, CTX.query)),
  { key: 'updated_at', dir: 'descending' }).slice(0, 6);

  return panel({
    title: 'Needs Attention', count: rows.length,
    tone: rows.length ? 'attn' : null, flush: true,
    tools: moreLink('View All', () => CTX.nav('jobs', { state: 'attention' })),
  }, table({
    compact: true, rowlink: true,
    empty: { title: 'Nothing needs attention', note: 'No failed or completed-with-issues job in this project.' },
    cols: [{ key: 'name', text: 'Job Name', name: true }, { key: 'kind', text: 'Type' },
      { key: 'state', text: 'Status' }, { key: 'updated_at', text: 'Updated' }],
    rows: rows.map((j) => ({
      id: j.id, cls: 'attn',
      onclick: () => CTX.nav('jobs', { job: j.id }),
      cells: [nameCell(j.kind, j.name), kindTag(j.kind), st(j.state), fmt.when(j.updated_at)],
    })),
  }));
}

/* ------------------------------------------------- recently completed jobs */

function completedPanel() {
  const d = CTX.data;
  const rows = sortRows((d.jobs || []).filter((j) => j.finished_at
    && (j.state === 'succeeded' || j.state === 'issues')
    && inProject(j, d, CTX.project) && matchText(j, CTX.query)),
  { key: 'finished_at', dir: 'descending' }).slice(0, 6);

  return panel({
    title: 'Recently Completed Jobs', count: rows.length, flush: true,
    tools: moreLink('View All', () => CTX.nav('history')),
  }, table({
    rowlink: true,
    empty: { title: 'Nothing completed yet', note: 'No completed job matches the project or search above.' },
    cols: [{ key: 'name', text: 'Job Name', name: true }, { key: 'kind', text: 'Type' },
      { key: 'scope', text: 'Scope' }, { key: 'model', text: 'Model' },
      { key: 'finished_at', text: 'Completed' }, { key: 'duration_s', text: 'Duration', num: true },
      { key: 'detections', text: 'Detections', num: true }, { key: 'state', text: 'Status' }],
    rows: rows.map((j) => ({
      id: j.id,
      onclick: () => CTX.nav('jobs', { job: j.id }),
      cells: [nameCell(j.kind, j.name), kindTag(j.kind), scopeCell(j), modelCell(j),
        fmt.when(j.finished_at), fmt.dur(j.duration_s),
        j.detections === null || j.detections === undefined
          ? h('span', { class: 'dash' }, '—') : fmt.int(j.detections),
        st(j.state)],
    })),
  }));
}
