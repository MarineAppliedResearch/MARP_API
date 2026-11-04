/**
 * The model registry says what each model is (#321).
 *
 * Settled with Isaac on 2026-10-31: task, engine and architecture are read from the
 * weights; a version is a free label; status is active or archived; Register Model uploads
 * weights; and class names that match no species register with a warning.
 *
 * The weights are `tests/fixtures/models/*.pt`, written by `make-fixtures.py` with
 * `torch.save` exactly as a real checkpoint is, around stand-in Ultralytics classes.
 *
 * @fileoverview Model weights reading, upload, hash-checked serving, status and lease.
 * @author Isaac Travers
 * @module tests/ml-model-registry
 */

'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const db = require('../model');
const gpuService = require('../service/gpu.service');
const { describeWeights } = require('../service/model-weights.service');
const { rewrite } = require('../migrations/20261031130000-a-model-says-what-it-is');

const runId = Date.now();
const FIXTURES = path.join(__dirname, 'fixtures', 'models');
const made = { modelIds: [], speciesId: null, root: null };

beforeAll(async () => {
    made.root = await fs.mkdtemp(path.join(os.tmpdir(), 'marp-model-registry-'));
    process.env.MODEL_STORAGE_ROOT = made.root;

    const [species] = await db.sequelize.query(
        `INSERT INTO species (taxserial, comname, species_list, created_at, updated_at)
         VALUES (:taxserial, 'jest-321 urchin', :list, NOW(), NOW()) RETURNING id`,
        { replacements: { taxserial: 930000000 + (runId % 100000), list: `jest-list-${runId}` }, type: db.Sequelize.QueryTypes.SELECT }
    );
    made.speciesId = species.id;
});

afterAll(async () => {
    const drop = (sql, replacements) => db.sequelize.query(sql, { replacements, logging: false });
    if (made.modelIds.length) {
        await drop('DELETE FROM model_species WHERE model_id IN (:ids)', { ids: made.modelIds });
        await drop('DELETE FROM ml_models WHERE id IN (:ids)', { ids: made.modelIds });
    }
    if (made.speciesId) await drop('DELETE FROM species WHERE id = :id', { id: made.speciesId });
    delete process.env.MODEL_STORAGE_ROOT;
    await fs.rm(made.root, { recursive: true, force: true });
});

/** Upload a fixture as a model. */
const upload = (fixture, fields) => {
    let call = global.api.post('/api/v2/model/upload').attach('weights', path.join(FIXTURES, fixture));
    for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
    return call;
};

describe('What the weights say (#321)', () => {

    it('reads the task, engine, architecture and class names from a checkpoint', () => {
        expect(describeWeights(path.join(FIXTURES, 'tiny-detector.pt'))).toMatchObject({
            engine: 'ultralytics',
            architecture: 'yolo11n',
            task: 'detection',
            file_format: 'pt',
            class_names: ['jest-321 urchin', 'jest-321 not a species'],
        });
    });

    it('recognises an older checkpoint\'s architecture from its blocks and multiples', () => {
        expect(describeWeights(path.join(FIXTURES, 'tiny-classifier.pt'))).toMatchObject({
            architecture: 'yolov8m-cls',
            task: 'classification',
        });
    });

    it('refuses a file that is not a torch checkpoint', () => {
        expect(() => describeWeights(__filename)).toThrow(/not a zip/);
    });
});

describe('The migration rewrites in place, originals to notes (#321)', () => {

    it('an older YOLOv8 model becomes an active ultralytics detector, saying what it was', () => {
        expect(rewrite({ model_type: 'YOLOv8', architecture_version: 'mixed', status: 'trained', engine: null })).toEqual({
            model_type: 'detection',
            architecture_version: 'yolov8',
            status: 'active',
            engine: 'ultralytics',
            note: "Before #321: model_type was 'YOLOv8'; architecture_version was 'mixed'; status was 'trained'.",
        });
    });

    it('a checkpoint name is not an architecture, and a status nothing sets is archived', () => {
        expect(rewrite({ model_type: 'detection', architecture_version: 'rockfish2', status: 'draft', engine: null })).toMatchObject({
            architecture_version: null,
            status: 'archived',
            note: "Before #321: architecture_version was 'rockfish2'; status was 'draft'.",
        });
    });

    it('a row that already says what it is is left alone', () => {
        expect(rewrite({ model_type: 'classification', architecture_version: 'yolo11m-cls', status: 'active', engine: null }).note).toBeNull();
    });
});

describe('Register Model uploads weights (#321)', () => {

    let registered;

    it('registers the model with what its weights say, and the species that matched', async () => {
        const response = await upload('tiny-detector.pt', { name: `jest-321-detector-${runId}`, version_label: 'v1 test' });

        expect(response.status).toBe(201);
        registered = response.body.model;
        made.modelIds.push(registered.id);

        expect(registered).toMatchObject({
            model_type: 'detection',
            architecture_version: 'yolo11n',
            engine: 'ultralytics',
            file_format: 'pt',
            status: 'active',
            version_label: 'v1 test',
        });
        expect(registered.artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(response.body.matched).toEqual([{ class_name: 'jest-321 urchin', species_id: made.speciesId }]);

        // Registered anyway, with a warning naming what matched nothing (Isaac, 2026-10-31).
        expect(response.body.unmatched).toEqual([{ class_name: 'jest-321 not a species', matches: 0 }]);
    });

    it('serves the stored weights, and lists them as present with their size', async () => {
        const served = await global.api.get(`/api/v2/model/${registered.id}/artifact`).buffer(true).parse((res, done) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
        });
        expect(served.status).toBe(200);
        expect(served.body.equals(await fs.readFile(path.join(FIXTURES, 'tiny-detector.pt')))).toBe(true);

        const listed = await global.api.get(`/api/v2/model/${registered.id}`);
        expect(listed.body.weights).toEqual({ present: true, bytes: served.body.length });
    });

    it('refuses to serve weights that are not the ones registered', async () => {
        await db.sequelize.query('UPDATE ml_models SET artifact_sha256 = :sha WHERE id = :id',
            { replacements: { sha: 'f'.repeat(64), id: registered.id } });

        expect((await global.api.get(`/api/v2/model/${registered.id}/artifact`)).status).toBe(409);

        await db.sequelize.query('UPDATE ml_models SET artifact_sha256 = :sha WHERE id = :id',
            { replacements: { sha: registered.artifact_sha256, id: registered.id } });
    });

    it('refuses a name already registered, and a file that is not a model', async () => {
        expect((await upload('tiny-detector.pt', { name: `jest-321-detector-${runId}` })).status).toBe(409);
        expect((await upload('make-fixtures.py', { name: `jest-321-not-a-model-${runId}` })).status).toBe(400);
        expect((await upload('tiny-detector.pt', {})).status).toBe(400);
    });

    it('tells a leased job\'s worker the architecture and task', async () => {
        const spec = await gpuService.describeModelForLease({ model: { name: 'm.pt', sha256: 'a'.repeat(64), ml_model_id: registered.id } });

        expect(spec.model).toMatchObject({ architecture: 'yolo11n', task: 'detection' });
    });

    it('takes a version label and archives, and archived is not offered for inference', async () => {
        const labelled = await global.api.put(`/api/v2/model/${registered.id}`).send({ model: { version_label: 'v2' } });
        expect(labelled.body.version_label).toBe('v2');

        const runnable = async () => (await global.api.get('/api/v2/ml_models?runnable=inference')).body.map((one) => one.id);
        expect(await runnable()).toContain(registered.id);

        const archived = await global.api.put(`/api/v2/model/${registered.id}`).send({ model: { status: 'archived' } });
        expect(archived.body.status).toBe('archived');
        expect(await runnable()).not.toContain(registered.id);

        expect((await global.api.put(`/api/v2/model/${registered.id}`).send({ model: { status: 'trained' } })).status)
            .toBeGreaterThanOrEqual(400);
    });
});

describe('The API records what weights say by itself (#321)', () => {

    const modelArtifactService = require('../service/model-artifact.service');

    /** A model row whose weights are a copy of one fixture, with nothing recorded. */
    async function unrecorded(name, fixture, extra = {}) {
        const relative = `models/${name}/weights/${name}.pt`;
        await fs.mkdir(path.join(made.root, path.dirname(relative)), { recursive: true });
        if (fixture) await fs.copyFile(path.join(FIXTURES, fixture), path.join(made.root, relative));
        else await fs.writeFile(path.join(made.root, relative), 'not a checkpoint');

        const row = await db.ml_models.create({ name, model_type: 'detection', storage_path: relative, status: 'active', ...extra });
        made.modelIds.push(row.id);
        return row.id;
    }

    const recorded = async (id) => (await db.ml_models.findByPk(id)).get({ plain: true });

    it('fills a model the first time it is read, and keeps it', async () => {
        const id = await unrecorded(`jest-321-unrecorded-${runId}`, 'tiny-detector.pt');

        const response = await global.api.get(`/api/v2/model/${id}`);

        expect(response.body).toMatchObject({ engine: 'ultralytics', architecture_version: 'yolo11n', file_format: 'pt' });
        expect(await recorded(id)).toMatchObject({ engine: 'ultralytics', architecture_version: 'yolo11n', file_format: 'pt' });
    });

    it('fills every unrecorded model at startup, making an older row exact', async () => {
        const id = await unrecorded(`jest-321-older-${runId}`, 'tiny-classifier.pt',
            { model_type: 'classification', architecture_version: 'yolov8', engine: 'ultralytics' });

        const sweep = await modelArtifactService.describeAllUnrecorded();

        expect(sweep.filled).toBeGreaterThanOrEqual(1);
        expect(await recorded(id)).toMatchObject({ architecture_version: 'yolov8m-cls', file_format: 'pt' });
    });

    it('leaves a file it cannot read as it was', async () => {
        const id = await unrecorded(`jest-321-unreadable-${runId}`, null);

        await modelArtifactService.describeAllUnrecorded();

        expect(await recorded(id)).toMatchObject({ engine: null, architecture_version: null, file_format: null });
    });

    it('fills a model a job is leased against before telling the worker', async () => {
        const id = await unrecorded(`jest-321-leased-${runId}`, 'tiny-detector.pt');

        const spec = await gpuService.describeModelForLease({ model: { name: 'm.pt', sha256: 'a'.repeat(64), ml_model_id: id } });

        expect(spec.model).toMatchObject({ architecture: 'yolo11n', task: 'detection' });
    });
});
