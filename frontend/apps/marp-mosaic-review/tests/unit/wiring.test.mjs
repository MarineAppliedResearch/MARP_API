/**
 * Every element the interface reaches for must be one that something draws.
 *
 * This exists because of a specific hour. The filter rail's markup was replaced with a
 * generated one, which removed `#selModelBtn` from `index.html` — but `mount.js` still
 * wired a click handler to it. `$('#selModelBtn')` returned null, `addEventListener`
 * threw during wiring, `mount()` aborted, and **the entire application rendered blank**.
 * Every browser test then failed looking for tiles that were never drawn, which reads as
 * "everything is broken" rather than "one id is missing".
 *
 * The browser tier did catch it. It caught it two minutes into a run, with forty failures
 * pointing at symptoms. This tier catches the same thing in under a second and names the
 * id — which is the difference between a diagnosis and a hunt.
 *
 * No DOM: this reads the source and the markup as text, which is why it belongs here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const html = readFileSync(join(APP, 'index.html'), 'utf8');
const uiDir = join(APP, 'src', 'ui');
const uiFiles = readdirSync(uiDir).filter((f) => f.endsWith('.js'));
const uiSource = Object.fromEntries(
  uiFiles.map((f) => [f, readFileSync(join(uiDir, f), 'utf8')]));
const allUi = Object.values(uiSource).join('\n');

/** Ids `index.html` actually contains. */
const inMarkup = new Set([...html.matchAll(/id="([A-Za-z][\w-]*)"/g)].map((m) => m[1]));

/** Ids some renderer writes into the page, so they exist by the time they are used. */
const generated = new Set([...allUi.matchAll(/id="([A-Za-z][\w-]*)"/g)].map((m) => m[1]));

test('every id the interface looks up is drawn by something', () => {
  const missing = [];

  for (const [file, source] of Object.entries(uiSource)) {
    for (const m of source.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)) {
      const id = m[1];
      if (inMarkup.has(id) || generated.has(id)) continue;
      missing.push(`${file} looks up #${id}, and nothing draws it`);
    }
  }

  assert.deepEqual(missing, [],
    'a lookup with nothing behind it returns null, and the first method call on it '
    + 'throws during wiring — which aborts mount() and blanks the whole application');
});

test('mount wires only controls that exist', () => {
  /* `anchor()` is the specific call that threw. It is null-safe now, but a handler bound
     to nothing is still a control that silently does not work. */
  const mount = uiSource['mount.js'];
  const missing = [];

  for (const m of mount.matchAll(/anchor\('#([A-Za-z][\w-]*)'/g)) {
    const id = m[1];
    if (inMarkup.has(id) || generated.has(id)) continue;
    missing.push(`mount.js anchors #${id}, and nothing draws it`);
  }

  assert.deepEqual(missing, []);
});

test('the rail mount point exists, since everything else hangs off it', () => {
  assert.ok(inMarkup.has('railDimensions'),
    'ui/rail.js draws every filter into #railDimensions; without it the rail is silently empty');
});

/**
 * P1: a dimension is one entry in the declaration and nothing else.
 *
 * #77 built that property and #81 is the first change to lean on it — removing the
 * Processor filter, reordering two, and nesting a third were all one edit each. The way
 * it decays is a `if (key === 'date')` appearing in a renderer, so this looks for exactly
 * that: any dimension key written as a string literal in the layer that draws them.
 *
 * The check is on `ui/` alone. `model/match.js` and `model/query-url.js` do still name
 * the date dimension, because a date range compares differently from a number range, and
 * that predates this. Widening the check is worth doing when that is fixed, not before —
 * a test that has to be argued with is a test people learn to ignore.
 */
test('no file that draws the rail knows a dimension by name', async () => {
  const { DIMENSIONS } = await import('../../src/model/dimensions.js');
  const offences = [];

  for (const [file, source] of Object.entries(uiSource)) {
    for (const d of DIMENSIONS) {
      /* Single quotes only: JavaScript string literals here are single-quoted, while the
         markup inside a template literal uses double quotes -- so `type="date"`, which is
         an input type and not this dimension, is correctly left alone. */
      if (source.includes(`'${d.key}'`)) {
        offences.push(`${file} names the ${d.key} dimension; the declaration should decide`);
      }
    }
  }

  assert.deepEqual(offences, []);
});
