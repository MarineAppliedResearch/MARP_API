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
import { createRequire } from 'node:module';

/* The session-type to species-list map, from the API rather than copied.
   `species_list` on a row is whatever the endpoint would have resolved, and the endpoint
   resolves it from this file (#130 A1) -- so a second copy here would make the fixture and
   the endpoint disagree the first time a session type is added, which is the exact family
   of defect #130 was. This is the one thing the generator reaches out of the app for; when
   the app is extracted it will fail loudly here, which is the right way for it to fail. */
const { speciesListForSessionType } =
  createRequire(import.meta.url)('../../../../db/species-lists.js');

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
/* `species_list` is here because a common name identifies a species only *within* a list
   -- taxserials below 10000 are local codes invented per list and reused (F15, and
   `db/species-lists.js` in the API). A10(c) qualifies a label with its list only when the
   current question spans more than one, so the fixture has to be able to span two. */
const SPECIES = [
  { species_id: 41, taxserial: 157213, comname: 'Bat Star',          species: 'Patiria miniata',           species_list: 'Inverts' },
  { species_id: 42, taxserial: 157220, comname: 'Leather Star',      species: 'Dermasterias imbricata',     species_list: 'Inverts' },
  { species_id: 43, taxserial: 157229, comname: 'Ochre Star',        species: 'Pisaster ochraceus',         species_list: 'Inverts' },
  { species_id: 44, taxserial: 157234, comname: 'Blood Star',        species: 'Henricia leviuscula',        species_list: 'Inverts' },
  { species_id: 45, taxserial: 157241, comname: 'Sunflower Star',    species: 'Pycnopodia helianthoides',   species_list: 'Inverts' },
  { species_id: 61, taxserial: 166705, comname: 'Rockfish',          species: 'Sebastes sp.',               species_list: 'Fish' },
  { species_id: 62, taxserial: 167640, comname: 'Painted Greenling', species: 'Oxylebius pictus',           species_list: 'Fish' },
  { species_id: 71, taxserial: 157905, comname: 'Red Urchin',        species: 'Mesocentrotus franciscanus', species_list: 'Inverts' },
  { species_id: 72, taxserial: 158140, comname: 'Sea Cucumber',      species: 'Parastichopus sp.',          species_list: 'Inverts' },
  { species_id: 81, taxserial: 98678,  comname: 'Rock Crab',         species: 'Cancer productus',           species_list: 'Inverts' },
  { species_id: 91, taxserial: 11021,  comname: 'Giant Kelp',        species: 'Macrocystis pyrifera',       species_list: 'Habitat' },
  { species_id: 92, taxserial: 78998,  comname: 'Leather Chiton',    species: 'Katharina tunicata',         species_list: 'Inverts' }
];

/**
 * The models the rail's Model dimension filters on.
 *
 * `observations.ml_model_id` is a real column with a real foreign key, and the endpoint's
 * filter is `int[]` -- so the fixture carries a catalogue with ids rather than the
 * free-text `model_name` it invented before. The name is a column on `ml_models`, which is
 * why the label cannot come off an observation row and comes from here instead.
 */
const MODELS = [
  { id: 91, name: 'BatStarNet v3.2' },
  { id: 90, name: 'BatStarNet v3.1' },
  { id: 74, name: 'KelpNet v1.4' }
];

const PROJECTS  = [{ project_id: 7, name: 'Deep Reef Survey 2025' },
                   { project_id: 8, name: 'Nearshore Kelp 2025' },
                   { project_id: 9, name: 'Outer Bank Transects' }];
const USERS     = [{ user_id: 3, name: 'J. Marsh' }, { user_id: 5, name: 'I. Travers' },
                   { user_id: 8, name: 'R. Okafor' }];
/* The five values the database actually holds. The casing really is inconsistent --
   `Fish_GULF` beside `INVERTS_GULF` -- and it is not tidied here, because a fixture that
   spells things more neatly than production tests a filter nobody will ever run. The
   fixture used to invent `ROV` and `Drop Cam`, which are platforms rather than session
   types and do not appear in the column at all. See #81 D1. */
const SESSION_TYPES = ['Fish', 'Fish_GULF', 'Inverts', 'INVERTS_GULF', 'Habitat'];
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
    /* A property of the session, not of the observation: `sessions.type` is one column on
       one row, so every observation of a session carries the same value. Rolling it per
       observation made "the type narrows which sessions are available" untrue, and the
       rail says it narrows them. */
    session_type: SESSION_TYPES[(i % 12) % SESSION_TYPES.length],
    /* Which annotation list a correction may be offered from, resolved from the session
       type exactly as the endpoint resolves it (#130 A1). **Null for `Fish_GULF` and
       `INVERTS_GULF`**, which the map does not name -- that is not tidied here for the
       same reason #81 D1 kept the inconsistent casing, and it earns its keep: a row whose
       list is null is the case the picker's "search all lists" action exists for, and
       without one in the fixture no browser test can reach it. */
    species_list: speciesListForSessionType(
      SESSION_TYPES[(i % 12) % SESSION_TYPES.length]),
    user_id: user.user_id,
    processor_name: user.name,

    /* Which model produced the detection, as `observations.ml_model_id` -- an integer key,
       because the endpoint's filter is `int[]` and rejects a name outright. Weighted so
       most observations came from the current model and a tail from the previous one,
       which is what a real deployment looks like mid-upgrade. */
    ml_model_id: pick([91, 91, 91, 90, 74]),

    species_id: sp.species_id,
    taxserial: sp.taxserial,
    /* Two names, deliberately different things -- see `src/model/row.js`. `comname` is the
       label the annotator's list entry carried and is **never rewritten**, including by a
       correction; `species_comname` is the current catalogue name of whatever `species_id`
       now points at. They start equal, and a correction moves only the second, which is
       what makes the drift auditable rather than silently tidied away. */
    comname: sp.comname,
    species_comname: sp.comname,
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

    /**
     * Server-side state the prototype starts from. Local decisions live in the store.
     *
     * `review_decision` / `training_decision`, and **null is the neutral state** -- the
     * absence of a row in `observation_review_current`, which is what the endpoint sends.
     * These were `review_status: 'unreviewed'` and `training_disposition: 'undecided'`:
     * a column that has not existed since #103, carrying a value the endpoint never sends.
     */
    review_decision: rand() < 0.08 ? 'reviewed' : null,
    /* Who decided, as a `users.user_id` -- A13. These were `reviewed_by` and
       `training_approved_by`, holding names, and the endpoint's row carries neither: an
       id is what lets a client say "by you" without the row exposing anybody. */
    review_reviewer_id: null,
    /* Present and null, not absent. The endpoint always sends both reason keys and the
       tile reads both; the fixture used to create them only when a commit wrote one, so
       the two row shapes differed by two keys nobody noticed -- the same family of
       divergence #130 came out of, and a unit check now fails on it. */
    flag_reason: null,
    training_decision: rand() < 0.06 ? 'promoted' : rand() < 0.09 ? 'excluded' : null,
    training_reviewer_id: null,
    exclusion_reason: null,

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
  rows[at] = { ...rows[at], comname: batStar.comname, species_comname: batStar.comname,
               scientific_name: batStar.species,
               species_id: batStar.species_id, taxserial: batStar.taxserial,
               thumb: pictureFor(shows, at), thumbnail_status: 'ready',
               confidence: at === 3 ? 0.54 : 0.57 };
}
/* Reviewed by somebody who is not the fixture's signed-in reviewer, so "by you" has a
   negative case as well as a positive one. `users` id 3 is J. Marsh. */
rows[20] = { ...rows[20], review_decision: 'reviewed', review_reviewer_id: 3 };
rows[28] = { ...rows[28], thumbnail_status: 'queued' };
rows[38] = { ...rows[38], thumbnail_status: 'failed' };

/**
 * Two observations whose `tc` says nothing, so #76's reporting has something to report.
 *
 * `observations.tc` is nullable and rows really do carry nothing there. Until A17 the
 * *date* filter could not answer for any row — it compared a date component no `tc`
 * carries — so "the count it had to exclude" was the whole result and the filter had to be
 * refused rather than served. Now that it compares `tc` as a **point in time**, a row can
 * answer whenever its `tc` carries a readable clock, which in this fixture is all of them.
 *
 * That would leave the exclusion note permanently hidden and the rule it protects
 * untested — a filter that silently omits is worse than no filter, and the only way to
 * know the note works is to have something for it to say. So two rows carry no clock.
 * They are on page one deliberately, where the reviewer meets them.
 */
for (const at of [45, 46]) {
  rows[at] = { ...rows[at], tc: null, etc: null };
}

const payload = {
  generated: '2026-09-03',
  note: 'Fabricated data for the Mosaic Reviewer prototype. No scientific meaning.',
  species: SPECIES,
  projects: PROJECTS,
  models: MODELS,
  users: USERS,
  observations: rows
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 1));
console.log(`wrote ${OUT}`);
console.log(`${rows.length} observations, ${new Set(rows.map(r => r.species_id)).size} species`);
console.log('thumbnail states:', ['ready', 'queued', 'failed']
  .map(s => `${s}=${rows.filter(r => r.thumbnail_status === s).length}`).join(' '));
