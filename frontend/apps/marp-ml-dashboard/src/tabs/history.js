/**
 * History — completed work, searchable, and deliberately bounded.
 *
 * #104: "the dashboard must not fetch the complete historical job table every
 * time it loads." So this is a bounded recent view with a window it names out
 * loud, filters, search and paging -- not the whole table with a scrollbar.
 *
 * The one action #104 asks for is Run again / Duplicate, which pre-fills a
 * configuration. Here that means navigating to Inference or Training with the
 * job id in the params; there is no preset or template subsystem, because that
 * issue rules one out until real use justifies it.
 */
import { h, frag, fill } from '../lib/dom.js';
import icon from '../lib/icons.js';
import { fmt, frac } from '../lib/fmt.js';
import {
  panel, panelRow, statRow, stat, st, pill, kindTag, nameCell, bar,
  btn, iconBtn, select, search, table, pager, kv, gapNote, sectTitle,
} from '../lib/parts.js';
import {
  nowOf, inProject, matchText, ageDays, sortRows, nextSort,
  projectOptions, KIND_OPTIONS, workersOn,
} from './jobs.js';

export const meta = {
  id: 'history',
  title: 'History',
  subtitle: 'Completed machine learning work, bounded, searchable',
};

/** Terminal states only. Anything still moving belongs on Jobs. */
const DONE = new Set(['succeeded', 'issues', 'failed', 'cancelled']);

const STATUS_OPTIONS = [
  ['all', 'All statuses'], ['succeeded', 'Completed'], ['issues', 'Completed (Issues)'],
  ['failed', 'Failed'], ['cancelled', 'Cancelled'],
];
const RANGE_OPTIONS = [
  ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All recorded'],
];

const S = {
  q: '', kind: 'all', status: 'all', project: 'all', range: '30', model: 'all', who: 'all',
  more: false, sel: null,
  sort: { key: 'finished_at', dir: 'descending' },
  page: 1, rows: 10,
};

let CTX = null;
let CARDS = null;
let COUNT = null;
let TABLE = null;
let FOOT = null;
let DETAIL = null;
let WINDOW = null;
const CTL = {};

/* ------------------------------------------------------------------ render */

export function render(ctx) {
  CTX = ctx;

  CARDS = h('div', {});
  COUNT = h('span', { class: 'count' });
  TABLE = h('div', { class: 'rowhost' });
  FOOT = h('div', { class: 'foothost' });
  DETAIL = h('div', {});
  WINDOW = h('p', { class: 'winnote' });

  const host = h('div', { class: 'tabgrid' },
    CARDS,
    panel({ title: frag('Job History', COUNT), tools: toolbar(), flush: true, foot: FOOT },
      WINDOW, TABLE),
    DETAIL);

  paintAll();
  return host;
}

/* ---------------------------------------------------------------- toolbar */

function toolbar() {
  CTL.kind = select(KIND_OPTIONS, { value: S.kind, label: 'Job type', onchange: (e) => set('kind', e.target.value) });
  CTL.status = select(STATUS_OPTIONS, { value: S.status, label: 'Status', onchange: (e) => set('status', e.target.value) });
  CTL.range = select(RANGE_OPTIONS, { value: S.range, label: 'Date range', onchange: (e) => set('range', e.target.value) });
  CTL.model = select(modelOptions(), { value: S.model, label: 'Model', onchange: (e) => set('model', e.target.value) });
  CTL.project = select(projectOptions(CTX.data), { value: S.project, label: 'Project', onchange: (e) => set('project', e.target.value) });
  CTL.who = select(whoOptions(), { value: S.who, label: 'Initiated by', onchange: (e) => set('who', e.target.value) });

  const box = search('Search history...', (e) => set('q', e.target.value));
  CTL.q = box.querySelector('input');
  CTL.q.value = S.q;

  const more = h('div', { class: 'morefilters', hidden: !S.more },
    h('span', { class: 'lab' }, 'Project'), CTL.project,
    h('span', { class: 'lab' }, 'Initiated by'), CTL.who,
    btn('Clear all filters', { ghost: true, sm: true, onclick: clearAll }));

  return frag(
    box, CTL.kind, CTL.status,
    h('span', { class: 'rangesel' }, icon('calendar'), CTL.range),
    h('span', { class: 'lab' }, 'Model'), CTL.model,
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
  const names = [...new Set((CTX.data.jobs || [])
    .filter((j) => DONE.has(j.state))
    .map((j) => j.model && j.model.name).filter(Boolean))].sort();
  return [['all', 'All models'], ...names.map((n) => [n, n])];
}
function whoOptions() {
  const who = [...new Set((CTX.data.jobs || [])
    .filter((j) => DONE.has(j.state))
    .map((j) => j.created_by).filter(Boolean))].sort();
  return [['all', 'Anyone'], ...who.map((n) => [n, n])];
}

function set(key, value) {
  S[key] = value;
  S.page = 1;
  paintAll();
}

function clearAll() {
  Object.assign(S, { q: '', kind: 'all', status: 'all', project: 'all', range: '30', model: 'all', who: 'all', page: 1 });
  for (const key of ['kind', 'status', 'range', 'model', 'project', 'who', 'q']) {
    if (CTL[key]) CTL[key].value = S[key];
  }
  paintAll();
}

/* ------------------------------------------------------------------ filter */

const days = () => (S.range === 'all' ? Infinity : Number(S.range));

/** The window, before the status/kind/text filters. The cards count this. */
function inWindow() {
  const d = CTX.data;
  const now = nowOf(d);
  return (d.jobs || []).filter((j) => DONE.has(j.state)
    && ageDays(j, now) <= days()
    && inProject(j, d, S.project)
    && inProject(j, d, CTX.project));
}

/** The window plus everything the toolbar narrows it by. */
function filtered() {
  return inWindow().filter((j) =>
    (S.status === 'all' || j.state === S.status)
    && (S.kind === 'all' || j.kind === S.kind)
    && (S.model === 'all' || (j.model && j.model.name) === S.model)
    && (S.who === 'all' || j.created_by === S.who)
    && matchText(j, S.q)
    && matchText(j, CTX.query));
}

/* ------------------------------------------------------------------- paint */

function paintAll() {
  fill(CARDS, cards());
  paintRows();
  fill(DETAIL, detail());
}

function paintRows() {
  const rows = sortRows(filtered(), S.sort);
  const pages = Math.max(1, Math.ceil(rows.length / S.rows));
  if (S.page > pages) S.page = pages;
  const start = (S.page - 1) * S.rows;
  const page = rows.slice(start, start + S.rows);

  fill(COUNT, ` (${fmt.int(rows.length)})`);
  fill(WINDOW, icon('info'),
    h('span', {},
      S.range === 'all'
        ? `Every completed job the fixture holds — ${fmt.int(inWindow().length)} rows. `
        : `Bounded view: jobs that finished in the last ${S.range} days — ${fmt.int(inWindow().length)} rows. `,
      h('span', { class: 'faint' }, 'The dashboard never loads the whole historical job table; widen the range deliberately.')));
  fill(TABLE, historyTable(page));
  fill(FOOT, rows.length
    ? pager({
      page: S.page, pages, rows: S.rows,
      shown: `Showing ${fmt.int(start + 1)}–${fmt.int(start + page.length)} of ${fmt.int(rows.length)} jobs`,
      onpage: (p) => { S.page = Math.min(pages, Math.max(1, p)); paintRows(); },
      onrows: (n) => { S.rows = n; S.page = 1; paintRows(); },
    })
    : h('span', {}, 'No completed job matches the filters above.'));
}

/* ------------------------------------------------------------- stat cards */

function cards() {
  const win = inWindow();
  const n = (state) => win.filter((j) => j.state === state).length;
  const ok = n('succeeded');
  const issues = n('issues');
  const bad = n('failed') + n('cancelled');

  return statRow(
    stat({
      label: 'Jobs In This Window', ico: 'history', state: 'idle', value: fmt.int(win.length),
      sub: [trend(win.length)],
      onclick: () => pickStatus('all'),
    }),
    stat({
      label: 'Completed', ico: 'check', state: 'done', value: fmt.int(ok),
      sub: [[fmt.pct(win.length ? ok / win.length : 0), 'of the window']],
      onclick: () => pickStatus('succeeded'),
    }),
    stat({
      label: 'Completed With Issues', ico: 'alert', state: 'issues', value: fmt.int(issues),
      sub: [[fmt.pct(win.length ? issues / win.length : 0), 'of the window']],
      onclick: () => pickStatus('issues'),
    }),
    stat({
      label: 'Failed / Cancelled', ico: 'x', state: 'failed', value: fmt.int(bad),
      sub: [[n('failed'), 'failed'], [n('cancelled'), 'cancelled']],
      onclick: () => pickStatus('failed'),
    }));
}

/** The previous window of the same length, so the comparison is a real count
 *  from the fixture rather than a decorative arrow. */
function trend(current) {
  if (S.range === 'all') return [fmt.int(current), 'all recorded'];
  const d = CTX.data;
  const now = nowOf(d);
  const w = days();
  const prev = (d.jobs || []).filter((j) => {
    if (!DONE.has(j.state)) return false;
    const age = ageDays(j, now);
    return age > w && age <= w * 2
      && inProject(j, d, S.project) && inProject(j, d, CTX.project);
  }).length;
  if (!prev) return [fmt.int(current), `in ${w} days`];
  const delta = Math.round(((current - prev) / prev) * 100);
  return [(delta >= 0 ? '+' : '') + delta + '%', `vs previous ${w} days`];
}

function pickStatus(status) {
  S.status = status;
  S.page = 1;
  if (CTL.status) CTL.status.value = status;
  paintAll();
}

/* ------------------------------------------------------------- the table */

function historyTable(rows) {
  return table({
    rowlink: true,
    sort: S.sort,
    onsort: (key) => { S.sort = nextSort(S.sort, key); paintRows(); },
    empty: {
      title: 'No completed job matches',
      note: 'Widen the date range, or clear the status, model and project filters.',
    },
    cols: [
      { key: 'name', text: 'Job Name', sortable: true, name: true },
      { key: 'kind', text: 'Type', sortable: true },
      { key: 'state', text: 'Status', sortable: true },
      { key: 'scope', text: 'Scope / Project', sortable: true },
      { key: 'model', text: 'Model', sortable: true },
      { key: 'dataset', text: 'Dataset / Input', sortable: true },
      { key: 'created_at', text: 'Started', sortable: true },
      { key: 'finished_at', text: 'Completed', sortable: true },
      { key: 'duration_s', text: 'Duration', num: true, sortable: true },
      { key: 'created_by', text: 'Initiated By', sortable: true },
      { key: 'actions', text: 'Actions' },
    ],
    rows: rows.map((job) => ({
      id: job.id,
      cls: job.id === S.sel ? 'sel' : null,
      onclick: () => pickRow(job),
      cells: [
        nameCell(job.kind, job.name),
        kindTag(job.kind),
        st(job.state),
        h('span', { class: 'scopecell' },
          h('span', {}, (job.scope && job.scope.label) || '—'),
          h('span', { class: 'faint' }, (job.scope && job.scope.project) || '')),
        job.model
          ? h('span', { class: 'modelcell' }, h('span', {}, job.model.name),
            h('span', { class: 'faint' }, 'v' + job.model.version))
          : h('span', { class: 'dash' }, '—'),
        job.dataset ? job.dataset.name : h('span', { class: 'dash' }, '—'),
        fmt.when(job.created_at),
        fmt.when(job.finished_at),
        fmt.dur(job.duration_s),
        job.created_by || h('span', { class: 'dash' }, 'service token'),
        h('span', { class: 'rowacts', onclick: (e) => e.stopPropagation() },
          iconBtn('eye', 'Show detail', () => pickRow(job), { sm: true }),
          iconBtn('retry', 'Run again — pre-fills a new job', () => runAgain(job), { sm: true }),
          iconBtn('copy', 'Duplicate — pre-fills a new job', () => runAgain(job), { sm: true })),
      ],
    })),
  });
}

function pickRow(job) {
  S.sel = S.sel === job.id ? null : job.id;
  paintRows();
  fill(DETAIL, detail());
}

/** #104's Run again / Duplicate: it pre-fills a configuration, so it navigates
 *  to the creation surface for that kind with the job id in the params. There
 *  is no route that duplicates a job server-side (DESIGN.md 4). */
const runAgain = (job) => CTX.nav(job.kind === 'training' ? 'training' : 'inference', { from: job.id });

/* -------------------------------------------------------- the detail panel */

function detail() {
  if (S.sel === null) return null;
  const job = CTX.data.jobById.get(S.sel);
  if (!job) return null;
  const run = job.run_id ? CTX.data.runById.get(job.run_id) : null;

  return panel({
    title: frag(nameCell(job.kind, job.name), ' ', pill(job.state), ' ', kindTag(job.kind)),
    tools: frag(
      btn('Run again', { primary: true, ico: 'retry', onclick: () => runAgain(job) }),
      btn('Open model', { ico: 'models', onclick: () => CTX.nav('models', job.model ? { model: job.model.id } : {}) }),
      job.dataset
        ? btn('Open dataset', { ico: 'datasets', onclick: () => CTX.nav('datasets', { dataset: job.dataset.id }) })
        : null,
      btn('View output', { ico: 'download', disabled: true, title: 'No route serves artifact bytes (DESIGN.md 6)' }),
      iconBtn('x', 'Close detail', () => { S.sel = null; paintRows(); fill(DETAIL, detail()); })),
  },
  panelRow('3', info(job), timeline(job), results(job, run)));
}

function info(job) {
  return panel({ title: 'Job Information' }, kv([
    ['Job', h('span', { class: 'mono' }, '#' + job.id)],
    ['Type', kindTag(job.kind)],
    ['Status', st(job.state)],
    ['Scope', (job.scope && job.scope.label) || '—'],
    ['Project', (job.scope && job.scope.project) || '—'],
    ['Model', job.model ? `${job.model.name} v${job.model.version}` : '—'],
    ['Model sha256', h('span', { class: 'mono wrap' }, (job.model && job.model.sha256) || '—')],
    job.dataset ? ['Dataset', job.dataset.name] : null,
    ['Initiated by', job.created_by || h('span', { class: 'dash' }, 'service token')],
    ['Submitted', fmt.when(job.created_at)],
    ['Completed', fmt.when(job.finished_at)],
    ['Duration', fmt.dur(job.duration_s)],
    ['Attempts', `${job.attempts_made} of ${job.max_attempts}`],
    ['Slots allowed', job.workers ? String(job.workers.cap) : '—'],
    ['Workers still on it', String(workersOn(CTX.data, job).length)],
  ]));
}

/**
 * The timeline, collapsed from the event rows: the first event of each kind, in
 * order, which is what a milestone list actually is. With no events for a job
 * -- most of them -- it falls back to the job's own timestamps and says so.
 */
function timeline(job) {
  const events = CTX.data.eventsByJob.get(job.id) || [];
  const seen = new Set();
  const steps = [];
  for (const e of events) {
    if (seen.has(e.kind)) continue;
    seen.add(e.kind);
    steps.push({ label: e.kind, at: e.at, note: e.message, level: e.level });
  }
  const last = events[events.length - 1];
  if (last && !steps.some((s) => s.at === last.at)) {
    steps.push({ label: 'last event', at: last.at, note: last.message, level: last.level });
  }

  const fallback = [
    { label: 'submitted', at: job.created_at, note: 'Queued for the pool' },
    { label: 'finished', at: job.finished_at, note: fmt.label(job.state) },
  ].filter((s) => s.at);

  const list = steps.length ? steps : fallback;
  const stateOf = (level) => (level === 'error' ? 'failed' : level === 'warn' ? 'issues' : 'done');

  return panel({ title: 'Job Timeline' },
    h('ol', { class: 'tline' }, list.map((s) => h('li', { dataState: stateOf(s.level) },
      h('span', { class: 'dot' }),
      h('div', {},
        h('b', {}, s.label),
        h('span', { class: 'tl-at' }, fmt.when(s.at)),
        h('span', { class: 'tl-note' }, s.note))))),
    steps.length
      ? gapNote(5, 'Collapsed from the job event rows. No route returns them, so this is fixture data.')
      : gapNote(5, 'The fixture holds no event rows for this job, so this is the job\'s own timestamps. '
        + 'No route returns event rows in any case.'));
}

function results(job, run) {
  const f = frac(job.progress);
  const last = run && (run.epochs || [])[(run.epochs || []).length - 1];

  const pairs = job.kind === 'training' && run
    ? [
      ['Epochs', `${fmt.int(run.epochs_done)} of ${fmt.int(run.epochs_total)}`],
      last ? ['Final training loss', fmt.metric(last.train_loss)] : null,
      last ? ['Final validation loss', fmt.metric(last.val_loss)] : null,
      last ? ['mAP@0.5', fmt.metric(last.map50)] : null,
      ['Batch size', String(run.batch_size)],
      ['Image size', run.image_size + ' px'],
      ['Optimizer', run.optimizer],
      run.dataset ? ['Training observations', fmt.int(run.dataset.observations)] : null,
      ['Registered version', run.produced_version
        ? run.produced_version.version
        : h('span', { class: 'dash' }, 'none — the run did not finish')],
    ]
    : [
      ['Frames processed', job.progress ? `${fmt.int(job.progress.done)} of ${fmt.int(job.progress.total)}` : '—'],
      ['Detections', job.detections === null || job.detections === undefined
        ? h('span', { class: 'dash' }, 'not counted') : fmt.int(job.detections)],
      ['Videos in scope', job.scope && job.scope.videos ? fmt.int(job.scope.videos) : '—'],
      ['Duration', fmt.dur(job.duration_s)],
      ['Failed pieces', String((job.issues || []).length)],
    ];

  return panel({ title: 'Results Summary' },
    f === null
      ? h('p', { class: 'muted' }, 'No progress was ever reported for this job.')
      : frag(bar(f, job.state), h('div', { class: 'progline' }, h('b', {}, fmt.pct(f)),
        h('span', { class: 'muted' }, job.progress.unit))),
    kv(pairs),
    job.failure_reason
      ? h('div', { class: 'note', dataState: 'failed' }, icon('alert'),
        h('span', {}, h('b', {}, 'Failure. '), job.failure_reason))
      : null,
    (job.issues || []).length
      ? frag(sectTitle('Pieces that failed'),
        h('ul', { class: 'issuelist' }, job.issues.map((it) => h('li', {},
          h('b', {}, it.video), ' ',
          h('span', { class: 'faint' }, `frames ${fmt.int(it.range[0])}–${fmt.int(it.range[1])}, `
            + `${it.attempts} attempts`),
          h('span', { class: 'wrap' }, it.reason)))))
      : null,
    job.detections !== null && job.detections !== undefined
      ? gapNote(11, 'Detections are not rolled up anywhere today; the ingest writes observations and nothing counts them.')
      : null);
}
