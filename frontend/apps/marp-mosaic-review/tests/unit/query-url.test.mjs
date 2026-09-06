/**
 * The question, written as an address, and read back.
 *
 * All of this is string handling and arithmetic, so it belongs here rather than in a
 * browser: a reload proves the wiring, but it cannot practically prove what happens to
 * forty different malformed addresses.
 *
 * The rule under test throughout is R3 — **an address that does not make sense is
 * discarded, never applied half-understood.** Addresses get typed, edited, truncated by a
 * chat client and pasted back together, so arriving malformed is the normal case.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toQuery, fromQuery, defaultQuery } from
  '../../src/model/query-url.js';
import { DIMENSIONS, DIMENSION, KIND, isActive } from '../../src/model/dimensions.js';
import { DEFAULT_FILTERS, DEFAULT_SORT } from '../../src/model/filters.js';

/** A question with everything at its default, for building on. */
const base = () => defaultQuery();

/** Write then read, which is the round trip every requirement here depends on. */
const round = (q) => fromQuery(toQuery(q));

test('R4: a bare address is the default question, and the default writes a bare address', () => {
  assert.equal(toQuery(defaultQuery()), '');

  const back = fromQuery('');
  assert.equal(back.mode, 'scientific');
  assert.equal(back.page, 1);
  assert.deepEqual(back.sort, DEFAULT_SORT);
  assert.deepEqual(back.filters.species, DEFAULT_FILTERS.species);
});

test('R1: mode, filters, sort and page all survive the round trip', () => {
  const q = base();
  q.mode = 'training';
  q.filters = {
    ...q.filters,
    dive: ['D04', 'D05'],
    species: ['Bat Star', 'Ochre Star'],
    confidence: { from: 0.5, to: 0.8 },
    timeOfDay: { from: '22:00', to: '02:00' },
    date: { from: '2019-01-01', to: '2019-12-31' }
  };
  q.sort = { field: 'obsID', dir: 'asc', then: null };
  q.page = 7;

  const back = round(q);
  assert.equal(back.mode, 'training');
  assert.equal(back.page, 7);
  assert.deepEqual(back.sort, { field: 'obsID', dir: 'asc', then: null });
  assert.deepEqual(back.filters.dive, ['D04', 'D05']);
  assert.deepEqual(back.filters.species, ['Bat Star', 'Ochre Star']);
  assert.deepEqual(back.filters.confidence, { from: 0.5, to: 0.8 });
  assert.deepEqual(back.filters.timeOfDay, { from: '22:00', to: '02:00' });
  assert.deepEqual(back.filters.date, { from: '2019-01-01', to: '2019-12-31' });
});

test('R6: every declared dimension can be written and read back', () => {
  /* Driven from the declaration rather than listed, so a dimension added in `dimensions.js`
     and forgotten here fails immediately instead of silently not surviving a reload. */
  for (const dimension of DIMENSIONS) {
    const q = base();
    if (dimension.kind === KIND.SET) q.filters[dimension.key] = ['alpha', 'beta'];
    else if (dimension.kind === KIND.WINDOW) q.filters[dimension.key] = { from: '01:15', to: '03:45' };
    else if (dimension.key === 'date') q.filters[dimension.key] = { from: '2020-02-02', to: null };
    else {
      const [lo, hi] = dimension.bounds;
      q.filters[dimension.key] = { from: lo, to: hi };
    }
    const back = round(q);
    assert.deepEqual(back.filters[dimension.key], q.filters[dimension.key],
      `${dimension.key} did not survive being written to an address and read back`);
  }
});

test('clearing every filter is not the same address as the default question', () => {
  /* The trap this closes: the fixture opens on one species. If "no parameters" meant
     "use the defaults", a reviewer who deliberately cleared the species filter would be
     handed it straight back on the next reload. */
  const q = base();
  for (const dimension of DIMENSIONS) {
    q.filters[dimension.key] = dimension.kind === KIND.SET ? [] : null;
  }
  const address = toQuery(q);
  assert.notEqual(address, '', 'an emptied question must not write a bare address');

  const back = fromQuery(address);
  for (const dimension of DIMENSIONS) {
    assert.equal(isActive(dimension, back.filters[dimension.key]), false,
      `${dimension.key} came back narrowing something after being cleared`);
  }
});

test('R3: a confidence range outside its own bounds is discarded, not clamped', () => {
  /* Clamping would silently answer a question nobody asked. */
  const back = fromQuery('?confidence=0.4..9');
  assert.equal(back.filters.confidence, null);
});

test('R3: a range whose ends are the wrong way round is discarded', () => {
  assert.equal(fromQuery('?confidence=0.9..0.2').filters.confidence, null);
  assert.equal(fromQuery('?date=2020-06-01..2020-01-01').filters.date, null);
});

test('R3: a time window may be the wrong way round, because that is the midnight wrap', () => {
  /* The one range where from later than to is meant rather than broken — #77 R4. */
  assert.deepEqual(fromQuery('?timeOfDay=22:00..02:00').filters.timeOfDay,
    { from: '22:00', to: '02:00' });
});

test('R3: malformed times and dates are discarded', () => {
  assert.equal(fromQuery('?timeOfDay=25:00..02:00').filters.timeOfDay, null);
  assert.equal(fromQuery('?timeOfDay=lunchtime..02:00').filters.timeOfDay, null);
  assert.equal(fromQuery('?date=2019-1-1..').filters.date, null);
  assert.equal(fromQuery('?date=yesterday..').filters.date, null);
});

test('R3: a range with no separator is discarded rather than read as one end', () => {
  assert.equal(fromQuery('?confidence=0.5').filters.confidence, null);
});

test('R3: one broken dimension does not cost the reviewer another', () => {
  const back = fromQuery('?dive=D04,D05&confidence=nonsense..also-nonsense');
  assert.deepEqual(back.filters.dive, ['D04', 'D05']);
  assert.equal(back.filters.confidence, null);
});

test('R3: an unknown mode falls back to scientific rather than breaking', () => {
  assert.equal(fromQuery('?mode=archaeology').mode, 'scientific');
  assert.equal(fromQuery('?mode=delete').mode, 'delete');
});

test('R3: a page that is not a page becomes page one', () => {
  assert.equal(fromQuery('?page=0').page, 1);
  assert.equal(fromQuery('?page=-4').page, 1);
  assert.equal(fromQuery('?page=abc').page, 1);
  assert.equal(fromQuery('?page=2.5').page, 1);
  assert.equal(fromQuery('?page=12').page, 12);
});

test('R3: a sort nobody offers is ignored', () => {
  assert.deepEqual(fromQuery('?sort=cuteness.desc').sort, DEFAULT_SORT);
  assert.deepEqual(fromQuery('?sort=obsID.asc').sort,
    { field: 'obsID', dir: 'asc', then: null });
});

test('M2: the secondary term survives the address', () => {
  const q = { ...defaultQuery(), sort: { field: 'confidence', dir: 'asc', then: { field: 'keyframe_count', dir: 'desc' } } };
  const written = toQuery(q);
  /* The fixture's default species filter rides along; the sort is the part under test. */
  assert.equal(written, '?species=Bat%20Star&sort=confidence.asc,keyframe_count.desc',
    'both terms in one parameter, because they are one question');
  assert.deepEqual(fromQuery(written).sort, q.sort);
});

test('M2: a malformed secondary does not cost the reviewer the primary', () => {
  /* The same rule every dimension already follows. An address is typed, edited and
     truncated by chat clients, so half of one being unreadable must not discard the
     half that was fine. */
  assert.deepEqual(fromQuery('?sort=obsID.desc,cuteness.asc').sort,
    { field: 'obsID', dir: 'desc', then: null });
  assert.deepEqual(fromQuery('?sort=obsID.desc,keyframe_count.sideways').sort,
    { field: 'obsID', dir: 'desc', then: null });
  assert.deepEqual(fromQuery('?sort=obsID.desc,').sort,
    { field: 'obsID', dir: 'desc', then: null });
});

test('M2: a secondary naming the primary is not a term, and is not written', () => {
  /* It can never be reached, so it is not a sort -- and an address that carried it would
     round-trip into something different from what it said. */
  assert.deepEqual(fromQuery('?sort=obsID.asc,obsID.desc').sort,
    { field: 'obsID', dir: 'asc', then: null });
  const q = { ...defaultQuery(), sort: { field: 'obsID', dir: 'asc', then: { field: 'obsID', dir: 'desc' } } };
  assert.equal(toQuery(q), '?species=Bat%20Star&sort=obsID.asc');
});

test('M2: the default sort still writes a bare address', () => {
  /* The whole of #79 rests on this: a bare address is the default question. A secondary
     that defaulted to anything would break every link already sent. */
  assert.equal(toQuery(defaultQuery()), '');
  assert.equal(DEFAULT_SORT.then, null);
});

test('R3: a parameter naming no dimension is simply ignored', () => {
  const back = fromQuery('?dive=D04&utm_source=email&nonsense=1');
  assert.deepEqual(back.filters.dive, ['D04']);
});

test('a value containing a comma stays one value', () => {
  /* Species names can carry commas, and a comma is also how a multi-select is separated.
     Reading the address with URLSearchParams decodes first and splits second, which turns
     one species into two — hence the hand-rolled parse. */
  const q = base();
  q.filters.species = ['Rockfish, unidentified', 'Bat Star'];
  assert.deepEqual(round(q).filters.species, ['Rockfish, unidentified', 'Bat Star']);
});

test('a half-escaped address does not throw', () => {
  /* `decodeURIComponent('%')` throws. An address that lost a character in a chat client
     must degrade, not take the application down with it. */
  assert.doesNotThrow(() => fromQuery('?species=%&dive=D04'));
  assert.deepEqual(fromQuery('?species=%&dive=D04').filters.dive, ['D04']);
});

test('the mode keeps its own status filter, and ignores the other mode\'s', () => {
  const q = base();
  q.filters.reviewStatus = ['reviewed'];
  const back = round(q);
  assert.deepEqual(back.filters.reviewStatus, ['reviewed']);

  /* Training's dimension in a scientific address narrows nothing — `queryFilters` drops
     it — so showing it in the rail would be a filter that lies. */
  const stray = fromQuery('?trainingDisposition=promoted&dive=D04');
  assert.deepEqual(stray.filters.trainingDisposition, DEFAULT_FILTERS.trainingDisposition);
});

test('R3: an unrecognised status value leaves the mode default in place', () => {
  /* Not "no status filter": that is a different question from the one the address asked. */
  const back = fromQuery('?reviewStatus=banana');
  assert.deepEqual(back.filters.reviewStatus, DEFAULT_FILTERS.reviewStatus);
});

test('a status filter matching the mode default is not written into the address', () => {
  const q = base();
  q.filters.reviewStatus = DEFAULT_FILTERS.reviewStatus.slice();
  assert.equal(toQuery(q).includes('reviewStatus'), false);
});

test('the address stays readable: colons survive, commas do not become separators', () => {
  const q = base();
  q.filters.timeOfDay = { from: '22:00', to: '02:00' };
  const address = toQuery(q);
  assert.ok(address.includes('timeOfDay=22:00..02:00'),
    `a time window should be legible in the address, got ${address}`);
});

test('an open-ended range keeps which end was open', () => {
  const q = base();
  q.filters.date = { from: null, to: '2020-12-31' };
  assert.deepEqual(round(q).filters.date, { from: null, to: '2020-12-31' });

  q.filters.date = { from: '2020-01-01', to: null };
  assert.deepEqual(round(q).filters.date, { from: '2020-01-01', to: null });
});

test('a dimension that nests keeps its dependents, because the address is not a gesture', () => {
  /* `applyDimension` drops dependents that no longer apply when somebody *changes* a
     filter. Reading an address is not a change — it is the state itself — so a link
     naming both a dive and a line must arrive with both. */
  const q = base();
  q.filters.dive = ['D04'];
  q.filters.line = ['2'];
  const back = round(q);
  assert.deepEqual(back.filters.dive, ['D04']);
  assert.deepEqual(back.filters.line, ['2']);
  assert.ok(DIMENSION.line.nestsUnder === 'dive');
});
