/**
 * What actually reaches the wire.
 *
 * **Every assertion here goes through `JSON.parse(JSON.stringify(body))`**, and that is not
 * pedantry — it is the whole reason this file exists. `deepEqual` on the request object
 * passes for a `Set`, for a `Map`, for a `Date`, and for anything else that serialises to
 * something other than itself. Three of Phase 8's seventeen findings are exactly that
 * shape, and none of them failed anything:
 *
 * - **F2** — `excludeIds` was a `Set`, and `JSON.stringify(new Set([1,2,3]))` is `{}`. The
 *   endpoint excluded nothing, every committed page came back among the pages still to do,
 *   and the arithmetic on screen stayed plausible throughout. #68 calls this the one that
 *   costs an afternoon.
 * - **F1** — the species filter sent a *name* where the endpoint takes `species_id`.
 * - **F4** — the commit sent ids and a `Map` where the endpoint requires
 *   `[{ observation_id, version }]` with the version mandatory.
 *
 * No DOM and no network, which is why this belongs at the unit tier: `src/api/requests.js`
 * builds bodies and nothing else, so the tier that runs in sixty milliseconds is the one
 * that can see all three.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  idList, filtersBody, pagesBody, countsBody, commitBody, correctionBody, retryBody,
  facetsBody
} from '../../src/api/requests.js';

/** What the body is once it has been serialised, which is the only version that matters. */
const onWire = (body) => JSON.parse(JSON.stringify(body));

/* ------------------------------------------------------------------ F2, R4 */

test('R4: a Set of pinned ids reaches the wire as an array of integers', () => {
  const body = pagesBody({
    filters: {}, sort: null, pageSize: 45, pages: [1], exclude: new Set([3, 1, 2])
  });

  /* The assertion that would have caught F2. On the object, `exclude` is already an
     array here — but a regression that put the Set back would pass a `deepEqual` on the
     argument and fail this. */
  assert.deepEqual(onWire(body).exclude, [1, 2, 3]);
});

test('R4: a Set that somehow reached the request is still not sent as one', () => {
  /* Belt and braces, and R4 asks for exactly this: "a Set must be impossible to send".
     `model/filters.js` converts where the Set gets in; this converts again on the way
     out, because one guard is a guard somebody routes around six months later. */
  const naive = { exclude: new Set([1, 2, 3]) };
  assert.deepEqual(onWire(naive).exclude, {},
    'this is what the defect looked like: an empty object, silently');

  const built = pagesBody({ filters: {}, pageSize: 45, pages: [1], exclude: naive.exclude });
  assert.deepEqual(onWire(built).exclude, [1, 2, 3]);
});

test('R4: an exclusion set nested in the filters is lifted out, not sent twice', () => {
  /* Where `queryFilters` puts it. The endpoint reads either, and a Set nested inside a
     filters object is how the first one travelled unnoticed — so nothing lets one back in
     and no stray `excludeIds` key rides along beside `exclude`. */
  const body = pagesBody({
    filters: { excludeIds: [7, 5] }, pageSize: 45, pages: [1]
  });
  const wire = onWire(body);

  assert.deepEqual(wire.exclude, [5, 7]);
  assert.equal(wire.filters.excludeIds, undefined,
    'one field, in the place the contract names');
});

test('R4: nothing pinned sends no exclusion field at all', () => {
  const wire = onWire(pagesBody({ filters: {}, pageSize: 45, pages: [1] }));
  assert.equal('exclude' in wire, false);
});

test('R4: an id list refuses what it cannot convert, rather than sending nonsense', () => {
  assert.deepEqual(idList(new Set([2, 1]), 'exclude'), [1, 2]);
  assert.deepEqual(idList([2, 1], 'exclude'), [1, 2]);
  assert.deepEqual(idList(null, 'exclude'), []);

  assert.throws(() => idList({ 1: true }, 'exclude'), /must be an array or a Set/);
  assert.throws(() => idList(['Bat Star'], 'exclude'), /integers/);
  /* The message names the trap, because whoever meets it is about to reintroduce it. */
  assert.throws(() => idList(7, 'exclude'), /silently excludes nothing/);
});

/* ------------------------------------------------------------------ F1, R5 */

test('R5: the species filter is sent as the key, never as a name', () => {
  const wire = onWire(filtersBody({ species: [41, 43] }));
  assert.deepEqual(wire.species, [41, 43]);
});

test('R5: a species name is refused rather than quietly matching nothing', () => {
  /* The endpoint answers `filters.species takes integer ids, not "Bat Star"`. Throwing
     here is better than discovering it as a failed page: a name in this field is a defect
     in the client, and the fixture would have matched nothing while the endpoint 400s. */
  assert.throws(() => filtersBody({ species: ['Bat Star'] }), /integers/);
});

test('R5: model and session are keys too, for the same reason', () => {
  const wire = onWire(filtersBody({ model: [91], session: [400, 401] }));
  assert.deepEqual(wire.model, [91]);
  assert.deepEqual(wire.session, [400, 401]);
  assert.throws(() => filtersBody({ model: ['BatStarNet v3.2'] }), /integers/);
});

test('an empty selection is not sent, because absence means not filtering', () => {
  const wire = onWire(filtersBody({
    project: [], dive: [], species: [], reviewStatus: [], trainingDisposition: []
  }));
  assert.deepEqual(wire, {}, 'an empty array would read as a filter that matches nothing');
});

test('A17: the date range is sent, and is not silently dropped', () => {
  /* Dropping it was considered and rejected: a filter that omits rows without saying so is
     worse than one that fails, which is the premise #76 itself rests on. */
  const wire = onWire(filtersBody({ date: { from: '09:00', to: '17:00' } }));
  assert.deepEqual(wire.date, { from: '09:00', to: '17:00' });
});

/* ------------------------------------------------------------------ R3 */

test('R3: a visible page asks for the total; a prefetch does not', () => {
  const visible = onWire(pagesBody({
    filters: {}, pageSize: 45, pages: [7], includeTotal: true
  }));
  assert.equal(visible.includeTotal, true);
  assert.deepEqual(visible.pages, [7]);

  const prefetch = onWire(pagesBody({ filters: {}, pageSize: 45, pages: [8, 9] }));
  assert.equal('includeTotal' in prefetch, false,
    'the total is one number per question; asking again is a second pass for it');
});

test('R3: the pages asked for are de-duplicated and ascending', () => {
  const wire = onWire(pagesBody({ filters: {}, pageSize: 45, pages: [9, 1, 9, 3] }));
  assert.deepEqual(wire.pages, [1, 3, 9]);
});

test('the sort reaches the wire as the terms the contract takes', () => {
  const wire = onWire(pagesBody({
    filters: {}, pageSize: 45, pages: [1],
    sort: [{ field: 'confidence', dir: 'asc' }, { field: 'obsID', dir: 'desc' }]
  }));
  assert.deepEqual(wire.sort, [
    { field: 'confidence', dir: 'asc' }, { field: 'obsID', dir: 'desc' }
  ]);
  /* `observation_id` is not among them: the server appends it, always, and so does the
     client. Declaring it would make it something a caller could reorder or drop. */
  assert.ok(!wire.sort.some((t) => t.field === 'observation_id'));
});

/* ------------------------------------------------------------------ F4, A7, R7 */

test('R7: a commit sends the version the reviewer saw, per observation', () => {
  const rows = [
    { observation_id: 10, version: 3 },
    { observation_id: 11, version: 1 }
  ];
  const wire = onWire(commitBody({ rows, marks: new Map() }));

  assert.deepEqual(wire.observations, [
    { observation_id: 10, version: 3 },
    { observation_id: 11, version: 1 }
  ]);
});

test('R7: a commit request with a missing version is not constructible', () => {
  /* The endpoint answers 400 — "a missing version is a 400, never an implicit overwrite" —
     and that is the right answer. A client that can *build* the request is a client with a
     latent silent-overwrite bug, so it throws here instead. */
  assert.throws(
    () => commitBody({ rows: [{ observation_id: 10 }] }),
    /has no version/
  );
  assert.throws(
    () => commitBody({ rows: [{ observation_id: 10, version: null }] }),
    /has no version/
  );
});

test('the marks reach the wire as an array of objects, never as a Map', () => {
  /* The same serialisation trap as F2, one field over: `JSON.stringify(new Map(...))` is
     `{}`, so a commit would have sent no exception set and accepted the whole page. */
  const rows = [{ observation_id: 10, version: 1 }, { observation_id: 11, version: 1 }];
  const marks = new Map([[11, { kind: 'except', reason: 'Wrong species' }]]);

  const wire = onWire(commitBody({ rows, marks }));
  /* **`kind` moved into this assertion rather than the assertion being loosened** (#126
     R9, A5). A mark now says which of the two things it is, in the one list keyed by
     `observation_id` that `applyCommit` already folds by. */
  assert.deepEqual(wire.marks, [{ observation_id: 11, reason: 'Wrong species', kind: 'except' }]);

  assert.deepEqual(onWire({ marks }).marks, {},
    'this is what sending the Map itself would have looked like');
});

test('a mark left over from another page is not sent, because every id must be on the page', () => {
  const rows = [{ observation_id: 10, version: 1 }];
  const marks = new Map([[10, { kind: 'except', reason: null }], [999, { kind: 'except', reason: 'Duplicate' }]]);

  const wire = onWire(commitBody({ rows, marks }));
  assert.deepEqual(wire.marks, [{ observation_id: 10, reason: null, kind: 'except' }]);
});

/* ------------------------------------------------------------------ #126 A5, R9 */

test('R9: an accept mark reaches the wire as a kind, in the one marks list', () => {
  /**
   * **A5, and the reason there is no second list.** One list keyed by `observation_id` is
   * what `applyCommit` already folds by; two lists reintroduce the question of what an id
   * appearing in both means. So the kind is moved *into* this list, and this assertion
   * names it rather than being loosened to let it through.
   */
  const rows = [{ observation_id: 10, version: 1 }, { observation_id: 11, version: 2 }];
  const marks = new Map([
    [10, { kind: 'accept', reason: null }],
    [11, { kind: 'except', reason: 'Duplicate' }]
  ]);

  const wire = onWire(commitBody({ rows, marks }));
  assert.deepEqual(wire.marks, [
    { observation_id: 10, reason: null, kind: 'accept' },
    { observation_id: 11, reason: 'Duplicate', kind: 'except' }
  ]);
});

test('R9: a mark with no kind is sent as the exception, which is what it always meant', () => {
  const rows = [{ observation_id: 10, version: 1 }];
  const wire = onWire(commitBody({ rows, marks: new Map([[10, { reason: null }]]) }));
  assert.equal(wire.marks[0].kind, 'except');
});

test('R3: committing only the marked is the same request over a shorter observations list', () => {
  /**
   * The whole of how the main button fits the existing contract. `observations` is the set
   * the commit is about, so naming only the marked rows means nothing else is read,
   * accepted or changed -- and `marks` carrying the kind says what each of them becomes.
   * No new field, and no second endpoint.
   */
  const marked = [{ observation_id: 11, version: 2 }];
  const marks = new Map([[11, { kind: 'accept', reason: null }]]);

  const wire = onWire(commitBody({ rows: marked, marks }));
  assert.deepEqual(wire.observations, [{ observation_id: 11, version: 2 }]);
  assert.deepEqual(wire.marks, [{ observation_id: 11, reason: null, kind: 'accept' }]);
  /* Every observation in the request is marked, so the sweep has nothing to sweep. */
  assert.equal(wire.observations.length, wire.marks.length);
});

test('a withdrawal is sent only for ids on the page', () => {
  const rows = [{ observation_id: 10, version: 1 }];
  const wire = onWire(commitBody({ rows, marks: new Map(), withdraw: [10, 999] }));
  assert.deepEqual(wire.withdraw, [10]);

  const none = onWire(commitBody({ rows, marks: new Map(), withdraw: [] }));
  assert.equal('withdraw' in none, false);
});

/* ------------------------------------------------------- the other three bodies */

test('a correction sends the version too, for the same reason a commit does', () => {
  const wire = onWire(correctionBody({ observationId: 10, speciesId: 417, version: 3 }));
  assert.deepEqual(wire, { observation_id: 10, version: 3, species_id: 417 });

  assert.throws(
    () => correctionBody({ observationId: 10, speciesId: 417 }),
    /has no version/
  );
});

test('R11: a page retry sends the whole page in one request', () => {
  const wire = onWire(retryBody(new Set([12, 10, 11])));
  assert.deepEqual(wire, { observationIds: [10, 11, 12] });
});

test('the counts and the facets take the same filters object the page query takes', () => {
  const filters = { project: ['Deep Reef'], species: [41] };
  assert.deepEqual(onWire(countsBody({ filters })).filters, { project: ['Deep Reef'], species: [41] });
  assert.deepEqual(onWire(facetsBody({ filters })).filters, { project: ['Deep Reef'], species: [41] });

  const scoped = onWire(facetsBody({ filters, dimensions: ['dive', 'line'] }));
  assert.deepEqual(scoped.dimensions, ['dive', 'line']);
  assert.equal('dimensions' in onWire(facetsBody({ filters })), false,
    'absent means every dimension');
});
