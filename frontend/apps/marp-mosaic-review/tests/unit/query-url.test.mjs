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
    /* Keys, not names (F1). And they have to come back as **numbers**: an address only
       carries text, and the endpoint refuses `filters.species` that is not integers. */
    species: [41, 43],
    confidence: { from: 0.5, to: 0.8 },
    timeOfDay: { from: '22:00', to: '02:00' },
    /* A17: the date range carries times. It was `YYYY-MM-DD`, which is the reading the
       human ruled out. */
    date: { from: '09:00', to: '17:00' }
  };
  q.sort = { field: 'obsID', dir: 'asc', then: null };
  q.page = 7;

  const back = round(q);
  assert.equal(back.mode, 'training');
  assert.equal(back.page, 7);
  assert.deepEqual(back.sort, { field: 'obsID', dir: 'asc', then: null });
  assert.deepEqual(back.filters.dive, ['D04', 'D05']);
  assert.deepEqual(back.filters.species, [41, 43]);
  assert.deepEqual(back.filters.confidence, { from: 0.5, to: 0.8 });
  assert.deepEqual(back.filters.timeOfDay, { from: '22:00', to: '02:00' });
  assert.deepEqual(back.filters.date, { from: '09:00', to: '17:00' });
});

test('R6: every declared dimension can be written and read back', () => {
  /* Driven from the declaration rather than listed, so a dimension added in `dimensions.js`
     and forgotten here fails immediately instead of silently not surviving a reload. */
  for (const dimension of DIMENSIONS) {
    const q = base();
    /* A `numeric` set dimension filters on an integer key, so `['alpha','beta']` is not a
       value it can carry -- it would be discarded on the way back in, which is R3 working
       rather than a round-trip failure. A `clock` range carries times (A17). */
    if (dimension.kind === KIND.SET) {
      q.filters[dimension.key] = dimension.numeric ? [41, 43] : ['alpha', 'beta'];
    } else if (dimension.kind === KIND.WINDOW) q.filters[dimension.key] = { from: '01:15', to: '03:45' };
    else if (dimension.clock) q.filters[dimension.key] = { from: '02:02', to: null };
    else {
      const [lo, hi] = dimension.bounds;
      q.filters[dimension.key] = { from: lo, to: hi };
    }
    const back = round(q);
    assert.deepEqual(back.filters[dimension.key], q.filters[dimension.key],
      `${dimension.key} did not survive being written to an address and read back`);
  }
});

test('clearing every filter comes back narrowing nothing', () => {
  /* The trap this closes: a reviewer who deliberately cleared a filter must not be handed
     it straight back on the next reload.
     It used to close that by asserting an emptied question never writes a *bare* address,
     which worked because the default opened on one species, so "cleared" and "default"
     were different questions. **Since A10(b) removed that literal they are the same
     question**, an emptied question does write a bare address, and that is correct rather
     than a regression: a bare address now means the default, and the default narrows
     nothing, so there is nothing to hand back.
     The property worth asserting was always the outcome, not the mechanism -- so this
     asserts the round trip directly. If a data-derived default is ever seeded onto a bare
     address, this test is the one that must be revisited first, because that is precisely
     what reopens the trap. */
  const q = base();
  for (const dimension of DIMENSIONS) {
    q.filters[dimension.key] = dimension.kind === KIND.SET ? [] : null;
  }
  const address = toQuery(q);

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
  /* Nothing rides along any more: the default question narrows nothing since A10(b), so
     the address carries the sort and only the sort. */
  assert.equal(written, '?sort=confidence.asc,keyframe_count.desc',
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
  assert.equal(toQuery(q), '?sort=obsID.asc');
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
  /* Project names can carry commas, and a comma is also how a multi-select is separated.
     Reading the address with URLSearchParams decodes first and splits second, which turns
     one value into two — hence the hand-rolled parse.
     This used the species dimension, which now carries integer keys and so cannot hold a
     comma at all (F1). `project` is the nearest dimension that still carries free text,
     and the property under test is the parser's, not that dimension's. */
  const q = base();
  q.filters.project = ['Deep Reef, outer', 'Nearshore Kelp'];
  assert.deepEqual(round(q).filters.project, ['Deep Reef, outer', 'Nearshore Kelp']);
});

test('a half-escaped address does not throw', () => {
  /* `decodeURIComponent('%')` throws. An address that lost a character in a chat client
     must degrade, not take the application down with it. */
  assert.doesNotThrow(() => fromQuery('?species=%&dive=D04'));
  assert.deepEqual(fromQuery('?species=%&dive=D04').filters.dive, ['D04']);
});

test('R7: the mode\'s own status filter round-trips', () => {
  const q = base();
  q.filters.reviewStatus = ['reviewed'];
  const back = round(q);
  assert.deepEqual(back.filters.reviewStatus, ['reviewed']);
});

test('R7: a borrowed status filter round-trips, and absence means not filtering', () => {
  /* The reverse of what this asserted until #89: a scientific address carrying training
     disposition used to be discarded, because `queryFilters` dropped the dimension and a
     filter drawn in the rail that narrows nothing is a lie. It narrows something now. */
  const asked = fromQuery('?trainingDisposition=promoted,excluded&dive=D04');
  assert.equal(asked.mode, 'scientific');
  assert.deepEqual(asked.filters.trainingDisposition, ['promoted', 'excluded']);
  assert.deepEqual(asked.filters.dive, ['D04']);
  assert.equal(toQuery(asked).includes('trainingDisposition=promoted,excluded'), true);

  /* Absent means not filtering, never "use the owning mode's default" — the same rule that
     stops a cleared species filter coming back on reload. */
  const bare = fromQuery('?dive=D04');
  assert.deepEqual(bare.filters.trainingDisposition, [],
    'a borrowed dimension the address does not mention narrows nothing');

  /* And into Training the other way round: a link carrying review status means what it
     says, while training disposition stays at Training\'s own default. */
  const intoTraining = fromQuery('?mode=training&reviewStatus=flagged');
  assert.deepEqual(intoTraining.filters.reviewStatus, ['flagged']);
  assert.deepEqual(intoTraining.filters.trainingDisposition, ['undecided']);
  assert.equal(toQuery(intoTraining).includes('reviewStatus=flagged'), true);
  assert.equal(toQuery(intoTraining).includes('trainingDisposition'), false,
    'a mode\'s own dimension at its own default is not written');
});

test('R3/R7: a bare address is still the default question, with nothing borrowed applied', () => {
  /* If the default question ever carried `trainingDisposition=undecided` it would both
     narrow Scientific's opening page and stop the default writing a bare address. */
  assert.equal(toQuery(defaultQuery()), '');
  const back = fromQuery('');
  assert.deepEqual(back.filters.trainingDisposition, []);
  assert.deepEqual(back.filters.reviewStatus, ['unreviewed', 'flagged']);
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
  /* Times rather than dates (A17). The property is which end was open, not which
     vocabulary the ends are written in. */
  const q = base();
  q.filters.date = { from: null, to: '17:00' };
  assert.deepEqual(round(q).filters.date, { from: null, to: '17:00' });

  q.filters.date = { from: '09:00', to: null };
  assert.deepEqual(round(q).filters.date, { from: '09:00', to: null });
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
