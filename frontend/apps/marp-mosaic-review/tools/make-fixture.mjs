/**
 * Generates the prototype's fake observation set.
 *
 * Columns mirror the real `observations` table and the tables it joins to, so the
 * prototype exercises the shape the API will eventually return. Values are invented
 * and carry no scientific meaning.
 *
 * Deterministic: same seed in, same file out. Run with `node tools/make-fixture.mjs`.
 */
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'fixtures', 'observations.json');
const THUMBS = join(HERE, '..', 'fixtures', 'thumbs');

/* mulberry32 — small deterministic PRNG so the fixture never shifts under us */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260903);
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/**
 * The five species with imagery, and the ten drawings each.
 *
 * `tools/make-thumbs.mjs` draws them. An observation may only be given a species that has
 * pictures, because the whole point of the mosaic is judging what is *shown* against what
 * is *claimed* — a tile whose label says urchin and whose picture is a generic blob teaches
 * a reviewer nothing, and teaches us nothing about whether the interface works.
 *
 * The taxonomy below stays longer than this list on purpose: the correction panel has to
 * offer species that are not on the page, or correcting a mistake is a choice between the
 * five things already in front of you.
 */
const IMAGED = {
  'Bat Star': 'bat-star',
  'Red Urchin': 'red-urchin',
  'Rockfish': 'rockfish',
  'Rock Crab': 'rock-crab',
  'Sea Cucumber': 'sea-cucumber'
};
const VARIANTS = 10;

/**
 * The files that actually exist, per species, whatever they happen to be.
 *
 * Read from the folder rather than assembled from a naming rule, so **swapping the
 * imagery is a matter of dropping files in and re-running this** -- no code change, no
 * extension baked into a template. That matters because the drawings currently in there
 * are a stand-in: they are procedural SVGs, and the intention is real model-generated
 * photographs. When those arrive as `bat-star-01.jpg` and friends they are simply picked
 * up, and a raster file wins over an SVG of the same name so the changeover can be partial.
 *
 * `fixtures/thumbs/README.md` is the contract: what to name them and what they should show.
 */
const RASTER = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

function variantsOf(slug) {
  const all = readdirSync(THUMBS).filter((f) => f.startsWith(`${slug}-`));
  const byIndex = new Map();
  for (const f of all.sort()) {
    const m = /-(\d{2})\.([a-z0-9]+)$/i.exec(f);
    if (!m) continue;
    const raster = RASTER.includes(`.${m[2].toLowerCase()}`);
    const held = byIndex.get(m[1]);
    /* A photograph beats a drawing of the same number, so the two can coexist while the
       real imagery is being filled in one species at a time. */
    if (!held || (raster && !held.raster)) byIndex.set(m[1], { file: f, raster });
  }
  const files = [...byIndex.keys()].sort().map((k) => byIndex.get(k).file);
  if (!files.length) {
    throw new Error(`No thumbnails for "${slug}" in fixtures/thumbs. `
      + 'Run `node tools/make-thumbs.mjs`, or add the images. See fixtures/thumbs/README.md.');
  }
  return files;
}

const VARIANT_FILES = Object.fromEntries(
  Object.values(IMAGED).map((slug) => [slug, variantsOf(slug)]));

/** One of a species' pictures, chosen so the same row always gets the same one. */
function thumbFor(comname, n) {
  const files = VARIANT_FILES[IMAGED[comname]];
  return files[n % files.length];
}

const SPECIES = [
  { species_id: 41, taxserial: 157213, comname: 'Bat Star',          species: 'Patiria miniata' },
  { species_id: 42, taxserial: 157220, comname: 'Leather Star',      species: 'Dermasterias imbricata' },
  { species_id: 43, taxserial: 157229, comname: 'Ochre Star',        species: 'Pisaster ochraceus' },
  { species_id: 44, taxserial: 157234, comname: 'Blood Star',        species: 'Henricia leviuscula' },
  { species_id: 45, taxserial: 157241, comname: 'Sunflower Star',    species: 'Pycnopodia helianthoides' },
  { species_id: 61, taxserial: 166705, comname: 'Rockfish',          species: 'Sebastes sp.' },
  { species_id: 62, taxserial: 167640, comname: 'Painted Greenling', species: 'Oxylebius pictus' },
  { species_id: 71, taxserial: 157905, comname: 'Red Urchin',        species: 'Mesocentrotus franciscanus' },
  { species_id: 72, taxserial: 158140, comname: 'Sea Cucumber',      species: 'Parastichopus sp.' },
  { species_id: 81, taxserial: 98678,  comname: 'Rock Crab',         species: 'Cancer productus' },
  { species_id: 91, taxserial: 11021,  comname: 'Giant Kelp',        species: 'Macrocystis pyrifera' },
  { species_id: 92, taxserial: 78998,  comname: 'Leather Chiton',    species: 'Katharina tunicata' }
];

const PROJECTS  = [{ project_id: 7, name: 'Deep Reef Survey 2025' },
                   { project_id: 8, name: 'Nearshore Kelp 2025' },
                   { project_id: 9, name: 'Outer Bank Transects' }];
const USERS     = [{ user_id: 3, name: 'J. Marsh' }, { user_id: 5, name: 'I. Travers' },
                   { user_id: 8, name: 'R. Okafor' }];
const SEXES     = [null, 'U', 'U', 'U', 'M', 'F'];
const NOTES     = [null, null, null, null, null, null,
                   'partially occluded by kelp', 'on vertical rock face',
                   'juvenile, size estimated', 'low visibility — sediment plume',
                   'two individuals overlapping', 'arms regenerating',
                   'buried, only oral disc visible'];

function timecode(totalSeconds, frac) {
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}.${String(frac).padStart(2, '0')}`;
}

/**
 * Enough rows to page through properly.
 *
 * 540 fitted on a handful of pages, so paging, the pager's window, the committed-page
 * count and anything that only goes wrong deep into a result set were all being judged on
 * a set small enough to hide the problem.
 */
const TOTAL = 3000;
const rows = [];

/* The species a page is predicted to be, and the ones a mistake looks like. */
const PRIMARY = SPECIES.find((x) => x.comname === 'Bat Star');
const CONFUSABLE = SPECIES.filter((x) => IMAGED[x.comname] && x !== PRIMARY);

for (let i = 0; i < TOTAL; i++) {
  /**
   * What the model said, and what is actually in the picture.
   *
   * These are two different things, and keeping them apart is the entire point of the
   * mosaic. `comname` is the model's claim -- it is what the filter matches and what the
   * caption says. The drawing is the truth. A **misclassification** is a row claiming Bat
   * Star with a crab in the frame, and that is what the reviewer is hunting: it survives
   * the species filter precisely because the label is wrong, which is why it is on the
   * page at all.
   *
   * An earlier version gave every outlier a different label *and* a matching picture. That
   * produced correctly-classified other species, which the species filter then removed --
   * so a page of Bat Stars was three hundred correct Bat Stars and there was nothing to
   * find. The tool looked like it worked and demonstrated nothing.
   */
  const isMisclassified = rand() < 0.07;
  const isOtherSpecies = !isMisclassified && rand() < 0.04;

  const sp = isOtherSpecies ? pick(CONFUSABLE) : PRIMARY;   // what the model claimed
  const shown = isMisclassified ? pick(CONFUSABLE) : sp;    // what is really in the frame

  const project = PROJECTS[i % 3 === 0 ? 0 : (i % 5 === 0 ? 1 : 0)];
  const user = pick(USERS);
  const start = 1800 + i * 37 + between(0, 20);

  /* Exceptional thumbnail states stay rare: the normal path is a ready image. */
  const roll = rand();
  const thumbnail_status = roll < 0.012 ? 'failed' : roll < 0.04 ? 'queued' : 'ready';

  rows.push({
    observation_id: 100000 + i,
    obsID: 1000 + i * 3,
    PobsID: null,

    project_id: project.project_id,
    project_name: project.name,

    session_id: 400 + (i % 12),
    dive: 'D0' + (4 + (i % 3)),
    line: String(1 + (i % 6)),
    lineId: `L${1 + (i % 6)}-${400 + (i % 12)}`,
    session_type: pick(['ROV', 'ROV', 'Drop Cam']),      // sessions.type
    user_id: user.user_id,
    processor_name: user.name,

    /* No column links an observation to the model that produced it yet -- that is Phase 3
       of #68. Simulated here anyway, because simulating the schema the client is being
       designed against is exactly what this fixture is for: a control that cannot be
       exercised cannot be judged, and the point of the prototype is to judge it.
       Weighted so most observations came from the current model and a tail from the
       previous one, which is what a real deployment looks like mid-upgrade. */
    model_name: pick(['BatStarNet v3.2', 'BatStarNet v3.2', 'BatStarNet v3.2',
                      'BatStarNet v3.1', 'KelpNet v1.4']),

    species_id: sp.species_id,
    taxserial: sp.taxserial,
    comname: sp.comname,
    scientific_name: sp.species,
    taxReview: null,

    /* A wrong call tends to be a less certain one. Weighting it that way is what makes the
       confidence filter worth having -- sorting by least-certain-first should genuinely
       bring the mistakes forward, and it should be possible to see that it does. */
    /* A wrong call tends to be a less certain one, so sorting by least-certain-first
       genuinely brings mistakes forward. The bands overlap heavily on purpose: a first
       attempt gave errors 0.50-0.78 against correct 0.62-0.99, and since the default sort
       is confidence ascending, page one came back with no correct observations on it at
       all. A page has to read as mostly right for the wrong one to pop out -- that is the
       premise the whole tool rests on, and separating the bands cleanly destroyed it. */
    /* Both draw from the same 0.50-0.99 range; the exponents only lean them apart. The
       lean is small on purpose, and the numbers were measured rather than guessed.

       A wrong call should tend to be a less certain one, so sorting by least-certain-first
       genuinely brings mistakes forward. But the default sort *is* confidence ascending,
       so any real separation lands every mistake on page one: a first attempt used
       0.50-0.78 against 0.62-0.99 and page one came back with no correct observations on
       it at all. A page has to read as mostly right for the wrong one to pop out -- that
       is the premise the tool rests on. At these exponents page one holds seven or eight
       misclassifications out of fifty, against about seven in a hundred overall: enough
       that sorting by confidence is visibly worth doing, few enough that the page still
       looks like a page of bat stars. */
    confidence: Number((0.50 + 0.49
      * Math.pow(rand(), isMisclassified ? 1.25 : 0.85)).toFixed(2)),

    tc: timecode(start, between(0, 24)),
    etc: timecode(start + between(2, 40), between(0, 24)),
    frame: String(between(0, 24)),
    mediaPosition: timecode(start, 0),
    video_source: `dive${4 + (i % 3)}_line${1 + (i % 6)}.mp4`,

    count: rand() < 0.9 ? 1 : between(2, 14),
    coarsesize: rand() < 0.08 ? null : between(4, 42),
    sex: pick(SEXES),
    quadrant: between(1, 4),
    note: pick(NOTES),

    keyframe_count: between(8, 54),
    first_framenum: between(100, 40000),

    /* Server-side state the prototype starts from. Local decisions live in the store. */
    review_status: rand() < 0.08 ? 'reviewed' : 'unreviewed',
    reviewed_by: null,
    training_disposition: rand() < 0.06 ? 'promoted' : rand() < 0.09 ? 'excluded' : 'undecided',
    training_approved_by: null,

    thumbnail_status,
    /* The picture is what is really there, which is not always what the label says. Fifty
       drawings are reused across three thousand rows, and that is the point -- a reviewer
       is judging the organism against the name, not whether they have seen this exact
       picture before. */
    thumb: thumbFor(shown.comname, i + (shown.species_id % VARIANTS)),

    createdAt: '2026-08-' + String(10 + (i % 20)).padStart(2, '0') + 'T09:00:00Z',
    updatedAt: '2026-09-0' + (1 + (i % 3)) + 'T14:' + String(10 + (i % 50)).padStart(2, '0') + ':00Z',
    version: 1
  });
}

/* a couple of guaranteed cases so the prototype always has them to show */
/* Two guaranteed misclassifications near the top of the first page, so the prototype
   always has something to find without waiting on the dice. Both claim Bat Star, which is
   what keeps them past the species filter; the pictures say otherwise. */
rows[3]  = { ...rows[3],  thumb: thumbFor('Rockfish', 2), confidence: 0.54 };
rows[9]  = { ...rows[9],  thumb: thumbFor('Rock Crab', 5), confidence: 0.57 };
rows[20] = { ...rows[20], review_status: 'reviewed', reviewed_by: 'J. Marsh' };
rows[28] = { ...rows[28], thumbnail_status: 'queued' };
rows[38] = { ...rows[38], thumbnail_status: 'failed' };

const payload = {
  generated: '2026-09-03',
  note: 'Fabricated data for the Mosaic Reviewer prototype. No scientific meaning.',
  species: SPECIES,
  projects: PROJECTS,
  users: USERS,
  observations: rows
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 1));
console.log(`wrote ${OUT}`);
console.log(`${rows.length} observations, ${new Set(rows.map(r => r.comname)).size} species`);
console.log('thumbnail states:', ['ready', 'queued', 'failed']
  .map(s => `${s}=${rows.filter(r => r.thumbnail_status === s).length}`).join(' '));
