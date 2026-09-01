/**
 * Endpoint tests for uploading and managing species pictures.
 *
 * Pictures used to live only inside the annotation GUI, and new ones could only
 * arrive by editing that repository. These endpoints are how they get to the API
 * instead (issue #52).
 *
 * Every picture is vetted and resized on the way in. That is not cosmetic: all
 * 646 pictures inherited from the GUI are exactly 244 pixels wide, because the
 * species buttons are laid out around that width, so an unresized upload would
 * be the one that looks wrong.
 *
 * This suite writes, so it creates its own disposable species and deletes
 * everything it made -- including the files, which live outside the database.
 * Runs against the app exported by app.js via Supertest, in-process, against the
 * real dev Postgres database (see jest.config.js).
 *
 * @fileoverview Endpoint tests for species picture upload, default and delete.
 * @author Isaac Travers
 * @module tests/species-pictures
 */

const fs = require('fs');
const path = require('path');

const request = require('supertest');
const sharp = require('sharp');

const app = require('../app');
const db = require('../model');

/**
 * Where the API stores picture files. Checked directly so the tests can prove a
 * file was actually written and actually removed, rather than trusting the
 * database row.
 *
 * @constant
 * @type {string}
 */
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'species-pictures');

/**
 * Width every stored picture should end up at.
 *
 * @constant
 * @type {number}
 */
const PICTURE_WIDTH = 244;

/**
 * Builds a solid-colour PNG of a given size, so a test can supply a real image
 * without a fixture file.
 *
 * @param {number} width - Image width in pixels.
 * @param {number} height - Image height in pixels.
 * @returns {Promise<Buffer>} PNG bytes.
 */
async function makePng(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 90, b: 140 },
    },
  }).png().toBuffer();
}

describe('Species picture upload', () => {

  /**
   * Disposable species every picture below is attached to, so nothing here
   * touches a real list entry.
   *
   * @type {number|undefined}
   */
  let speciesId;

  /**
   * Filenames written during the suite, removed in afterAll in case a test
   * failed before its own cleanup.
   *
   * @type {Array<string>}
   */
  const writtenFiles = [];

  /**
   * Creates the disposable species directly through the model: it needs a
   * species_list and taxserial that cannot collide with a real entry, and the
   * create endpoint has no way to guarantee that.
   */
  beforeAll(async () => {
    const created = await db.species.create({
      species_list: 'jest-picture-list',
      taxserial: 987654321,
      comname: 'Jest Picture Subject',
      // Retired, so this fixture never shows up in GET /api/species/lists
      // while the suite runs.
      is_active: false,
    });
    speciesId = created.id;
  });

  /**
   * Removes the species, which cascades to its picture rows, then any files
   * left behind.
   */
  afterAll(async () => {
    if (speciesId) {
      await db.species.destroy({ where: { id: speciesId } });
    }

    for (const filename of writtenFiles) {
      const filePath = path.join(STORAGE_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  /**
   * A picture larger than the target should be scaled down to the standard
   * width, keeping its aspect ratio, and the stored file should match what the
   * record claims.
   */
  it('resizes an oversized upload to the standard width', async () => {
    const res = await request(app)
      .post(`/api/species/${speciesId}/pictures`)
      .attach('pictures', await makePng(800, 600), 'big-photo.png');

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);

    const picture = res.body[0];
    writtenFiles.push(picture.filename);

    expect(picture.width).toBe(PICTURE_WIDTH);
    // 800x600 scaled to 244 wide is 183 tall.
    expect(picture.height).toBe(183);
    expect(picture.original_name).toBe('big-photo.png');
    expect(picture.species_id).toBe(speciesId);

    // The file must exist and actually be the size recorded.
    const filePath = path.join(STORAGE_DIR, picture.filename);
    expect(fs.existsSync(filePath)).toBe(true);

    const stored = await sharp(filePath).metadata();
    expect(stored.width).toBe(PICTURE_WIDTH);
    expect(stored.height).toBe(183);
  });

  /**
   * The first picture a species gets has to become the default, or "the"
   * picture is undefined -- the ambiguity this table exists to remove.
   */
  it('makes the first picture the default and later ones not', async () => {
    const pictures = await request(app).get(`/api/species/${speciesId}/pictures`);

    expect(pictures.status).toBe(200);
    expect(pictures.body[0].is_default).toBe(true);

    const second = await request(app)
      .post(`/api/species/${speciesId}/pictures`)
      .attach('pictures', await makePng(500, 500), 'second.png');

    expect(second.status).toBe(201);
    writtenFiles.push(second.body[0].filename);
    expect(second.body[0].is_default).toBe(false);
  });

  /**
   * A GIF cannot stay a GIF: an animated one does not resize meaningfully, and
   * a species button has no use for animation.
   */
  it('converts a GIF to PNG', async () => {
    const gif = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 30, b: 30 } },
    }).gif().toBuffer();

    const res = await request(app)
      .post(`/api/species/${speciesId}/pictures`)
      .attach('pictures', gif, 'animated.gif');

    expect(res.status).toBe(201);
    writtenFiles.push(res.body[0].filename);

    expect(res.body[0].content_type).toBe('image/png');
    expect(res.body[0].filename).toMatch(/\.png$/);
    expect(res.body[0].original_name).toBe('animated.gif');
  });

  /**
   * An image too small to reach the standard width without being enlarged past
   * usefulness should be refused with a reason, not stored as a blurry smear.
   */
  it('rejects an image below the minimum size', async () => {
    const res = await request(app)
      .post(`/api/species/${speciesId}/pictures`)
      .attach('pictures', await makePng(60, 40), 'tiny.png');

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/minimum/i);
  });

  /**
   * The declared type and the extension are both client-supplied. Only decoding
   * proves the bytes are an image.
   */
  it('rejects a non-image sent with an image name', async () => {
    const res = await request(app)
      .post(`/api/species/${speciesId}/pictures`)
      .attach('pictures', Buffer.from('this is definitely not a png'), 'lies.png');

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/could not be read as an image/i);
  });

  /**
   * A request with no file at all is a client mistake worth naming, since the
   * field name is easy to get wrong.
   */
  it('rejects a request with no files attached', async () => {
    const res = await request(app).post(`/api/species/${speciesId}/pictures`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/pictures/);
  });

  /**
   * Uploading against a species that does not exist must not leave a file
   * behind.
   */
  it('404s for an unknown species and writes nothing', async () => {
    const before = fs.existsSync(STORAGE_DIR) ? fs.readdirSync(STORAGE_DIR).length : 0;

    const res = await request(app)
      .post('/api/species/999999999/pictures')
      .attach('pictures', await makePng(400, 300), 'orphan.png');

    expect(res.status).toBe(404);

    const after = fs.existsSync(STORAGE_DIR) ? fs.readdirSync(STORAGE_DIR).length : 0;
    expect(after).toBe(before);
  });
});

describe('Species picture management', () => {

  /**
   * Disposable species for the default/delete tests.
   *
   * @type {number|undefined}
   */
  let speciesId;

  /**
   * Picture ids created below.
   *
   * @type {Array<number>}
   */
  const pictureIds = [];

  /**
   * Filenames written, cleaned up in afterAll.
   *
   * @type {Array<string>}
   */
  const writtenFiles = [];

  /**
   * Creates a species with two pictures, which is what the default-switching
   * and delete-promotion behaviour needs.
   */
  beforeAll(async () => {
    const created = await db.species.create({
      species_list: 'jest-picture-list',
      taxserial: 987654322,
      comname: 'Jest Picture Manager',
      is_active: false,
    });
    speciesId = created.id;

    for (const name of ['first.png', 'second.png']) {
      const res = await request(app)
        .post(`/api/species/${speciesId}/pictures`)
        .attach('pictures', await makePng(400, 300), name);
      pictureIds.push(res.body[0].id);
      writtenFiles.push(res.body[0].filename);
    }
  });

  /**
   * Removes the species and any leftover files.
   */
  afterAll(async () => {
    if (speciesId) {
      await db.species.destroy({ where: { id: speciesId } });
    }

    for (const filename of writtenFiles) {
      const filePath = path.join(STORAGE_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  /**
   * A thumbnail should be smaller than the stored picture and carry a cache
   * header, since a grid asks for hundreds at once.
   */
  it('serves a thumbnail smaller than the full picture', async () => {
    const full = await request(app).get(`/api/species/pictures/${pictureIds[0]}`);
    const thumb = await request(app).get(`/api/species/pictures/${pictureIds[0]}/thumbnail`);

    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toMatch(/^image\//);
    expect(thumb.headers['cache-control']).toContain('max-age');

    const meta = await sharp(thumb.body).metadata();
    expect(meta.width).toBeLessThan(PICTURE_WIDTH);
    expect(thumb.body.length).toBeLessThan(full.body.length);
  });

  /**
   * The thumbnail ETag must be its own, or a client that has the thumbnail
   * cached would be told its full-size copy is current too.
   */
  it('gives the thumbnail its own ETag', async () => {
    const full = await request(app).get(`/api/species/pictures/${pictureIds[0]}`);
    const thumb = await request(app).get(`/api/species/pictures/${pictureIds[0]}/thumbnail`);

    expect(thumb.headers.etag).toBeTruthy();
    expect(thumb.headers.etag).not.toBe(full.headers.etag);

    const cached = await request(app)
      .get(`/api/species/pictures/${pictureIds[0]}/thumbnail`)
      .set('If-None-Match', thumb.headers.etag);

    expect(cached.status).toBe(304);
  });

  /**
   * Switching the default must move it, not add a second one -- a partial
   * unique index allows only one per species.
   */
  it('moves the default rather than adding a second', async () => {
    const res = await request(app).put(`/api/species/pictures/${pictureIds[1]}/default`);

    expect(res.status).toBe(200);
    expect(res.body.is_default).toBe(true);

    const all = await request(app).get(`/api/species/${speciesId}/pictures`);
    const defaults = all.body.filter((picture) => picture.is_default);

    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(pictureIds[1]);
  });

  /**
   * Deleting the default should promote another, so a species with pictures
   * always has one.
   */
  it('promotes another default when the default is deleted', async () => {
    const res = await request(app).delete(`/api/species/pictures/${pictureIds[1]}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pictureIds[1]);

    // The file must go too, not just the row.
    expect(fs.existsSync(path.join(STORAGE_DIR, res.body.filename))).toBe(false);

    const remaining = await request(app).get(`/api/species/${speciesId}/pictures`);
    expect(remaining.body).toHaveLength(1);
    expect(remaining.body[0].is_default).toBe(true);
    expect(remaining.body[0].id).toBe(pictureIds[0]);
  });

  /**
   * Deleting something that is not there is a 404 rather than a stack trace.
   */
  it('404s when deleting an unknown picture', async () => {
    const res = await request(app).delete('/api/species/pictures/999999999');

    expect(res.status).toBe(404);
  });
});
