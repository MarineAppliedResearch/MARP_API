/**
 * Generates the ML Dashboard mockup's fixture — the data behind all eight tabs.
 *
 * Field names follow the real `/api/v2/gpu/…` response shapes recorded in MARP_API#104's
 * measurement comment wherever the API can already answer, so wiring the app later is a
 * change of source and not a change of vocabulary. Where the API has no representation
 * yet (a logical job over a MARP selection, "completed with issues", a job event log, a
 * per-job worker cap) the field exists here anyway, because that is what the screens
 * show; `DESIGN.md` lists every one of them.
 *
 * Deterministic: same seed in, same bytes out. The PRNG is created inside `build()`, so
 * calling it twice in one process returns the identical object — `tests/unit/fixture.test.mjs`
 * asserts that, because a fixture that drifts under a regeneration turns every future
 * diff into a merge argument.
 *
 * Values are fabricated. Nothing here is a fact about MARP, and no id in it refers to a
 * real MARP row.
 *
 * Run with `node tools/make-fixture.mjs` (or `npm run fixture`).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'fixtures', 'ml-dashboard.json');

/** The instant the fixture calls "now". Today in this workspace; nothing is dated after it. */
const NOW = '2026-09-09T16:40:00Z';
const NOW_MS = Date.parse(NOW);
const SEED = 20260909;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* mulberry32 — a small deterministic PRNG, inline so the fixture never shifts under a
   dependency bump. The same generator the mosaic reviewer's fixture uses. */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Whole-second ISO 8601 with a Z.
 *
 * Throws on a future instant rather than clamping: a generator that produces tomorrow's
 * timestamp has a bug, and a clamped date is one nobody ever finds. The one deliberate
 * exception is a live lease deadline, which is in the future by definition and is
 * formatted by `isoLease`.
 */
function iso(ms) {
  if (ms > NOW_MS) throw new Error(`fixture date is in the future: ${new Date(ms).toISOString()}`);
  return isoLease(ms);
}

/** As `iso`, without the future check. Only a live `lease_expires_at` may use it. */
function isoLease(ms) {
  return new Date(Math.round(ms / 1000) * 1000).toISOString().replace(/\.000Z$/, 'Z');
}

/* The label set an invertebrate/fish model here would carry: common name and the
   scientific name that goes with it, so the Models and Datasets breakdowns can show
   either. Ordered inverts-then-fish, which is what GROUPS slices. */
const SPECIES_DEFS = [
  ['California sea cucumber', 'Apostichopus californicus'],
  ['Giant plumose anemone', 'Metridium farcimen'],
  ['Fish-eating anemone', 'Urticina piscivora'],
  ['Orange sea pen', 'Ptilosarcus gurneyi'],
  ['Red sea urchin', 'Mesocentrotus franciscanus'],
  ['Purple sea urchin', 'Strongylocentrotus purpuratus'],
  ['Green sea urchin', 'Strongylocentrotus droebachiensis'],
  ['Sunflower star', 'Pycnopodia helianthoides'],
  ['Bat star', 'Patiria miniata'],
  ['Vermilion star', 'Mediaster aequalis'],
  ['Ochre sea star', 'Pisaster ochraceus'],
  ['Basket star', 'Gorgonocephalus eucnemis'],
  ['Brittle star', 'Ophiura sarsii'],
  ['Red tree coral', 'Primnoa pacifica'],
  ['Cloud sponge', 'Aphrocallistes vastus'],
  ['Boot sponge', 'Rhabdocalyptus dawsoni'],
  ['Dungeness crab', 'Metacarcinus magister'],
  ['Tanner crab', 'Chionoecetes bairdi'],
  ['Spot prawn', 'Pandalus platyceros'],
  ['Vermilion rockfish', 'Sebastes miniatus'],
  ['Yelloweye rockfish', 'Sebastes ruberrimus'],
  ['Quillback rockfish', 'Sebastes maliger'],
  ['Rosethorn rockfish', 'Sebastes helvomaculatus'],
  ['Lingcod', 'Ophiodon elongatus']
];

/** Which slice of the label set a model or dataset covers. Inclusive index ranges. */
const GROUPS = {
  inverts: [0, 18],
  urchins: [4, 6],
  stars: [7, 12],
  sponges: [13, 15],
  crabs: [16, 18],
  fish: [19, 23],
  all: [0, 23]
};

/* Substrate segmentation classes are not species. Kept explicit so no screen assumes a
   class label is always an organism. */
const SUBSTRATE_CLASSES = ['mud', 'sand', 'shell hash', 'cobble', 'boulder', 'bedrock'];

const PROJECT_DEFS = [
  ['CAMPA-2024', 'CAMPA 2024', 48, 312, 1842],
  ['GULF-2025', 'GULF 2025', 22, 141, 806],
  ['PACIFIC-2023', 'PACIFIC 2023', 31, 198, 1174],
  ['SALT-2024', 'SALT 2024', 14, 87, 498],
  ['VENTS-2025', 'VENTS 2025', 9, 52, 311],
  ['ARCTIC-2024', 'ARCTIC 2024', 17, 104, 623]
];

const USERS = ['itravers', 'jmarsh', 'kholt', 'dpeterson', 'lnguyen', 'svaldez', 'mkeller'];

/* Real hardware, honest VRAM, and the slot count that much VRAM actually supports. */
const GPUS = [
  { name: 'NVIDIA GeForce RTX 4090', vram_gb: 24, slots: 2, driver: '565.90', cuda: '12.7' },
  { name: 'NVIDIA GeForce RTX 3090', vram_gb: 24, slots: 2, driver: '552.22', cuda: '12.4' },
  { name: 'NVIDIA RTX A5000', vram_gb: 24, slots: 2, driver: '565.90', cuda: '12.7' },
  { name: 'NVIDIA GeForce RTX 4070', vram_gb: 12, slots: 1, driver: '552.22', cuda: '12.4' },
  { name: 'NVIDIA L40S', vram_gb: 48, slots: 3, driver: '570.86', cuda: '12.8' },
  { name: 'NVIDIA A100 80GB PCIe', vram_gb: 80, slots: 4, driver: '570.86', cuda: '12.8' }
];

const MODEL_DEFS = [
  { name: 'MARP-Det-v3', model_type: 'detect', task: 'detect-track', base: 'yolo11l',
    group: 'inverts', versions: 4,
    notes: 'General benthic detector. The workhorse for CAMPA and PACIFIC transect video.' },
  { name: 'MARP-Inverts-YOLO', model_type: 'detect', task: 'detect', base: 'yolov8m',
    group: 'inverts', versions: 3,
    notes: 'Invertebrate-only detector, kept for comparison against MARP-Det-v3.' },
  { name: 'MARP-Rockfish-Cls', model_type: 'classify', task: 'classify', base: 'yolo11m-cls',
    group: 'fish', versions: 3,
    notes: 'Rockfish species classifier, run over crops from a detection pass.' },
  { name: 'MARP-Fish-Det', model_type: 'detect', task: 'detect-track', base: 'yolo11m',
    group: 'fish', versions: 2,
    notes: 'Fish detector and tracker for mid-water and near-bottom passes.' },
  { name: 'MARP-Substrate-Seg', model_type: 'segment', task: 'segment', base: 'yolo11m-seg',
    group: 'substrate', versions: 2,
    notes: 'Substrate segmentation for habitat classification. Its classes are not species.' },
  { name: 'MARP-Sponge-Det', model_type: 'detect', task: 'detect', base: 'yolov8s',
    group: 'sponges', versions: 2,
    notes: 'Glass sponge reef work. Trained mostly on VENTS and SALT imagery.' },
  { name: 'MARP-SeaStar-Det', model_type: 'detect', task: 'detect', base: 'yolov8s',
    group: 'stars', versions: 1,
    notes: 'Asteroid detector built for the wasting-disease time series.' },
  { name: 'MARP-Crab-Det', model_type: 'detect', task: 'detect', base: 'yolov8s',
    group: 'crabs', versions: 2,
    notes: 'Commercial crab counts. Low class count, high precision requirement.' },
  { name: 'MARP-Urchin-Count', model_type: 'detect', task: 'count', base: 'yolo11s',
    group: 'urchins', versions: 3,
    notes: 'Density counting over fixed quadrats. Reduction is count-per-frame, not tracks.' },
  { name: 'MARP-Multiclass-Det-XL', model_type: 'detect', task: 'detect-track', base: 'yolo11x',
    group: 'all', versions: 1,
    notes: 'Everything in one detector. Slow, and the only model here that needs 24 GB to run.' }
];

/* Name, class group, who saved it, and the project its observations came from. The project
   is declared rather than drawn, because a training job that says GULF 2025 over a
   dataset named PACIFIC is a screen contradicting itself. */
const DATASET_DEFS = [
  ['CAMPA_2024_Inverts_Approved_v3', 'inverts', 'itravers', 'CAMPA 2024'],
  ['GULF_2025_Fish_Train_v1', 'fish', 'jmarsh', 'GULF 2025'],
  ['PACIFIC_Rockfish_Mixed_v2', 'fish', 'kholt', 'PACIFIC 2023'],
  ['SALT_2024_Substrate_v1', 'substrate', 'dpeterson', 'SALT 2024'],
  ['ALL_Projects_Inverts_v5', 'all', 'itravers', 'All projects'],
  ['VENTS_2025_Sponges_v1', 'sponges', 'lnguyen', 'VENTS 2025'],
  ['ARCTIC_2024_SeaStars_v2', 'stars', 'svaldez', 'ARCTIC 2024'],
  ['CAMPA_Urchin_Quadrats_v1', 'urchins', 'mkeller', 'CAMPA 2024']
];

/**
 * The whole fixture, built from the seed. Pure: no I/O, no clock, no module-level state.
 *
 * @returns {object} the payload written to `fixtures/ml-dashboard.json`
 */
export function build() {
  const rand = rng(SEED);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const chance = (p) => rand() < p;
  const hex = (n) => {
    let s = '';
    for (let i = 0; i < n; i += 1) s += '0123456789abcdef'[Math.floor(rand() * 16)];
    return s;
  };
  const uuid = () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
  /** Fisher-Yates on the fixture's own PRNG, so a shuffled list is still reproducible. */
  const shuffle = (a) => {
    const out = a.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const round = (n, dp) => Number(n.toFixed(dp));
  const pad = (n, w) => String(n).padStart(w, '0');
  const group1000 = (n) => n.toLocaleString('en-US');

  /* ------------------------------------------------------------------ species */

  const species = SPECIES_DEFS.map(([comname, sci], i) => ({
    species_id: 1200 + i * 3,
    comname,
    species: sci
  }));

  /** The label list a group covers, as class rows. */
  const classesFor = (group) => {
    if (group === 'substrate') {
      return SUBSTRATE_CLASSES.map((label, i) => ({
        species_id: null, comname: label, class_index: i
      }));
    }
    const [lo, hi] = GROUPS[group];
    return species.slice(lo, hi + 1).map((s, i) => ({
      species_id: s.species_id, comname: s.comname, class_index: i
    }));
  };

  /* ------------------------------------------------------------------ projects */

  const projects = PROJECT_DEFS.map(([code, name, dives, lines, videos], i) => ({
    id: i + 1,
    code,
    name,
    dives,
    lines,
    videos,
    /* Videos times a plausible length at 25 fps, rounded so the number does not pretend to
       a precision nobody measured. */
    frames: Math.round((videos * between(21_000, 34_000)) / 1000) * 1000
  }));

  /* ------------------------------------------------------------------ datasets */

  const datasets = DATASET_DEFS.map(([name, group, created_by, project], i) => {
    const classes = classesFor(group);
    const observations = between(3_400, 61_000);
    /* One label per observation, so the breakdown sums to the membership count. A
       breakdown that does not add up is the Datasets screen contradicting itself. */
    const weights = classes.map(() => 0.3 + rand());
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    let assigned = 0;
    const breakdown = classes.map((c, n) => {
      const count = n === classes.length - 1
        ? observations - assigned
        : Math.max(1, Math.round((weights[n] / weightTotal) * observations));
      assigned += count;
      return { ...c, count };
    });
    /* 70/15/15 by intent, but the split-group rule means a boundary lands where a group
       ends rather than on an exact percentage. */
    const train = Math.round(observations * (0.68 + rand() * 0.05));
    const val = Math.round((observations - train) * (0.45 + rand() * 0.12));
    const test = observations - train - val;
    const createdMs = NOW_MS - between(20, 270) * DAY - between(0, 23) * HOUR - between(0, 3599) * 1000;
    return {
      id: 300 + i * 4,
      name,
      project,
      group,
      description: group === 'substrate'
        ? 'Approved observations, substrate classes, frozen membership and split.'
        : 'Approved observations, benthic labels, frozen membership and split.',
      created_by,
      created_at: iso(createdMs),
      updated_at: iso(createdMs + between(0, 6) * HOUR),
      observations,
      classes: breakdown,
      split: { train, val, test },
      /* Transitive time-overlap groups: observations whose key frames are on screen
         together cannot be split apart, so the split is assigned per group, not per row. */
      split_groups: Math.max(1, Math.round(observations / between(5, 14))),
      _createdMs: createdMs
    };
  });

  /* ------------------------------------------------------------------ models */

  let modelId = 88;
  let versionId = 5100;
  const models = MODEL_DEFS.map((def) => {
    modelId += between(1, 3);
    const classes = classesFor(def.group);
    const versions = [];
    for (let v = 0; v < def.versions; v += 1) {
      const ds = datasets[Math.floor(rand() * datasets.length)];
      const trainedMs = Math.min(
        ds._createdMs + between(1, 40) * DAY + v * between(9, 30) * DAY,
        NOW_MS - between(2, 9) * DAY - between(0, 23) * HOUR - between(0, 3599) * 1000
      );
      /* Later versions are better, with the gains getting smaller — which is what a real
         registry looks like, and what makes comparing two versions worth drawing. */
      const lift = 1 - Math.exp(-0.9 * (v + 1));
      const map50 = round(0.58 + lift * 0.31 + rand() * 0.015, 4);
      const weightMb = def.base.includes('x') ? 128
        : def.base.includes('l') ? 49
          : def.base.includes('m') ? 38 : 18;
      versionId += between(1, 4);
      versions.push({
        id: versionId,
        /* Two minors per major, so a four-version model tops out at 2.1.x rather than
           4.x — a model called MARP-Det-v3 whose newest version is 4.1.3 reads as a
           mistake even when it is not. */
        version: `${Math.floor(v / 2) + 1}.${v % 2}.${between(0, 4)}`,
        sha256: hex(64),
        trained_at: iso(trainedMs),
        engine: def.base.startsWith('yolo11') ? 'ultralytics-yolo11' : 'ultralytics-yolov8',
        task: def.task,
        base_model: def.base,
        dataset_id: ds.id,
        classes: classes.map((c) => c.comname),
        metrics: {
          map50,
          map5095: round(map50 * (0.6 + rand() * 0.07), 4),
          precision: round(0.62 + lift * 0.29 + rand() * 0.02, 4),
          recall: round(0.55 + lift * 0.32 + rand() * 0.025, 4)
        },
        size_mb: round(6 + classes.length * 0.4 + weightMb + rand() * 3, 1),
        /* Preference is task-specific, carries a note, and is never automatic — a
           successful training run registers a version but does not promote it. Two
           versions get one, set below once the registry exists. */
        preferred_for_task: null,
        preferred_note: null
      });
    }
    /* A registry row exists because its first version arrived, so it is dated from that
       rather than independently — otherwise a model can carry a version trained before
       the model was registered. */
    const trainedMs = versions.map((v) => Date.parse(v.trained_at));
    return {
      id: modelId,
      name: def.name,
      model_type: def.model_type,
      task: def.task,
      status: 'active',
      notes: def.notes,
      class_count: classes.length,
      created_at: iso(Math.min(...trainedMs) - between(1, 20) * DAY),
      updated_at: iso(Math.max(...trainedMs)),
      versions
    };
  });

  /* Exactly two preferences, each for one task and each with a note saying what it is
     preferred *for*. MARP has no global promotion hierarchy, and the wording is
     deliberate: "preferred for this task", never "promoted". */
  const detModel = models.find((m) => m.name === 'MARP-Det-v3');
  const detVersion = detModel.versions[detModel.versions.length - 1];
  detVersion.preferred_for_task = 'detect-track';
  detVersion.preferred_note =
    'Preferred for detect-and-track on CAMPA and PACIFIC transect video. Holds tracks '
    + 'through the silt clouds the earlier weights lost them in. Not preferred for still '
    + 'quadrats, where MARP-Urchin-Count still counts better.';
  const clsModel = models.find((m) => m.name === 'MARP-Rockfish-Cls');
  const clsVersion = clsModel.versions[clsModel.versions.length - 1];
  clsVersion.preferred_for_task = 'classify';
  clsVersion.preferred_note =
    'Preferred for rockfish classification from detection crops. Separates quillback from '
    + 'rosethorn, which every earlier version confused. Wants crops at 224 px or better.';

  const modelById = new Map(models.map((m) => [m.id, m]));

  /** A job's model reference: resolved and locked at submission. */
  const lockModel = (model, version) => ({
    id: model.id,
    name: model.name,
    version: version.version,
    version_id: version.id,
    sha256: version.sha256
  });

  /* ------------------------------------------------------------------ jobs */

  /* The state plan: state, how many, how many of them inference, how many training. The
     brief says "about"; these are the numbers it resolves to, and every stat card is
     recounted from the rows rather than read off this table. Inference to training comes
     out 80:40. */
  const PLAN = [
    ['queued', 8, 5, 3],
    ['running', 6, 4, 2],
    ['cancelling', 1, 1, 0],
    ['paused', 2, 1, 1],
    ['failed', 4, 3, 1],
    ['issues', 3, 3, 0],
    ['cancelled', 4, 3, 1],
    ['succeeded', 92, 60, 32]
  ];

  /* A job's subject, and the class group whose models can do it. */
  const SUBJECTS = [
    ['Inverts', 'inverts'], ['Invertebrate_Detect', 'inverts'], ['Fish_Detect', 'fish'],
    ['Rockfish_Cls', 'fish'], ['Substrate_Seg', 'substrate'], ['Sponge_Survey', 'sponges'],
    ['SeaStar_Count', 'stars'], ['Crab_Count', 'crabs'], ['Urchin_Count', 'urchins'],
    ['Benthic_All', 'all']
  ];

  const modelsForGroup = (group) => {
    const matches = models.filter((m, i) => MODEL_DEFS[i].group === group);
    return matches.length ? matches : models;
  };

  /* A model is fine-tuned on a dataset of its own classes. Nothing has a crab dataset, so
     the everything dataset is the fallback — training MARP-Crab-Det on a rockfish set
     would be a scientific nonsense the Training screen would then display. */
  const datasetsForGroup = (group) => {
    const matches = datasets.filter((d) => d.group === group);
    return matches.length ? matches : datasets.filter((d) => d.group === 'all');
  };

  const codeOf = (project) => project.code.replace('-', '_');

  const FAILURES = [
    'CUDA out of memory: tried to allocate 2.31 GiB (GPU 0; 23.99 GiB total capacity; '
      + '22.87 GiB already allocated by this process)',
    'Model artifact hash mismatch: the manifest declares sha256 9f2c4b… and the downloaded '
      + 'artifact hashes 4a81e0… . Refusing to run unverified weights.',
    'Video unreachable: the media server answered HTTP 404 for item 3f9a21c8 on five '
      + 'attempts over 4 m 10 s',
    'Training diverged: val_loss rose for nine consecutive epochs and reached 9.81 at '
      + 'epoch 31 (gradient overflow, loss scale collapsed to 1)'
  ];

  const ISSUE_REASONS = [
    'Lease expired: no heartbeat for 118 s. The range went back to the pool and failed its '
      + 'last attempt.',
    'Video unreachable: the media server answered HTTP 502 for this item',
    'Decoder error: corrupt GOP at frame 41,208. Range abandoned after three attempts.',
    'CUDA out of memory on the worker that took this range, three times running'
  ];

  const raw = [];
  for (const [state, count, nInference, nTraining] of PLAN) {
    const kinds = shuffle([
      ...Array.from({ length: nInference }, () => 'inference'),
      ...Array.from({ length: nTraining }, () => 'training')
    ]);
    for (let i = 0; i < count; i += 1) raw.push({ state, kind: kinds[i] });
  }

  /* When each job was created, or for a finished one when it finished. Terminal jobs are
     biased toward the recent end: the pool has been getting busier, and a flat six weeks
     would put almost nothing in "completed today" and make that card look broken. */
  for (const j of raw) {
    if (j.state === 'queued') j.createdMs = NOW_MS - between(1, 45) * MIN;
    else if (j.state === 'running') j.createdMs = NOW_MS - between(20, 300) * MIN;
    else if (j.state === 'cancelling') j.createdMs = NOW_MS - between(35, 70) * MIN;
    else if (j.state === 'paused') j.createdMs = NOW_MS - between(3, 9) * HOUR;
    else j.finishedMs = NOW_MS - Math.round(40 * MIN + (42 * DAY - 40 * MIN) * (rand() ** 2.2));
  }

  /* The body of each job. */
  const seenNames = new Map();
  for (const j of raw) {
    const project = pick(projects);
    const [subject, group] = pick(SUBJECTS);
    const candidates = modelsForGroup(group);
    const model = candidates[Math.floor(rand() * candidates.length)];
    const version = model.versions[Math.floor(rand() * model.versions.length)];

    if (j.kind === 'training') {
      const pool = datasetsForGroup(MODEL_DEFS[models.indexOf(model)].group);
      const ds = pool[Math.floor(rand() * pool.length)];
      j.dataset = { id: ds.id, name: ds.name };
      /* Named for the model and the dataset it was trained on. The version in the name is
         the *dataset's*: the version this run produces is not known until it succeeds, and
         a `_v4_` in a job name that is not the model version invites exactly that misread. */
      const parts = ds.name.split('_');
      j.name = `${chance(0.5) ? 'Train' : 'Finetune'}_${model.name}_${parts[0]}_${parts[parts.length - 1]}`;
      /* A training job's scope is its one saved dataset, not a video selection, so
         `videos` is null rather than zero — nothing was selected, not none matched. The
         project comes from the dataset, not from the dice. */
      j.scope = { label: `Dataset: ${ds.name}`, project: ds.project, videos: null, video: null };
      j.total = pick([60, 80, 100, 120]);
      j.unit = 'epochs';
    } else {
      j.dataset = null;
      const c = codeOf(project);
      /* One dive and one line per job, used by both the name and the scope label. Drawing
         them twice is how a row ends up called Dive_0108 over a video from D0074. */
      const dive = pad(between(1, 480), 4);
      const line = pad(between(1, 48), 2);
      const videos = chance(0.62) ? 1 : between(2, 46);
      if (videos === 1) {
        j.name = chance(0.5) ? `${c}_Dive_${dive}_${subject}` : `${c}_D${dive}_L${line}_${subject}`;
        j.scope = { label: `Video: ${c}_D${dive}_L${line}_CAM1.mp4`, project: project.name, videos: 1 };
      } else if (chance(0.22)) {
        j.name = `${project.name.split(' ')[0]}_${subject}_v${between(1, 4)}`;
        j.scope = { label: `Project: ${project.name} · ${videos} videos`, project: project.name, videos };
      } else if (chance(0.5)) {
        j.name = `${c}_Dive_${dive}_${subject}`;
        j.scope = { label: `Dive ${dive} · ${videos} videos`, project: project.name, videos };
      } else {
        j.name = `${c}_Line_${line}_${subject}`;
        j.scope = { label: `Line ${line} · ${videos} videos`, project: project.name, videos };
      }
      j.total = between(6_000, 320_000);
      j.unit = 'frames';
      j.projectCode = c;
      j.videoFile = `${c}_D${dive}_L${line}_CAM1.mp4`;
      /* The first video of the selection, named. A batch is one video cut into ranges
         today, so for most jobs this is the only video; the diagnostics view needs a file
         name and a scope label is not one. */
      j.scope.video = j.videoFile;
    }

    /* A duplicate name is plausible in real life but useless in a mockup, where a screen
       may key a row on it. A re-run reads as a re-run. */
    const n = (seenNames.get(j.name) || 0) + 1;
    seenNames.set(j.name, n);
    if (n > 1) j.name = `${j.name}_r${n}`;

    j.model = lockModel(model, version);
    j.priority = chance(0.68) ? 5 : between(1, 9);
    /* `created_by` is null for anything submitted with a service token, which #104 found
       was every job in its run. A "who ran this" column has to survive that. */
    j.created_by = chance(0.05) ? null : pick(USERS);
    j.batchId = j.kind === 'inference' && chance(0.6) ? uuid() : null;
    j.maxAttempts = 3;
    j.cap = j.kind === 'training' ? 1 : pick([1, 2, 4, 8, 12, 16, 24, 32]);
  }

  /* Progress, duration and the terminal timestamps, per state. */
  for (const j of raw) {
    const total = j.total;
    const detectionRate = 0.02 + rand() * 0.3;
    /* Frames per second for inference; seconds per epoch, inverted, for training. */
    const perSecond = j.kind === 'training' ? 1 / between(45, 220) : between(40, 240);
    const fullDuration = Math.max(20, Math.round(total / perSecond) + between(15, 90));

    j.progress = { done: 0, total, unit: j.unit };
    j.attemptsMade = 1;
    j.durationS = null;
    j.detections = null;
    j.failureReason = null;
    j.issues = [];

    if (j.state === 'queued') {
      /* Legitimately null before the first heartbeat. A zeroed bar would claim a
         measurement nobody took, so the field is null and the screens draw a dash. */
      j.progress = null;
      j.attemptsMade = 0;
      j.updatedMs = j.createdMs;
    } else if (j.state === 'running' || j.state === 'cancelling') {
      j.progress.done = Math.round(total * (0.08 + rand() * 0.8));
      j.updatedMs = NOW_MS - between(2, 40) * 1000;
    } else if (j.state === 'paused') {
      j.progress.done = Math.round(total * (0.15 + rand() * 0.6));
      j.updatedMs = NOW_MS - between(12, 220) * MIN;
    } else {
      const finished = j.state === 'succeeded' || j.state === 'issues';
      j.durationS = finished ? fullDuration : Math.round(fullDuration * (0.1 + rand() * 0.6));
      j.createdMs = j.finishedMs - j.durationS * 1000 - between(0, 25) * MIN;
      j.updatedMs = j.finishedMs;
      if (j.state === 'succeeded') {
        j.progress.done = total;
        if (j.kind === 'inference') j.detections = Math.round(total * detectionRate);
      } else if (j.state === 'issues') {
        /* Mostly succeeded, a few ranges never made it. First-class, not a failure, and
           the operator retries only the ranges named here. */
        j.progress.done = Math.round(total * (0.86 + rand() * 0.11));
        j.detections = Math.round(j.progress.done * detectionRate);
        j.attemptsMade = between(2, 3);
        const bad = between(1, 4);
        for (let k = 0; k < bad; k += 1) {
          const from = between(0, Math.max(1, total - 12_000));
          /* A single-video job can only have failed ranges of that one video. A selection
             of several can have failed a different one, so the file is drawn afresh
             within the same project. */
          j.issues.push({
            video: j.scope.videos === 1
              ? j.videoFile
              : `${j.projectCode}_D${pad(between(1, 480), 4)}_L${pad(between(1, 48), 2)}_CAM1.mp4`,
            range: [from, from + between(4_000, 12_000)],
            reason: ISSUE_REASONS[Math.floor(rand() * ISSUE_REASONS.length)],
            attempts: between(2, 3)
          });
        }
      } else if (j.state === 'failed') {
        j.progress.done = Math.round(total * (0.05 + rand() * 0.5));
        j.attemptsMade = 3;
        j.failureReason = j.kind === 'training'
          ? FAILURES[3]
          : FAILURES[Math.floor(rand() * 3)];
      } else if (j.state === 'cancelled') {
        /* A cancelled attempt's partial results are staged and never recorded, so there is
           nothing honest to put in `detections`. */
        j.progress.done = Math.round(total * (0.05 + rand() * 0.7));
      }
    }
  }

  /* One failed inference job never got a heartbeat: the artifact hash did not match, so it
     died in prepare. Progress is null there too — a dash on a *failed* row, not only on a
     queued one, which is the case a screen most easily gets wrong. */
  const prepareFail = raw.find((j) => j.state === 'failed' && j.kind === 'inference');
  prepareFail.failureReason = FAILURES[1];
  prepareFail.progress = null;
  prepareFail.durationS = between(9, 22);

  /* Newest first, and the id order agrees with the created_at order the way a real
     sequence-assigned primary key does. */
  raw.sort((a, b) => b.createdMs - a.createdMs);
  let nextId = 1834;
  const jobs = raw.map((j) => {
    const id = nextId;
    nextId -= between(1, 2);
    return {
      id,
      batch_id: j.batchId,
      name: j.name,
      kind: j.kind,
      state: j.state,
      priority: j.priority,
      scope: j.scope,
      model: j.model,
      dataset: j.dataset,
      run_id: null,
      progress: j.progress,
      /* `using` is present tense, so a finished job is using nobody; it is filled in below
         from the pool. `cap` is what was asked for at submit, which the API has no field
         for today. */
      workers: { using: 0, cap: j.cap },
      attempts_made: j.attemptsMade,
      max_attempts: j.maxAttempts,
      created_by: j.created_by,
      created_at: iso(j.createdMs),
      updated_at: iso(j.updatedMs),
      finished_at: j.finishedMs ? iso(j.finishedMs) : null,
      duration_s: j.durationS,
      detections: j.detections,
      failure_reason: j.failureReason,
      issues: j.issues
    };
  });

  /* ------------------------------------------------------------------ training runs */

  const runningTraining = jobs.filter((j) => j.state === 'running' && j.kind === 'training');
  const failedTraining = jobs.filter((j) => j.state === 'failed' && j.kind === 'training');
  const succeededTraining = jobs.filter((j) => j.state === 'succeeded' && j.kind === 'training');

  /* A version is registered by exactly one run, so the ten finished runs claim ten
     different versions. Left to the dice, three runs all "produced" MARP-SeaStar-Det
     1.0.1 — a provenance chain that says two things at once, which is worse than no
     provenance chain. Each run takes the newest version of its model that no earlier run
     has claimed, and a job whose model has none left is passed over. */
  const claimed = new Set();
  const finishedRuns = [];
  for (const job of succeededTraining) {
    if (finishedRuns.length === 10) break;
    const model = modelById.get(job.model.id);
    /* Index 0 is a model's first version and was fine-tuned from an upstream checkpoint;
       a run needs a previous MARP version to have fine-tuned from. */
    const free = model.versions.filter((v, n) => n > 0 && !claimed.has(v.id));
    if (!free.length) continue;
    const version = free[free.length - 1];
    claimed.add(version.id);
    /* The job's locked model reference is what the run started from and what it
       registered, so it moves with the run. */
    job.model = lockModel(model, version);
    finishedRuns.push(job);
  }
  if (finishedRuns.length < 10) {
    throw new Error(`only ${finishedRuns.length} training runs could claim a distinct model version`);
  }
  const runJobs = [runningTraining[0], failedTraining[0], ...finishedRuns];

  const runs = runJobs.map((job, i) => {
    const model = modelById.get(job.model.id);
    const ds = datasets.find((d) => d.id === job.dataset.id);
    const total = job.progress ? job.progress.total : 100;
    const diverged = job.state === 'failed';
    const done = job.state === 'running' ? job.progress.done : diverged ? 31 : total;
    const perEpoch = Math.max(30, Math.round((job.duration_s || 6_400) / Math.max(1, done)));
    /* The job row and its run must agree on how many epochs are done: the diverged run
       stopped at 31, and the job's own progress was drawn before the run existed. */
    job.progress.done = done;

    const epochs = [];
    /* Where the diverged run's val_loss and mAP had got to when it turned. The ramp
       continues from there rather than restarting at a constant, which would draw a
       chart that dips just before it blows up. */
    let turnVal = null;
    let turnMap = null;
    for (let e = 1; e <= done; e += 1) {
      const p = e / total;
      const train = 1.92 * Math.exp(-2.6 * p) + 0.22 + (rand() - 0.5) * 0.06;
      let val = 1.98 * Math.exp(-2.3 * p) + 0.3 + (rand() - 0.5) * 0.09;
      let map50 = 0.88 * (1 - Math.exp(-3.4 * p)) + 0.06 + (rand() - 0.5) * 0.02;
      if (diverged && e === 12) {
        turnVal = val;
        turnMap = map50;
      } else if (diverged && e > 12) {
        /* The losses part company: train keeps falling, val climbs away from it, and mAP
           goes with val. That shape is the whole reason this run is in the fixture. */
        val = turnVal + ((e - 12) ** 1.9) * 0.055 + rand() * 0.05;
        map50 = Math.max(0.02, turnMap - (e - 12) * 0.032 - rand() * 0.01);
      }
      epochs.push({
        epoch: e,
        train_loss: round(Math.max(0.05, train), 4),
        val_loss: round(Math.max(0.05, val), 4),
        map50: round(Math.min(0.97, Math.max(0.01, map50)), 4),
        seconds: perEpoch
      });
    }

    /* Transfer learning: the run starts from the previous registered version of this model
       where there is one, and from the upstream checkpoint for a model's first version.
       A successful run registers the version its job row points at — and does not mark it
       preferred, which stays an explicit human decision. */
    const idx = model.versions.findIndex((v) => v.id === job.model.version_id);
    const base = idx > 0 ? model.versions[idx - 1] : null;
    const produced = job.state === 'succeeded'
      ? { id: job.model.version_id, version: job.model.version }
      : null;

    const run = {
      id: 700 + i * 3,
      job_id: job.id,
      name: job.name,
      state: job.state,
      model: { id: model.id, name: model.name },
      base_model: base ? { version: base.version, version_id: base.id } : null,
      base_checkpoint: MODEL_DEFS[models.indexOf(model)].base,
      produced_version: produced,
      dataset: { id: ds.id, name: ds.name, observations: ds.observations },
      epochs_done: done,
      epochs_total: total,
      batch_size: pick([8, 16, 16, 32]),
      learning_rate: pick([0.01, 0.005, 0.002, 0.001]),
      optimizer: pick(['SGD', 'AdamW', 'AdamW']),
      image_size: pick([640, 640, 960, 1280]),
      compute_device: 'cuda:0',
      created_at: job.created_at,
      started_at: job.created_at,
      finished_at: job.finished_at,
      failure_reason: job.failure_reason,
      epochs
    };
    job.run_id = run.id;
    return run;
  });

  /* ------------------------------------------------------------------ workers */

  const workerNames = [];
  for (let i = 1; i <= 84; i += 1) workerNames.push([`ml-gpu-${pad(i, 2)}`, 'rack']);
  for (let i = 1; i <= 30; i += 1) workerNames.push([`marp-rig-${pad(i, 2)}`, 'rig']);
  for (let i = 1; i <= 17; i += 1) workerNames.push([`campa-lab-${pad(i, 2)}`, 'lab']);
  /* Contributed machines, named by the person who enrolled them. The point of the pool is
     that a volunteer can join it, and a pool of nothing but `ml-gpu-NN` hides that. */
  for (const n of ['dave-rtx4090', 'jmarsh-workstation', 'kholt-3090', 'lnguyen-a5000',
    'svaldez-4070', 'mkeller-rig', 'hallberg-lab-01', 'okamoto-4090', 'ruiz-3090',
    'whitcomb-l40s', 'bergstrom-4070', 'tanaka-a100']) workerNames.push([n, 'contributed']);

  /** Which GPUs a family of machine is built from. Indexes into GPUS. */
  const FAMILY_GPUS = {
    rack: [0, 2, 4, 5],
    rig: [1, 3],
    lab: [3, 1],
    contributed: [0, 1, 2, 3, 4, 5]
  };
  /* A machine outside the rack is likelier to be switched off, so the offline rows land
     where an operator would expect them rather than spread uniformly. */
  const FLAKINESS = { rack: 0.05, rig: 0.15, lab: 0.3, contributed: 0.7 };

  const draft = workerNames.map(([name, family], i) => {
    const gpuIds = FAMILY_GPUS[family];
    return {
      i,
      name,
      family,
      gpu: GPUS[gpuIds[Math.floor(rand() * gpuIds.length)]],
      enrolledMs: NOW_MS - between(9, 430) * DAY - between(0, 23) * HOUR - between(0, 3599) * 1000,
      score: FLAKINESS[family] + rand() * 0.5
    };
  });

  /* The pool's shape, and it is the Dashboard mockup's arithmetic: 143 enrolled, 19
     switched off, 124 reachable. Of the reachable, 6 are paused by an operator and 118
     are taking work — 98 of those busy right now, 20 idle.
     So `workers_online` in `counts` means *reachable* (state is not offline), which is
     what the card labelled Online shows; `state === 'online'` is 118 of them. Written out
     because 124 + 6 + 19 does not sum to 143 and somebody will check. */
  const byScore = draft.slice().sort((a, b) => (b.score - a.score) || (a.i - b.i));
  const offlineSet = new Set(byScore.slice(0, 19).map((w) => w.i));
  const pausedSet = new Set(byScore.slice(19, 25).map((w) => w.i));
  const takingWork = shuffle(draft.filter((w) => !offlineSet.has(w.i) && !pausedSet.has(w.i)));
  const busySet = new Set(takingWork.slice(0, 98).map((w) => w.i));

  /* What the busy machines are working on: the six running jobs and the one that is
     cancelling, whose attempt is still winding down. A training run holds exactly one
     GPU, so the other 96 spread over the four running inference jobs and the cancelling
     one. */
  const runningInference = jobs.filter((j) => j.state === 'running' && j.kind === 'inference');
  const cancellingJob = jobs.find((j) => j.state === 'cancelling');
  const liveAssignment = [];
  const inferenceShares = [30, 24, 19, 15];
  runningInference.forEach((job, n) => {
    for (let k = 0; k < inferenceShares[n]; k += 1) liveAssignment.push(job);
  });
  for (let k = 0; k < 8; k += 1) liveAssignment.push(cancellingJob);
  for (const job of runningTraining) liveAssignment.push(job);

  let attemptId = 90_140;
  let liveCursor = 0;
  const workers = draft.map((w) => {
    const offline = offlineSet.has(w.i);
    const paused = pausedSet.has(w.i);
    const busy = busySet.has(w.i);
    const state = offline ? 'offline' : paused ? 'paused' : 'online';
    /* `activity` is derived, not stored: busy when a live attempt exists, otherwise from
       state. #104 measured it that way, and it is not filterable server-side. */
    const activity = busy ? 'busy' : state === 'online' ? 'idle' : state;

    /* A healthy idle worker's last_seen_at can be a whole long-poll window stale — #104
       measured 1.5 s to 55.6 s — so "quiet" has to mean well over a minute. */
    const lastSeenMs = offline
      ? NOW_MS - between(3 * HOUR, 26 * DAY)
      : NOW_MS - between(1, 56) * 1000;

    const attempts = [];
    let currentJob = null;
    let currentModel = null;
    if (busy) {
      const job = liveAssignment[liveCursor % liveAssignment.length];
      liveCursor += 1;
      currentJob = { id: job.id, name: job.name };
      currentModel = { id: job.model.id, name: job.model.name, version: job.model.version };
      /* A multi-slot machine may hold two ranges of the same batch. Two ranges of two
         different jobs would also be legal; kept to one job so a worker row has a single
         answer to "what is this machine doing". */
      const training = job.kind === 'training';
      /* A training run holds one whole GPU start to finish, so it never occupies two
         slots and its attempt covers the whole run rather than a frame range. */
      const slots = !training && w.gpu.slots >= 2 && chance(0.3) ? 2 : 1;
      const jobTotal = job.progress ? job.progress.total : 100;
      for (let s = 0; s < slots; s += 1) {
        const rangeTotal = training
          ? jobTotal
          : Math.max(1, Math.round(jobTotal / (slots * between(2, 9))));
        attemptId += between(1, 3);
        attempts.push({
          id: attemptId,
          job_id: job.id,
          slot_index: s,
          lease_epoch: between(1, 3),
          state: chance(0.06) ? 'uploading' : 'running',
          leased_at: iso(NOW_MS - between(40, 3_400) * 1000),
          /* The one field in this fixture deliberately in the future: a live lease deadline
             has to be, or every busy worker reads as dead. */
          lease_expires_at: isoLease(NOW_MS + between(12, 88) * 1000),
          last_heartbeat_at: iso(NOW_MS - between(1, 28) * 1000),
          progress_done: training
            ? job.progress.done
            : Math.round(rangeTotal * (0.05 + rand() * 0.9)),
          progress_total: rangeTotal,
          progress_unit: training ? 'epochs' : 'frames'
        });
      }
    } else if (!offline && chance(0.35)) {
      /* An idle or paused machine still has the last model it ran in its cache. */
      const m = models[Math.floor(rand() * models.length)];
      const v = m.versions[m.versions.length - 1];
      currentModel = { id: m.id, name: m.name, version: v.version };
    }

    return {
      worker_id: `wk-${hex(16)}`,
      name: w.name,
      state,
      activity,
      slot_count: w.gpu.slots,
      worker_version: offline
        ? pick(['0.9.3', '0.9.4'])
        : pick(['1.0.0', '1.0.1', '1.0.1', '0.9.4']),
      capabilities: {
        gpus: [{
          name: w.gpu.name,
          vram_gb: w.gpu.vram_gb,
          driver: w.gpu.driver,
          cuda: w.gpu.cuda
        }],
        engines: w.gpu.vram_gb >= 24
          ? ['ultralytics-yolo11', 'ultralytics-yolov8', 'tensorrt', 'onnxruntime']
          : ['ultralytics-yolo11', 'ultralytics-yolov8', 'onnxruntime'],
        reductions: ['per-frame', 'track-summary', 'count-per-frame'],
        cpu: pick(['AMD Ryzen 9 7950X', 'AMD EPYC 7443P', 'Intel Xeon Silver 4310',
          'Intel Core i9-13900K', 'AMD Ryzen 7 5800X']),
        ram_gb: pick([32, 64, 64, 128, 256]),
        os: pick(['Ubuntu 24.04', 'Ubuntu 22.04', 'Windows 11']),
        python: pick(['3.12.10', '3.12.7', '3.11.9']),
        max_batch: w.gpu.vram_gb >= 48 ? 32 : w.gpu.vram_gb >= 24 ? 16 : 8
      },
      enrolled_at: iso(w.enrolledMs),
      last_seen_at: iso(Math.max(lastSeenMs, w.enrolledMs)),
      current_job: currentJob,
      current_model: currentModel,
      attempts
    };
  });

  /* What each live job is actually using, now that the pool is assigned. Distinct
     machines, not attempts: a worker holding two ranges of one batch is one contributor. */
  for (const job of jobs) {
    const using = workers.filter((w) => w.current_job && w.current_job.id === job.id).length;
    if (using) job.workers = { using, cap: Math.max(using, job.workers.cap) };
  }

  /* ------------------------------------------------------------------ events */

  /* The diagnostics view reads these. No route returns them today — the rows exist in
     `gpu_job_events` and nothing serves them — so the mockup reads them from here. */
  const eventJobs = [
    ...jobs.filter((j) => j.state === 'running').slice(0, 3),
    cancellingJob,
    ...jobs.filter((j) => j.state === 'failed').slice(0, 2),
    jobs.find((j) => j.state === 'issues'),
    jobs.find((j) => j.state === 'succeeded')
  ].filter(Boolean);

  const events = [];
  for (const job of eventJobs) {
    const reachable = workers.filter((w) => w.state !== 'offline');
    const worker = reachable[Math.floor(rand() * reachable.length)];
    const startMs = Date.parse(job.created_at);
    const endMs = job.finished_at ? Date.parse(job.finished_at) : NOW_MS - between(3, 25) * 1000;
    const count = between(30, 80);
    const step = Math.max(1000, Math.floor((endMs - startMs) / count));
    const total = job.progress ? job.progress.total : (job.kind === 'training' ? 100 : 40_000);
    let seq = 0;
    const push = (at, level, kind, message) => {
      seq += 1;
      events.push({
        job_id: job.id, seq, at: iso(Math.min(at, endMs)), level, kind, message
      });
    };

    push(startMs, 'info', 'lease',
      `Leased to ${worker.name} slot 0 (lease epoch 1, 90 s deadline, worker ${worker.worker_id})`);
    push(startMs + step, 'info', 'prepare',
      `Model ${job.model.name} ${job.model.version} resolved from cache, sha256 ${job.model.sha256.slice(0, 12)}…`);
    push(startMs + step * 2, 'info', 'prepare',
      job.kind === 'training'
        ? `Dataset ${job.dataset.name} materialised: ${total} epochs planned, batch 16, 640 px`
        : `Decoder opened ${job.scope.video} at 25.000 fps, ${group1000(total)} frames in range`);
    push(startMs + step * 3, 'info', 'prepare',
      `Warm-up complete on ${worker.capabilities.gpus[0].name}, fp16, batch ${worker.capabilities.max_batch}`);

    for (let n = 4; n < count - 3; n += 1) {
      const at = startMs + step * n;
      const roll = rand();
      if (roll < 0.55) {
        const done = Math.round((total * n) / count);
        push(at, 'info', 'progress',
          job.kind === 'training'
            ? `epoch ${Math.max(1, done)}/${total} — train_loss ${round(0.3 + rand() * 1.1, 3)}, val_loss ${round(0.4 + rand() * 1.2, 3)}`
            : `frames ${group1000(done)}/${group1000(total)} (${round((done / total) * 100, 1)}%) at ${round(28 + rand() * 60, 1)} fps`);
      } else if (roll < 0.84) {
        push(at, 'info', 'metric',
          `batch ${between(10, 900)}: ${between(0, 74)} detections, mean confidence ${round(0.42 + rand() * 0.5, 3)}`);
      } else if (roll < 0.93) {
        push(at, 'info', 'lease',
          `Lease renewed, epoch ${between(1, 3)}, deadline moved to +90 s`);
      } else {
        push(at, 'warn', 'warn', pick([
          `Decoder reported ${between(1, 6)} dropped frames; the range continues`,
          `GPU memory at ${between(88, 97)}% — batch reduced to ${between(4, 12)} for the rest of this range`,
          `Heartbeat took ${between(2100, 8400)} ms to acknowledge; the coordinator may be busy`,
          `Class ${pick(species).comname} produced ${between(180, 900)} detections in one batch — check the confidence floor`
        ]));
      }
    }

    if (job.state === 'failed') {
      push(endMs - step * 2, 'error', 'error', job.failure_reason);
      push(endMs - step, 'warn', 'warn',
        `Attempt ${job.attempts_made} of ${job.max_attempts} failed; no attempts remain`);
      push(endMs, 'error', 'result', 'Job failed. Nothing was written to the observation database.');
    } else if (job.state === 'issues') {
      for (const issue of job.issues.slice(0, 2)) {
        push(endMs - step * 3, 'error', 'error',
          `Range ${issue.range[0]}-${issue.range[1]} of ${issue.video}: ${issue.reason}`);
      }
      push(endMs - step, 'info', 'upload',
        `Uploading results.jsonl (${round(4 + rand() * 40, 1)} MB) to staging`);
      push(endMs, 'warn', 'result',
        `Completed with issues: ${job.issues.length} range${job.issues.length === 1 ? '' : 's'} never finished, `
        + `${group1000(job.detections || 0)} detections from the rest`);
    } else if (job.state === 'succeeded') {
      push(endMs - step, 'info', 'upload',
        `Uploading results.jsonl (${round(4 + rand() * 40, 1)} MB) to staging`);
      push(endMs, 'info', 'result',
        `Attempt succeeded: ${group1000(total)} ${job.kind === 'training' ? 'epochs' : 'frames'}, `
        + `${group1000(job.detections || 0)} detections in ${job.duration_s} s`);
    } else if (job.state === 'cancelling') {
      push(endMs - step, 'warn', 'warn',
        'Cancel requested by itravers. It is delivered on the next heartbeat; the attempt is winding down.');
      push(endMs, 'warn', 'progress',
        'The attempt is still reporting. The job state is cancelled and the attempt is not — that pair is what "cancelling" means.');
    } else {
      push(endMs, 'info', 'progress', 'Attempt live, awaiting the next heartbeat.');
    }
  }

  /* ------------------------------------------------------------------ counts */

  const stateCount = (s) => jobs.filter((j) => j.state === s).length;
  const stateKind = (s, k) => jobs.filter((j) => j.state === s && j.kind === k).length;
  const today = NOW.slice(0, 10);

  const counts = {
    running: stateCount('running'),
    running_inference: stateKind('running', 'inference'),
    running_training: stateKind('running', 'training'),
    queued: stateCount('queued'),
    queued_inference: stateKind('queued', 'inference'),
    queued_training: stateKind('queued', 'training'),
    cancelling: stateCount('cancelling'),
    paused: stateCount('paused'),
    failed: stateCount('failed'),
    issues: stateCount('issues'),
    cancelled: stateCount('cancelled'),
    succeeded: stateCount('succeeded'),
    /* What the "Needs attention" card counts: a failure and a partial success both want a
       human. Cancelled does not — somebody already decided. */
    needs_attention: stateCount('failed') + stateCount('issues'),
    /* Completed with issues is still completed, so it counts here too. A card reading
       "Completed today 18" over a table showing 21 rows finished today is the exact
       disagreement this fixture exists to avoid. */
    completed_today: jobs.filter((j) => j.finished_at
      && j.finished_at.slice(0, 10) === today
      && (j.state === 'succeeded' || j.state === 'issues')).length,
    jobs_total: jobs.length,
    workers_total: workers.length,
    workers_online: workers.filter((w) => w.state !== 'offline').length,
    workers_busy: workers.filter((w) => w.activity === 'busy').length,
    workers_idle: workers.filter((w) => w.activity === 'idle').length,
    workers_paused: workers.filter((w) => w.state === 'paused').length,
    workers_offline: workers.filter((w) => w.state === 'offline').length,
    gpu_slots_total: workers.reduce((n, w) => n + w.slot_count, 0),
    gpu_slots_in_use: workers.reduce((n, w) => n + w.attempts.length, 0)
  };

  /* Scratch, used while building; not part of the fixture's contract. */
  for (const d of datasets) delete d._createdMs;

  return {
    generated: today,
    now: NOW,
    seed: SEED,
    note: 'Fabricated data for the MARP Machine Learning Dashboard mockup. No scientific '
      + 'meaning, and no id here refers to a real MARP row. Regenerate with '
      + '`npm run fixture`; a conflict on this file is a regeneration, not a merge.',
    projects,
    species,
    jobs,
    workers,
    models,
    datasets,
    runs,
    events,
    counts
  };
}

/* Written only when this file is the entry point, so a test can import `build` without
   the import itself rewriting the tracked fixture. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = build();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`);
  const c = data.counts;
  const versions = data.models.reduce((n, m) => n + m.versions.length, 0);
  console.log(
    `wrote ${relative(process.cwd(), OUT)} — ${data.projects.length} projects, ${data.jobs.length} jobs `
    + `(${c.running} running, ${c.queued} queued, ${c.needs_attention} need attention, ${c.completed_today} completed today), `
    + `${data.workers.length} workers (${c.workers_busy} busy, ${c.workers_idle} idle, ${c.workers_paused} paused, `
    + `${c.workers_offline} offline; ${c.gpu_slots_in_use} of ${c.gpu_slots_total} slots), `
    + `${data.models.length} models / ${versions} versions, ${data.datasets.length} datasets, `
    + `${data.runs.length} runs, ${data.events.length} events, ${data.species.length} classes`
  );
}
