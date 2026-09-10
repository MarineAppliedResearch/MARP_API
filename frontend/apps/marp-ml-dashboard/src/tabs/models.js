/**
 * Models — the `ml_models` registry, with versions as first-class objects.
 *
 * #104: models are selected from MARP's existing registry rather than a
 * parallel catalogue, so this screen is the registry and its versions and
 * nothing else. Two of its words are load-bearing:
 *
 * - **preferred for a task**, with a note saying what for. Task-specific
 *   guidance, not a ranking. #104 names "promoted" as the wrong term for what
 *   MARP means, so the word does not appear here.
 * - **assigned to a worker** means cache and preload it there and prefer that
 *   worker for matching jobs. It does not restrict the worker to that model,
 *   and the screen says so where a user would otherwise assume it did.
 *
 * The registry can be read as models or as the flat list of every version,
 * because "which weights have this hash" and "what has this model shipped"
 * are different questions and the second one is a version list.
 */
import { h, fill, $ } from '../lib/dom.js';
import icon from '../lib/icons.js';
import { fmt } from '../lib/fmt.js';
import {
  panel, panelRow, statRow, stat, tag, table, pager, btn, iconBtn, select, search, seg,
  check, kv, drawer, gapNote, sectTitle,
} from '../lib/parts.js';

export const meta = {
  id: 'models',
  title: 'Models',
  subtitle: 'The registered models and their versions',
};

/** The task wording, decided once so the registry and the job screens agree. */
const TASKS = {
  detect: 'Detect', 'detect-track': 'Detect & Track', classify: 'Classify',
  segment: 'Segment', count: 'Count',
};
const taskLabel = (t) => TASKS[t] || t || '—';

/** A version counts as recent if it was trained inside this window. */
const RECENT_DAYS = 30;

const state = {
  view: 'models',
  q: '',
  shellQ: null,
  task: 'all',
  engine: 'all',
  preferredOnly: false,
  page: 1,
  rows: 10,
  sort: { key: 'updated', dir: 'descending' },
  /** version id -> { task, note } an operator marked here. The fixture carries
   *  the same shape on the version itself, so both are read the same way. */
  preferred: new Map(),
  /** model id -> the workers an operator asked to preload it. Unwired. */
  assigned: new Map(),
};

let ctxRef = null;
let refs = {};

/* ------------------------------------------------------------------ reading */

const versionsOf = (m) => m.versions || [];

/** Newest version by training date; the row's headline. */
function latest(m) {
  return versionsOf(m).slice().sort((a, b) =>
    Date.parse(b.trained_at || 0) - Date.parse(a.trained_at || 0))[0] || null;
}

/** Preferred-for-a-task, whether it came from the fixture or from this screen. */
function preferredOn(v) {
  const local = state.preferred.get(v.id);
  if (local) return local;
  if (v.preferred_for_task) return { task: v.preferred_for_task, note: v.preferred_note || '' };
  return null;
}

const preferredVersions = (m) => versionsOf(m).filter((v) => preferredOn(v));

/** Workers with this model loaded right now. Not the same as "cached": the
 *  pool has no cached-model inventory (see the gap note on the detail). */
function loadedOn(ctx, modelId, version) {
  return (ctx.data.workers || []).filter((w) => w.current_model
    && w.current_model.id === modelId
    && (!version || w.current_model.version === version)).length;
}

function datasetOf(ctx, v) {
  return v && v.dataset_id ? ctx.data.datasetById.get(v.dataset_id) : null;
}

function projectName(ctx) {
  if (!ctx.project || ctx.project === 'all') return null;
  const p = (ctx.data.projects || []).find((x) => x.code === ctx.project);
  return p ? p.name : ctx.project;
}

/** A model belongs to a project through the datasets its versions trained on.
 *  A version with no dataset cannot be placed, and is not hidden for it. */
function inProject(ctx, m, proj) {
  if (!proj) return true;
  const named = versionsOf(m).map((v) => datasetOf(ctx, v)).filter(Boolean);
  if (!named.length) return true;
  return named.some((d) => d.project === proj || d.project === 'All projects');
}

/* ---------------------------------------------------------------- filtering */

function models(ctx) {
  const proj = projectName(ctx);
  const q = state.q.trim().toLowerCase();
  return (ctx.data.models || []).filter((m) => {
    if (state.task !== 'all' && m.task !== state.task) return false;
    if (state.engine !== 'all' && !versionsOf(m).some((v) => v.engine === state.engine)) return false;
    if (state.preferredOnly && !preferredVersions(m).length) return false;
    if (!inProject(ctx, m, proj)) return false;
    if (q) {
      const ds = versionsOf(m).map((v) => (datasetOf(ctx, v) || {}).name).filter(Boolean);
      const hay = [m.name, taskLabel(m.task), m.model_type, m.notes,
        ...versionsOf(m).map((v) => v.version), ...versionsOf(m).map((v) => v.sha256), ...ds]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** The flat version list: every version of every model, one row each. */
function versionRows(ctx) {
  const rows = [];
  for (const m of models(ctx)) {
    for (const v of versionsOf(m)) {
      if (state.engine !== 'all' && v.engine !== state.engine) continue;
      if (state.preferredOnly && !preferredOn(v)) continue;
      rows.push({ m, v });
    }
  }
  return rows;
}

const MODEL_SORTS = {
  name: (ctx, m) => m.name.toLowerCase(),
  task: (ctx, m) => taskLabel(m.task),
  version: (ctx, m) => (latest(m) || {}).version || '',
  metric: (ctx, m) => ((latest(m) || {}).metrics || {}).map50 || 0,
  loaded: (ctx, m) => loadedOn(ctx, m.id),
  versions: (ctx, m) => versionsOf(m).length,
  updated: (ctx, m) => Date.parse(m.updated_at || 0),
};

const VERSION_SORTS = {
  name: (ctx, r) => (r.m.name + ' ' + r.v.version).toLowerCase(),
  task: (ctx, r) => taskLabel(r.v.task),
  version: (ctx, r) => r.v.version,
  metric: (ctx, r) => (r.v.metrics || {}).map50 || 0,
  loaded: (ctx, r) => loadedOn(ctx, r.m.id, r.v.version),
  size: (ctx, r) => r.v.size_mb || 0,
  updated: (ctx, r) => Date.parse(r.v.trained_at || 0),
};

function sortRows(ctx, rows, table_) {
  const pick = table_[state.sort.key] || table_.updated;
  const dir = state.sort.dir === 'descending' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = pick(ctx, a), y = pick(ctx, b);
    if (x < y) return -1 * dir;
    if (x > y) return 1 * dir;
    return 0;
  });
}

function onsort(key) {
  state.sort = state.sort.key === key
    ? { key, dir: state.sort.dir === 'ascending' ? 'descending' : 'ascending' }
    : { key, dir: 'descending' };
  state.page = 1;
  paintList();
}

/* -------------------------------------------------------------- the rollups */

function rollups(ctx) {
  const all = ctx.data.models || [];
  const allVersions = all.flatMap(versionsOf);
  const prefVersions = allVersions.filter((v) => preferredOn(v));
  const prefModels = all.filter((m) => preferredVersions(m).length);
  const loaded = (ctx.data.workers || []).filter((w) => w.current_model).length;
  const cutoff = Date.parse(ctx.data.now) - RECENT_DAYS * 86400000;
  const recent = allVersions.filter((v) => Date.parse(v.trained_at || 0) > cutoff);

  return statRow(
    stat({
      label: 'Registered Models', value: fmt.int(all.length), state: 'idle', ico: 'models',
      sub: [[fmt.int(allVersions.length), 'versions'],
        [fmt.int(new Set(all.map((m) => m.task)).size), 'tasks']],
      onclick: () => { state.view = 'models'; state.preferredOnly = false; state.page = 1; paintAll(); },
    }),
    stat({
      label: 'Preferred For A Task', value: fmt.int(prefVersions.length), state: 'done', ico: 'star',
      sub: [[fmt.int(prefModels.length), 'models'], [fmt.int(new Set(prefVersions.map((v) => preferredOn(v).task)).size), 'tasks covered']],
      onclick: () => { state.preferredOnly = true; state.page = 1; paintAll(); },
    }),
    stat({
      label: 'Loaded On Workers Now', value: fmt.int(loaded),
      of: fmt.int((ctx.data.workers || []).length), state: 'busy', ico: 'gpu',
      sub: [[fmt.int(new Set((ctx.data.workers || []).filter((w) => w.current_model)
        .map((w) => w.current_model.id)).size), 'distinct models']],
      onclick: () => ctx.nav('workers'),
    }),
    stat({
      label: `Trained In ${RECENT_DAYS} Days`, value: fmt.int(recent.length), state: 'running', ico: 'training',
      sub: [[fmt.int(new Set(recent.map((v) => v.id)).size), 'versions']],
      onclick: () => ctx.nav('training'),
    }));
}

/* ------------------------------------------------------------- the registry */

const metricCell = (v, key) => {
  const n = (v.metrics || {})[key];
  return n === undefined || n === null ? h('span', { class: 'dash' }, '—') : fmt.metric(n);
};

const starFor = (v) => {
  const p = v && preferredOn(v);
  return p
    ? h('span', { class: 'star on', title: `Preferred for ${taskLabel(p.task)}` }, icon('star'))
    : null;
};

function taskOptions(ctx) {
  const seen = [...new Set((ctx.data.models || []).map((m) => m.task))];
  return [['all', 'Any task'], ...seen.map((t) => [t, taskLabel(t)])];
}

function engineOptions(ctx) {
  const seen = [...new Set((ctx.data.models || []).flatMap((m) => versionsOf(m).map((v) => v.engine)))];
  return [['all', 'Any engine'], ...seen.sort().map((e) => [e, e])];
}

function modelTable(ctx) {
  const rows = sortRows(ctx, models(ctx), MODEL_SORTS);
  return { rows, el: (slice) => h('div', { class: 't-modelreg' }, table({
    cols: [
      { key: 'name', text: 'Model', sortable: true },
      { key: 'task', text: 'Task', sortable: true },
      { key: 'version', text: 'Latest', sortable: true },
      { key: 'engine', text: 'Engine' },
      { key: 'base', text: 'Base Model' },
      { key: 'dataset', text: 'Training Dataset' },
      { key: 'metric', text: 'mAP@50', sortable: true, num: true },
      { key: 'loaded', text: 'Loaded', sortable: true, num: true },
      { key: 'versions', text: 'Versions', sortable: true, num: true },
      { key: 'updated', text: 'Updated', sortable: true, num: true },
    ],
    sort: state.sort, onsort, rowlink: true,
    empty: { title: 'No models match', note: 'Nothing in the registry matches these filters.' },
    rows: slice.map((m) => {
      const v = latest(m);
      const ds = datasetOf(ctx, v);
      return {
        onclick: () => openModel(m, ctx),
        cells: [
          // The star belongs to the model when *any* of its versions is
          // preferred; the newest version is often not the preferred one.
          h('span', { class: 'rowico mname' }, icon('models'), h('b', {}, m.name),
            starFor(preferredVersions(m)[0])),
          taskLabel(m.task),
          v ? h('span', { class: 'mono' }, v.version) : h('span', { class: 'dash' }, '—'),
          v ? tag(v.engine) : h('span', { class: 'dash' }, '—'),
          v ? h('span', { class: 'mono faint' }, v.base_model || '—') : h('span', { class: 'dash' }, '—'),
          ds
            ? h('button', { class: 'btn ghost sm', type: 'button',
              onclick: (e) => { e.stopPropagation(); ctx.nav('datasets', { dataset: ds.id }); } }, ds.name)
            : h('span', { class: 'dash' }, '—'),
          v ? metricCell(v, 'map50') : h('span', { class: 'dash' }, '—'),
          fmt.int(loadedOn(ctx, m.id)),
          fmt.int(versionsOf(m).length),
          fmt.date(m.updated_at),
        ],
      };
    }),
  })) };
}

function versionTable(ctx) {
  const rows = sortRows(ctx, versionRows(ctx), VERSION_SORTS);
  return { rows, el: (slice) => h('div', { class: 't-versions' }, table({
    cols: [
      { key: 'name', text: 'Model', sortable: true },
      { key: 'version', text: 'Version', sortable: true },
      { key: 'task', text: 'Task', sortable: true },
      { key: 'engine', text: 'Engine' },
      { key: 'dataset', text: 'Trained On' },
      { key: 'metric', text: 'mAP@50', sortable: true, num: true },
      { key: 'p', text: 'Precision', num: true },
      { key: 'r', text: 'Recall', num: true },
      { key: 'size', text: 'Size', sortable: true, num: true },
      { key: 'hash', text: 'Hash' },
      { key: 'updated', text: 'Trained', sortable: true, num: true },
    ],
    sort: state.sort, onsort, rowlink: true,
    empty: { title: 'No versions match', note: 'No registered version matches these filters.' },
    rows: slice.map(({ m, v }) => {
      const ds = datasetOf(ctx, v);
      return {
        onclick: () => openVersion(m, v, ctx),
        cells: [
          h('span', { class: 'rowico mname' }, icon('models'), h('b', {}, m.name), starFor(v)),
          h('span', { class: 'mono' }, v.version),
          taskLabel(v.task),
          tag(v.engine),
          ds ? ds.name : h('span', { class: 'dash' }, '—'),
          metricCell(v, 'map50'),
          metricCell(v, 'precision'),
          metricCell(v, 'recall'),
          fmt.mb(v.size_mb),
          h('span', { class: 'mono faint' }, fmt.hash(v.sha256)),
          fmt.date(v.trained_at),
        ],
      };
    }),
  })) };
}

function registryPanel(ctx) {
  const built = state.view === 'models' ? modelTable(ctx) : versionTable(ctx);
  const total = built.rows.length;
  const pages = Math.max(1, Math.ceil(total / state.rows));
  if (state.page > pages) state.page = pages;
  const slice = built.rows.slice((state.page - 1) * state.rows, state.page * state.rows);
  const proj = projectName(ctx);

  return panel({
    title: 'Model Registry',
    count: total,
    flush: true,
    tools: [
      seg([
        { id: 'models', text: 'Models', ico: 'models' },
        { id: 'versions', text: 'All Versions', ico: 'queue' },
      ], { value: state.view, label: 'Read the registry as',
        onchange: (v) => { state.view = v; state.page = 1; paintList(); } }),
      select(taskOptions(ctx), { value: state.task, label: 'Task',
        onchange: (e) => { state.task = e.target.value; state.page = 1; paintList(); } }),
      select(engineOptions(ctx), { value: state.engine, label: 'Engine',
        onchange: (e) => { state.engine = e.target.value; state.page = 1; paintList(); } }),
      check('Preferred only', state.preferredOnly, (v) => {
        state.preferredOnly = v; state.page = 1; paintList();
      }),
      searchBox(),
    ],
    foot: pager({
      page: state.page, pages, rows: state.rows, total,
      shown: `${fmt.int(total)} ${state.view === 'models' ? 'models' : 'versions'}`
        + (proj ? ` trained on ${proj} data` : ''),
      onpage: (p) => { state.page = Math.min(pages, Math.max(1, p)); paintList(); },
      onrows: (n) => { state.rows = n; state.page = 1; paintList(); },
    }),
  }, built.el(slice));
}

/**
 * Preferred-for-a-task, read the other way round: task first.
 *
 * This is the panel that makes #104's wording true. Preference is guidance for
 * one task, so the useful question is "what should run a segmentation job",
 * and the answer is a version and a reason -- not a rank.
 */
function preferredPanel(ctx) {
  const rows = Object.keys(TASKS).map((task) => {
    const found = [];
    for (const m of (ctx.data.models || [])) {
      for (const v of versionsOf(m)) {
        const p = preferredOn(v);
        if (p && p.task === task) found.push({ m, v, p });
      }
    }
    return { task, found };
  });

  return panel({
    title: 'Preferred For A Task',
    count: rows.filter((r) => r.found.length).length,
    tools: [btn('Preferred only', { ghost: true, sm: true, ico: 'star',
      onclick: () => { state.preferredOnly = true; state.page = 1; paintList(); } })],
  },
  h('div', { class: 'preflist' }, rows.map(({ task, found }) => (found.length
    ? found.map(({ m, v, p }) => h('div', { class: 'prefrow link',
      onclick: () => openVersion(m, v, ctx) },
    h('span', { class: 'star on' }, icon('star')),
    h('div', {},
      h('b', {}, taskLabel(task)),
      h('span', { class: 'mono faint' }, `  ${m.name} ${v.version}`),
      h('p', { class: 'muted' }, p.note || 'No note recorded.')),
    icon('arrowRight')))
    : h('div', { class: 'prefrow none' },
      h('span', { class: 'star' }, icon('star')),
      h('div', {},
        h('b', {}, taskLabel(task)),
        h('p', { class: 'muted' }, 'No preference recorded. A job for this task resolves its '
          + 'model at submit from what the operator chooses.')))))),
  h('p', { class: 'hint' }, 'A preference is task-specific guidance with a reason, not a ranking: '
    + 'one version can be preferred for tracking transect video while another is preferred for '
    + 'still quadrats. Training registers a new version and never marks it preferred.'));
}

/** What the pool is actually running, per model. */
function poolPanel(ctx) {
  const workers = ctx.data.workers || [];
  const counts = new Map();
  for (const w of workers) {
    if (!w.current_model) continue;
    counts.set(w.current_model.id, (counts.get(w.current_model.id) || 0) + 1);
  }
  const rows = (ctx.data.models || [])
    .map((m) => ({ m, n: counts.get(m.id) || 0 }))
    .sort((a, b) => b.n - a.n);
  const max = rows.length ? Math.max(1, rows[0].n) : 1;

  return panel({
    title: 'Loaded On The Pool',
    count: rows.filter((r) => r.n).length,
    tools: [btn('Open the pool', { ghost: true, sm: true, icoAfter: 'arrowRight',
      onclick: () => ctx.nav('workers') })],
  },
  h('div', { class: 'cbars' }, rows.map(({ m, n }) => h('div', { class: 'cbar' },
    h('span', { class: 'cb-name' }, m.name),
    h('span', { class: 'cb-track' }, h('i', { style: `width:${Math.max(1, (n / max) * 100)}%` })),
    h('span', { class: 'cb-num' }, fmt.int(n)),
    h('span', { class: 'cb-pct' }, 'workers')))),
  h('p', { class: 'hint' }, 'Assigning a model to workers caches and preloads it there and prefers '
    + 'those workers for matching jobs. It does not restrict them to it: every other compatible '
    + 'model still runs, and the coordinator still decides what goes where.'),
  gapNote(7, 'These are the models loaded this instant, derived from what each worker reports it '
    + 'is running. There is no cached-model inventory and no route to assign or preload one.'));
}

function searchBox() {
  const box = search('Name, version, dataset, hash...', (e) => {
    state.q = e.target.value;
    state.page = 1;
    paintList();
    const next = $('.model-list .search input');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  });
  box.querySelector('input').value = state.q;
  return box;
}

/* --------------------------------------------------------- the model detail */

/** The form that marks a version preferred. It asks for the task and the note,
 *  because "preferred" on its own is the global ranking #104 says MARP does
 *  not mean -- the task and the reason are the content. */
function preferForm(m, v, done) {
  const taskSel = select(Object.keys(TASKS).map((t) => [t, taskLabel(t)]),
    { value: v.task || m.task, label: 'Preferred for which task', wide: true });
  const note = h('textarea', { class: 'inp wide', rows: 3,
    ariaLabel: 'What this version is preferred for',
    placeholder: 'What is it preferred for, and what is it not preferred for?' });
  const err = h('p', { class: 'hint err' });
  return h('div', { class: 'preferform' },
    h('div', { class: 'field req' }, h('label', {}, 'Preferred for task'), taskSel),
    h('div', { class: 'field req' }, h('label', {}, 'Note'), note,
      h('span', { class: 'hint' }, 'Task-specific guidance, not a ranking. Another version stays '
        + 'preferred for another task, and this changes nothing already queued.')),
    err,
    h('div', { class: 'btnrow' },
      btn('Mark preferred', { primary: true, ico: 'star', onclick: () => {
        if (!note.value.trim()) { err.textContent = 'Say what it is preferred for.'; return; }
        state.preferred.set(v.id, { task: taskSel.value, note: note.value.trim() });
        done(true);
      } }),
      btn('Cancel', { ghost: true, onclick: () => done(false) })));
}

function openModel(m, ctx) {
  const bodyEl = h('div', { class: 'mdetail' });
  let preferring = null;

  const refresh = () => {
    const vs = versionsOf(m).slice().sort((a, b) =>
      Date.parse(b.trained_at || 0) - Date.parse(a.trained_at || 0));
    const v0 = vs[0];
    const prefs = preferredVersions(m);

    fill(bodyEl,
      sectTitle('Registry record'),
      kv([
        ['Name', m.name],
        ['Task', taskLabel(m.task)],
        ['Model type', m.model_type || '—'],
        ['Status', tag(m.status || 'unknown')],
        ['Classes', fmt.int(m.class_count)],
        ['Versions', fmt.int(vs.length)],
        ['Registered', fmt.when(m.created_at)],
        ['Updated', fmt.when(m.updated_at)],
      ]),
      m.notes && h('p', { class: 'notes' }, m.notes),

      sectTitle('Preferred for'),
      prefs.length
        ? h('div', { class: 'preflist' }, prefs.map((v) => {
          const p = preferredOn(v);
          return h('div', { class: 'prefrow' },
            h('span', { class: 'star on' }, icon('star')),
            h('div', {},
              h('b', {}, taskLabel(p.task)),
              h('span', { class: 'mono faint' }, ' ' + v.version),
              h('p', { class: 'muted' }, p.note || 'No note recorded.')),
            state.preferred.has(v.id)
              ? iconBtn('x', 'Remove this preference', () => {
                state.preferred.delete(v.id); refresh(); paintList(); paintStats(); paintRest();
              }, { sm: true })
              : null);
        }))
        : h('p', { class: 'muted' }, 'Not preferred for any task. A successful training run '
          + 'registers a version but never marks it preferred -- that stays a human decision.'),
      preferring
        ? preferForm(m, preferring, (saved) => {
          preferring = null;
          refresh();
          if (saved) { paintList(); paintStats(); paintRest(); }
        })
        : h('div', { class: 'btnrow' },
          btn('Mark a version preferred for a task', { ico: 'star', onclick: () => {
            preferring = v0; refresh();
          }, disabled: !v0 })),

      sectTitle('Versions'),
      table({
        compact: true,
        cols: [
          { key: 'v', text: 'Version' }, { key: 'e', text: 'Engine' },
          { key: 'd', text: 'Trained On' }, { key: 'm', text: 'mAP@50', num: true },
          { key: 's', text: 'Size', num: true }, { key: 'h', text: 'Hash' },
          { key: 't', text: 'Trained', num: true },
        ],
        rowlink: true,
        empty: { title: 'No versions', note: 'Nothing has been registered against this model.' },
        rows: vs.map((v) => {
          const ds = datasetOf(ctx, v);
          return {
            onclick: () => { d.close(); openVersion(m, v, ctx); },
            cells: [
              h('span', {}, h('span', { class: 'mono' }, v.version), starFor(v)),
              tag(v.engine),
              ds ? ds.name : h('span', { class: 'dash' }, '—'),
              metricCell(v, 'map50'),
              fmt.mb(v.size_mb),
              h('span', { class: 'mono faint' }, fmt.hash(v.sha256)),
              fmt.date(v.trained_at),
            ],
          };
        }),
      }),

      sectTitle('On the pool'),
      h('p', { class: 'muted' }, `Loaded on ${fmt.int(loadedOn(ctx, m.id))} of `
        + `${fmt.int((ctx.data.workers || []).length)} workers right now.`),
      h('p', { class: 'hint' },
        'Assigning this model to workers caches and preloads it there and prefers those workers '
        + 'for matching jobs. It does not restrict them to this model: every other compatible '
        + 'model still runs on them, and the coordinator still assigns the work.'),
      gapNote(7, 'Assign or preload a model on a worker has no route, and the pool has no '
        + 'cached-model inventory -- a worker reports its engines and reductions, not what it '
        + 'holds. The count above is what is loaded this instant, not what is cached.'),
      gapNote(6, 'Nothing serves registered model artifacts to workers. A job carries whatever '
        + '`model.url` the submitter typed, with no foreign key to this registry and no '
        + 'validation against it, so a local filesystem path is accepted today.'),
      state.assigned.has(m.id)
        ? h('p', { class: 'pendline' }, tag('pending', 'pend'),
          h('span', { class: 'muted' }, ' Preload requested on the whole pool. Reached nothing.'))
        : null);
  };

  const d = drawer({
    title: m.name,
    badge: tag(taskLabel(m.task)),
    body: bodyEl,
    actions: [
      btn('Use for inference', { primary: true, ico: 'inference',
        onclick: () => { d.close(); ctx.nav('inference', { model: m.id }); } }),
      btn('Assign to workers', { ico: 'workers', onclick: () => {
        state.assigned.set(m.id, 'all');
        refresh();
      } }),
      btn('View versions on the pool', { ghost: true, ico: 'gpu',
        onclick: () => { d.close(); ctx.nav('workers', { q: m.name }); } }),
    ],
  });
  refresh();
  document.body.appendChild(d.el);
}

/* ------------------------------------------------------- the version detail */

function openVersion(m, v, ctx) {
  const ds = datasetOf(ctx, v);
  const p = preferredOn(v);
  const bodyEl = h('div', { class: 'mdetail' });
  let preferring = false;

  const refresh = () => fill(bodyEl,
    sectTitle('Version'),
    kv([
      ['Model', h('button', { class: 'btn ghost sm', type: 'button',
        onclick: () => { d.close(); openModel(m, ctx); } }, m.name)],
      ['Version', h('span', { class: 'mono' }, v.version)],
      ['Task', taskLabel(v.task)],
      ['Engine', tag(v.engine)],
      ['Base model', h('span', { class: 'mono' }, v.base_model || '—')],
      ['Trained', fmt.when(v.trained_at)],
      ['Size', fmt.mb(v.size_mb)],
      ['sha256', h('span', { class: 'mono brk' }, v.sha256 || '—')],
      ['Trained on', ds
        ? h('button', { class: 'btn ghost sm', type: 'button',
          onclick: () => { d.close(); ctx.nav('datasets', { dataset: ds.id }); } },
        `${ds.name} · ${fmt.int(ds.observations)} observations`)
        : '—'],
      ['Loaded on', `${fmt.int(loadedOn(ctx, m.id, v.version))} workers`],
    ]),
    h('p', { class: 'hint' },
      'A job resolves and fixes its exact model, version and hash at submit. Marking another '
      + 'version preferred later does not change work that is already queued.'),

    sectTitle('Metrics on the validation partition'),
    h('div', { class: 'metricrow' },
      [['mAP@50', 'map50'], ['mAP@50-95', 'map5095'], ['Precision', 'precision'], ['Recall', 'recall']]
        .map(([label, key]) => h('div', { class: 'metric' },
          h('span', { class: 'ml' }, label),
          h('b', {}, metricCell(v, key))))),
    h('p', { class: 'hint' }, 'Measured on the saved dataset\'s validation partition. The split is '
      + 'part of the saved dataset and is never re-split, which is what makes two versions '
      + 'comparable at all.'),

    sectTitle('Preferred for'),
    p
      ? h('div', { class: 'prefrow' },
        h('span', { class: 'star on' }, icon('star')),
        h('div', {}, h('b', {}, taskLabel(p.task)), h('p', { class: 'muted' }, p.note || '')),
        state.preferred.has(v.id)
          ? iconBtn('x', 'Remove this preference', () => {
            state.preferred.delete(v.id); refresh(); paintList(); paintStats(); paintRest();
          }, { sm: true })
          : null)
      : preferring
        ? preferForm(m, v, (saved) => {
          preferring = false; refresh();
          if (saved) { paintList(); paintStats(); paintRest(); }
        })
        : h('div', { class: 'btnrow' },
          btn('Mark preferred for a task', { ico: 'star', onclick: () => { preferring = true; refresh(); } })),

    sectTitle(`Class list (${fmt.int((v.classes || []).length)})`),
    h('div', { class: 'tagrow classes' }, (v.classes || []).map((c) => tag(c))),

    sectTitle('Artifact'),
    gapNote(6, 'There is no route that serves this artifact. The hash and the size are recorded, '
      + 'nothing delivers the bytes -- not to a worker and not to a person -- and `model.url` on a '
      + 'submitted job is free text with no link back to this row.'));

  const d = drawer({
    title: `${m.name} ${v.version}`,
    badge: p ? tag('preferred: ' + taskLabel(p.task), 'pref') : null,
    body: bodyEl,
    actions: [
      btn('Use for inference', { primary: true, ico: 'inference',
        onclick: () => { d.close(); ctx.nav('inference', { model: m.id, version: v.id }); } }),
      btn('Train from this checkpoint', { accent: true, ico: 'training',
        onclick: () => { d.close(); ctx.nav('training', { base: v.id }); } }),
      btn('Download artifact', { ghost: true, ico: 'download', disabled: true,
        title: 'No route serves model artifacts (DESIGN.md 6)' }),
    ],
  });
  refresh();
  document.body.appendChild(d.el);
}

/* -------------------------------------------------------------- rendering */

function paintStats() { if (refs.stats) fill(refs.stats, rollups(ctxRef)); }
function paintList() { if (refs.list) fill(refs.list, registryPanel(ctxRef)); }
function paintRest() {
  if (refs.rest) fill(refs.rest, panelRow('2', preferredPanel(ctxRef), poolPanel(ctxRef)));
}
function paintAll() { paintStats(); paintList(); paintRest(); }

export function render(ctx) {
  ctxRef = ctx;
  if (ctx.query !== state.shellQ) {
    state.shellQ = ctx.query;
    state.q = ctx.query || '';
    state.page = 1;
  }
  refs = {
    stats: h('div', {}),
    list: h('div', { class: 'model-list' }),
    rest: h('div', {}),
  };
  const root = h('div', { class: 'tab-models' }, refs.stats, refs.list, refs.rest);
  paintAll();
  return root;
}

export function mount(el, ctx) {
  // A model id in the hash opens that model, so the Jobs and Training screens
  // can link straight at one rather than at the list.
  const id = ctx.params && Number(ctx.params.model);
  if (!id) return;
  const m = ctx.data.modelById.get(id);
  if (m) openModel(m, ctx);
}
