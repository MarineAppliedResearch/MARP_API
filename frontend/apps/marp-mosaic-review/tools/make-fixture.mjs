/**
 * Generates the prototype's fake observation set.
 *
 * Columns mirror the real `observations` table and the tables it joins to, so the
 * prototype exercises the shape the API will eventually return. Values are invented
 * and carry no scientific meaning.
 *
 * Deterministic: same seed in, same file out. Run with `node tools/make-fixture.mjs`.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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
 * The imagery, read from `fixtures/thumbs/manifest.json`.
 *
 * **The manifest says which species a picture shows, not the filename.** Deriving it from
 * the name would work right up until a file is renamed, and then the fixture would quietly
 * claim a crab was a sea star — which is the single mistake this whole application exists
 * to catch, so it is a poor one to build in at the source.
 *
 * An observation may only claim a species that has pictures. The point of the mosaic is
 * judging what is *shown* against what is *claimed*, and a tile labelled urchin with no
 * urchin behind it teaches a reviewer nothing.
 *
 * The taxonomy below stays longer than this list on purpose: the correction panel has to
 * offer species that are not on the page, or fixing a mistake is a choice between the five
 * things already in front of you.
 */
const MANIFEST = JSON.parse(readFileSync(join(THUMBS, 'manifest.json'), 'utf8'));

/** Species name -> its pictures, sorted, so the fixture is reproducible. */
const PICTURES = (() => {
  const out = {};
  for (const [file, meta] of Object.entries(MANIFEST)) {
    if (!meta || !meta.species) continue;
    (out[meta.species] = out[meta.species] || []).push(file);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
})();

const IMAGED_SPECIES = Object.keys(PICTURES);
if (!IMAGED_SPECIES.length) {
  throw new Error('fixtures/thumbs/manifest.json lists no species. See that folder README.');
}

/**
 * One of a species' pictures.
 *
 * `n` is the row's own index, so a row always gets the same picture and re-running this
 * changes nothing. A handful of pictures spread over three thousand rows repeat heavily,
 * which is expected and fine — a reviewer is judging the organism against the name, not
 * whether they have seen this exact frame before.
 */
function pictureFor(species, n) {
  const files = PICTURES[species];
  if (!files) throw new Error('No pictures for "' + species + '" in manifest.json');
  return files[n % files.length];
}

/**
 * The taxonomy the correction panel offers.
 *
 * Deliberately longer than the five species that have pictures: correcting a mistake has
 * to be a real choice, not a pick from the same five already on the page.
 */
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

/**
 * How the claimed species are spread.
 *
 * Every species gets enough observations to be worth reviewing, not just the one the
 * default filter opens on. Filtering to Rock Crab has to give pages of crabs with a few
 * wrong ones among them, exactly as filtering to Bat Star does — otherwise four of the
 * five species lead somewhere that cannot be practised on.
 *
 * Bat Star stays the largest because it is what the fixture opens on, and a first page
 * should be full.
 */
const MIX = IMAGED_SPECIES.flatMap((name) =>
  Array(name === 'Bat Star' ? 8 : 3).fill(name));

/**
 * How often the label is wrong. The same rate for every species, so there is something to
 * find whichever one you filter to.
 *
 * Three per cent, which is about two wrong on a page of sixty. Tuned from use rather than
 * chosen: seven per cent was reported as "way way more than that". A page has to read as a
 * page of bat stars with a couple of intruders, because the whole premise is that the
 * wrong one pops out — and it cannot pop out of a crowd of other wrong ones.
 *
 * This is the one number to turn if the practice set feels too easy or too busy.
 */
const WRONG_RATE = 0.03;

for (let i = 0; i < TOTAL; i++) {
  /**
   * What the model said, and what is actually in the picture.
   *
   * These are two different things, and keeping them apart is the entire point of the
   * mosaic. `comname` is the model's claim -- it is what the filter matches and what the
   * caption says. The picture is the truth. A **misclassification** is a row claiming Bat
   * Star with a crab in the frame, and that is what the reviewer is hunting: it survives
   * the species filter precisely because the label is wrong, which is why it is on the
   * page at all.
   *
   * An earlier version gave every outlier a different label *and* a matching picture. That
   * produced correctly-classified other species, which the species filter then removed --
   * so a page of Bat Stars was three hundred correct Bat Stars and there was nothing to
   * find. The tool looked like it worked and demonstrated nothing.
   */
  const claimedName = pick(MIX);
  const isMisclassified = rand() < WRONG_RATE;
  const shownName = isMisclassified
    ? pick(IMAGED_SPECIES.filter((n) => n !== claimedName))
    : claimedName;

  const sp = SPECIES.find((x) => x.comname === claimedName);   // what the model claimed

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
    /**
     * Confidence is independent of whether the label is right.
     *
     * It was not, for a while: a wrong call was given a lower confidence so that sorting
     * by least-certain-first would bring mistakes forward. That is realistic and it ruined
     * the fixture, because the default sort *is* confidence ascending — so page one
     * collected the mistakes and ran at three times the underlying rate. Reported from use
     * as "on a page of 60 bat stars I had to flag 20".
     *
     * Whether low confidence really predicts error is an empirical question about a model,
     * not something to bake into demo data. Uniform here means every page carries roughly
     * the same few wrong ones, wherever you are in the result and however you sort it.
     */
    confidence: Number((0.50 + rand() * 0.49).toFixed(2)),

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
    thumb: pictureFor(shownName, i),

    createdAt: '2026-08-' + String(10 + (i % 20)).padStart(2, '0') + 'T09:00:00Z',
    updatedAt: '2026-09-0' + (1 + (i % 3)) + 'T14:' + String(10 + (i % 50)).padStart(2, '0') + ':00Z',
    version: 1
  });
}

/* a couple of guaranteed cases so the prototype always has them to show */
/* Two guaranteed misclassifications near the top of the first page, so the prototype
   always has something to find without waiting on the dice. Both claim Bat Star, which is
   what keeps them past the species filter; the pictures say otherwise. */
const batStar = SPECIES.find((x) => x.comname === 'Bat Star');
for (const [at, shows] of [[3, 'Rockfish'], [9, 'Rock Crab']]) {
  rows[at] = { ...rows[at], comname: batStar.comname, scientific_name: batStar.species,
               species_id: batStar.species_id, taxserial: batStar.taxserial,
               thumb: pictureFor(shows, at), thumbnail_status: 'ready',
               confidence: at === 3 ? 0.54 : 0.57 };
}
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
