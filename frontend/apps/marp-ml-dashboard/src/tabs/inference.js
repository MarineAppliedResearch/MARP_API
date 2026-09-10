/**
 * Inference — the job-creation flow.
 *
 * Drawn from #104's inference mockup, with one deliberate departure the issue
 * requires: the mockup puts confidence, IoU, max detections and image size on
 * the front face, and #104's *Job creation* section says the ordinary surface
 * carries only the few decisions most users need, with thresholds, tracker,
 * reduction and chunk size under Advanced settings. The issue wins, so the
 * front face is the five decisions -- scope, task, model, workers, output --
 * and the rest is a collapsed block.
 *
 * The other rule from #104 that shapes this file: a task preset chooses
 * defaults but never hides what is running. So the resolved model, version,
 * hash, tracker and reduction are always on screen, and every one of them
 * stays editable after a preset has filled it in.
 */
import { h, fill } from '../lib/dom.js';
import icon from '../lib/icons.js';
import { fmt } from '../lib/fmt.js';
import {
  panel, panelRow, table, seg, tabstrip, stepTitle, field, fieldRow, slider,
  check, checks, select, input, btn, iconBtn, kv, gapNote, drawer, tag,
  st, progress, moreLink, sectTitle,
} from '../lib/parts.js';

export const meta = {
  id: 'inference', title: 'Inference', subtitle: 'Run trained models on your data',
};

/* The sub-sections. Scheduled Inference is disabled on purpose: nothing in
   #104 asks for scheduling and no API represents it (assumption A4). */
const SUBS = [
  { id: 'run', text: 'Run Inference Job', ico: 'play' },
  { id: 'batch', text: 'Batch Inference', ico: 'split' },
  { id: 'sched', text: 'Scheduled Inference', ico: 'calendar', disabled: true, later: 'later' },
  { id: 'results', text: 'Results & Visualizations', ico: 'chart' },
];

/**
 * The presets. Each one only *fills* the settings below -- it does not lock
 * them, and editing any of them flips the preset to Custom so the form never
 * claims a preset is in force when it is not.
 */
const PRESETS = {
  'detect-track': {
    text: 'Detect & Track',
    fill: { conf: 0.25, iou: 0.45, maxdet: 300, tracker: 'bytetrack', reduction: 'per-track-best' },
  },
  detect: {
    text: 'Detect Only',
    fill: { conf: 0.30, iou: 0.45, maxdet: 300, tracker: 'none', reduction: 'per-frame-all' },
  },
  custom: { text: 'Custom', fill: null },
};

const TRACKERS = [['bytetrack', 'ByteTrack'], ['botsort', 'BoT-SORT'], ['none', 'None (no tracking)']];
const REDUCTIONS = [
  ['per-frame-all', 'Per frame — every detection'],
  ['per-frame-max', 'Per frame — highest confidence only'],
  ['per-track-best', 'Per track — best frame of each track'],
];
const ENGINES = ['Ultralytics (YOLO)', 'PyTorch (TorchScript)', 'ONNX Runtime'];

/* Tab-local state. The shell is never asked to re-render; this tab repaints
   its own subtrees. */
const S = {
  sub: 'run',
  preset: 'detect-track',
  modelId: null,
  version: null,
  engine: null,
  scope: 'project',
  project: null,
  dive: 1,
  line: 1,
  videos: new Set(),
  vquery: '',
  conf: 0.25, iou: 0.45, maxdet: 300, imgsz: 640,
  tracker: 'bytetrack', reduction: 'per-track-best', chunk: 900,
  advOpen: false,
  mode: 'observations',
  saveTo: 'project',
  out: { annotated: false, crops: false, conf: true },
  csv: { conf: true, track: true, perDetection: true },
  worker: 'auto', workerIds: new Set(), capOn: false, cap: 4,
  name: '',
  batchVideo: 0, batchFrames: 27000, batchChunk: 900,
};

let CTX = null;
let ROOT = null;
/* The subtrees this tab repaints for itself. */
const R = { model: null, scope: null, out: null, resolved: null, presetSel: null, batch: null };

/* --------------------------------------------------------------- fixture reads */

const models = () => ((CTX.data && CTX.data.models) || []).filter((m) => m && m.name);
const projects = () => (CTX.data && CTX.data.projects) || [];

/** A model row carries either a `versions` array or one flat version. */
function versionsOf(m) {
  if (!m) return [];
  if (Array.isArray(m.versions) && m.versions.length) return m.versions;
  return [{ version: m.version || '1.0.0', sha256: m.sha256 || '', created_at: m.created_at || null }];
}

const modelById = (id) => models().find((m) => String(m.id) === String(id)) || models()[0] || null;

function currentModel() {
  const m = modelById(S.modelId);
  if (!m) return { model: null, ver: null };
  const vs = versionsOf(m);
  const ver = vs.find((v) => String(v.version) === String(S.version)) || vs[0];
  return { model: m, ver };
}

const projectByCode = (code) => projects().find((p) => p.code === code || p.name === code);
const currentProject = () => projectByCode(S.project) || projects()[0] || null;

/** 620000000 -> "~620M". A magnitude, where the exact integer is noise. */
function mag(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '~' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return '~' + Math.round(n / 1e6) + 'M';
  if (n >= 1e4) return '~' + Math.round(n / 1e3) + 'k';
  return fmt.int(n);
}

const slug = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

/* Dive, line and video labels are derived from the project's counts. The
   fixture carries counts rather than lists, and typing names in would be
   inventing rows the API would never return. */
function diveLabels(p) {
  const n = Math.min(p ? p.dives : 0, 200);
  return Array.from({ length: n }, (_, i) => [i + 1, 'DIVE ' + String(i + 1).padStart(4, '0')]);
}
const linesPerDive = (p) => (p && p.dives ? Math.max(1, Math.round(p.lines / p.dives)) : 1);
const lineLabels = (p) =>
  Array.from({ length: linesPerDive(p) }, (_, i) => [i + 1, 'LINE ' + String(i + 1).padStart(2, '0')]);

function videoLabels(p) {
  const per = p && p.dives ? Math.max(1, Math.round(p.videos / p.dives)) : 1;
  const out = [];
  for (const [d] of diveLabels(p).slice(0, 24)) {
    for (let i = 1; i <= Math.min(per, 6); i++) {
      out.push(`${slug(p && p.code)}_DIVE_${String(d).padStart(4, '0')}_${String(i).padStart(2, '0')}.mp4`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------- the scope */

/**
 * What the chosen scope actually covers. Every number here is computed from
 * `ctx.data.projects` -- the sentence under the segmented control is the thing
 * an operator reads before committing a 1,842-video run, so it must not be
 * typed.
 */
function scopeFacts() {
  const p = currentProject();
  if (!p) return { videos: 0, frames: 0, label: 'No project', sentence: 'No project selected.' };
  const framesPer = p.videos ? p.frames / p.videos : 0;

  if (S.scope === 'project') {
    return {
      videos: p.videos, frames: p.frames, exact: true,
      label: `Project: ${p.name}`,
      sentence: `Run inference on all dives and lines in project “${p.name}”`,
    };
  }
  if (S.scope === 'dive') {
    const v = Math.max(1, Math.round(p.dives ? p.videos / p.dives : p.videos));
    return {
      videos: v, frames: Math.round(v * framesPer),
      label: `Dive: DIVE ${String(S.dive).padStart(4, '0')} · ${p.name}`,
      sentence: `Run inference on every line in dive ${String(S.dive).padStart(4, '0')} of “${p.name}”`,
    };
  }
  if (S.scope === 'line') {
    const v = Math.max(1, Math.round(p.lines ? p.videos / p.lines : p.videos));
    return {
      videos: v, frames: Math.round(v * framesPer),
      label: `Line: LINE ${String(S.line).padStart(2, '0')} · dive ${String(S.dive).padStart(4, '0')}`,
      sentence: `Run inference on line ${String(S.line).padStart(2, '0')} of dive ${String(S.dive).padStart(4, '0')} in “${p.name}”`,
    };
  }
  const v = S.videos.size;
  return {
    videos: v, frames: Math.round(v * framesPer), exact: true,
    label: `Custom selection · ${p.name}`,
    sentence: v
      ? `Run inference on ${fmt.int(v)} hand-picked video${v === 1 ? '' : 's'} from “${p.name}”`
      : 'Pick the videos to run inference on.',
  };
}

/** The two lines the scope summary box holds, so the checkbox list can refresh
 *  them without repainting the column it lives in. */
function scopeSummaryLines() {
  const facts = scopeFacts();
  return [
    h('b', {}, facts.sentence),
    h('div', { class: 'muted' },
      `${fmt.int(facts.videos)} video${facts.videos === 1 ? '' : 's'} will be processed`,
      facts.frames ? ` · ${mag(facts.frames)} frames${facts.exact ? '' : ' (estimated)'}` : '',
      ` · ${fmt.int(Math.max(1, Math.ceil((facts.frames || 0) / Math.max(1, S.chunk))))} chunks`
      + ` at ${fmt.int(S.chunk)} frames`),
  ];
}

/* ------------------------------------------------------------------ the columns */

/** 1. Model & Settings. */
function paintModel() {
  const { model, ver } = currentModel();
  const vs = versionsOf(model);

  const presetSel = select(Object.entries(PRESETS).map(([id, p]) => [id, p.text]), {
    value: S.preset, wide: true, label: 'Task preset',
    onchange: (e) => {
      S.preset = e.target.value;
      const f = PRESETS[S.preset] && PRESETS[S.preset].fill;
      if (f) Object.assign(S, f);
      repaint('model');
    },
  });
  R.presetSel = presetSel;

  return [
    h('p', { class: 'stepsub' }, 'Choose the task, then confirm the model that will run'),

    field('Task preset', presetSel, {
      hint: 'A preset only fills the settings below. The model, tracker and reduction stay visible and editable.',
    }),

    field('Model', select(models().map((m) => [m.id, m.name]), {
      value: model ? model.id : '', wide: true, label: 'Model',
      onchange: (e) => { S.modelId = e.target.value; S.version = null; repaint('model'); },
    }), { req: true }),

    fieldRow(
      field('Version', select(vs.map((v) => [v.version, v.version]), {
        value: ver ? ver.version : '', wide: true, label: 'Model version',
        onchange: (e) => { S.version = e.target.value; repaint('model'); },
      })),
      field('Model engine', select(
        model && model.engine ? [model.engine, ...ENGINES.filter((x) => x !== model.engine)] : ENGINES, {
          value: S.engine || (model && model.engine) || ENGINES[0], wide: true, label: 'Model engine',
          onchange: (e) => { S.engine = e.target.value; repaint('model'); },
        }))),

    kv([
      ['Task', (model && (model.task || model.kind)) || 'Object detection'],
      ['Resolved version', ver ? ver.version : '—'],
      ['Artifact hash', h('span', { class: 'mono' }, fmt.hash(ver && ver.sha256))],
      ['Registered', fmt.date((ver && ver.created_at) || (model && model.created_at))],
      model && model.notes ? ['Preferred for', model.notes] : null,
    ]),

    h('p', { class: 'note info' }, icon('info'),
      h('span', {}, 'The version and hash above are ',
        h('b', {}, 'resolved and locked when the job is submitted'),
        '. Marking a different version preferred later does not change work already queued.')),

    h('div', { class: 'linkrow' },
      btn('View model details', {
        ghost: true, sm: true, icoAfter: 'arrowRight',
        onclick: () => CTX.nav('models', model ? { model: model.id } : {}),
      })),

    /* Everything #104 puts under Advanced. A <details> so expand and collapse
       are the browser's, which also makes it keyboard-reachable for free. */
    h('details', {
      class: 'adv', open: S.advOpen,
      ontoggle: (e) => { S.advOpen = e.target.open; },
    },
    h('summary', {}, icon('chevronRight'), h('span', {}, 'Advanced settings'),
      h('span', { class: 'advsum' },
        `conf ${S.conf} · IoU ${S.iou} · ${trackerText()} · ${fmt.int(S.chunk)}f chunks`)),
    h('div', { class: 'advbd' },
      field('Confidence threshold', slider({
        value: S.conf, min: 0, max: 1, step: 0.01, label: 'Confidence threshold',
        onchange: (v) => { S.conf = v; touched(); },
      })),
      field('IoU threshold (NMS)', slider({
        value: S.iou, min: 0, max: 1, step: 0.01, label: 'IoU threshold',
        onchange: (v) => { S.iou = v; touched(); },
      })),
      fieldRow(
        field('Max detections per image', input({
          type: 'number', value: S.maxdet, min: 1, max: 2000, step: 10, wide: true,
          label: 'Max detections per image',
          oninput: (e) => { S.maxdet = Number(e.target.value) || 0; touched(); },
        })),
        field('Image size (pixels)', select([320, 480, 640, 960, 1280], {
          value: S.imgsz, wide: true, label: 'Image size',
          onchange: (e) => { S.imgsz = Number(e.target.value); touched(); },
        }), { hint: 'Model input size; aspect ratio is maintained.' })),
      field('Tracker', select(TRACKERS, {
        value: S.tracker, wide: true, label: 'Tracker',
        onchange: (e) => { S.tracker = e.target.value; touched(); repaint('model'); },
      }), { hint: 'Tracking uses hard chunk boundaries — a track never spans two chunks.' }),
      field('Reduction', select(REDUCTIONS, {
        value: S.reduction, wide: true, label: 'Reduction',
        onchange: (e) => { S.reduction = e.target.value; touched(); repaint('model'); },
      })),
      field('Chunk size (frames)', slider({
        value: S.chunk, min: 300, max: 5400, step: 300, label: 'Chunk size in frames',
        onchange: (v) => { S.chunk = v; touched(); },
      }), { hint: 'Fixed per job. The coordinator decides which chunks exist and hands them out.' }),
      gapNote(10, 'chunk size is a submit-time argument stored nowhere, so a later view cannot report what was used.'))),
  ];
}

const trackerText = () => (TRACKERS.find((t) => t[0] === S.tracker) || ['', S.tracker])[1];
const reductionText = () => (REDUCTIONS.find((t) => t[0] === S.reduction) || ['', S.reduction])[1];

/** Editing anything a preset filled means the preset no longer describes the
 *  run. Say so on the select rather than leaving it claiming otherwise. */
function touched() {
  if (S.preset !== 'custom') {
    S.preset = 'custom';
    if (R.presetSel) R.presetSel.value = 'custom';
  }
  paintResolved();
}

/** The line that keeps the model honest: what is actually going to run, on
 *  screen at all times, whether a preset chose it or a person did. */
function paintResolved() {
  if (!R.resolved) return;
  const { model, ver } = currentModel();
  fill(R.resolved,
    h('span', { class: 'rchip' }, icon('models'),
      h('span', {}, model ? model.name : 'No model'),
      h('b', {}, ver ? ver.version : '')),
    h('span', { class: 'rchip' }, h('i', {}, 'hash'),
      h('span', { class: 'mono' }, fmt.hash(ver && ver.sha256))),
    h('span', { class: 'rchip' }, h('i', {}, 'tracker'), h('span', {}, trackerText())),
    h('span', { class: 'rchip' }, h('i', {}, 'reduction'), h('span', {}, reductionText())),
    h('span', { class: 'rchip' }, h('i', {}, 'conf'), h('span', {}, String(S.conf))),
    h('span', { class: 'rchip' }, h('i', {}, 'IoU'), h('span', {}, String(S.iou))),
    h('span', { class: 'rchip' }, h('i', {}, 'image'), h('span', {}, S.imgsz + 'px')));
}

/** 2. Input Data. */
function paintScope() {
  const p = currentProject();
  const vids = S.scope === 'custom' ? videoLabels(p) : [];

  return [
    h('p', { class: 'stepsub' }, 'Select the MARP data to run inference on'),

    field('Inference scope', seg([
      { id: 'project', text: 'Project', ico: 'datasets' },
      { id: 'dive', text: 'Dive', ico: 'clock' },
      { id: 'line', text: 'Line', ico: 'split' },
      { id: 'custom', text: 'Custom Video Selection', ico: 'video' },
    ], { value: S.scope, label: 'Inference scope', onchange: (id) => { S.scope = id; repaint('scope'); } })),

    field('Project', select(projects().map((x) => [x.code, x.name]), {
      value: p ? p.code : '', wide: true, label: 'Project',
      onchange: (e) => { S.project = e.target.value; S.videos.clear(); repaint('scope'); },
    }), { req: true }),

    /* The controls under the segmented control are the ones this scope needs
       and no others -- which is what makes it a scope chooser rather than a
       row of filters. */
    (S.scope === 'dive' || S.scope === 'line') && field('Dive', select(diveLabels(p), {
      value: S.dive, wide: true, label: 'Dive',
      onchange: (e) => { S.dive = Number(e.target.value); repaint('scope'); },
    })),
    S.scope === 'line' && field('Line', select(lineLabels(p), {
      value: S.line, wide: true, label: 'Line',
      onchange: (e) => { S.line = Number(e.target.value); repaint('scope'); },
    })),
    S.scope === 'custom' && field('Videos',
      h('div', {},
        input({
          placeholder: 'Filter videos…', wide: true, value: S.vquery, label: 'Filter videos',
          oninput: (e) => {
            S.vquery = e.target.value;
            /* Repainting the column would take the caret with it, so only the
               list and its count are refilled. */
            const box = R.scope && R.scope.querySelector('.picklist');
            if (box) fill(box, videoRows(vids));
            refreshPickCount(vids);
          },
        }),
        h('div', { class: 'picklist' }, videoRows(vids))),
      { hint: pickCountText(vids) }),

    S.scope !== 'custom' && h('div', { class: 'ministats' },
      miniStat('Total dives', fmt.int(p ? p.dives : 0)),
      miniStat('Total lines', fmt.int(p ? p.lines : 0)),
      miniStat('Total videos', fmt.int(p ? p.videos : 0)),
      miniStat('Total frames', mag(p ? p.frames : 0))),

    h('div', { class: 'scopesum' },
      h('span', { class: 'scopeico' }, icon('video')),
      h('div', { class: 'scopetext' }, scopeSummaryLines())),

    gapNote(1, 'a job over a project, dive or line has nowhere to store the selection that produced it — '
      + 'a batch is one video cut into frame ranges today, so a scope wider than one video submits one job per video. Milestone 2.'),
  ];
}

const miniStat = (label, value) =>
  h('div', { class: 'ministat' }, h('span', {}, label), h('b', {}, value));

function shownVideos(vids) {
  return vids
    .filter((v) => !S.vquery || v.toLowerCase().includes(S.vquery.toLowerCase()))
    .slice(0, 40);
}

function pickCountText(vids) {
  const p = currentProject();
  return `${fmt.int(shownVideos(vids).length)} of ${fmt.int(p ? p.videos : 0)} videos listed`
    + ` · ${fmt.int(S.videos.size)} selected`;
}

function refreshPickCount(vids) {
  const hint = R.scope && R.scope.querySelector('.field .hint');
  if (hint) fill(hint, pickCountText(vids));
}

function videoRows(vids) {
  const shown = shownVideos(vids);
  if (!shown.length) return h('div', { class: 'pickempty' }, 'No videos match that filter.');
  return shown.map((v) => check(v, S.videos.has(v), (on) => {
    if (on) S.videos.add(v); else S.videos.delete(v);
    /* The summary sentence counts the selection, so it follows immediately. */
    const text = R.scope && R.scope.querySelector('.scopetext');
    if (text) fill(text, scopeSummaryLines());
    refreshPickCount(vids);
  }));
}

/** 3. Output & Options. */
function paintOut() {
  const csv = S.mode === 'csv';
  const pool = ((CTX.data && CTX.data.workers) || []).slice(0, 40);

  return [
    h('p', { class: 'stepsub' }, 'Decide where the results go, then run'),

    field('Output mode', seg([
      { id: 'observations', text: 'Write observations', ico: 'datasets' },
      { id: 'csv', text: 'CSV test/export', ico: 'download' },
    ], { value: S.mode, label: 'Output mode', onchange: (id) => { S.mode = id; repaint('out'); } }), {
      hint: csv
        ? 'Nothing is written to the observation database. This is the path for testing a model without a second application.'
        : 'Detections become MARP observations through the coordinator. The worker never writes them itself.',
    }),

    csv
      ? field('Save results to',
        h('div', { class: 'ro' }, icon('download'), h('span', {}, 'CSV file — no database write')),
        { hint: 'The observation database is not modified in this mode.' })
      : field('Save results to', select([
        ['project', 'Project detections'],
        ['session', 'Session (dive) detections'],
        ['review', 'Detections, queued for mosaic review'],
      ], {
        value: S.saveTo, wide: true, label: 'Save results to',
        onchange: (e) => { S.saveTo = e.target.value; },
      }), {
        hint: 'Saved as observations and linked to this project. Nothing is marked reviewed — '
          + 'an observation with no completed review is already in the human-review workflow.',
      }),

    csv
      ? field('CSV contents', checks(
        check('One row per detection (otherwise one row per frame)', S.csv.perDetection,
          (v) => { S.csv.perDetection = v; }),
        check('Include confidence scores', S.csv.conf, (v) => { S.csv.conf = v; }),
        check('Include track ids', S.csv.track, (v) => { S.csv.track = v; })))
      : field('Output options', checks(
        h('label', { class: 'check locked' },
          h('input', { type: 'checkbox', checked: true, disabled: true }),
          h('span', {}, 'Save detections to database'),
          tag('always')),
        check('Include confidence scores', S.out.conf, (v) => { S.out.conf = v; }),
        check('Generate annotated video', S.out.annotated, (v) => { S.out.annotated = v; repaint('out'); }),
        check('Save detection crops (thumbnails)', S.out.crops, (v) => { S.out.crops = v; repaint('out'); }))),

    csv
      ? gapNote(6, 'nothing serves artifact bytes, so a finished CSV has no download route. The file is written and an artifact row records its path.')
      : (S.out.annotated || S.out.crops)
        ? gapNote(14, 'annotated video generation and detection crops have no pipeline behind them. Choosing them records the intent and nothing else.')
        : null,

    field('Worker selection', select([
      ['auto', 'Auto (best available GPU)'],
      ['specific', 'Specific workers…'],
    ], {
      value: S.worker, wide: true, label: 'Worker selection',
      onchange: (e) => { S.worker = e.target.value; repaint('out'); },
    }), { hint: 'Scheduling stays with the coordinator; this is a preference, not an assignment.' }),

    S.worker === 'specific' && field('Workers',
      h('div', { class: 'picklist short' }, pool.length
        ? pool.map((w) => check(workerText(w), S.workerIds.has(workerId(w)), (on) => {
          if (on) S.workerIds.add(workerId(w)); else S.workerIds.delete(workerId(w));
          /* The count under the list has to follow, and the list is short
             enough that repainting the column is cheaper than threading a
             reference to one hint through three functions. */
          repaint('out');
        }))
        : h('div', { class: 'pickempty' }, 'The pool is empty in this fixture.')),
      { hint: `${fmt.int(S.workerIds.size)} selected` }),

    field(null, checks(
      check('Limit how many workers this job may use', S.capOn, (v) => { S.capOn = v; repaint('out'); }))),
    S.capOn && field('Worker cap', slider({
      value: S.cap, min: 1, max: 32, step: 1, label: 'Worker cap',
      onchange: (v) => { S.cap = v; },
    })),
    (S.worker === 'specific' || S.capOn)
      && gapNote(9, 'a per-job worker cap and worker affinity have no field and no limit in the API. Recorded here, enforced nowhere.'),

    field('Job name (optional)', input({
      wide: true, value: S.name, placeholder: autoName(), label: 'Job name',
      /* Deliberately does not repaint -- a repaint on every keystroke would
         take the caret with it. */
      oninput: (e) => { S.name = e.target.value; },
    }), { hint: 'Letters, numbers, and - _ only. Left blank, the name shown is used.' }),

    h('div', { class: 'runrow' },
      btn('Run Inference', { primary: true, big: true, block: true, ico: 'play', onclick: showSpec })),
    h('p', { class: 'runnote' },
      'This mockup submits nothing. Run Inference shows the job specification it would send.'),
  ];
}

const workerId = (w) => w.worker_id || w.id || w.name;
function workerText(w) {
  const caps = w.capabilities || {};
  const gpu = caps.gpu || caps.gpu_name || w.gpu || 'GPU';
  return `${w.name || workerId(w)} · ${gpu}`;
}

function autoName() {
  const { model, ver } = currentModel();
  const p = currentProject();
  return [slug(p && p.code), slug(model && model.name), ver ? 'v' + ver.version : null,
    S.mode === 'csv' ? 'csv' : null].filter(Boolean).join('-') || 'inference-job';
}

/* ------------------------------------------------------------------- the spec */

/** The object this form would submit. Built from state, never read back out
 *  of the DOM. */
function jobSpec() {
  const { model, ver } = currentModel();
  const facts = scopeFacts();
  const p = currentProject();
  return {
    kind: 'inference',
    name: S.name || autoName(),
    preset: S.preset,
    scope: {
      type: S.scope,
      project: p ? p.code : null,
      dive: S.scope === 'dive' || S.scope === 'line' ? S.dive : null,
      line: S.scope === 'line' ? S.line : null,
      videos: S.scope === 'custom' ? Array.from(S.videos) : null,
      video_count: facts.videos,
      estimated_frames: facts.frames,
    },
    model: {
      id: model ? model.id : null,
      name: model ? model.name : null,
      version: ver ? ver.version : null,
      sha256: ver ? ver.sha256 : null,
      engine: S.engine || (model && model.engine) || ENGINES[0],
    },
    params: {
      conf: S.conf, iou: S.iou, max_det: S.maxdet, imgsz: S.imgsz,
      tracker: S.tracker, reduction: S.reduction, chunk_frames: S.chunk,
    },
    output: S.mode === 'csv'
      ? {
        mode: 'csv_export', writes_observations: false,
        csv: { one_row_per_detection: S.csv.perDetection, confidence: S.csv.conf, track_ids: S.csv.track },
      }
      : {
        mode: 'observations', writes_observations: true, save_to: S.saveTo,
        confidence: S.out.conf, annotated_video: S.out.annotated, detection_crops: S.out.crops,
      },
    workers: {
      selection: S.worker,
      worker_ids: S.worker === 'specific' ? Array.from(S.workerIds) : [],
      cap: S.capOn ? S.cap : null,
    },
  };
}

/**
 * What the primary button does. A mockup whose primary action does nothing
 * teaches nothing -- and one that says "submitted" teaches something false,
 * so this says plainly that nothing was sent.
 */
function showSpec() {
  const s = jobSpec();
  const { model, ver } = currentModel();
  let d;
  const body = h('div', { class: 'specbody' },
    h('p', { class: 'note info' }, icon('info'),
      h('span', {}, h('b', {}, 'Nothing has been submitted. '),
        'This is the specification this form would send to POST /api/v2/gpu/jobs.')),
    kv([
      ['Job name', s.name],
      ['Scope', scopeFacts().label],
      ['Videos', fmt.int(s.scope.video_count)],
      ['Frames', mag(s.scope.estimated_frames)],
      ['Model', model ? `${model.name} ${ver ? ver.version : ''}` : '—'],
      ['Artifact hash', h('span', { class: 'mono' }, fmt.hash(ver && ver.sha256))],
      ['Engine', s.model.engine],
      ['Task preset', PRESETS[S.preset].text],
      ['Tracker', trackerText()],
      ['Reduction', reductionText()],
      ['Chunk size', fmt.int(S.chunk) + ' frames'],
      ['Output', S.mode === 'csv'
        ? 'CSV test/export — nothing is written to the observation database'
        : 'Observations → ' + S.saveTo],
      ['Workers', s.workers.selection === 'auto' ? 'Auto' : `${s.workers.worker_ids.length} named`],
      ['Worker cap', s.workers.cap === null ? 'None' : fmt.int(s.workers.cap)],
    ]),
    S.mode === 'csv'
      ? gapNote(6, 'CSV test/export writes a file and records an artifact row. No route serves the bytes.')
      : null,
    sectTitle('The request body'),
    h('pre', { class: 'spec mono' }, JSON.stringify(s, null, 2)));

  d = drawer({
    title: 'Inference job specification',
    badge: tag('not submitted', 'warn'),
    body,
    actions: [btn('Close', { onclick: () => d.close() })],
  });
  document.body.appendChild(d.el);
}

/* --------------------------------------------------------- recent jobs table */

/** The shell's project select and search box mean something here, so they are
 *  applied rather than ignored. */
function inferenceJobs() {
  const q = (CTX.query || '').toLowerCase();
  const proj = CTX.project;
  const p = projectByCode(proj);
  const want = [proj, p && p.name, p && p.code].filter(Boolean).map((x) => String(x).toLowerCase());
  return ((CTX.data && CTX.data.jobs) || [])
    .filter((j) => j.kind === 'inference')
    .filter((j) => {
      if (!proj || proj === 'all') return true;
      return want.includes(String((j.scope && j.scope.project) || '').toLowerCase());
    })
    .filter((j) => !q || [j.name, j.model && j.model.name, j.scope && j.scope.label]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
}

function recentTable(rows) {
  return table({
    rowlink: true,
    cols: [
      { key: 'name', text: 'Job Name', name: true },
      { key: 'scope', text: 'Video / Dataset' },
      { key: 'model', text: 'Model' },
      { key: 'state', text: 'Status' },
      { key: 'prog', text: 'Progress' },
      { key: 'det', text: 'Detections', num: true },
      { key: 'started', text: 'Started' },
      { key: 'dur', text: 'Duration', num: true },
      { key: 'act', text: 'Actions' },
    ],
    rows: rows.map((j) => ({
      id: j.id,
      cls: j.state === 'failed' || j.state === 'issues' ? 'attn' : null,
      onclick: () => CTX.nav('jobs', { job: j.id }),
      cells: [
        j.name,
        h('span', {}, (j.scope && j.scope.label) || '—',
          j.scope && j.scope.videos
            ? h('span', { class: 'faint' }, ` (${fmt.int(j.scope.videos)} videos)`) : null),
        h('span', {}, (j.model && j.model.name) || '—',
          j.model && j.model.version ? h('span', { class: 'faint' }, ' ' + j.model.version) : null),
        st(j.state),
        progress(j),
        fmt.int(j.detections),
        fmt.when(j.created_at),
        fmt.dur(j.duration_s),
        h('div', { class: 'actcell', onclick: (e) => e.stopPropagation() },
          iconBtn('eye', 'Open this job', () => CTX.nav('jobs', { job: j.id }), { sm: true }),
          iconBtn('download', 'Download results — no artifact route exists (DESIGN.md 6)',
            null, { sm: true, disabled: true })),
      ],
    })),
    empty: { title: 'No inference jobs match', note: 'Clear the project or the search box in the top bar.' },
  });
}

/* ------------------------------------------------------------- batch section */

/**
 * Batch inference, drawn honestly: a batch today is *one video* cut into frame
 * ranges, which is what the API can express (#104's measurement comment). The
 * piece table is computed from the frame count and the chunk size, so the
 * controls show what would actually be submitted.
 */
function paintBatch() {
  const p = currentProject();
  const vids = videoLabels(p);
  const total = Math.max(1, S.batchFrames);
  const size = Math.max(1, S.batchChunk);
  const n = Math.ceil(total / size);
  const pieces = Array.from({ length: Math.min(n, 200) }, (_, i) => {
    const from = i * size;
    const to = Math.min(total, from + size) - 1;
    return { i: i + 1, from, to, frames: to - from + 1 };
  });

  return panelRow('wide-narrow',
    panel({ title: stepTitle(1, 'Split one video into chunks'), count: n },
      h('p', { class: 'stepsub' }, 'The coordinator decides which chunks exist; a worker leases one at a time'),
      field('Video', select(vids.map((v, i) => [i, v]), {
        value: S.batchVideo, wide: true, label: 'Video',
        onchange: (e) => { S.batchVideo = Number(e.target.value); repaint('batch'); },
      }), { req: true }),
      fieldRow(
        field('Total frames', input({
          type: 'number', value: S.batchFrames, min: 1, step: 100, wide: true, label: 'Total frames',
          oninput: (e) => { S.batchFrames = Number(e.target.value) || 1; repaint('batch'); },
        })),
        field('Chunk size (frames)', select([300, 600, 900, 1800, 2700, 5400], {
          value: S.batchChunk, wide: true, label: 'Chunk size',
          onchange: (e) => { S.batchChunk = Number(e.target.value); repaint('batch'); },
        }))),
      h('div', { class: 'scopesum' },
        h('span', { class: 'scopeico' }, icon('split')),
        h('div', { class: 'scopetext' },
          h('b', {}, `${fmt.int(n)} chunk${n === 1 ? '' : 's'} of ${fmt.int(size)} frames`),
          h('div', { class: 'muted' },
            'One job per chunk, sharing one batch_id. Tracking resets at every boundary — '
            + 'a track never spans two chunks, and MARP does not reconcile them afterwards.'))),
      gapNote(1, 'a batch cannot span videos: the splitter varies the frame range and holds the video constant, '
        + 'and batch_id has no row of its own. Milestone 2.'),
      table({
        compact: true,
        cols: [
          { key: 'i', text: 'Chunk', num: true },
          { key: 'range', text: 'Frame range' },
          { key: 'frames', text: 'Frames', num: true },
          { key: 'state', text: 'State' },
        ],
        rows: pieces.map((c) => [
          c.i,
          h('span', { class: 'mono' }, `${fmt.int(c.from)} – ${fmt.int(c.to)}`),
          fmt.int(c.frames),
          st('queued'),
        ]),
        empty: 'Nothing to split',
      })),
    panel({ title: 'What a chunk costs to lose' },
      h('p', { class: 'note' },
        'An interrupted chunk goes back to the pool and is re-run ',
        h('b', {}, 'from the start of its range'),
        ' by whichever machine next takes it. There is no checkpoint resume, on the same machine or '
        + 'another one, so the chunk size is the size of the work you are willing to repeat.'),
      kv([
        ['Chunk size', fmt.int(size) + ' frames'],
        ['Chunks', fmt.int(n)],
        ['Worst-case rework', fmt.int(size) + ' frames'],
        ['Progress model', 'completed chunks plus the live attempt'],
      ]),
      h('p', { class: 'note' },
        'Batch progress is derived from completed chunks plus the live attempt rather than a running '
        + 'total, because an interrupted chunk restarts at zero and a running total would go backwards.')));
}

/* ----------------------------------------------------------- results section */

/**
 * Results, deliberately thin. The pipeline that draws detections onto frames
 * is a later milestone and there is no artifact download route at all, so this
 * draws the list honestly and does not invent a viewer.
 */
function paintResults() {
  const rows = inferenceJobs().filter((j) => ['succeeded', 'done', 'issues'].includes(j.state));
  return [
    panel({
      title: 'Completed inference runs', count: rows.length,
      tools: moreLink('View all jobs', () => CTX.nav('history')),
    },
    gapNote(6, 'no route serves artifact bytes, so nothing here can be downloaded or opened. '
      + 'artifacts.path is recorded and the file sits on the worker host.'),
    table({
      rowlink: true,
      cols: [
        { key: 'name', text: 'Job Name', name: true },
        { key: 'scope', text: 'Scope' },
        { key: 'model', text: 'Model' },
        { key: 'state', text: 'Status' },
        { key: 'det', text: 'Detections', num: true },
        { key: 'fin', text: 'Finished' },
        { key: 'dur', text: 'Duration', num: true },
        { key: 'art', text: 'Result' },
      ],
      rows: rows.map((j) => ({
        id: j.id,
        onclick: () => CTX.nav('jobs', { job: j.id }),
        cells: [
          j.name,
          (j.scope && j.scope.label) || '—',
          h('span', {}, (j.model && j.model.name) || '—',
            j.model && j.model.version ? h('span', { class: 'faint' }, ' ' + j.model.version) : null),
          st(j.state),
          fmt.int(j.detections),
          fmt.when(j.finished_at || j.updated_at),
          fmt.dur(j.duration_s),
          h('div', { class: 'actcell', onclick: (e) => e.stopPropagation() },
            iconBtn('download', 'Download — no artifact route exists (DESIGN.md 6)',
              null, { sm: true, disabled: true }),
            iconBtn('eye', 'Open this job', () => CTX.nav('jobs', { job: j.id }), { sm: true })),
        ],
      })),
      empty: {
        title: 'No completed inference runs match',
        note: 'Clear the project or the search box in the top bar.',
      },
    })),
    panel({ title: 'Visualisations' },
      h('p', { class: 'note' },
        'Drawing detections back onto frames, and the detection-crop contact sheet, need a rendering '
        + 'pipeline that does not exist. Reviewing machine detections against the imagery is the '
        + 'Picture Mosaic Reviewer’s job today.'),
      gapNote(14, 'annotated video generation and detection crops are output options in the mockup with no pipeline behind them.'),
      gapNote(11, 'nothing counts detections per job — the ingest writes observations and the count is '
        + 'not rolled up, so a real run has nothing to put in the Detections column.'),
      h('div', { class: 'linkrow' },
        btn('Open the Picture Mosaic Reviewer', {
          ghost: true, sm: true, icoAfter: 'arrowRight',
          onclick: () => { location.href = '../marp-mosaic-review/'; },
        }))),
  ];
}

/* --------------------------------------------------------------- the repaint */

function repaint(which) {
  if (which === 'model' && R.model) { fill(R.model, paintModel()); paintResolved(); return; }
  if (which === 'scope' && R.scope) { fill(R.scope, paintScope()); return; }
  if (which === 'out' && R.out) { fill(R.out, paintOut()); return; }
  if (which === 'batch' && R.batch) { fill(R.batch, paintBatch()); return; }
  paint();
}

function paint() {
  if (!ROOT) return;
  fill(ROOT,
    tabstrip(SUBS, {
      value: S.sub, label: 'Inference section',
      onchange: (id) => { S.sub = id; paint(); },
    }),
    S.sub === 'run' ? runSection() : null,
    S.sub === 'batch' ? (R.batch = h('div', { class: 'stack' }, paintBatch())) : null,
    S.sub === 'results' ? h('div', { class: 'stack' }, paintResults()) : null);
}

function runSection() {
  R.model = h('div', { class: 'colbd' }, paintModel());
  R.scope = h('div', { class: 'colbd' }, paintScope());
  R.out = h('div', { class: 'colbd' }, paintOut());
  R.resolved = h('div', { class: 'resolved' });
  paintResolved();

  const rows = inferenceJobs().slice(0, 6);
  return h('div', { class: 'stack' },
    /* #104: a preset must not hide the model. This bar is what makes that
       true no matter which column the operator is looking at. */
    h('div', { class: 'resolvedbar' },
      h('span', { class: 'resolvedlab' }, 'Will run'), R.resolved),
    panelRow('3',
      panel({ title: stepTitle(1, 'Model & Settings') }, R.model),
      panel({ title: stepTitle(2, 'Input Data') }, R.scope),
      panel({ title: stepTitle(3, 'Output & Options') }, R.out)),
    panel({
      title: 'Recent Inference Jobs', count: rows.length,
      tools: moreLink('View All Jobs', () => CTX.nav('jobs', { kind: 'inference' })),
      flush: true,
    }, recentTable(rows)));
}

/* ------------------------------------------------------------------ the tab */

export function render(ctx) {
  CTX = ctx;
  /* First render only: take the defaults out of the fixture rather than
     hard-coding ids that the next regeneration would invalidate. */
  if (S.modelId === null && models().length) S.modelId = models()[0].id;
  if (S.project === null && projects().length) S.project = projects()[0].code;
  if (ctx.params && ctx.params.sub && SUBS.some((s) => s.id === ctx.params.sub && !s.disabled)) {
    S.sub = ctx.params.sub;
  }
  ROOT = h('div', { class: 'tab-run' });
  paint();
  return ROOT;
}
