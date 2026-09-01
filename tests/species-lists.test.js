/**
 * Endpoint tests for the annotation species lists and species pictures.
 *
 * These endpoints exist so the API can be the single source of truth for the
 * species lists, which until now lived as seven CSV files inside the annotation
 * GUI, and for the pictures, which lived as 663 files beside them (issue #52).
 *
 * Read-only throughout, so nothing needs cleaning up: the data under test is
 * the imported list itself, put there by
 * `migrations/20260901120200-import-species-lists.js` and
 * `migrations/20260901120400-import-species-pictures.js`. Runs against the app
 * exported by app.js via Supertest, in-process, against the real dev Postgres
 * database (see jest.config.js).
 *
 * The assertions deliberately avoid pinning exact row counts, which would break
 * the moment somebody edits a list -- exactly the thing this work is meant to
 * make easy. They pin the structural facts instead.
 *
 * @fileoverview Endpoint tests for GET /api/species/lists and the list/picture routes.
 * @author Isaac Travers
 * @module tests/species-lists
 */

const request = require('supertest');
const app = require('../app');

/**
 * The seven lists the annotation GUI shipped. Named explicitly because losing
 * one to a bad import is exactly the kind of failure that would otherwise go
 * unnoticed.
 *
 * @constant
 * @type {Array<string>}
 */
const EXPECTED_LISTS = [
  'Fish',
  'GULF_Fish',
  'GULF_Inverts',
  'Habitat',
  'Inverts',
  'MarineDebris',
  'Substrate_60Seconds',
];

describe('Annotation species lists', () => {

  /**
   * GET /api/species/lists should name every list and count its entries.
   */
  it('lists the seven annotation lists with entry counts', async () => {
    const res = await request(app).get('/api/species/lists');

    expect(res.status).toBe(200);

    const names = res.body.map((list) => list.species_list);
    expect(names).toEqual(EXPECTED_LISTS);

    for (const list of res.body) {
      expect(list.entry_count).toEqual(expect.any(Number));
      expect(list.entry_count).toBeGreaterThan(0);
    }
  });

  /**
   * The two historical rows with no list ('No code', 'Line start taxserial')
   * are kept because ML metrics reference them, but they are not on any list
   * and must not be offered for annotation.
   */
  it('excludes entries that belong to no list', async () => {
    const res = await request(app).get('/api/species/lists');

    expect(res.status).toBe(200);
    expect(res.body.map((list) => list.species_list)).not.toContain(null);
  });

  /**
   * GET /api/species/list/:list should return that list's entries, scoped to
   * it, each carrying a pictures array.
   */
  it('returns one list, scoped to it, with pictures attached', async () => {
    const res = await request(app).get('/api/species/list/Fish');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(100);
    expect(res.body.every((entry) => entry.species_list === 'Fish')).toBe(true);
    expect(res.body.every((entry) => Array.isArray(entry.pictures))).toBe(true);
  });

  /**
   * The response has to be usable as-is for building a tab tree, which means a
   * list's entries arrive grouped by main tab and sub-tab rather than
   * interleaved.
   */
  it('groups a list by main tab then sub-tab', async () => {
    const res = await request(app).get('/api/species/list/Fish');

    expect(res.status).toBe(200);

    // A group is contiguous if the number of transitions between distinct
    // tab/sub-tab pairs equals the number of distinct pairs.
    // JSON rather than a joined string: a tab name may contain whatever
    // characters somebody typed, so any separator could appear inside one.
    const pairs = res.body.map((entry) => JSON.stringify([entry.gui_maintab, entry.gui_subtab]));
    const transitions = pairs.filter((pair, index) => index === 0 || pair !== pairs[index - 1]);

    expect(transitions.length).toBe(new Set(pairs).size);
  });

  /**
   * A list that does not exist is an empty list, not an error -- the same shape
   * a real but empty list would produce.
   */
  it('returns an empty array for an unknown list', async () => {
    const res = await request(app).get('/api/species/list/NoSuchList');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('Annotation species list search', () => {

  /**
   * Search should match on name, case-insensitively, and stay inside the list.
   */
  it('finds entries by name within one list', async () => {
    const res = await request(app).get('/api/species/list/Fish/search?q=rockfish');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((entry) => entry.species_list === 'Fish')).toBe(true);

    for (const entry of res.body) {
      const haystack = [entry.comname, entry.species, entry.gui_display_name]
        .filter(Boolean).join(' ').toLowerCase();
      expect(haystack).toContain('rockfish');
    }
  });

  /**
   * An empty q must be rejected rather than quietly returning the whole list,
   * which would read as a working search.
   */
  it('rejects an empty search term', async () => {
    const res = await request(app).get('/api/species/list/Fish/search?q=');

    expect(res.status).toBe(400);
  });
});

describe('Species identity is list plus taxserial', () => {

  /**
   * The reason `species_list` exists. ITIS serial 169237 is on two lists under
   * two different common names, so a lookup by taxserial alone cannot say which
   * entry is meant.
   */
  it('returns different entries for the same taxserial on different lists', async () => {
    const fish = await request(app).get('/api/species/list/Fish/taxserial/169237');
    const gulf = await request(app).get('/api/species/list/GULF_Fish/taxserial/169237');

    expect(fish.status).toBe(200);
    expect(gulf.status).toBe(200);

    expect(fish.body.comname).toBe('UI croaker');
    expect(gulf.body.comname).toBe('Drum');

    // Same taxon underneath, which is what itis_tsn records.
    expect(fish.body.itis_tsn).toBe(169237);
    expect(gulf.body.itis_tsn).toBe(169237);

    expect(fish.body.id).not.toBe(gulf.body.id);
  });

  /**
   * Local codes below 10000 are invented per list and reused, so they must not
   * be given an ITIS serial.
   */
  it('leaves itis_tsn null for a local per-list code', async () => {
    const res = await request(app).get('/api/species/list/Substrate_60Seconds/taxserial/1');

    expect(res.status).toBe(200);
    expect(res.body.taxserial).toBe(1);
    expect(res.body.itis_tsn).toBeNull();
  });

  /**
   * Habitat's 666xxx values are six digits and look like ITIS serials, but are
   * synthetic categories rather than taxa.
   */
  it('leaves itis_tsn null for a synthetic Habitat code', async () => {
    const res = await request(app).get('/api/species/list/Habitat/taxserial/666001');

    expect(res.status).toBe(200);
    expect(res.body.comname).toBe('Rock');
    expect(res.body.itis_tsn).toBeNull();
  });

  /**
   * A taxserial that is not on the named list is a 404, even when it exists on
   * another list.
   */
  it('404s for a taxserial that is not on the named list', async () => {
    const res = await request(app).get('/api/species/list/Habitat/taxserial/169237');

    expect(res.status).toBe(404);
  });
});

describe('Species pictures', () => {

  /**
   * The picture id used below, discovered rather than hardcoded so the suite
   * does not depend on insertion order.
   *
   * @type {number|undefined}
   */
  let pictureId;

  /**
   * Finds a species that has at least one picture.
   */
  beforeAll(async () => {
    const res = await request(app).get('/api/species/list/Fish');
    const withPicture = res.body.find((entry) => entry.pictures.length > 0);
    pictureId = withPicture && withPicture.pictures[0].id;
  });

  /**
   * A species' pictures should be listable, with the default first.
   */
  it('lists the pictures for a species, default first', async () => {
    const list = await request(app).get('/api/species/list/Fish');
    const withPicture = list.body.find((entry) => entry.pictures.length > 0);

    const res = await request(app).get(`/api/species/${withPicture.id}/pictures`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].is_default).toBe(true);
    expect(res.body[0].species_id).toBe(withPicture.id);
  });

  /**
   * At most one picture per species may be the default -- otherwise "the"
   * picture is ambiguous, which is the bug the GUI had.
   */
  it('marks exactly one picture as default per species', async () => {
    const res = await request(app).get('/api/species/list/Inverts');

    expect(res.status).toBe(200);

    for (const entry of res.body) {
      const defaults = entry.pictures.filter((picture) => picture.is_default);
      expect(defaults.length).toBeLessThanOrEqual(1);
      if (entry.pictures.length > 0) {
        expect(defaults.length).toBe(1);
      }
    }
  });

  /**
   * The bytes should come back with the recorded content type and a cache
   * header, since a species grid requests hundreds at once.
   */
  it('serves the picture file with caching headers', async () => {
    expect(pictureId).toEqual(expect.any(Number));

    const res = await request(app).get(`/api/species/pictures/${pictureId}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\//);
    expect(res.headers['cache-control']).toContain('max-age');
    expect(res.headers.etag).toBeTruthy();
    expect(res.body.length).toBeGreaterThan(0);
  });

  /**
   * A matching ETag should short-circuit to 304, which is what stops a tab switch
   * re-downloading every picture.
   */
  it('answers 304 when the client already has the picture', async () => {
    const first = await request(app).get(`/api/species/pictures/${pictureId}`);
    const etag = first.headers.etag;

    const second = await request(app)
      .get(`/api/species/pictures/${pictureId}`)
      .set('If-None-Match', etag);

    expect(second.status).toBe(304);
  });

  /**
   * An unknown picture is a 404 rather than a stack trace.
   */
  it('404s for an unknown picture id', async () => {
    const res = await request(app).get('/api/species/pictures/999999999');

    expect(res.status).toBe(404);
  });
});
