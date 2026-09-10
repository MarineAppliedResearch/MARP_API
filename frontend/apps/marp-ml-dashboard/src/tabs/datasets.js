/**
 * Datasets — the builder, and the saved datasets.
 *
 * The subtle requirements in #104 all live on this screen, and each one is
 * drawn rather than described:
 *
 * - **Only observations promoted/approved for training are eligible.** The
 *   eligibility filter says so and cannot be turned off; that is what training
 *   approval is for.
 * - **A saved dataset is its observation membership**, not the query that
 *   produced it. So the builder adds *subsets* into a membership, deduplicates
 *   them, and never offers to save a query.
 * - **The split is part of the saved dataset and is never re-split on use.**
 *   Re-splitting risks leakage between experiments and makes model comparisons
 *   unreliable, so a saved dataset's split is read-only here.
 * - **The split cannot be done per observation.** Observations whose key
 *   frames are on screen at the same time must land in the same partition, and
 *   the rule is transitive: A overlaps B, B overlaps C, so A, B and C are one
 *   group even where A and C do not overlap. **The group is the unit the split
 *   assigns**, so every control on the split panel moves a whole group and
 *   there is deliberately no way to move one observation.
 * - **What is frozen is membership and split assignment**, not a byte-for-byte
 *   snapshot. Said in full where a user would ask.
 *
 * The candidate observations and their split groups are generated here, from a
 * seed, because the fixture carries a dataset's `split_groups` as a *count*
 * rather than as rows -- see the report. Everything a saved dataset shows
 * comes from the fixture.
 */
import { h, fill, $ } from '../lib/dom.js';
import icon from '../lib/icons.js';
import { fmt } from '../lib/fmt.js';
import {
  panel, panelRow, table, pager, btn, iconBtn, select, search, seg, tabstrip,
  field, fieldRow, input, kv, drawer, gapNote, sectTitle, stepTitle, tag, bar, empty,
} from '../lib/parts.js';

export const meta = {
  id: 'datasets',
  title: 'Datasets',
  subtitle: 'Build a training dataset, then save its membership and its split',
};

/** The split targets an operator can ask for. Whole groups only, so the
 *  achieved shares land near these rather than on them. */
const RATIOS = [
  ['70-15-15', '70 / 15 / 15'],
  ['80-10-10', '80 / 10 / 10'],
  ['60-20-20', '60 / 20 / 20'],
];

const PARTS = [['train', 'Train'], ['val', 'Validation'], ['test', 'Test']];

const state = {
  view: 'builder',
  /** The query the builder is composing. Not saved with the dataset; #104. */
  qy: {
    project: 'all', dive: 'all', line: 'all', species: 'all', model: 'all',
    confMin: '0.50', confMax: '1.00', from: '', to: '',
  },
  result: null,          // the last query's summary, or null before one is run
  subsets: [],           // { id, label, detail, observations, groups: [...] }
  name: '',
  description: '',
  ratio: '70-15-15',
  assign: new Map(),     // group id -> 'train' | 'val' | 'test'
  gPart: 'all',
  gQuery: '',
  gPage: 1,
  gRows: 12,
  savedQ: '',
  shellQ: null,
  savedPage: 1,
  savedRows: 10,
  nextSubset: 1,
  seeded: false,
};

let ctxRef = null;
let refs = {};

/* ---------------------------------------------------------------- the seed */

/** A tiny deterministic generator. The builder needs candidate observations to
 *  group and split, and the fixture has none; a seeded stream keeps the same
 *  query producing the same numbers twice, which a random one would not. */
function rng(seedText) {
  let s = 2166136261;
  for (const ch of String(seedText)) { s ^= ch.charCodeAt(0); s = Math.imul(s, 16777619); }
  return function next() {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Candidate observations for one query, grouped by the split-grouping rule.
 *
 * Every group's observations overlap in a chain rather than all at once: the
 * first and last do not overlap each other, and are in the same group only
 * because the ones between them link the two. That is the transitive rule in
 * #104, and the group's timeline draws it.
 */
function buildGroups(seed, total, videos) {
  const rand = rng(seed);
  const byId = new Map();
  let left = total;
  let obsId = 880000 + Math.floor(rand() * 90000);
  while (left > 0) {
    const want = 1 + Math.floor(rand() * rand() * 8);
    const size = Math.min(left, want);
    const vi = Math.floor(rand() * videos.length);
    const bucket = Math.floor(rand() * 104);
    const startFrame = 200 + bucket * 400;
    // The id is the video and the frame window rather than a serial number,
    // because two queries that both reach the same window are reaching the
    // same observations -- which is what makes "deduplicated" mean anything.
    const id = `G-${String(vi).padStart(2, '0')}-${String(bucket).padStart(3, '0')}`;
    const existing = byId.get(id);
    const obs = existing ? existing.obs : [];
    for (let i = 0; i < size; i++) {
      const n = obs.length;
      // stride 20, length 25: each observation overlaps its neighbour and
      // nothing further, so a group of four is a chain of three overlaps.
      obs.push({ id: obsId++, from: startFrame + n * 20, to: startFrame + n * 20 + 25 });
    }
    if (existing) {
      existing.frames += size;
      existing.to = obs[obs.length - 1].to;
    } else {
      byId.set(id, {
        id,
        video: videos[vi],
        obs,
        frames: size + 2 + Math.floor(rand() * 3),
        from: obs[0].from,
        to: obs[obs.length - 1].to,
      });
    }
    left -= size;
  }
  return [...byId.values()];
}

/* ------------------------------------------------------------- the query */

function projectName(ctx) {
  if (!ctx.project || ctx.project === 'all') return null;
  const p = (ctx.data.projects || []).find((x) => x.code === ctx.project);
  return p ? p.name : ctx.project;
}

function queryLabel(ctx) {
  const q = state.qy;
  const bits = [];
  const proj = q.project === 'all' ? (projectName(ctx) || 'All projects') : q.project;
  bits.push(proj);
  if (q.dive !== 'all') bits.push(q.dive);
  if (q.line !== 'all') bits.push(q.line);
  if (q.species !== 'all') bits.push(q.species);
  return bits.join(' · ');
}

function queryDetail() {
  const q = state.qy;
  const bits = [`Confidence ${q.confMin}-${q.confMax}`];
  if (q.model !== 'all') bits.push(`Model ${q.model}`);
  if (q.from || q.to) bits.push(`${q.from || 'start'} to ${q.to || 'now'}`);
  bits.push('Approved for training');
  return bits.join('  ·  ');
}

/** Run the query: a summary plus its groups, deterministic in the filters. */
function runQuery(ctx) {
  const seed = JSON.stringify(state.qy) + (projectName(ctx) || '');
  const rand = rng(seed);
  const observations = 620 + Math.floor(rand() * 4200);
  const species = ctx.data.species || [];
  const classCount = Math.max(3, Math.min(species.length, 3 + Math.floor(rand() * 9)));
  const chosen = species.slice(0, classCount);
  // Class counts that sum to the total, biggest first, so the breakdown reads
  // like a real long tail rather than an even split.
  const weights = chosen.map(() => 0.25 + rand());
  const sum = weights.reduce((a, b) => a + b, 0);
  let used = 0;
  const classes = chosen.map((s, i) => {
    const n = i === chosen.length - 1
      ? observations - used
      : Math.max(1, Math.round((weights[i] / sum) * observations));
    used += n;
    return { comname: s.comname, species_id: s.species_id, count: n };
  }).sort((a, b) => b.count - a.count);

  // One video pool per project rather than per query: two queries over the
  // same project reach the same videos, which is where duplicates come from.
  const vseed = state.qy.project === 'all' ? (projectName(ctx) || 'all') : state.qy.project;
  const vrand = rng('videos:' + vseed);
  const videoCount = 14 + Math.floor(vrand() * 26);
  const videos = [];
  for (let i = 0; i < videoCount; i++) {
    videos.push(`D${String(101 + Math.floor(vrand() * 60)).padStart(4, '0')}`
      + `_L${String(1 + Math.floor(vrand() * 40)).padStart(2, '0')}_CAM1`);
  }
  const groups = buildGroups(seed, observations, videos);

  state.result = {
    observations,
    frames: groups.reduce((n, g) => n + g.frames, 0),
    videos: videoCount,
    classes,
    label: queryLabel(ctx),
    detail: queryDetail(),
    groups,
  };
}

/* ------------------------------------------------------- the membership */

/** Every group in the dataset under construction, deduplicated by group id --
 *  which is also how the observations deduplicate, since a group is a set of
 *  observations that cannot be separated. */
function allGroups() {
  const seen = new Map();
  for (const s of state.subsets) {
    for (const g of s.groups) if (!seen.has(g.id)) seen.set(g.id, g);
  }
  return [...seen.values()];
}

const groupObs = (g) => g.obs.length;
const totalObs = () => allGroups().reduce((n, g) => n + groupObs(g), 0);

function addSubset(ctx) {
  pushSubset(ctx);
  paintBuilder();
}

function pushSubset(ctx) {
  if (!state.result) return;
  const r = state.result;
  const id = state.nextSubset++;
  state.subsets.push({
    id, label: r.label, detail: r.detail, observations: r.observations,
    classes: r.classes, groups: r.groups,
  });
  rebalance();
  if (!state.name) state.name = suggestName(ctx);
}

function suggestName(ctx) {
  const proj = state.qy.project !== 'all' ? state.qy.project : (projectName(ctx) || 'ALL');
  return `${proj.replace(/\s+/g, '_')}_Training_v1`;
}

function removeSubset(i) {
  state.subsets.splice(i, 1);
  rebalance();
  paintBuilder();
}

/** Assign whole groups until each partition is near its target share. The
 *  unit is the group, so the achieved shares land near the target and not on
 *  it -- which is the honest behaviour and worth showing. */
function rebalance() {
  const [t, v, s] = state.ratio.split('-').map(Number);
  const target = { train: t / 100, val: v / 100, test: s / 100 };
  const groups = allGroups();
  const total = groups.reduce((n, g) => n + groupObs(g), 0) || 1;
  const got = { train: 0, val: 0, test: 0 };
  state.assign = new Map();
  // Biggest first, so a large group cannot be forced into the smallest
  // partition at the end and blow the ratio apart.
  for (const g of groups.slice().sort((a, b) => groupObs(b) - groupObs(a))) {
    let pick = 'train';
    let worst = -Infinity;
    for (const [key] of PARTS) {
      const deficit = target[key] - got[key] / total;
      if (deficit > worst) { worst = deficit; pick = key; }
    }
    state.assign.set(g.id, pick);
    got[pick] += groupObs(g);
  }
}

function partitionTotals() {
  const out = {
    train: { groups: 0, obs: 0, frames: 0 },
    val: { groups: 0, obs: 0, frames: 0 },
    test: { groups: 0, obs: 0, frames: 0 },
  };
  for (const g of allGroups()) {
    const p = state.assign.get(g.id) || 'train';
    out[p].groups++;
    out[p].obs += groupObs(g);
    out[p].frames += g.frames;
  }
  return out;
}

/** Move one whole group. Nothing on this screen moves less than this. */
function moveGroup(id, part) {
  state.assign.set(id, part);
  paintSplit();
}

/* ------------------------------------------------------- panel 1: eligible */

function diveOptions(ctx) {
  const p = (ctx.data.projects || []).find((x) => x.name === state.qy.project);
  const n = Math.min(12, p ? p.dives : 8);
  const out = [['all', 'All dives']];
  for (let i = 1; i <= n; i++) out.push([`D${String(100 + i).padStart(4, '0')}`, `D${String(100 + i).padStart(4, '0')}`]);
  return out;
}

function queryPanel(ctx) {
  const q = state.qy;
  const set = (k) => (e) => { q[k] = e.target.value; state.result = null; paintBuilder(); };

  return panel({ title: stepTitle(1, 'Eligible Observations') },
    h('p', { class: 'sub' }, 'Filter the observations that are allowed into a training dataset.'),
    h('div', { class: 'lockbox' }, icon('check'),
      h('div', {},
        h('b', {}, 'Approved for training only'),
        h('span', {}, ' Only observations a human has reviewed and approved for training are '
          + 'eligible. That is what training approval is for, and it cannot be switched off here.'))),
    field('Project', select([['all', 'All projects'],
      ...(ctx.data.projects || []).map((p) => [p.name, p.name])],
    { value: q.project, wide: true, label: 'Project', onchange: set('project') })),
    fieldRow(
      field('Dive', select(diveOptions(ctx), { value: q.dive, label: 'Dive', onchange: set('dive') })),
      field('Line', select([['all', 'All lines'], ['L01', 'L01'], ['L02', 'L02'], ['L14', 'L14'],
        ['L30', 'L30'], ['L31', 'L31']], { value: q.line, label: 'Line', onchange: set('line') }))),
    field('Species', select([['all', 'All approved species'],
      ...(ctx.data.species || []).slice(0, 24).map((s) => [s.comname, s.comname])],
    { value: q.species, wide: true, label: 'Species', onchange: set('species') })),
    field('Generating model', select([['all', 'Any model, and hand annotation'],
      ...(ctx.data.models || []).map((m) => [m.name, m.name])],
    { value: q.model, wide: true, label: 'Generating model', onchange: set('model') }),
    { hint: 'Which model produced the detection, for observations that came from inference.' }),
    fieldRow(
      field('Confidence from', input({ value: q.confMin, label: 'Confidence from',
        oninput: (e) => { q.confMin = e.target.value; } })),
      field('to', input({ value: q.confMax, label: 'Confidence to',
        oninput: (e) => { q.confMax = e.target.value; } }))),
    fieldRow(
      field('Approved from', input({ type: 'date', value: q.from, label: 'Approved from',
        oninput: (e) => { q.from = e.target.value; } })),
      field('to', input({ type: 'date', value: q.to, label: 'Approved to',
        oninput: (e) => { q.to = e.target.value; } }))),
    h('div', { class: 'btnrow' },
      btn('Run query', { primary: true, ico: 'search', onclick: () => { runQuery(ctx); paintBuilder(); } }),
      btn('Reset filters', { ghost: true, onclick: () => {
        state.qy = { project: 'all', dive: 'all', line: 'all', species: 'all', model: 'all',
          confMin: '0.50', confMax: '1.00', from: '', to: '' };
        state.result = null;
        paintBuilder();
      } })),
    h('p', { class: 'hint' }, 'The query is a way of finding observations. It is not kept: a saved '
      + 'dataset is defined by the observations that ended up in it.'));
}

/* -------------------------------------------------- panel 2: query results */

const classBars = (classes, top) => {
  const shown = classes.slice(0, top);
  const rest = classes.slice(top);
  const total = classes.reduce((n, c) => n + c.count, 0) || 1;
  const restTotal = rest.reduce((n, c) => n + c.count, 0);
  // The aggregate row counts towards the scale, or a bar three times longer
  // than the top class draws the same length as it.
  const max = Math.max(shown[0] ? shown[0].count : 1, restTotal, 1);
  const row = (name, count, cls) => h('div', { class: 'cbar' + (cls ? ' ' + cls : '') },
    h('span', { class: 'cb-name' }, name),
    // Clamped, because the aggregated "other classes" row can be larger than
    // the largest single class and a 187% bar overflows its own track.
    h('span', { class: 'cb-track' },
      h('i', { style: `width:${Math.min(100, Math.max(2, (count / max) * 100))}%` })),
    h('span', { class: 'cb-num' }, fmt.int(count)),
    h('span', { class: 'cb-pct' }, fmt.pct(count / total)));
  return h('div', { class: 'cbars' },
    shown.map((c) => row(c.comname, c.count)),
    rest.length ? row(`Other (${rest.length} classes)`, restTotal, 'rest') : null);
};

/** Which videos the matching observations sit in, biggest first. */
function videoBars(groups) {
  const per = new Map();
  for (const g of groups) per.set(g.video, (per.get(g.video) || 0) + g.obs.length);
  const rows = [...per.entries()].sort((a, b) => b[1] - a[1]);
  const shown = rows.slice(0, 5);
  const rest = rows.slice(5);
  const restTotal = rest.reduce((n, r) => n + r[1], 0);
  const max = Math.max(1, shown[0] ? shown[0][1] : 1, restTotal);
  const total = rows.reduce((n, r) => n + r[1], 0) || 1;
  const row = (name, count, cls) => h('div', { class: 'cbar' + (cls ? ' ' + cls : '') },
    h('span', { class: 'cb-name mono' }, name),
    h('span', { class: 'cb-track' },
      h('i', { style: `width:${Math.min(100, Math.max(2, (count / max) * 100))}%` })),
    h('span', { class: 'cb-num' }, fmt.int(count)),
    h('span', { class: 'cb-pct' }, fmt.pct(count / total)));
  return h('div', { class: 'cbars' },
    shown.map(([name, count]) => row(name, count)),
    rest.length ? row(`Other (${rest.length} videos)`, restTotal, 'rest') : null);
}

function resultPanel(ctx) {
  const r = state.result;
  if (!r) {
    return panel({ title: stepTitle(2, 'Query Results') },
      empty({ title: 'No query has been run', note: 'Set the filters and run the query to see '
        + 'which approved observations match.' }));
  }
  return panel({ title: stepTitle(2, 'Query Results'), count: r.observations },
    h('div', { class: 'bignums' },
      h('div', {}, h('b', {}, fmt.int(r.observations)), h('span', {}, 'observations')),
      h('div', {}, h('b', {}, fmt.int(r.frames)), h('span', {}, 'key frames')),
      h('div', {}, h('b', {}, fmt.int(r.videos)), h('span', {}, 'videos')),
      h('div', {}, h('b', {}, fmt.int(r.classes.length)), h('span', {}, 'classes')),
      h('div', {}, h('b', {}, fmt.int(r.groups.length)), h('span', {}, 'split groups'))),
    h('div', { class: 'sect' }, 'Class breakdown'),
    classBars(r.classes, 5),
    h('p', { class: 'hint' }, `${fmt.int(r.observations)} observations fall into `
      + `${fmt.int(r.groups.length)} split groups, because observations whose key frames share the `
      + 'screen cannot be separated. The groups are what the split assigns.'),
    h('div', { class: 'btnrow' },
      btn('Add all matching to the dataset', { primary: true, block: true, ico: 'plus',
        onclick: () => addSubset(ctx) })),
    h('p', { class: 'hint' }, 'Adding the same observation twice changes nothing; membership is a '
      + 'set, and duplicates are ignored.'),
    h('div', { class: 'sect' }, 'Where they come from'),
    videoBars(r.groups),
    h('p', { class: 'hint' }, 'The reference mockup shows sample key frames here. They are not '
      + 'drawn: nothing in this app fetches frame images, and a thumbnail strip would be the one '
      + 'part of this screen with no way to wire it.'));
}

/* -------------------------------------------------- panel 3: the dataset */

function datasetPanel(ctx) {
  const groups = allGroups();
  const obs = totalObs();
  const classes = mergedClasses();

  // Held so typing the name can enable Create without a repaint, which would
  // take the caret out of the field being typed into.
  const createBtn = btn('Create dataset', { accent: true, big: true, ico: 'datasets',
    disabled: !obs || !state.name.trim(), onclick: () => saveDataset(ctx) });

  return panel({ title: stepTitle(3, 'Dataset') },
    field('Dataset name', input({ value: state.name, wide: true, label: 'Dataset name',
      placeholder: 'CAMPA_2024_Inverts_Training_v1',
      oninput: (e) => {
        state.name = e.target.value;
        createBtn.disabled = !totalObs() || !state.name.trim();
      } }), { req: true }),
    field('Description', h('textarea', { class: 'inp wide', rows: 2, ariaLabel: 'Description',
      value: state.description, placeholder: 'What is in it, and what it is for.',
      oninput: (e) => { state.description = e.target.value; } })),
    h('div', { class: 'sect' }, `Added subsets (${state.subsets.length})`),
    state.subsets.length
      ? h('div', { class: 'subsets' }, state.subsets.map((s, i) => h('div', { class: 'subset' },
        h('span', { class: 'n' }, i + 1),
        h('div', { class: 'body' },
          h('b', {}, s.label),
          h('span', { class: 'muted' }, s.detail)),
        h('div', { class: 'right' },
          h('b', {}, fmt.int(s.observations)),
          h('span', { class: 'muted' }, 'observations')),
        iconBtn('x', `Remove subset ${i + 1}`, () => removeSubset(i), { sm: true, danger: true }))))
      : empty({ title: 'Nothing added yet', note: 'Run a query and add the matching observations.' }),
    h('div', { class: 'totline' },
      h('span', {}, 'Total, deduplicated'),
      h('b', {}, fmt.int(obs)),
      h('span', { class: 'muted' }, `${fmt.int(groups.length)} split groups`)),
    classes.length ? h('div', { class: 'sect' }, 'Composition') : null,
    classes.length ? classBars(classes, 5) : null,
    h('div', { class: 'frozenbox' }, icon('info'),
      h('div', {},
        h('b', {}, 'What gets saved'),
        h('span', {}, ' The observation membership and the split assignment, and nothing else. '
          + 'An observation that later loses training approval stays in this dataset; an edited '
          + 'observation is used as edited; a deleted one is simply absent when the dataset is '
          + 'rebuilt. Any materialised training copy is a disposable cache built from these ids, '
          + 'never the record itself.'))),
    h('div', { class: 'btnrow' },
      createBtn,
      btn('Save draft', { ghost: true, ico: 'copy', disabled: !obs })),
    !obs ? h('p', { class: 'hint' }, 'Add at least one subset and name the dataset.') : null);
}

function mergedClasses() {
  const map = new Map();
  for (const s of state.subsets) {
    for (const c of (s.classes || [])) {
      map.set(c.comname, (map.get(c.comname) || 0) + c.count);
    }
  }
  return [...map.entries()].map(([comname, count]) => ({ comname, count }))
    .sort((a, b) => b.count - a.count);
}

function saveDataset(ctx) {
  const t = partitionTotals();
  const d = drawer({
    title: 'Dataset saved',
    badge: tag('mockup'),
    body: h('div', {},
      h('p', {}, `${state.name} would be created with ${fmt.int(totalObs())} observations in `
        + `${fmt.int(allGroups().length)} split groups.`),
      kv([
        ['Train', `${fmt.int(t.train.obs)} observations · ${fmt.int(t.train.groups)} groups`],
        ['Validation', `${fmt.int(t.val.obs)} observations · ${fmt.int(t.val.groups)} groups`],
        ['Test', `${fmt.int(t.test.obs)} observations · ${fmt.int(t.test.groups)} groups`],
      ]),
      h('p', { class: 'hint' }, 'Membership and split assignment are what is written. The split '
        + 'is now fixed: every training run over this dataset uses these exact partitions, '
        + 'because re-splitting leaks frames between experiments and makes two models '
        + 'incomparable.'),
      gapNote(6, 'This mockup writes nothing. `datasets` and `dataset_observations` already carry '
        + 'membership and an `inclusion_type` of train, val or test, so the split has somewhere '
        + 'to live -- what has no route yet is creating one of these from the dashboard.')),
    actions: [btn('Close', { primary: true, onclick: () => d.close() })],
  });
  document.body.appendChild(d.el);
}

/* --------------------------------------------------- panel 4: the split */

/**
 * One group, drawn as its own overlap timeline.
 *
 * This is the part that has to teach the rule. Each observation is a bar
 * placed by its key-frame span, so a group of four reads as a staircase in
 * which each bar overlaps its neighbour and the first and last do not touch.
 * A control that appeared to move one bar would teach exactly the wrong model,
 * so the partition control belongs to the group and there is none per row.
 */
function groupCard(g) {
  const part = state.assign.get(g.id) || 'train';
  const span = Math.max(1, g.to - g.from);
  const chain = g.obs.length > 1;

  return h('div', { class: 'grp', dataPart: part },
    h('header', {},
      h('b', { class: 'mono' }, g.id),
      tag(`${g.obs.length} obs`),
      tag(`${g.frames} frames`),
      h('span', { class: 'mono faint vid' }, g.video)),
    h('div', { class: 'chain', role: 'img',
      ariaLabel: `${g.obs.length} observations, overlapping in a chain across frames ${g.from} to ${g.to}` },
      g.obs.map((o) => h('span', { class: 'obsbar' },
        h('i', { style: `left:${((o.from - g.from) / span) * 100}%;`
          + `width:${Math.max(4, ((o.to - o.from) / span) * 100)}%` })))),
    h('div', { class: 'grpfoot' },
      h('span', { class: 'mono faint' }, `frames ${fmt.int(g.from)}-${fmt.int(g.to)}`),
      chain
        ? h('span', { class: 'why' }, `one group: ${g.obs.length - 1} overlapping pair`
          + (g.obs.length > 2 ? 's, linked transitively' : ''))
        : h('span', { class: 'why' }, 'one group: nothing shares its frames')),
    h('div', { class: 'grpmove' },
      seg(PARTS.map(([id, text]) => ({ id, text })), {
        value: part, label: `Partition for group ${g.id}`,
        onchange: (p) => moveGroup(g.id, p),
      }),
      iconBtn('eye', `Open group ${g.id}`, () => openGroup(g), { sm: true })));
}

function openGroup(g) {
  const span = Math.max(1, g.to - g.from);
  const part = state.assign.get(g.id) || 'train';
  const pairs = [];
  for (let i = 0; i < g.obs.length - 1; i++) {
    if (g.obs[i].to > g.obs[i + 1].from) pairs.push([g.obs[i], g.obs[i + 1]]);
  }
  const first = g.obs[0];
  const last = g.obs[g.obs.length - 1];
  const direct = g.obs.length > 2 && first.to > last.from;

  const d = drawer({
    title: `Split group ${g.id}`,
    badge: tag(PARTS.find(([p]) => p === part)[1], 'part-' + part),
    body: h('div', { class: 'grpdetail' },
      kv([
        ['Video', h('span', { class: 'mono' }, g.video)],
        ['Frame span', `${fmt.int(g.from)} - ${fmt.int(g.to)}`],
        ['Observations', fmt.int(g.obs.length)],
        ['Key frames', fmt.int(g.frames)],
        ['Partition', PARTS.find(([p]) => p === part)[1]],
      ]),
      sectTitle('Why these are one group'),
      h('div', { class: 'chain big' }, g.obs.map((o) => h('span', { class: 'obsbar' },
        h('span', { class: 'lab mono' }, o.id),
        h('i', { style: `left:${((o.from - g.from) / span) * 100}%;`
          + `width:${Math.max(3, ((o.to - o.from) / span) * 100)}%` })))),
      h('p', {}, pairs.length
        ? pairs.map(([a, b]) => `${a.id} overlaps ${b.id}`).join('; ') + '.'
        : 'This observation shares its key frames with nothing else.'),
      g.obs.length > 2
        ? h('p', { class: 'hint' }, direct
          ? `${first.id} and ${last.id} overlap directly as well.`
          : `${first.id} and ${last.id} do not overlap each other. They are in the same group `
            + 'anyway, because the observations between them link the two -- the rule is '
            + 'transitive, and a partition boundary drawn inside this chain would put the same '
            + 'on-screen frames on both sides of it.')
        : null,
      sectTitle('Observations'),
      table({
        compact: true,
        cols: [{ key: 'id', text: 'Observation' }, { key: 'f', text: 'Frames', num: true },
          { key: 's', text: 'Span', num: true }],
        empty: { title: 'No observations', note: '' },
        rows: g.obs.map((o) => ({
          cells: [h('span', { class: 'mono' }, o.id), `${fmt.int(o.from)} - ${fmt.int(o.to)}`,
            fmt.int(o.to - o.from)],
        })),
      }),
      h('p', { class: 'hint' }, 'There is deliberately no partition control on an observation. '
        + 'The group is the unit the split assigns; moving one observation out of it would put '
        + 'frames that are on screen together into two different partitions.')),
    actions: PARTS.map(([p, label]) => btn(`Move group to ${label}`, {
      primary: p === 'train', onclick: () => { moveGroup(g.id, p); d.close(); openGroup(g); },
      disabled: p === part,
    })),
  });
  document.body.appendChild(d.el);
}

function partCard(key, label, t, total) {
  return h('div', { class: 'partcard', dataPart: key },
    h('header', {}, h('b', {}, label), h('span', { class: 'share' }, fmt.pct(total ? t.obs / total : 0))),
    h('div', { class: 'pnum' }, fmt.int(t.obs), h('span', {}, ' observations')),
    bar(total ? t.obs / total : 0, key === 'train' ? 'done' : key === 'val' ? 'queued' : 'paused'),
    // A saved dataset records how many groups it has in total but not per
    // partition, so the sub-line is drawn only where the number is real.
    t.groups === null ? null : h('div', { class: 'psub' },
      h('span', {}, `${fmt.int(t.groups)} groups`),
      h('span', {}, `${fmt.int(t.frames)} key frames`)));
}

function splitPanel() {
  const groups = allGroups();
  const total = totalObs();
  const t = partitionTotals();

  if (!groups.length) {
    return panel({ title: stepTitle(4, 'Train / Validation / Test Split') },
      empty({ title: 'Nothing to split yet',
        note: 'Add observations to the dataset and their split groups appear here.' }));
  }

  const q = state.gQuery.trim().toLowerCase();
  const shown = groups.filter((g) => {
    if (state.gPart !== 'all' && (state.assign.get(g.id) || 'train') !== state.gPart) return false;
    if (q && !(g.id + ' ' + g.video).toLowerCase().includes(q)) return false;
    return true;
  });
  const pages = Math.max(1, Math.ceil(shown.length / state.gRows));
  if (state.gPage > pages) state.gPage = pages;
  const slice = shown.slice((state.gPage - 1) * state.gRows, state.gPage * state.gRows);

  return panel({
    title: stepTitle(4, 'Train / Validation / Test Split'),
    count: groups.length,
    tools: [
      h('span', { class: 'lab' }, 'Target'),
      select(RATIOS, { value: state.ratio, label: 'Target split',
        onchange: (e) => { state.ratio = e.target.value; rebalance(); paintSplit(); } }),
      btn('Rebalance whole groups', { ico: 'split', onclick: () => { rebalance(); paintSplit(); } }),
      select([['all', 'All partitions'], ...PARTS], { value: state.gPart, label: 'Show partition',
        onchange: (e) => { state.gPart = e.target.value; state.gPage = 1; paintSplit(); } }),
      splitSearch(),
    ],
    foot: pager({
      page: state.gPage, pages, rows: state.gRows, total: shown.length,
      shown: `${fmt.int(shown.length)} of ${fmt.int(groups.length)} groups`,
      onpage: (p) => { state.gPage = Math.min(pages, Math.max(1, p)); paintSplit(); },
      onrows: (n) => { state.gRows = n; state.gPage = 1; paintSplit(); },
    }),
  },
  h('div', { class: 'partrow' },
    partCard('train', 'Train', t.train, total),
    partCard('val', 'Validation', t.val, total),
    partCard('test', 'Test', t.test, total)),
  h('p', { class: 'hint' },
    'The split assigns whole groups. Two observations whose key frames are on screen at the same '
    + 'time must land in the same partition, and the rule is transitive -- A overlaps B and B '
    + 'overlaps C puts all three in one group even where A and C do not overlap. That is why '
    + 'nothing here can move a single observation, and why the achieved shares sit near the '
    + 'target rather than on it.'),
  slice.length
    ? h('div', { class: 'groups' }, slice.map(groupCard))
    : empty({ title: 'No groups match', note: 'Clear the partition filter or the search.' }));
}

function splitSearch() {
  const box = search('Group or video...', (e) => {
    state.gQuery = e.target.value;
    state.gPage = 1;
    paintSplit();
    const next = $('.split-wrap .search input');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  });
  box.querySelector('input').value = state.gQuery;
  return box;
}

/* --------------------------------------------------------- saved datasets */

function savedRows(ctx) {
  const proj = projectName(ctx);
  const q = (state.savedQ || '').trim().toLowerCase();
  return (ctx.data.datasets || []).filter((d) => {
    if (proj && d.project !== proj && d.project !== 'All projects') return false;
    if (q) {
      const hay = [d.name, d.description, d.project, d.group, d.created_by].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function savedPanel(ctx) {
  const rows = savedRows(ctx);
  const pages = Math.max(1, Math.ceil(rows.length / state.savedRows));
  if (state.savedPage > pages) state.savedPage = pages;
  const slice = rows.slice((state.savedPage - 1) * state.savedRows, state.savedPage * state.savedRows);

  return panel({
    title: 'Saved Datasets',
    count: rows.length,
    flush: true,
    tools: [savedSearch()],
    foot: pager({
      page: state.savedPage, pages, rows: state.savedRows, total: rows.length,
      shown: `${fmt.int(rows.length)} of ${fmt.int((ctx.data.datasets || []).length)} datasets`,
      onpage: (p) => { state.savedPage = Math.min(pages, Math.max(1, p)); paintSaved(); },
      onrows: (n) => { state.savedRows = n; state.savedPage = 1; paintSaved(); },
    }),
  }, h('div', { class: 't-saved' }, table({
    cols: [
      { key: 'n', text: 'Dataset' }, { key: 'p', text: 'Project' },
      { key: 'o', text: 'Observations', num: true }, { key: 'g', text: 'Split Groups', num: true },
      { key: 'tr', text: 'Train', num: true }, { key: 'va', text: 'Validation', num: true },
      { key: 'te', text: 'Test', num: true }, { key: 'c', text: 'Classes', num: true },
      { key: 'by', text: 'Created By' }, { key: 'u', text: 'Updated', num: true },
    ],
    rowlink: true,
    empty: { title: 'No saved datasets match', note: 'Clear the search or the project scope.' },
    rows: slice.map((d) => ({
      onclick: () => openDataset(d, ctx),
      cells: [
        h('span', { class: 'rowico' }, icon('datasets'), h('b', {}, d.name)),
        d.project,
        fmt.int(d.observations),
        fmt.int(d.split_groups),
        fmt.int(d.split && d.split.train),
        fmt.int(d.split && d.split.val),
        fmt.int(d.split && d.split.test),
        fmt.int((d.classes || []).length),
        d.created_by || '—',
        fmt.date(d.updated_at),
      ],
    })),
  })));
}

function savedSearch() {
  const box = search('Dataset name, project, author...', (e) => {
    state.savedQ = e.target.value;
    state.savedPage = 1;
    paintSaved();
    const next = $('.saved-wrap .search input');
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
  });
  box.querySelector('input').value = state.savedQ || '';
  return box;
}

function openDataset(d, ctx) {
  const sp = d.split || { train: 0, val: 0, test: 0 };
  const total = sp.train + sp.val + sp.test || 1;
  const classes = (d.classes || []).map((c) => ({ comname: c.comname, count: c.count }))
    .sort((a, b) => b.count - a.count);

  const dr = drawer({
    title: d.name,
    badge: tag(`${fmt.int(d.split_groups)} split groups`),
    body: h('div', { class: 'dsdetail' },
      sectTitle('Saved dataset'),
      kv([
        ['Project', d.project],
        ['Group', d.group || '—'],
        ['Observations', fmt.int(d.observations)],
        ['Split groups', fmt.int(d.split_groups)],
        ['Classes', fmt.int(classes.length)],
        ['Created by', d.created_by || '—'],
        ['Created', fmt.when(d.created_at)],
        ['Updated', fmt.when(d.updated_at)],
      ]),
      d.description && h('p', { class: 'notes' }, d.description),

      sectTitle('Split — frozen'),
      h('div', { class: 'partrow' },
        partCard('train', 'Train', { obs: sp.train, groups: null }, total),
        partCard('val', 'Validation', { obs: sp.val, groups: null }, total),
        partCard('test', 'Test', { obs: sp.test, groups: null }, total)),
      h('div', { class: 'frozenbox' }, icon('info'),
        h('div', {},
          h('b', {}, 'This split is never re-split'),
          h('span', {}, ' The train, validation and test assignment is part of this saved dataset. '
            + 'Every run over it uses these partitions: re-splitting on use would leak frames '
            + 'between experiments and make two models incomparable. It is read-only here, and it '
            + 'was assigned in whole split groups, never per observation.'))),
      h('div', { class: 'frozenbox' }, icon('info'),
        h('div', {},
          h('b', {}, 'Frozen means membership and split, not a snapshot'),
          h('span', {}, ' An observation that has since lost training approval is still a member. '
            + 'An edited observation is used as edited. A deleted one is simply absent when the '
            + 'dataset is next materialised. The materialised copy is a disposable cache and can '
            + 'be evicted and rebuilt from these ids at any time.'))),

      sectTitle('Composition'),
      classes.length ? classBars(classes, 8) : h('p', { class: 'muted' }, 'No class breakdown recorded.'),

      sectTitle('Used by'),
      usedBy(d, ctx)),
    actions: [
      btn('Train from this dataset', { primary: true, ico: 'training',
        onclick: () => { dr.close(); ctx.nav('training', { dataset: d.id }); } }),
      btn('Duplicate as a new dataset', { ico: 'copy', onclick: () => {
        state.view = 'builder';
        state.name = d.name.replace(/_v(\d+)$/, (m, n) => `_v${Number(n) + 1}`);
        dr.close();
        paint();
      } }),
      btn('Rebuild materialised copy', { ghost: true, ico: 'refresh', disabled: true,
        title: 'No route materialises a dataset yet' }),
    ],
  });
  document.body.appendChild(dr.el);
}

/** Which registered versions trained on this dataset, and which runs used it. */
function usedBy(d, ctx) {
  const versions = [];
  for (const m of (ctx.data.models || [])) {
    for (const v of (m.versions || [])) if (v.dataset_id === d.id) versions.push({ m, v });
  }
  const runs = (ctx.data.runs || []).filter((r) => r.dataset && r.dataset.id === d.id);
  if (!versions.length && !runs.length) {
    return h('p', { class: 'muted' }, 'Nothing has trained on this dataset yet.');
  }
  return table({
    compact: true,
    cols: [{ key: 'w', text: 'What' }, { key: 'n', text: 'Name' }, { key: 'd', text: 'When', num: true }],
    empty: { title: 'Unused', note: '' },
    rows: [
      ...versions.map(({ m, v }) => ({
        onclick: () => ctx.nav('models', { model: m.id }),
        cells: [tag('version'), `${m.name} ${v.version}`, fmt.date(v.trained_at)],
      })),
      ...runs.map((r) => ({
        onclick: () => ctx.nav('training', { run: r.id }),
        cells: [tag('run'), r.name, fmt.date(r.started_at)],
      })),
    ],
    rowlink: true,
  });
}

/* -------------------------------------------------------------- rendering */

function paintBuilder() { if (refs.builder) fill(refs.builder, builderView(ctxRef)); }
function paintSplit() { if (refs.split) fill(refs.split, splitPanel()); }
function paintSaved() { if (refs.saved) fill(refs.saved, savedPanel(ctxRef)); }

function builderView(ctx) {
  refs.split = h('div', { class: 'split-wrap' });
  const view = h('div', { class: 'builder' },
    panelRow('3', queryPanel(ctx), resultPanel(ctx), datasetPanel(ctx)),
    refs.split);
  paintSplit();
  return view;
}

function paint() {
  refs.builder = h('div', {});
  refs.saved = h('div', { class: 'saved-wrap' });
  fill(refs.root,
    tabstrip([
      { id: 'builder', text: 'Dataset Builder', ico: 'plus' },
      { id: 'saved', text: 'Saved Datasets', ico: 'datasets' },
    ], { value: state.view, label: 'Datasets view',
      onchange: (v) => { state.view = v; paint(); } }),
    state.view === 'builder' ? refs.builder : refs.saved);
  if (state.view === 'builder') paintBuilder();
  else paintSaved();
}

/** The state the screen opens in: a dataset part-built, as the mockup draws
 *  it. An empty builder shows none of the design that matters here. */
function seed(ctx) {
  state.seeded = true;
  const project = (ctx.data.projects[0] || {}).name || 'all';
  state.qy.project = project;
  state.qy.confMin = '0.70';
  runQuery(ctx);
  pushSubset(ctx);
  const sp = (ctx.data.species || [])[3];
  if (sp) state.qy.species = sp.comname;
  state.qy.confMin = '0.55';
  runQuery(ctx);
  pushSubset(ctx);
  // Leave the last query on screen, as though the operator had just run it.
}

export function render(ctx) {
  ctxRef = ctx;
  if (!state.seeded) seed(ctx);
  if (ctx.query !== state.shellQ) {
    state.shellQ = ctx.query;
    state.savedQ = ctx.query || '';
    state.savedPage = 1;
    if (ctx.query) state.view = 'saved';
  }
  if (ctx.params && ctx.params.dataset) state.view = 'saved';
  refs.root = h('div', { class: 'tab-datasets' });
  paint();
  return refs.root;
}

export function mount(el, ctx) {
  const id = ctx.params && Number(ctx.params.dataset);
  if (!id) return;
  const d = ctx.data.datasetById.get(id);
  if (d) openDataset(d, ctx);
}
