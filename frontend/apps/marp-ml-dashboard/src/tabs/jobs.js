/**
 * Jobs — the one shared queue and history for training and inference.
 *
 * #104: training and inference share the GPU pool, so they share one queue,
 * with the kind visible and filterable rather than split into two screens.
 *
 * The most important interaction here is opening a row: the job detail drawer
 * is where "what is this job doing, and what went wrong" is answered. It leads
 * with progress, model, pieces and workers, and keeps chunk/attempt/lease/retry
 * detail under diagnostics -- #104 is explicit that the low-level view must not
 * dominate the normal one.
 *
 * The tab owns its own filter, sort and page state in `S`, and repaints its own
 * subtree. It never calls the shell's render.
 */
import { h, frag, fill } from '../lib/dom.js';
import icon from '../lib/icons.js';
import { fmt, frac } from '../lib/fmt.js';
import {
  panel, panelRow, statRow, stat, st, pill, kindTag, nameCell, progress, bar,
  btn, iconBtn, select, search, table, pager, kv, drawer, gapNote, logPane,
  sectTitle, moreLink,
} from '../lib/parts.js';
import { ATTN } from '../data.js';

export const meta = {
  id: 'jobs',
  title: 'Jobs',
  subtitle: 'One queue for training and inference, newest first',
};

/* ------------------------------------------------------------------ shared */

/* Exported because Dashboard and History filter the same rows by the same two
   shell controls, and two screens that disagree about what "this project" means
   read as a data bug. Candidate for promotion into src/lib. */

/** The clock. The fixture carries its own `now`, and every date filter here is
 *  relative to it -- against the wall clock a fixed fixture drifts out of its
 *  own "last 7 days" and the default view empties for no visible reason. */
export const nowOf = (data) => new Date(data && data.now ? data.now : Date.now());

/** The shell's Project select holds a project *code*; a job's scope holds the
 *  project *name*. This is the one place that mapping is done. */
export function inProject(job, data, code) {
  if (!code || code === 'all') return true;
  const p = (data.projects || []).find((x) => x.code === code);
  const want = p ? p.name : code;
  return (job.scope && job.scope.project) === want;
}

/** The free-text match, over the fields an operator would actually type. */
export function matchText(job, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  const hay = [
    job.name, job.kind, fmt.label(job.state), job.created_by,
    job.scope && job.scope.label, job.scope && job.scope.project,
    job.model && job.model.name, job.model && job.model.version,
    job.dataset && job.dataset.name, String(job.id),
  ];
  return hay.some((v) => v && String(v).toLowerCase().includes(s));
}

/** Days between a job's last movement and the fixture's now. */
export function ageDays(job, now) {
  const t = new Date(job.finished_at || job.updated_at || job.created_at);
  return (now - t) / 86400000;
}

/** The states a status filter can name, including the two rollups a stat card
 *  navigates to. `attention` is #104's needs-attention set, not a job state. */
export function matchState(job, want) {
  if (!want || want === 'all') return true;
  if (want === 'attention') return ATTN.has(job.state);
  if (want === 'live') return job.state === 'running' || job.state === 'cancelling';
  if (want === 'done') return job.state === 'succeeded' || job.state === 'issues';
  return job.state === want;
}

/** The sortable columns, in one map, so a key names the same quantity on every
 *  screen that offers it. Null sorts low rather than throwing. */
export const SORT_KEY = {
  name: (j) => (j.name || '').toLowerCase(),
  kind: (j) => j.kind,
  scope: (j) => ((j.scope && j.scope.label) || '').toLowerCase(),
  model: (j) => ((j.model && j.model.name) || '').toLowerCase(),
  state: (j) => fmt.label(j.state),
  progress: (j) => { const f = frac(j.progress); return f === null ? -1 : f; },
  workers: (j) => (j.workers ? j.workers.using : -1),
  created_at: (j) => j.created_at || '',
  updated_at: (j) => j.updated_at || '',
  finished_at: (j) => j.finished_at || '',
  duration_s: (j) => (j.duration_s === null || j.duration_s === undefined ? -1 : j.duration_s),
  detections: (j) => (j.detections === null || j.detections === undefined ? -1 : j.detections),
  created_by: (j) => (j.created_by || ''),
  dataset: (j) => ((j.dataset && j.dataset.name) || ''),
};

/** Sorted copy. The id tie-break keeps paging deterministic, which is the same
 *  requirement the mosaic reviewer has for a query-derived page. */
export function sortRows(rows, sort) {
  const get = SORT_KEY[sort.key];
  if (!get) return rows;
  const dir = sort.dir === 'ascending' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const x = get(a), y = get(b);
    if (x < y) return -dir;
    if (x > y) return dir;
    return a.id - b.id;
  });
}

/** Toggle a sort key, ascending first, and hand back the new sort. */
export function nextSort(sort, key) {
  if (sort.key === key) return { key, dir: sort.dir === 'ascending' ? 'descending' : 'ascending' };
  return { key, dir: 'ascending' };
}

export const STATUS_OPTIONS = [
  ['all', 'All Statuses'], ['running', 'Running'], ['queued', 'Queued'],
  ['paused', 'Paused'], ['cancelling', 'Cancelling'], ['succeeded', 'Completed'],
  ['issues', 'Completed (Issues)'], ['failed', 'Failed'], ['cancelled', 'Cancelled'],
  ['attention', 'Needs attention'],
];
export const KIND_OPTIONS = [['all', 'All Job Types'], ['inference', 'Inference'], ['training', 'Training']];
export const RANGE_OPTIONS = [['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']];

/** The project select every tab draws, in project order from the fixture. */
export const projectOptions = (data) =>
  [['all', 'All Projects'], ...(data.projects || []).map((p) => [p.code, p.name])];

/** Which workers are contributing to this job, read from their live attempts.
 *  There is no worker list on a job -- `workers.using` is a count -- so the
 *  pool is scanned rather than joined. */
export function workersOn(data, job) {
  const out = [];
  for (const w of (data.workers || [])) {
    for (const a of (w.attempts || [])) {
      if (a.job_id === job.id) out.push({ worker: w, attempt: a });
    }
  }
  return out;
}

/** A scope cell: the selection label, with the project under it when they differ. */
export const scopeCell = (job) => h('span', { class: 'scopecell' },
  h('span', {}, (job.scope && job.scope.label) || '—'),
  job.scope && job.scope.project ? h('span', { class: 'faint' }, job.scope.project) : null);

/** The model cell, name plus version, everywhere the same shape. */
export const modelCell = (job) => (job.model
  ? h('span', { class: 'modelcell' }, h('span', {}, job.model.name),
    h('span', { class: 'faint' }, 'v' + job.model.version))
  : h('span', { class: 'dash' }, '—'));

/* ------------------------------------------------------------- tab state */

const S = {
  q: '', kind: 'all', status: 'all', project: 'all', range: '7',
  model: 'all', who: 'all', more: false,
  sort: { key: 'updated_at', dir: 'descending' },
  page: 1, rows: 10,
};

let CTX = null;
let COUNT = null;      // the (n) in the panel heading, updated in place
let TABLE = null;      // the rows host, repainted without touching the toolbar
let FOOT = null;
let CARDS = null;
let LOWER = null;
let open = null;       // the live drawer, so a second row closes the first
let seenParams = null; // so a shell repaint does not re-apply a stale deep link
let pendingJob = null;
// The toolbar controls are built once and kept, so a filter changed from a stat
// card has to be written back into them by hand or the toolbar starts lying
// about the table underneath it.
const CTL = {};

/* A deep link (`#/jobs?state=failed`) sets the filters once. Re-applying it on
   every shell repaint would fight the operator's own filter changes. */
function applyParams(p) {
  const sig = JSON.stringify(p || {});
  if (sig === seenParams) return;
  seenParams = sig;
  if (p.state) { S.status = p.state; S.page = 1; S.range = 'all'; }
  if (p.kind) { S.kind = p.kind; S.page = 1; }
  if (p.project) S.project = p.project;
  if (p.job) pendingJob = Number(p.job);
}

/* ------------------------------------------------------------------ render */

export function render(ctx) {
  CTX = ctx;
  if (open) { open.close(); open = null; }
  applyParams(ctx.params || {});

  COUNT = h('span', { class: 'count' });
  TABLE = h('div', { class: 'rowhost' });
  FOOT = h('div', { class: 'foothost' });
  CARDS = h('div', {});
  LOWER = h('div', {});

  const host = h('div', { class: 'tabgrid' },
    CARDS,
    panel({ title: frag('Jobs', COUNT), tools: toolbar(), flush: true, foot: FOOT }, TABLE),
    LOWER);

  paintAll();
  return host;
}

export function mount() {
  if (pendingJob !== null) {
    const job = CTX.data.jobById.get(pendingJob);
    pendingJob = null;
    if (job) openJob(job);
  }
}

/* The toolbar is built once and kept. Rebuilding it on every keystroke is what
   makes a search box lose a character per key -- the shell already carries a
   workaround for its own copy of that bug. */
function toolbar() {
  CTL.model = select(modelOptions(), { value: S.model, label: 'Model', onchange: (e) => set('model', e.target.value) });
  CTL.who = select(whoOptions(), { value: S.who, label: 'Submitted by', onchange: (e) => set('who', e.target.value) });
  CTL.kind = select(KIND_OPTIONS, { value: S.kind, label: 'Job type', onchange: (e) => set('kind', e.target.value) });
  CTL.status = select(STATUS_OPTIONS, { value: S.status, label: 'Status', onchange: (e) => set('status', e.target.value) });
  CTL.project = select(projectOptions(CTX.data), { value: S.project, label: 'Project', onchange: (e) => set('project', e.target.value) });
  CTL.range = select(RANGE_OPTIONS, { value: S.range, label: 'Date range', onchange: (e) => set('range', e.target.value) });

  const box = search('Search jobs...', (e) => set('q', e.target.value));
  CTL.q = box.querySelector('input');
  CTL.q.value = S.q;

  const more = h('div', { class: 'morefilters', hidden: !S.more },
    h('span', { class: 'lab' }, 'Model'), CTL.model,
    h('span', { class: 'lab' }, 'Submitted by'), CTL.who,
    btn('Clear all filters', { ghost: true, sm: true, onclick: clearAll }));

  return frag(
    box, CTL.kind, CTL.status, CTL.project,
    h('span', { class: 'rangesel' }, icon('calendar'), CTL.range),
    btn('More Filters', {
      ghost: true, ico: 'filter',
      onclick: (e) => {
        S.more = !S.more;
        more.hidden = !S.more;
        e.currentTarget.classList.toggle('on', S.more);
      },
    }),
    more);
}

function modelOptions() {
  const names = [...new Set((CTX.data.jobs || []).map((j) => j.model && j.model.name).filter(Boolean))].sort();
  return [['all', 'All models'], ...names.map((n) => [n, n])];
}
function whoOptions() {
  const who = [...new Set((CTX.data.jobs || []).map((j) => j.created_by).filter(Boolean))].sort();
  return [['all', 'Anyone'], ...who.map((n) => [n, n])];
}

function set(key, value) {
  S[key] = value;
  S.page = 1;
  paintRows();
}

function clearAll() {
  Object.assign(S, { q: '', kind: 'all', status: 'all', project: 'all', range: '7', model: 'all', who: 'all', page: 1 });
  syncControls();
  paintRows();
}

/** Write `S` back into the persistent controls. */
function syncControls() {
  for (const key of ['kind', 'status', 'project', 'range', 'model', 'who', 'q']) {
    if (CTL[key]) CTL[key].value = S[key];
  }
}

/* ------------------------------------------------------------------ filter */

function filtered() {
  const d = CTX.data;
  const now = nowOf(d);
  const days = S.range === 'all' ? Infinity : Number(S.range);
  return (d.jobs || []).filter((j) =>
    matchState(j, S.status)
    && (S.kind === 'all' || j.kind === S.kind)
    && inProject(j, d, S.project)          // the panel's own project select
    && inProject(j, d, CTX.project)        // and the shell's, ANDed
    && (S.model === 'all' || (j.model && j.model.name) === S.model)
    && (S.who === 'all' || j.created_by === S.who)
    && ageDays(j, now) <= days
    && matchText(j, S.q)
    && matchText(j, CTX.query));
}

/* ------------------------------------------------------------------- paint */

function paintAll() {
  fill(CARDS, cards());
  paintRows();
  fill(LOWER, lower());
}

function paintRows() {
  const rows = sortRows(filtered(), S.sort);
  const pages = Math.max(1, Math.ceil(rows.length / S.rows));
  if (S.page > pages) S.page = pages;
  const start = (S.page - 1) * S.rows;
  const page = rows.slice(start, start + S.rows);

  fill(COUNT, ` (${fmt.int(rows.length)})`);
  fill(TABLE, jobsTable(page));
  fill(FOOT, rows.length
    ? pager({
      page: S.page, pages, rows: S.rows,
      shown: `Showing ${fmt.int(start + 1)}–${fmt.int(start + page.length)} of ${fmt.int(rows.length)} jobs`,
      onpage: (p) => { S.page = Math.min(pages, Math.max(1, p)); paintRows(); },
      onrows: (n) => { S.rows = n; S.page = 1; paintRows(); },
    })
    : h('span', {}, 'No jobs match the filters above.'));
}

/* ------------------------------------------------------------- stat cards */

function cards() {
  const d = CTX.data;
  const all = d.jobs || [];
  const n = (fn) => all.filter(fn).length;
  const kind = (state, k) => n((j) => j.state === state && j.kind === k);
  const today = all.filter((j) => j.finished_at && ageDays(j, nowOf(d)) <= 1);

  return statRow(
    stat({
      label: 'Running Jobs', ico: 'play', state: 'running', value: fmt.int(n((j) => j.state === 'running')),
      sub: [[kind('running', 'inference'), 'inference'], [kind('running', 'training'), 'training']],
      onclick: () => jump('running'),
    }),
    stat({
      label: 'Queued Jobs', ico: 'queue', state: 'queued', value: fmt.int(n((j) => j.state === 'queued')),
      sub: [[kind('queued', 'inference'), 'inference'], [kind('queued', 'training'), 'training']],
      onclick: () => jump('queued'),
    }),
    stat({
      label: 'Completed Today', ico: 'check', state: 'done', value: fmt.int(today.length),
      sub: [[today.filter((j) => j.state === 'succeeded').length, 'successful'],
        [today.filter((j) => j.state === 'issues').length, 'with issues']],
      onclick: () => { S.status = 'done'; S.range = '1'; S.page = 1; syncControls(); paintRows(); },
    }),
    stat({
      label: 'Needs Attention', ico: 'alert', state: 'failed', value: fmt.int(n((j) => ATTN.has(j.state))),
      sub: [[n((j) => j.state === 'failed'), 'failed'], [n((j) => j.state === 'issues'), 'with issues']],
      onclick: () => jump('attention'),
    }));
}

/* A card that names a subset filters to it in place -- this screen already is
   the jobs screen, so navigating away from it would be theatre. */
function jump(status) {
  S.status = status;
  S.range = 'all';
  S.page = 1;
  syncControls();
  paintRows();
}

/* ---------------------------------------------------------- the jobs table */

function jobsTable(rows) {
  const cols = [
    { key: 'name', text: 'Job Name', sortable: true, name: true },
    { key: 'kind', text: 'Type', sortable: true },
    { key: 'scope', text: 'Scope', sortable: true },
    { key: 'model', text: 'Model', sortable: true },
    { key: 'state', text: 'Status', sortable: true },
    { key: 'progress', text: 'Progress', sortable: true },
    { key: 'workers', text: 'Workers', num: true, sortable: true },
    { key: 'created_at', text: 'Submitted', sortable: true },
    { key: 'updated_at', text: 'Updated', sortable: true },
    { key: 'actions', text: 'Actions' },
  ];
  return table({
    cols,
    rowlink: true,
    sort: S.sort,
    onsort: (key) => { S.sort = nextSort(S.sort, key); paintRows(); },
    empty: {
      title: 'No jobs match',
      note: 'Widen the date range, or clear the status and project filters.',
    },
    rows: rows.map((job) => ({
      id: job.id,
      cls: ATTN.has(job.state) ? 'attn' : null,
      onclick: () => openJob(job),
      cells: [
        nameCell(job.kind, job.name),
        kindTag(job.kind),
        scopeCell(job),
        modelCell(job),
        st(job.state),
        progress(job),
        job.workers ? `${job.workers.using} / ${job.workers.cap}` : '—',
        fmt.when(job.created_at),
        fmt.when(job.updated_at),
        rowActions(job),
      ],
    })),
  });
}

/**
 * The actions a state actually allows. #104's two operator meanings for pause
 * are not both expressible against today's API -- one `paused` state cannot say
 * "draining" as well -- so this is the single pause, and the note under the
 * toolbar says none of these have a route yet.
 */
function rowActions(job) {
  const acts = [];
  const stop = (to, label) => iconBtn('stop', label, () => move(job, to), { sm: true, danger: true });
  if (job.state === 'running') {
    acts.push(iconBtn('pause', 'Pause job', () => move(job, 'paused'), { sm: true }));
    acts.push(stop('cancelling', 'Cancel job'));
  } else if (job.state === 'queued') {
    acts.push(iconBtn('play', 'Start now', () => move(job, 'running'), { sm: true }));
    acts.push(stop('cancelled', 'Cancel job'));
  } else if (job.state === 'paused') {
    acts.push(iconBtn('play', 'Resume job', () => move(job, 'running'), { sm: true }));
    acts.push(stop('cancelled', 'Cancel job'));
  } else if (job.state === 'cancelling') {
    // The cancel is already delivered; there is nothing left to ask for.
    acts.push(iconBtn('pause', 'Pause unavailable while cancelling', null, { sm: true, disabled: true }));
    acts.push(iconBtn('stop', 'Cancel already sent', null, { sm: true, danger: true, disabled: true }));
  } else {
    acts.push(iconBtn('retry', 'Retry job', () => retry(job), { sm: true }));
    acts.push(iconBtn('copy', 'Duplicate job', () => duplicate(job), { sm: true }));
  }
  // Without this a row action would also open the drawer behind it.
  return h('span', { class: 'rowacts', onclick: (e) => e.stopPropagation() }, acts);
}

function move(job, to) {
  job.state = to;
  if (to === 'paused' || to === 'cancelled') job.workers = { using: 0, cap: job.workers ? job.workers.cap : 0 };
  if (to === 'cancelled') job.finished_at = job.updated_at;
  paintAll();
}

function retry(job) {
  job.state = 'queued';
  // A retried job has not reported yet, so it has no progress. The dash is the
  // honest cell here; a 0% bar would claim a measurement (#104).
  job.progress = null;
  job.finished_at = null;
  job.duration_s = null;
  job.workers = { using: 0, cap: job.workers ? job.workers.cap : 0 };
  paintAll();
}

const duplicate = (job) => CTX.nav(job.kind === 'training' ? 'training' : 'inference', { from: job.id });

/* ---------------------------------------------------------- lower panels */

function lower() {
  const d = CTX.data;
  const mine = (j) => inProject(j, d, CTX.project) && matchText(j, CTX.query);

  const recent = sortRows((d.jobs || []).filter((j) => mine(j) && j.finished_at && j.state === 'succeeded'),
    { key: 'finished_at', dir: 'descending' }).slice(0, 5);
  const attn = sortRows((d.jobs || []).filter((j) => mine(j) && ATTN.has(j.state)),
    { key: 'updated_at', dir: 'descending' }).slice(0, 6);

  return panelRow('2',
    panel({
      title: 'Recent Completed Jobs', count: recent.length, flush: true,
      tools: moreLink('View All', () => CTX.nav('history')),
    }, table({
      compact: true, rowlink: true,
      empty: { title: 'Nothing completed', note: 'No completed job matches the project or search above.' },
      cols: [{ key: 'name', text: 'Job Name', name: true }, { key: 'kind', text: 'Type' },
        { key: 'model', text: 'Model' }, { key: 'finished_at', text: 'Completed' },
        { key: 'duration_s', text: 'Duration', num: true }, { key: 'state', text: 'Status' }],
      rows: recent.map((j) => ({
        id: j.id, onclick: () => openJob(j),
        cells: [nameCell(j.kind, j.name), kindTag(j.kind), modelCell(j),
          fmt.when(j.finished_at), fmt.dur(j.duration_s), st(j.state)],
      })),
    })),
    panel({
      title: 'Needs Attention', count: attn.length, tone: attn.length ? 'attn' : null, flush: true,
      tools: moreLink('View All', () => jump('attention')),
    }, table({
      compact: true, rowlink: true,
      empty: { title: 'Nothing needs attention', note: 'No failed or issue job matches the filters above.' },
      cols: [{ key: 'name', text: 'Job Name', name: true }, { key: 'kind', text: 'Type' },
        { key: 'state', text: 'Status' }, { key: 'updated_at', text: 'Updated' }],
      rows: attn.map((j) => ({
        id: j.id, cls: 'attn', onclick: () => openJob(j),
        cells: [nameCell(j.kind, j.name), kindTag(j.kind), st(j.state), fmt.when(j.updated_at)],
      })),
    })));
}

/* ------------------------------------------------------------- the drawer */

/**
 * The job detail drawer. Order is #104's: progress, model, pieces, workers,
 * failure state -- then diagnostics, collapsed, for chunk, attempt, lease and
 * retry detail plus the event log.
 */
function openJob(job) {
  if (open) open.close();
  const d = CTX.data;
  const live = workersOn(d, job);
  const run = job.run_id ? d.runById.get(job.run_id) : null;

  const body = frag(
    progressBlock(job),
    job.state === 'cancelling' ? cancellingNote() : null,
    job.failure_reason ? failureBlock(job) : null,
    kv([
      ['Job', h('span', { class: 'mono' }, '#' + job.id)],
      ['Type', kindTag(job.kind)],
      ['State', st(job.state)],
      ['Scope', (job.scope && job.scope.label) || '—'],
      ['Project', (job.scope && job.scope.project) || '—'],
      ['Model', job.model
        ? frag(job.model.name, ' ', h('span', { class: 'faint' }, 'v' + job.model.version),
          ' ', h('span', { class: 'mono faint' }, fmt.hash(job.model.sha256)))
        : '—'],
      job.dataset ? ['Dataset', job.dataset.name] : null,
      ['Priority', String(job.priority)],
      ['Workers', job.workers ? `${job.workers.using} of ${job.workers.cap} slots` : '—'],
      ['Submitted', fmt.when(job.created_at)],
      ['Submitted by', job.created_by || h('span', { class: 'dash' }, 'service token')],
      ['Last update', fmt.when(job.updated_at)],
      job.finished_at ? ['Finished', fmt.when(job.finished_at)] : null,
      job.duration_s ? ['Duration', fmt.dur(job.duration_s)] : null,
      job.detections !== null && job.detections !== undefined
        ? ['Detections', fmt.int(job.detections)] : null,
    ]),
    run ? trainingBlock(run) : null,
    piecesBlock(job, live),
    workersBlock(live),
    diagnostics(job, live));

  open = drawer({
    title: job.name,
    badge: pill(job.state),
    body,
    actions: frag(...drawerActions(job)),
    onclose: () => { open = null; },
  });
  document.body.appendChild(open.el);
}

function progressBlock(job) {
  const f = frac(job.progress);
  if (f === null) {
    return h('div', { class: 'block' }, sectTitle('Overall progress'),
      h('p', { class: 'muted' },
        'No measurement yet. Progress is null until the first heartbeat, so this shows a dash rather than 0%.'));
  }
  const p = job.progress;
  return h('div', { class: 'block' }, sectTitle('Overall progress'),
    bar(f, job.state),
    h('div', { class: 'progline' },
      h('b', {}, fmt.pct(f)),
      h('span', { class: 'muted' }, `${fmt.int(p.done)} of ${fmt.int(p.total)} ${p.unit}`)));
}

/* `cancelling` is derived, not stored: the job is cancelled and an attempt is
   still live. #104 measured 18-20 s, so no duration is promised here. */
const cancellingNote = () => h('div', { class: 'note', dataState: 'cancelling' },
  icon('info'),
  h('span', {}, h('b', {}, 'Cancelling. '),
    'The cancel is delivered and an attempt is still winding down. The job is not '
    + 'cancelled until that attempt reports; it is not a failure, and there is no '
    + 'field for this state — it is derived from the job plus its live attempt.'));

const failureBlock = (job) => h('div', { class: 'note', dataState: 'failed' },
  icon('alert'), h('span', {}, h('b', {}, 'Failure. '), job.failure_reason));

function trainingBlock(run) {
  const last = (run.epochs || [])[(run.epochs || []).length - 1];
  return h('div', { class: 'block' }, sectTitle('Training run'),
    kv([
      ['Run', h('span', { class: 'mono' }, '#' + run.id)],
      ['Epochs', `${fmt.int(run.epochs_done)} of ${fmt.int(run.epochs_total)}`],
      ['Batch size', String(run.batch_size)],
      ['Learning rate', String(run.learning_rate)],
      ['Optimizer', run.optimizer],
      ['Image size', run.image_size + ' px'],
      ['Device', run.compute_device],
      last ? ['Last epoch', `train ${fmt.metric(last.train_loss)} · val ${fmt.metric(last.val_loss)} · mAP@0.5 ${fmt.metric(last.map50)}`] : null,
      run.produced_version ? ['Registered as', run.produced_version.version] : null,
    ]));
}

/**
 * Pieces. A batch is one video cut into frame ranges (#104), and there is no
 * row for the batch, so this is what the API can answer: live ranges from the
 * attempts, failed ranges from the job's issues, and the rest as a rollup.
 */
function piecesBlock(job, live) {
  const issues = job.issues || [];
  return h('div', { class: 'block' }, sectTitle('Pieces'),
    gapNote(1, 'A logical job over a MARP selection, with a per-piece rollup of its own, is Milestone 2. '
      + 'Today a batch is one video cut into frame ranges and has no row to hold a rollup.'),
    h('div', { class: 'piecerow' },
      piece('done', 'Complete', job.progress ? fmt.pct(frac(job.progress)) : '—'),
      piece('running', 'Running', String(live.length)),
      piece('queued', 'Queued', job.state === 'queued' ? '1' : '0'),
      piece('failed', 'Failed', String(issues.length))),
    issues.length
      ? table({
        compact: true,
        cols: [{ key: 'video', text: 'Item', name: true }, { key: 'range', text: 'Frame range' },
          { key: 'attempts', text: 'Attempts', num: true }, { key: 'reason', text: 'Why' }],
        rows: issues.map((it) => [it.video, `${fmt.int(it.range[0])}–${fmt.int(it.range[1])}`,
          String(it.attempts), h('span', { class: 'wrap' }, it.reason)]),
        empty: 'No failed pieces',
      })
      : null);
}

const piece = (state, label, value) => h('div', { class: 'piece', dataState: state },
  h('span', { class: 'dot' }), h('b', {}, value), h('span', {}, label));

function workersBlock(live) {
  return h('div', { class: 'block' }, sectTitle('Workers contributing'),
    table({
      compact: true,
      empty: { title: 'No worker holds this job', note: 'Nothing is leased for it right now.' },
      cols: [{ key: 'name', text: 'Worker', name: true }, { key: 'gpu', text: 'GPU' },
        { key: 'progress', text: 'Attempt progress' }, { key: 'state', text: 'Attempt' }],
      rows: live.map(({ worker, attempt }) => [
        worker.name,
        (worker.capabilities && worker.capabilities.gpus && worker.capabilities.gpus[0]
          ? worker.capabilities.gpus[0].name : '—'),
        attempt.progress_total
          ? `${fmt.int(attempt.progress_done)} / ${fmt.int(attempt.progress_total)} ${attempt.progress_unit}`
          : h('span', { class: 'dash' }, '—'),
        st(worker.activity === 'busy' ? 'running' : worker.activity),
      ]),
    }));
}

/**
 * Diagnostics. Collapsed, because #104 says chunk, attempt, lease and retry
 * detail must not dominate the normal job view. The event log lives here and
 * carries its gap note: the rows exist and no route returns them.
 */
function diagnostics(job, live) {
  const events = CTX.data.eventsByJob.get(job.id) || [];
  return h('details', { class: 'diag' },
    h('summary', {}, icon('chevronRight'), 'Diagnostics — attempts, leases and the event log'),
    h('div', { class: 'diag-bd' },
      kv([
        ['Attempts', `${job.attempts_made} of ${job.max_attempts}`],
        ['Batch', job.batch_id ? h('span', { class: 'mono' }, job.batch_id) : h('span', { class: 'dash' }, 'not batched')],
        ['Model sha256', h('span', { class: 'mono wrap' }, (job.model && job.model.sha256) || '—')],
        ...live.map(({ worker, attempt }) => [
          `Attempt #${attempt.id}`,
          h('span', { class: 'wrap' },
            `${worker.name} slot ${attempt.slot_index}, lease epoch ${attempt.lease_epoch}, `
            + `expires ${fmt.when(attempt.lease_expires_at)}, last heartbeat ${fmt.when(attempt.last_heartbeat_at)}`),
        ]),
      ]),
      gapNote(5, 'The event rows exist — #104 counted 38,101 in one run — and no route returns any of them. '
        + 'This log is read from the fixture.'),
      events.length
        ? logPane(events)
        : h('p', { class: 'muted' }, 'The fixture carries no event lines for this job.')));
}

function drawerActions(job) {
  const acts = [];
  if (job.state === 'running') {
    acts.push(btn('Pause', { ico: 'pause', onclick: () => { move(job, 'paused'); reopen(job); } }));
    acts.push(btn('Cancel job', { danger: true, ico: 'stop', onclick: () => { move(job, 'cancelling'); reopen(job); } }));
  } else if (job.state === 'queued' || job.state === 'paused') {
    acts.push(btn(job.state === 'queued' ? 'Start now' : 'Resume', { ico: 'play', onclick: () => { move(job, 'running'); reopen(job); } }));
    acts.push(btn('Cancel job', { danger: true, ico: 'stop', onclick: () => { move(job, 'cancelled'); reopen(job); } }));
  } else if (job.state === 'cancelling') {
    acts.push(btn('Cancel already sent', { disabled: true, ico: 'stop' }));
  } else {
    acts.push(btn('Retry', { ico: 'retry', onclick: () => { retry(job); reopen(job); } }));
  }
  acts.push(btn('Duplicate', { ico: 'copy', onclick: () => duplicate(job) }));
  acts.push(btn('Open model', { ghost: true, ico: 'models', onclick: () => CTX.nav('models', job.model ? { model: job.model.id } : {}) }));
  return acts;
}

/* An action taken inside the drawer changes what the drawer says, so it is
   rebuilt rather than left showing the state before the click. */
function reopen(job) {
  openJob(job);
}
