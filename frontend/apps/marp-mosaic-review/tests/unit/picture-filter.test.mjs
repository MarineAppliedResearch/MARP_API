/**
 * The Picture filter (#287): only tiles whose picture is in a chosen state.
 *
 * Isaac, 2026-11-12: "the mosaic viewer needs a way to filter by only images that are
 * actually available". It is a set filter like Project or Dive, so it has to reach the
 * request, survive the address bar, and be worded for a reviewer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DIMENSION } from '../../src/model/dimensions.js';
import { filtersBody } from '../../src/api/requests.js';
import { toQuery, fromQuery, defaultQuery } from '../../src/model/query-url.js';

test('choosing Available sends it with the question', () => {
  assert.deepEqual(filtersBody({ picture: ['available'] }), { picture: ['available'] });
  assert.equal(filtersBody({ picture: [] }).picture, undefined, 'nothing chosen filters nothing');
});

test('the choice survives the address bar', () => {
  const start = defaultQuery();
  const query = toQuery({ ...start, filters: { ...start.filters, picture: ['available', 'no video'] } });
  assert.deepEqual(fromQuery(query).filters.picture, ['available', 'no video']);
});

test('each state is worded for a reviewer', () => {
  const picture = DIMENSION.picture;
  assert.equal(picture.all, 'Any picture');
  assert.deepEqual(['available', 'preparing', 'no video', 'no image'].map(picture.one),
    ['Available', 'Preparing', 'No video available', 'No image']);
});
