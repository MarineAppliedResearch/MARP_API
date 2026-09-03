/**
 * Generates the prototype's fake observation set.
 *
 * Columns mirror the real `observations` table and the tables it joins to, so the
 * prototype exercises the shape the API will eventually return. Values are invented
 * and carry no scientific meaning.
 *
 * Deterministic: same seed in, same file out. Run with `node tools/make-fixture.mjs`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'fixtures', 'observations.json');

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

const TOTAL = 540;
const rows = [];

for (let i = 0; i < TOTAL; i++) {
  /* Weighted so most of a page is the queried species and outliers are genuinely rare,
     which is what makes the mosaic's pop-out premise testable. */
  const isOutlier = rand() < 0.06;
  const sp = isOutlier ? pick(SPECIES.slice(5)) : SPECIES[0];

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
    session_type: pick(['ROV', 'ROV', 'Drop Cam']),
    user_id: user.user_id,
    processor_name: user.name,

    species_id: sp.species_id,
    taxserial: sp.taxserial,
    comname: sp.comname,
    scientific_name: sp.species,
    taxReview: null,

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
    /* Thumb must agree with the label. t08 is the rockfish crop and t17 the purple
       leather star; everything else reads as a bat star, so those two are reserved. */
    thumb: sp.comname === 'Rockfish' ? 8
         : sp.comname === 'Leather Star' ? 17
         : (() => { let t = i % 28; while (t === 8 || t === 17) t = (t + 5) % 28; return t; })(),

    createdAt: '2026-08-' + String(10 + (i % 20)).padStart(2, '0') + 'T09:00:00Z',
    updatedAt: '2026-09-0' + (1 + (i % 3)) + 'T14:' + String(10 + (i % 50)).padStart(2, '0') + ':00Z',
    version: 1
  });
}

/* a couple of guaranteed cases so the prototype always has them to show */
rows[3]  = { ...rows[3],  comname: 'Rockfish', scientific_name: 'Sebastes sp.', species_id: 61, thumb: 8, confidence: 0.61 };
rows[9]  = { ...rows[9],  comname: 'Leather Star', scientific_name: 'Dermasterias imbricata', species_id: 42, thumb: 17 };
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
