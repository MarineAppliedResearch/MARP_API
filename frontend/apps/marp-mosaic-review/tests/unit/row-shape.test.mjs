/**
 * The client must read no row field the endpoint does not send.
 *
 * This is the check the last three defects of one family were waiting for, and it is
 * worth more than any of the three fixes:
 *
 * - **#130** — the endpoint never sent `species_id`, so `speciesListFor` was permanently
 *   null, so the correction search was refused before a request was made. Every browser
 *   test passed, because the render tier ran on the fixture and the fixture's row *did*
 *   carry `species_id`.
 * - **#124 F6** — the tile drew `comname` where the endpoint sends `species_comname`, so
 *   a corrected tile showed the old animal for ever.
 * - **#124 F8** — the tile read `reviewed_by`, `flagged_by`, `training_approved_by` and
 *   `excluded_by`. The row has never carried any of the four, so "REVIEWED by you", the
 *   borrowed tag's attribution and `byMe` all silently became nothing.
 *
 * None of them failed anything. Each was a field the client read and only the fixture
 * had: the fixture-backed tiers saw a value, and the application was the only thing that
 * ever met `undefined` — in front of a reviewer.
 *
 * **#157 deleted the fixture, and that removes the mismatch rather than the check.** The
 * three checks here whose subject was `fixtures/observations.json` — that it carried
 * every field the endpoint sends, that its extra fields were declared, that the
 * declaration had not gone stale — went with it. What is left is the half that was always
 * about the application: the client against the published contract.
 *
 * **One source, and it is not this file's own opinion.** The endpoint's row is
 * `MosaicRow` in `docs/openapi.generated.json`, generated from `docs/openapi.js` and which
 * CI already fails on when it is stale. So this check cannot drift from the contract — it
 * can only report that the client has drifted from it.
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

/**
 * Fields the client attaches to a row itself, so they are on no row the endpoint sends.
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
 * **`src/api/` is excluded on purpose**: it *is* the backing, and it is entitled to know
 * its own shape. Everything else is the client, and the client must only know the shape
 * the backing presents. (`src/data.js` was excluded here for the same reason, until #157
 * deleted it.)
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

test('R10: the client reads no row field the endpoint does not send', () => {
  const wrong = [];

  for (const [key, files] of rowReads) {
    if (endpointKeys.has(key)) continue;
    if (CLIENT_ATTACHED.has(key) || NOT_A_ROW.has(key)) continue;
    wrong.push(`${key} — read in ${[...files].sort().join(', ')}`);
  }

  assert.deepEqual(wrong.sort(), [],
    'a field the endpoint does not send is undefined in front of a reviewer. That is '
    + '#124 F6 and F8, and #130');
});

test('R10: species_list is on the endpoint row, because #130 turns on it', () => {
  /* Named rather than left to the sweep above, which only sees what the client *reads*:
     `store.js` reaches `species_list` through `speciesListFor`, so dropping it from the
     contract would take the picker's ability to search with it and nothing generic would
     notice. */
  assert.ok(endpointKeys.has('species_list'),
    'the endpoint has to resolve the list, or the correction search has nothing to scope to');
});
