/**
 * Workers — the GPU pool.
 *
 * #104 is emphatic that this must not be designed around four office GPUs:
 * MARP may have hundreds of workers, including machines contributed by
 * volunteers. So the pool is drawn as three layers rather than as cards:
 *
 *   1. four rollups, for "is the pool healthy";
 *   2. a grouped summary -- by GPU type, state or worker version -- which is
 *      the layer that still reads at 143 rows and would still read at 1,430;
 *   3. one filtered, sorted, paged table, reached by drilling into a group or
 *      by filtering directly. A row opens the machine's detail.
 *
 * Two honest limits are drawn rather than hidden. A healthy idle worker's
 * `last_seen_at` is up to one long-poll window stale (#104 measured 1.5-55.6
 * s), so the quiet threshold sits at 90 s and the footer says so -- a screen
 * that called a worker dead after 30 s would be wrong about most of the pool.
 * And no worker mutation route exists except rename (DESIGN.md 7), so pause,
 * drain, resume, assign-model and retire are drawn with their gap note.
 */
import { h, fill, $ } from '../lib/dom.js';
import icon from '../lib/icons.js';
import { fmt } from '../lib/fmt.js';
import {
  panel, statRow, stat, st, pill, tag, table, pager, btn, iconBtn, select, search,
  check, kv, drawer, gapNote, bar, sectTitle,
} from '../lib/parts.js';

export const meta = {
  id: 'workers',
  title: 'Workers',
  subtitle: 'The GPU pool that runs the work',
};

/** No contact for this long is "quiet". Well above the 55.6 s long poll #104
 *  measured, because anything under 60 s calls healthy idle machines dead. */
const QUIET_S = 90;

/** An attempt that is still holding a slot. */
const LIVE_ATTEMPT = new Set(['assigned', 'preparing', 'running', 'uploading']);

/** The dimensions the pool can be grouped by. All three are in the pool row;
 *  a contributor or site grouping would be better and has no field (report). */
const GROUPS = [
  ['gpu', 'GPU type'],
  ['activity', 'State'],
  ['version', 'Worker version'],
];

/* Tab-local state. Re-render our own subtree; never the shell's. */
const state = {
  q: '',
  shellQ: null,
  activity: 'all',
  gpu: 'all',
  version: 'all',
  group: 'gpu',
  projectOnly: false,
  page: 1,
  rows: 25,
  sort: { key: 'name', dir: 'ascending' },
  renaming: null,
  /** worker_id -> the name an operator typed here. Rename is the one worker
   *  mutation the API has (#104), so it persists for the session. */
  names: new Map(),
  /** worker_id -> the state an unwired control asked for. Drawn as pending so
   *  the click does something visible without claiming it reached anything. */
  intent: new Map(),
};

let ctxRef = null;
let root = null;
let refs = {};

/* ------------------------------------------------------------ reading a row */

const cap = (w) => w.capabilities || {};
const gpu0 = (w) => (Array.isArray(cap(w).gpus) ? cap(w).gpus[0] : null) || {};
const gpuName = (w) => gpu0(w).name || 'Unknown GPU';
const vramGb = (w) => (gpu0(w).vram_gb === undefined ? null : gpu0(w).vram_gb);
const slots = (w) => w.slot_count || 0;
const busySlots = (w) => (w.attempts || []).filter((a) => LIVE_ATTEMPT.has(a.state)).length;
const nameOf = (w) => state.names.get(w.worker_id) || w.name;
const liveAttempt = (w) => (w.attempts || []).find((a) => LIVE_ATTEMPT.has(a.state)) || null;

/** The state a row draws. An unwired control's intent wins, and is labelled. */
function activityOf(w) {
  return state.intent.get(w.worker_id) || w.activity || w.state || 'offline';
}

/** Seconds since the pool last heard from this machine, against the fixture's
 *  own `now` rather than the wall clock -- the fixture is a snapshot, and a
 *  snapshot read tomorrow would otherwise report the whole pool dead. */
function quietFor(w, now) {
  if (!w.last_seen_at) return null;
  return Math.max(0, (now - Date.parse(w.last_seen_at)) / 1000);
}

const isQuiet = (w, now) => activityOf(w) !== 'offline' && (quietFor(w, now) || 0) > QUIET_S;

/** The shell's project select carries a project code; every row names the
 *  project instead, so the code has to be resolved before anything compares. */
function projectName(ctx) {
  if (!ctx.project || ctx.project === 'all') return null;
  const p = (ctx.data.projects || []).find((x) => x.code === ctx.project);
  return p ? p.name : ctx.project;
}

/** The logical job a worker is on, resolved through the job index. */
function jobOf(w, ctx) {
  const a = liveAttempt(w);
  const byAttempt = a ? ctx.data.jobById.get(a.job_id) : null;
  if (byAttempt) return byAttempt;
  if (w.current_job) return ctx.data.jobById.get(w.current_job.id) || w.current_job;
  return null;
}

/* ---------------------------------------------------------------- filtering */

function filtered(ctx) {
  const now = Date.parse(ctx.data.now);
  const proj = projectName(ctx);
  const q = state.q.trim().toLowerCase();
  return (ctx.data.workers || []).filter((w) => {
    if (state.activity !== 'all') {
      if (state.activity === 'quiet' ? !isQuiet(w, now) : activityOf(w) !== state.activity) return false;
    }
    if (state.gpu !== 'all' && gpuName(w) !== state.gpu) return false;
    if (state.version !== 'all' && w.worker_version !== state.version) return false;
    if (state.projectOnly && proj) {
      const job = jobOf(w, ctx);
      const on = job && job.scope && (job.scope.project === proj || job.scope.project === 'All projects');
      if (!on) return false;
    }
    if (q) {
      const hay = [nameOf(w), w.worker_id, gpuName(w), w.worker_version,
        w.current_model && w.current_model.name, w.current_job && w.current_job.name]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const SORTS = {
  name: (w) => nameOf(w).toLowerCase(),
  activity: (w) => activityOf(w),
  capacity: (w) => slots(w) - busySlots(w),
  gpu: (w) => gpuName(w),
  vram: (w) => vramGb(w) || 0,
  seen: (w) => Date.parse(w.last_seen_at || 0),
};

function sorted(rows) {
  const pick = SORTS[state.sort.key] || SORTS.name;
  const dir = state.sort.dir === 'descending' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = pick(a), y = pick(b);
    if (x < y) return -1 * dir;
    if (x > y) return 1 * dir;
    return nameOf(a).localeCompare(nameOf(b));
  });
}

function onsort(key) {
  state.sort = state.sort.key === key
    ? { key, dir: state.sort.dir === 'ascending' ? 'descending' : 'ascending' }
    : { key, dir: 'ascending' };
  state.page = 1;
  paintList();
}

/* -------------------------------------------------------------- the rollups */

function rollups(ctx) {
  const now = Date.parse(ctx.data.now);
  const all = ctx.data.workers || [];
  const online = all.filter((w) => activityOf(w) !== 'offline');
  const busy = all.filter((w) => activityOf(w) === 'busy');
  const idle = all.filter((w) => activityOf(w) === 'idle');
  const held = all.filter((w) => activityOf(w) === 'paused' || activityOf(w) === 'draining');
  const quiet = all.filter((w) => isQuiet(w, now));
  const slotTotal = all.reduce((n, w) => n + slots(w), 0);
  const slotBusy = all.reduce((n, w) => n + busySlots(w), 0);
  const proj = projectName(ctx);
  const onProject = proj ? all.filter((w) => {
    const job = jobOf(w, ctx);
    return job && job.scope && (job.scope.project === proj || job.scope.project === 'All projects');
  }).length : 0;

  const jump = (key) => () => {
    state.activity = key; state.page = 1; state.q = '';
    paintList(); paintPool();
    const el = $('.pool-list');
    if (el) el.scrollIntoView({ block: 'nearest' });
  };

  return statRow(
    stat({
      label: 'Workers Online', value: fmt.int(online.length), of: fmt.int(all.length),
      state: 'online', ico: 'workers', onclick: jump('all'),
      sub: [[fmt.int(busy.length), 'busy'], [fmt.int(idle.length), 'idle'],
        [fmt.int(all.length - online.length), 'offline']],
    }),
    stat({
      label: 'GPU Slots In Use', value: fmt.int(slotBusy), of: fmt.int(slotTotal),
      state: 'busy', ico: 'gpu', onclick: jump('busy'),
      sub: [[fmt.int(slotTotal - slotBusy), 'free'], [fmt.pct(slotTotal ? slotBusy / slotTotal : 0), 'used']],
    }),
    stat({
      label: 'Paused or Draining', value: fmt.int(held.length),
      state: 'paused', ico: 'pause', onclick: jump('paused'),
      sub: [[fmt.int(held.length), 'paused'], ['—', 'draining']],
    }),
    stat({
      label: `Quiet Over ${QUIET_S}s`, value: fmt.int(quiet.length),
      state: quiet.length ? 'issues' : 'online', ico: 'clock', onclick: jump('quiet'),
      sub: proj ? [[fmt.int(onProject), 'on ' + proj]] : [[fmt.int(all.length - online.length), 'reported offline']],
    }));
}

/* -------------------------------------------------- the grouped pool summary */

function groupKey(w) {
  if (state.group === 'activity') return fmt.label(activityOf(w));
  if (state.group === 'version') return w.worker_version || 'unknown';
  return gpuName(w);
}

function groupRows(ctx) {
  const now = Date.parse(ctx.data.now);
  const map = new Map();
  for (const w of (ctx.data.workers || [])) {
    const key = groupKey(w);
    if (!map.has(key)) {
      map.set(key, { key, n: 0, online: 0, busy: 0, quiet: 0, slots: 0, slotsBusy: 0, vram: vramGb(w) });
    }
    const g = map.get(key);
    g.n++;
    if (activityOf(w) !== 'offline') g.online++;
    if (activityOf(w) === 'busy') g.busy++;
    if (isQuiet(w, now)) g.quiet++;
    g.slots += slots(w);
    g.slotsBusy += busySlots(w);
  }
  return [...map.values()].sort((a, b) => b.slots - a.slots || a.key.localeCompare(b.key));
}

/** Clicking a group is the drill-down: it sets the matching filter on the
 *  table below rather than opening a second view of the same rows. */
function pickGroup(g) {
  if (state.group === 'gpu') state.gpu = state.gpu === g.key ? 'all' : g.key;
  else if (state.group === 'version') state.version = state.version === g.key ? 'all' : g.key;
  else {
    const key = String(g.key).toLowerCase();
    state.activity = state.activity === key ? 'all' : key;
  }
  state.page = 1;
  paintPool();
  paintList();
}

function poolPanel(ctx) {
  const rows = groupRows(ctx);
  const picked = (g) => (state.group === 'gpu' ? state.gpu === g.key
    : state.group === 'version' ? state.version === g.key
      : state.activity === String(g.key).toLowerCase());

  const body = table({
    cols: [
      { key: 'k', text: state.group === 'gpu' ? 'GPU Type' : state.group === 'version' ? 'Worker Version' : 'State' },
      { key: 'n', text: 'Workers', num: true },
      { key: 'on', text: 'Online', num: true },
      { key: 'busy', text: 'Busy', num: true },
      { key: 'slots', text: 'Slots Used', num: true },
      { key: 'cap', text: 'Capacity' },
    ],
    rowlink: true,
    compact: true,
    empty: { title: 'No workers enrolled', note: 'The pool is empty.' },
    rows: rows.map((g) => ({
      cls: picked(g) ? 'sel' : null,
      onclick: () => pickGroup(g),
      cells: [
        h('span', { class: 'rowico' }, icon(state.group === 'activity' ? 'workers' : 'gpu'),
          h('span', {}, g.key),
          g.vram && state.group === 'gpu' ? h('span', { class: 'faint' }, ` ${fmt.gb(g.vram * 1024)}`) : null),
        fmt.int(g.n),
        fmt.int(g.online),
        fmt.int(g.busy),
        `${fmt.int(g.slotsBusy)} / ${fmt.int(g.slots)}`,
        h('span', { class: 'capbar' },
          bar(g.slots ? g.slotsBusy / g.slots : 0, 'busy'),
          h('span', { class: 'pct' }, fmt.pct(g.slots ? g.slotsBusy / g.slots : 0))),
      ],
    })),
  });

  return panel({
    title: 'Pool Summary',
    count: rows.length,
    flush: true,
    tools: [
      h('span', { class: 'lab' }, 'Group by'),
      select(GROUPS, { value: state.group, label: 'Group the pool by',
        onchange: (e) => { state.group = e.target.value; paintPool(); } }),
      btn('Clear drill-down', { ghost: true, sm: true, onclick: () => {
        state.gpu = 'all'; state.version = 'all'; state.activity = 'all';
        state.page = 1; paintPool(); paintList();
      } }),
    ],
    foot: h('span', {}, 'A group is the layer that still reads at a thousand workers. ',
      'Select one to filter the table below; select it again to clear.'),
  }, h('div', { class: 't-pool' }, body));
}

/* --------------------------------------------------------------- the table */

function activityOptions(ctx) {
  const seen = new Set((ctx.data.workers || []).map((w) => activityOf(w)));
  const order = ['busy', 'idle', 'online', 'draining', 'paused', 'offline'];
  return [['all', 'Any state'], ...order.filter((s) => seen.has(s)).map((s) => [s, fmt.label(s)]),
    ['quiet', `Quiet over ${QUIET_S}s`]];
}

function gpuOptions(ctx) {
  const seen = [...new Set((ctx.data.workers || []).map(gpuName))].sort();
  return [['all', 'Any GPU'], ...seen.map((g) => [g, g])];
}

function versionOptions(ctx) {
  const seen = [...new Set((ctx.data.workers || []).map((w) => w.worker_version))].sort().reverse();
  return [['all', 'Any version'], ...seen.map((v) => [v, 'v' + v])];
}

/** The name cell, which is also the rename control. Identity is the durable
 *  generated id (#104); the name under it is editable metadata, and editable
 *  while the machine holds a lease. */
function nameCell(w) {
  if (state.renaming === w.worker_id) {
    const box = h('input', { class: 'inp', value: nameOf(w), ariaLabel: 'Worker name',
      dataRename: w.worker_id,
      onkeydown: (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { state.renaming = null; paintList(); }
        e.stopPropagation();
      } });
    const commit = () => {
      const v = box.value.trim();
      if (v) state.names.set(w.worker_id, v);
      state.renaming = null;
      paintList();
    };
    return h('span', { class: 'renamer', onclick: (e) => e.stopPropagation() },
      box,
      iconBtn('tick', 'Save name', commit, { sm: true }),
      iconBtn('x', 'Cancel rename', () => { state.renaming = null; paintList(); }, { sm: true }));
  }
  return h('span', { class: 'wname' },
    h('b', {}, nameOf(w)),
    state.names.has(w.worker_id) && tag('renamed'),
    // The durable id is on screen next to the name so the distinction between
    // identity and metadata is visible rather than asserted.
    h('span', { class: 'mono faint' }, w.worker_id));
}

function seenCell(w, now) {
  const s = quietFor(w, now);
  if (s === null) return h('span', { class: 'dash' }, '—');
  const quiet = isQuiet(w, now);
  return h('span', { class: 'seen' + (quiet ? ' quiet' : '') },
    fmt.ago(w.last_seen_at, now),
    quiet && icon('alert'));
}

function listPanel(ctx) {
  const now = Date.parse(ctx.data.now);
  const all = filtered(ctx);
  const rows = sorted(all);
  const pages = Math.max(1, Math.ceil(rows.length / state.rows));
  if (state.page > pages) state.page = pages;
  const slice = rows.slice((state.page - 1) * state.rows, state.page * state.rows);
  const proj = projectName(ctx);

  const body = table({
    cols: [
      { key: 'name', text: 'Worker', sortable: true },
      { key: 'activity', text: 'State', sortable: true },
      { key: 'capacity', text: 'Slots', sortable: true, num: true },
      { key: 'gpu', text: 'GPU', sortable: true },
      { key: 'vram', text: 'VRAM', sortable: true, num: true },
      { key: 'job', text: 'Current Job' },
      { key: 'model', text: 'Current Model' },
      { key: 'seen', text: 'Last Seen', sortable: true, num: true },
      { key: 'act', text: 'Actions' },
    ],
    sort: state.sort,
    onsort,
    rowlink: true,
    empty: {
      title: 'No workers match',
      note: 'Nothing in the pool matches these filters. Clear one and try again.',
    },
    rows: slice.map((w) => {
      const job = jobOf(w, ctx);
      const a = liveAttempt(w);
      const act = activityOf(w);
      return {
        id: w.worker_id,
        state: act,
        cls: isQuiet(w, now) ? 'attn' : null,
        onclick: () => openWorker(w, ctx),
        cells: [
          nameCell(w),
          h('span', { class: 'stcell' }, st(act),
            state.intent.has(w.worker_id) && tag('pending', 'pend')),
          h('span', {}, `${busySlots(w)} / ${slots(w)}`),
          gpuName(w),
          vramGb(w) === null ? h('span', { class: 'dash' }, '—') : fmt.gb(vramGb(w) * 1024),
          job
            ? h('span', { class: 'jobcell' },
              h('span', { class: 'nm' }, job.name || `job ${job.id}`),
              a && a.progress_total
                ? h('span', { class: 'faint' }, ` ${fmt.pct(a.progress_done / a.progress_total)}`)
                : null)
            : h('span', { class: 'dash' }, '—'),
          w.current_model
            ? h('span', {}, w.current_model.name,
              h('span', { class: 'faint' }, ' ' + w.current_model.version))
            : h('span', { class: 'dash' }, '—'),
          seenCell(w, now),
          h('span', { class: 'rowacts', onclick: (e) => e.stopPropagation() },
            iconBtn('pencil', `Rename ${nameOf(w)}`, () => { state.renaming = w.worker_id; paintList(); }, { sm: true }),
            act === 'paused' || act === 'draining'
              ? iconBtn('play', `Resume ${nameOf(w)} (not wired)`, () => intend(w, 'idle'), { sm: true })
              : iconBtn('pause', `Pause ${nameOf(w)} (not wired)`, () => intend(w, 'paused'), { sm: true }),
            iconBtn('eye', `Open ${nameOf(w)}`, () => openWorker(w, ctx), { sm: true })),
        ],
      };
    }),
  });

  const chips = h('span', { class: 'fchips' },
    state.gpu !== 'all' && fchip(state.gpu, () => { state.gpu = 'all'; paintPool(); paintList(); }),
    state.version !== 'all' && fchip('v' + state.version, () => { state.version = 'all'; paintPool(); paintList(); }),
    state.activity !== 'all' && fchip(state.activity === 'quiet' ? `quiet > ${QUIET_S}s` : fmt.label(state.activity),
      () => { state.activity = 'all'; paintPool(); paintList(); }),
    state.q && fchip(`"${state.q}"`, () => { state.q = ''; paintList(); }),
    state.projectOnly && proj && fchip(proj, () => { state.projectOnly = false; paintList(); }));

  return panel({
    title: 'Workers',
    count: rows.length,
    flush: true,
    tools: [
      chips,
      select(activityOptions(ctx), { value: state.activity, label: 'Worker state',
        onchange: (e) => { state.activity = e.target.value; state.page = 1; paintList(); paintPool(); } }),
      select(gpuOptions(ctx), { value: state.gpu, label: 'GPU type',
        onchange: (e) => { state.gpu = e.target.value; state.page = 1; paintList(); paintPool(); } }),
      select(versionOptions(ctx), { value: state.version, label: 'Worker version',
        onchange: (e) => { state.version = e.target.value; state.page = 1; paintList(); paintPool(); } }),
      searchBox(),
      proj && check(`Only on ${proj} work`, state.projectOnly, (v) => {
        state.projectOnly = v; state.page = 1; paintList();
      }),
    ],
    foot: [
      pager({
        page: state.page, pages, rows: state.rows, total: rows.length,
        shown: `${fmt.int(rows.length)} of ${fmt.int((ctx.data.workers || []).length)} workers`
          + (rows.length ? ` · showing ${(state.page - 1) * state.rows + 1}-`
            + Math.min(rows.length, state.page * state.rows) : ''),
        onpage: (p) => { state.page = Math.min(pages, Math.max(1, p)); paintList(); },
        onrows: (n) => { state.rows = n; state.page = 1; paintList(); },
      }),
    ],
  }, h('div', { class: 't-workers' }, body),
  h('div', { class: 'poolfoot' },
    h('p', { class: 'hint' },
      `Last Seen is a long poll behind: a healthy idle worker can be up to a full window stale `
      + `(measured 1.5-55.6 s on #104). Quiet means no contact for ${QUIET_S}s, which is why the `
      + `threshold sits above 60 s -- a screen that called a machine dead after 30 s would be wrong `
      + `about most of the pool. Offline is what the pool reports, not something inferred here.`),
    gapNote(12, 'GET /gpu/workers returns every worker with its full capabilities blob and no '
      + 'limit, offset, filter or ordering -- about 2 MB a refresh at 500 workers. This table is '
      + 'drawn as if the route pages, sorts and filters, because at this scale it has to.')));
}

const fchip = (text, onclear) => h('span', { class: 'fchip' }, text,
  h('button', { type: 'button', ariaLabel: `Clear ${text}`, onclick: onclear }, icon('x')));

/** The table's own search box. Kept out of the repaint so typing does not
 *  lose the caret -- only the rows and the footer are rebuilt. */
function searchBox() {
  const box = search('Name, id, GPU, model...', (e) => {
    state.q = e.target.value;
    state.page = 1;
    paintRows();
  });
  const inp = box.querySelector('input');
  inp.value = state.q;
  refs.search = inp;
  return box;
}

/* ------------------------------------------------------------ the detail */

function intend(w, next) {
  state.intent.set(w.worker_id, next);
  paintList();
  paintStats();
}

function openWorker(w, ctx) {
  const now = Date.parse(ctx.data.now);
  const c = cap(w);
  const g = gpu0(w);
  const job = jobOf(w, ctx);
  const a = liveAttempt(w);
  const act = activityOf(w);

  const nameInput = h('input', { class: 'inp wide', value: nameOf(w), ariaLabel: 'Worker name' });
  const saveName = () => {
    const v = nameInput.value.trim();
    if (!v) return;
    state.names.set(w.worker_id, v);
    paintList();
    d.close();
    openWorker(w, ctx);
  };

  const past = (w.attempts || []).filter((x) => !LIVE_ATTEMPT.has(x.state)).slice(0, 8);

  const body = h('div', { class: 'wdetail' },
    sectTitle('Identity'),
    kv([
      ['Durable id', h('span', { class: 'mono' }, w.worker_id)],
      ['Name', h('span', { class: 'namerow' }, nameInput,
        btn('Rename', { sm: true, primary: true, onclick: saveName }))],
      ['Enrolled', fmt.when(w.enrolled_at)],
      ['Worker version', 'v' + (w.worker_version || '—')],
      ['Slots', `${busySlots(w)} of ${slots(w)} in use`],
      ['Last seen', h('span', {}, fmt.ago(w.last_seen_at, now),
        h('span', { class: 'faint' }, '  ' + fmt.when(w.last_seen_at)))],
    ]),
    h('p', { class: 'hint' },
      'The durable id is the identity and survives a restart; the name is editable metadata and '
      + 'may be changed at any time, including while this machine holds a lease. Rename is the '
      + 'only worker mutation that has a route.'),

    sectTitle('Hardware'),
    kv([
      ['GPU', g.name || '—'],
      ['VRAM', g.vram_gb ? fmt.gb(g.vram_gb * 1024) : '—'],
      ['CUDA / driver', `${g.cuda || '—'} / ${g.driver || '—'}`],
      ['CPU', c.cpu || '—'],
      ['RAM', c.ram_gb ? fmt.gb(c.ram_gb * 1024) : '—'],
      ['OS', c.os || '—'],
      ['Python', c.python || '—'],
      ['Max batch', c.max_batch === undefined ? '—' : fmt.int(c.max_batch)],
    ]),
    h('div', { class: 'tagrow' },
      (c.engines || []).map((e) => tag(e)),
      (c.reductions || []).map((r) => tag(r))),

    sectTitle('Current work'),
    job
      ? h('div', { class: 'jobbox' },
        h('div', { class: 'jobline' },
          h('b', {}, job.name || `job ${job.id}`),
          job.kind ? tag(job.kind === 'training' ? 'Training' : 'Inference', 'kind-' + job.kind) : null,
          btn('Open job', { sm: true, ghost: true, icoAfter: 'arrowRight',
            onclick: () => { d.close(); ctx.nav('jobs', { job: job.id }); } })),
        kv([
          job.scope && ['Scope', job.scope.label || '—'],
          job.scope && ['Project', job.scope.project || '—'],
          w.current_model && ['Model', `${w.current_model.name} ${w.current_model.version}`],
          a && ['Slot', `${(a.slot_index || 0) + 1} of ${slots(w)}`],
          a && ['Lease expires', fmt.when(a.lease_expires_at)],
          a && ['Last heartbeat', fmt.ago(a.last_heartbeat_at, now)],
        ].filter(Boolean)),
        a && a.progress_total
          ? h('div', { class: 'progrow', dataState: 'running' },
            bar(a.progress_done / a.progress_total, 'running'),
            h('span', { class: 'pct' }, fmt.pct(a.progress_done / a.progress_total)),
            h('span', { class: 'faint' },
              `${fmt.int(a.progress_done)} / ${fmt.int(a.progress_total)} ${a.progress_unit || ''}`))
          : h('p', { class: 'muted' }, 'No progress reported yet on this attempt.'))
      : h('p', { class: 'muted' }, act === 'offline'
        ? 'Nothing. The pool has not heard from this machine.'
        : 'Nothing. This worker is available for the next matching job.'),

    sectTitle('Recent attempts on this worker'),
    table({
      compact: true,
      cols: [
        { key: 'j', text: 'Job' }, { key: 's', text: 'State' },
        { key: 'p', text: 'Progress', num: true }, { key: 'w', text: 'Leased', num: true },
      ],
      empty: { title: 'No finished attempts', note: 'This machine has not completed work yet.' },
      rows: past.map((x) => {
        const jb = ctx.data.jobById.get(x.job_id);
        return {
          cells: [
            jb ? (jb.name || `job ${x.job_id}`) : `job ${x.job_id}`,
            st(x.state === 'succeeded' ? 'done' : x.state === 'abandoned' ? 'cancelled' : x.state),
            x.progress_total ? fmt.pct(x.progress_done / x.progress_total) : h('span', { class: 'dash' }, '—'),
            fmt.when(x.leased_at),
          ],
        };
      }),
    }),

    sectTitle('Operator controls'),
    gapNote(7, 'No worker mutation route exists. Pause, resume, drain, assign or preload a model '
      + 'and retire all need a direct database write today; only rename has a route. These '
      + 'controls set a pending state on this screen and reach nothing.'),
    gapNote(8, 'One `paused` state cannot express draining versus immediately paused. '
      + '"Pause after current job" and "Pause now" are two different operator intents and the '
      + 'pool has one column for both, so a drained machine and an interrupted one read alike.'),
    h('p', { class: 'hint' },
      'Assigning a model caches and preloads it here and prefers this worker for matching jobs. '
      + 'It does not restrict the worker to that model, and other compatible models still run.'),
    state.intent.has(w.worker_id)
      ? h('p', { class: 'pendline' }, pill(state.intent.get(w.worker_id), 'pending: '
        + fmt.label(state.intent.get(w.worker_id))),
      btn('Undo', { sm: true, ghost: true, onclick: () => {
        state.intent.delete(w.worker_id); paintList(); d.close(); openWorker(w, ctx);
      } }))
      : null);

  const d = drawer({
    title: nameOf(w),
    badge: pill(act),
    body,
    actions: [
      btn('Pause now', { ico: 'stop', onclick: () => { intend(w, 'paused'); d.close(); openWorker(w, ctx); } }),
      btn('Pause after current job', { ico: 'pause',
        onclick: () => { intend(w, 'draining'); d.close(); openWorker(w, ctx); } }),
      btn('Resume', { ico: 'play', onclick: () => { intend(w, 'idle'); d.close(); openWorker(w, ctx); } }),
      btn('Assign model', { ico: 'models', onclick: () => { d.close(); ctx.nav('models'); } }),
      btn('Retire worker', { danger: true, ico: 'x',
        onclick: () => { intend(w, 'offline'); d.close(); openWorker(w, ctx); } }),
    ],
  });
  document.body.appendChild(d.el);
}

/* -------------------------------------------------------------- rendering */

function paintPool() {
  if (!refs.pool) return;
  fill(refs.pool, poolPanel(ctxRef));
}

function paintList() {
  if (!refs.list) return;
  fill(refs.list, listPanel(ctxRef));
  const box = $('input[data-rename]', refs.list);
  if (box) { box.focus(); box.select(); }
}

/** Rows only, so the search box keeps its caret. */
function paintRows() {
  paintList();
  if (refs.search) {
    const next = $('.pool-list .search input');
    if (next) {
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
  }
}

function paintStats() {
  if (refs.stats) fill(refs.stats, rollups(ctxRef));
}

export function render(ctx) {
  ctxRef = ctx;
  // The shell's search is the app-wide one; adopt it when it changes, and let
  // the table's own box override it afterwards.
  if (ctx.query !== state.shellQ) {
    state.shellQ = ctx.query;
    state.q = ctx.query || '';
    state.page = 1;
  }
  if (ctx.params && ctx.params.state && ctx.params.state !== state.activity) {
    state.activity = ctx.params.state;
    state.page = 1;
  }
  refs = {
    stats: h('div', {}),
    pool: h('div', { class: 'pool-summary' }),
    list: h('div', { class: 'pool-list' }),
  };
  root = h('div', { class: 'tab-workers' }, refs.stats, refs.pool, refs.list);
  paintStats();
  paintPool();
  paintList();
  return root;
}
