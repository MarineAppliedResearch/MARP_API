/**
 * Endpoint tests for the model_species CRUD API.
 *
 * Full lifecycle test for the MARP API test suite: create, update, get by
 * id, then delete. model_species requires both an existing model_id and
 * species_id (model/model_species.model.js), so this suite builds
 * disposable parent ml_model and species records and tears them all down
 * afterward, in reverse order.
 *
 * @fileoverview Endpoint tests for POST/PUT/GET/DELETE /api/model_species.
 * @author Isaac Travers
 * @module tests/model_species
 */

const request = require('supertest');
const app = require('../app');

/**
 * Verifies the full create -> update -> get -> delete lifecycle for a
 * model_species record.
 */
describe('Model species lifecycle', () => {

  /**
   * Unique per test run so it's easy to distinguish in the dev database
   * while this suite runs.
   *
   * @constant
   * @type {string}
   */
  const uniqueTag = `jest-pilot-modelspecies-${Date.now()}`;

  /**
   * Unique per test run, kept within Postgres INTEGER range, to satisfy
   * the unique constraint on species.taxserial.
   *
   * @constant
   * @type {number}
   */
  const taxserial = Date.now() % 2000000000;

  /**
   * id of the disposable parent ml_model created in beforeAll.
   *
   * @type {number|undefined}
   */
  let modelId;

  /**
   * id of the disposable parent species created in beforeAll.
   *
   * @type {number|undefined}
   */
  let speciesId;

  /**
   * id of the model_species record created below, used by the update/
   * get/delete steps and cleaned up in afterAll.
   *
   * @type {number|undefined}
   */
  let modelSpeciesId;

  /**
   * Creates the disposable parent ml_model and species the model_species
   * record will reference.
   */
  beforeAll(async () => {
    const modelRes = await request(app)
      .post('/api/model')
      .send({ model: { name: uniqueTag, model_type: 'yolov8' } });
    modelId = modelRes.body.id;

    const speciesRes = await request(app)
      .post('/api/species')
      .send({ species: { taxserial, comname: 'Jest ModelSpecies Parent' } });
    speciesId = speciesRes.body.id;
  });

  /**
   * Deletes the model_species record, species, and model created by this
   * suite, in case the "deletes the model_species record" test below
   * didn't already remove the join record.
   */
  afterAll(async () => {
    if (modelSpeciesId) {
      await request(app).delete(`/api/model_species/${modelSpeciesId}`);
    }
    if (speciesId) {
      await request(app).delete(`/api/species/${speciesId}`);
    }
    if (modelId) {
      await request(app).delete(`/api/model/${modelId}`);
    }
  });

  /**
   * POST /api/model_species should insert a new model_species row and
   * return it.
   */
  it('creates a model_species record', async () => {
    const res = await request(app)
      .post('/api/model_species')
      .send({ model_id: modelId, species_id: speciesId });

    expect(res.status).toBe(200);
    expect(res.body.model_id).toBe(modelId);
    expect(res.body.species_id).toBe(speciesId);
    expect(res.body.id).toEqual(expect.any(Number));

    modelSpeciesId = res.body.id;
  });

  /**
   * PUT /api/model_species/:id should update the join record's fields by
   * id.
   */
  it('updates the model_species record', async () => {
    const res = await request(app)
      .put(`/api/model_species/${modelSpeciesId}`)
      .send({ notes: 'updated by jest' });

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('updated by jest');
  });

  /**
   * GET /api/model_species/:id should return the join record, reflecting
   * the update above.
   */
  it('gets the model_species record by id', async () => {
    const res = await request(app).get(`/api/model_species/${modelSpeciesId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(modelSpeciesId);
    expect(res.body.notes).toBe('updated by jest');
  });

  /**
   * DELETE /api/model_species/:id should remove the join record, leaving
   * no trace in the dev database.
   */
  it('deletes the model_species record', async () => {
    const res = await request(app).delete(`/api/model_species/${modelSpeciesId}`);

    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/model_species/${modelSpeciesId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(getRes.body.error.status).toBe(404);
    expect(typeof getRes.body.error.requestId).toBe('string');
  });
});
