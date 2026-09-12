/**
 * The fixture and the endpoint must agree about the row.
 *
 * This is the check the last three defects of one family were waiting for, and it is
 * worth more than any of the three fixes:
 *
 * - **#130** — the endpoint never sent `species_id`, so `speciesListFor` was permanently
 *   null, so the correction search was refused before a request was made. Every browser
 *   test passed, because the render tier runs on the fixture and the fixture's row *does*
 *   carry `species_id`.
 * - **#124 F6** — the tile drew `comname` where the endpoint sends `species_comname`, so
 *   a corrected tile showed the old animal for ever.
 * - **#124 F8** — the tile read `reviewed_by`, `flagged_by`, `training_approved_by` and
 *   `excluded_by`. The row has never carried any of the four, so "REVIEWED by you", the
 *   borrowed tag's attribution and `byMe` all silently became nothing.
 *
 * None of them failed anything. A field the client reads that only one backing has is
 * invisible to every tier: the fixture-backed tiers see a value, and the API-backed
 * application is the only thing that meets `undefined` — in front of a reviewer.
 *
 * **Two sources, neither of them this file's own opinion.** The endpoint's row is
 * `MosaicRow` in `docs/openapi.generated.json`, which is generated from
 * `docs/openapi.js` and which CI already fails on when it is stale; the fixture's row is
 * `fixtures/observations.json`, which `tools/make-fixture.mjs` generates. So this check
 * cannot drift from either — it can only report that they have drifted from each other.
 *
 * Milliseconds, no database, no browser, and it reads the generated contract as text.
 * **It reaches out of the app** for that one file, which is the only thing here that
 * does; when this app is extracted it will fail loudly at the read rather than quietly
 * stop checking, which is the right way round.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACT = join(APP, '..', '..', '..', 'docs', 'openapi.generated.json');

/* A missing prerequisite fails. A skipped suite looks green, and this one is meant to be
   the thing that notices. */
if (!existsSync(CONTRACT)) {
  throw new Error(
    `docs/openapi.generated.json is not at ${CONTRACT}. `
    + 'Run `npm run docs:api:build` in MARP_API, or this check proves nothing.');
}

/** What the endpoint sends, from the published contract. */
const endpointKeys = (() => {
  const spec = JSON.parse(readFileSync(CONTRACT, 'utf8'));
  const row = spec.components && spec.components.schemas && spec.components.schemas.MosaicRow;
  assert.ok(row && row.properties, 'MosaicRow is not in the generated contract');
  return new Set(Object.keys(row.properties));
})();

/** What the fixture serves. */
const fixtureRows = JSON.parse(
  readFileSync(join(APP, 'fixtures', 'observations.json'), 'utf8')).observations;

const fixtureKeys = new Set(fixtureRows.flatMap((row) => Object.keys(row)));

/**
 * Fields the fixture carries that the endpoint does not, each one deliberate.
 *
 * A fixture field is not automatically wrong — the fixture simulates a whole little
 * database, and some of these are its own bookkeeping (`thumb` is where its picture file
 * is; `session_id` and `project_id` are how it resolves a facet). What is wrong is the
 * **client** reading one, and that is what the next test asserts.
 *
 * Listing them rather than tolerating "anything extra" is the point: a new fixture-only
 * field has to be added here on purpose, by somebody who has just been asked whether the
 * endpoint ought to be sending it instead.
 */
const FIXTURE_ONLY = new Set([
  // Columns on `observations` the endpoint deliberately withholds. `processor_name` and
  // `lineId` are A7 — with them the mosaic route stops being `observations:read`.
  'PobsID', 'coarsesize', 'count', 'etc', 'frame', 'lineId', 'mediaPosition', 'note',
  'processor_name', 'quadrant', 'scientific_name', 'sex', 'taxReview', 'taxserial',
  'user_id', 'video_source', 'createdAt', 'updatedAt',
  // Keys the fixture needs to resolve its own joins, which the endpoint has already
  // resolved into `project_name`, `dive`, `line` and `species_comname`.
  'project_id', 'session_id', 'ml_model_id', 'species_id',
  // Where the fixture's picture file is. The endpoint's tile addresses a route derivable
  // from `observation_id`, so no URL is repeated 45 times a page.
  'thumb',
]);

/**
 * Fields the client attaches to a row itself, so they are on neither backing's row.
 *
 * `store.js` writes the retry answer onto the row it was asked about. Kept short and
 * declared, because "the client put it there" is the one honest reason to read a field
 * the endpoint does not send.
 */
const CLIENT_ATTACHED = new Set(['thumbnail_permanent', 'thumbnail_reason']);

/**
 * Names that are read off a variable called `row` or `r` and are not a row field.
 *
 * `page.js` calls a commit-*result* entry `r` as well, and its `outcome` is a decision
 * the endpoint answered with rather than a column. One entry, named rather than
 * pattern-matched, so adding to it is visible in a diff.
 */
const NOT_A_ROW = new Set(['outcome']);

/** Source with comments and single-line string literals removed. Template bodies stay. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

/**
 * Every `row.x` and `r.x` the client above the seam reads, and which file read it.
 *
 * **`src/data.js` and `src/api/` are excluded on purpose**: those two *are* the backings,
 * and each is entitled to know its own shape. Everything else is the client, and the
 * client must only know the shape both of them present.
 *
 * `row` and `r` is a convention rather than a guarantee, and this check is part of why
 * the convention is worth keeping: a row bound to some other name escapes it.
 */
const rowReads = (() => {
  const dirs = [['src', 'ui'], ['src', 'model']];
  const files = [join(APP, 'src', 'store.js')];

  for (const dir of dirs) {
    const here = join(APP, ...dir);
    for (const name of readdirSync(here)) {
      if (name.endsWith('.js')) files.push(join(here, name));
    }
  }

  const out = new Map();

  for (const file of files) {
    const src = code(readFileSync(file, 'utf8'));
    for (const match of src.matchAll(/\b(?:row|r)\.([A-Za-z_$][\w$]*)/g)) {
      const key = match[1];
      if (!out.has(key)) out.set(key, new Set());
      out.get(key).add(file.slice(APP.length + 1).replace(/\\/g, '/'));
    }
  }

  return out;
})();

test('R10: the fixture carries every field the endpoint sends', () => {
  /* The direction #130 actually broke in, one step earlier. The endpoint gained
     `species_list` and the fixture had to gain it too, or every fixture-backed tier would
     go on exercising a row the application never meets. Asserted over *every* row rather
     than over the first: a field present on some rows is worse than one present on none,
     because the tier passes until the unlucky row is the one the test picks. */
  const missing = [...endpointKeys].filter((key) => !fixtureRows.every((row) => key in row));

  assert.deepEqual(missing, [],
    'the endpoint sends these and the fixture does not, so no fixture-backed tier can '
    + 'see what the application reads. Add them in tools/make-fixture.mjs and re-run '
    + '`npm run fixture`');
});

test('R10: the client reads no row field the endpoint does not send', () => {
  const wrong = [];

  for (const [key, files] of rowReads) {
    if (endpointKeys.has(key)) continue;
    if (CLIENT_ATTACHED.has(key) || NOT_A_ROW.has(key)) continue;
    wrong.push(`${key} — read in ${[...files].sort().join(', ')}`
      + (fixtureKeys.has(key) ? ' — the fixture has it and the endpoint does not' : ''));
  }

  assert.deepEqual(wrong.sort(), [],
    'a field only one backing carries is undefined in the application and a value in '
    + 'every test. That is #124 F6 and F8, and #130');
});

test('R10: every fixture-only field is a declared one', () => {
  const undeclared = [...fixtureKeys]
    .filter((key) => !endpointKeys.has(key) && !FIXTURE_ONLY.has(key))
    .sort();

  assert.deepEqual(undeclared, [],
    'the fixture grew a field the endpoint does not send. Either the endpoint should be '
    + 'sending it, or it belongs in FIXTURE_ONLY here with a line saying why');
});

test('R10: nothing is declared fixture-only that the endpoint actually sends', () => {
  /* The list above going stale in the other direction. Without this, a field promoted
     into the contract would stay on a list that says the endpoint does not send it, and
     the check above would stop noticing it was read. */
  const stale = [...FIXTURE_ONLY].filter((key) => endpointKeys.has(key)).sort();

  assert.deepEqual(stale, [],
    'the endpoint sends these now, so they are not fixture-only any more');
});

test('R10: species_list is on both, because #130 turns on it', () => {
  /* Named rather than left to the sweep above. The generic checks would pass if
     `species_list` were dropped from both at once, and the picker would go back to being
     unable to search -- which is the defect, not a tidy-up. */
  assert.ok(endpointKeys.has('species_list'), 'the endpoint has to resolve the list');
  assert.ok(fixtureRows.every((row) => 'species_list' in row),
    'and the fixture has to carry it, or no fixture-backed tier sees the picker work');
  assert.ok(fixtureRows.some((row) => row.species_list === null),
    'including at least one row whose session type names no list, which is the only case '
    + 'the "search all lists" action exists for');
});
