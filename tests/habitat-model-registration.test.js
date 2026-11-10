/**
 * A trained habitat model is registered with its substrates and decision rules, sent to a run
 * with them, and kept apart from species engines (#287).
 *
 * Settled with Isaac on 2026-11-10 (MARP_API#287): habitat models are their own type,
 * `habitat`; a model's cut-offs and stretch rules are stored with it and sent with each run.
 *
 * Registration is called directly, inside a transaction this file rolls back, so nothing it
 * writes outlives the test. The publish path that calls it is covered by
 * `gpu-trained-model-registration.test.js`; what is new is the habitat branch inside it. The
 * two artifact files and the copied weights are removed afterwards.
 *
 * @fileoverview Tests for registering and running habitat models.
 * @module tests/habitat-model-registration
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('../model');
const { ARTIFACT_DIRECTORY, HABITAT_MODEL_TYPE, HABITAT_ENGINE } = require('../config/gpu-orchestration');
const { storageRoot } = require('../service/model-artifact.service');
const { registerTrainedModel } = require('../repository/trained-model.repository');
const habitatRules = require('../db/habitat-rules');
const gpuService = require('../service/gpu.service');

const runId = Date.now();
const { QueryTypes } = db.Sequelize;

/** The order the model's outputs follow: the dataset's class order. */
const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];

/** What a trainer publishes. */
const PUBLISHED = {
    substrates: SUBSTRATES,
    cut_offs: { Rock: 0.45, Mud: 0.5, Sand: 0.4, Cobble: 0.35, Boulder: 0.3 },
    crop: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1.0 },
    input_size: 518,
};

const written = [];

/** A file in the artifact store, content-addressed as the worker's upload leaves it. */
function storeArtifact(content) {
    const bytes = Buffer.from(content);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const file = path.join(ARTIFACT_DIRECTORY, hash);
    fs.mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });
    fs.writeFileSync(file, bytes);
    written.push(file);
    return hash;
}

/**
 * Register a habitat model from a finished training job, then roll everything back.
 *
 * @param {Object} options - `{ classes, rules }`: the dataset's class names (looked up on the
 *   Habitat list, or `[name, list]`), and the rules file to publish, or null for none.
 * @returns {Promise<Object>} `{ registered, model, species }`, read before the rollback.
 */
async function registerHabitat({ classes = SUBSTRATES, rules = PUBLISHED } = {}) {
    const transaction = await db.sequelize.transaction();
    const q = (sql, replacements) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction, logging: false });
    try {
        const [dataset] = await q(
            `INSERT INTO datasets (name, location, num_samples, num_classes, source, status, task, created_at, updated_at)
             VALUES (:name, 'test', 10, :n, 'test', 'ready', 'habitat', now(), now()) RETURNING id`,
            { name: `jest-habitat-${runId}`, n: classes.length }
        );
        for (const [index, entry] of classes.entries()) {
            const [name, list] = Array.isArray(entry) ? entry : [entry, 'Habitat'];
            let [species] = await q('SELECT id FROM species WHERE comname = :name AND species_list = :list ORDER BY id LIMIT 1', { name, list });
            // A substrate name on another list is made here when the database has none,
            // inside this transaction, so the check never depends on what is seeded.
            if (!species) {
                [species] = await q(
                    `INSERT INTO species (taxserial, comname, species, species_list, created_at, updated_at)
                     VALUES (:tax, :name, :name, :list, now(), now()) RETURNING id`,
                    { tax: 990000000 + (runId % 1000000), name, list }
                );
            }
            await q(
                `INSERT INTO dataset_classes (dataset_id, species_id, class_index, created_at, updated_at)
                 VALUES (:d, :s, :i, now(), now()) RETURNING dataset_id`,
                { d: dataset.id, s: species.id, i: index }
            );
        }
        const spec = { engine: 'marp_habitat_training', dataset: { dataset_id: dataset.id, name: `jest-habitat-${runId}` } };
        const [job] = await q(
            "INSERT INTO gpu_jobs (kind, spec, state) VALUES ('training', CAST(:spec AS jsonb), 'succeeded') RETURNING id, kind, spec",
            { spec: JSON.stringify(spec) }
        );
        const artifact = (role, hash) => q(
            `INSERT INTO artifacts (job_id, artifact_type, path, hash, created_at, updated_at)
             VALUES (:job, :role, :hash, :hash, now(), now()) RETURNING id`,
            { job: job.id, role, hash }
        );
        await artifact('weights', storeArtifact(`habitat-weights-${runId}-${Math.random()}`));
        if (rules) await artifact(habitatRules.RULES_ROLE, storeArtifact(typeof rules === 'string' ? rules : JSON.stringify(rules)));

        const registered = await registerTrainedModel({ db, job, transaction });
        const [model] = await q('SELECT * FROM ml_models WHERE id = :id', { id: registered.id });
        written.push(path.resolve(storageRoot(), path.dirname(path.dirname(model.storage_path))));
        const species = await q(
            `SELECT s.comname, s.species_list FROM model_species ms JOIN species s ON s.id = ms.species_id
              WHERE ms.model_id = :id ORDER BY ms.species_id`,
            { id: registered.id }
        );
        return { registered, model, species };
    } finally {
        await transaction.rollback();
    }
}

afterAll(() => {
    for (const file of written) fs.rmSync(file, { recursive: true, force: true });
});

describe('a habitat model\'s decision rules (db/habitat-rules.js)', () => {
    test('stores what training decided beside the settled stretch rules', () => {
        const rules = habitatRules.rulesForModel(PUBLISHED, SUBSTRATES);
        expect(rules).toMatchObject({
            version: 1,
            substrates: SUBSTRATES,
            tuned_cut_offs: PUBLISHED.cut_offs,
            crop: PUBLISHED.crop,
            input_size: 518,
            samples_per_second: 3,
            average_s: 1,
            raise: { Mud: 0.2 },
            // Stored whole (A18): Gravel too, though this model has none.
            exclusive: [['Mud', 'Sand', 'Gravel']],
            min_stretch_s: 2,
            bridge_s: 2,
        });
    });

    test('sends a run the cut-offs it applies: tuned, plus the raise, at most 0.95', () => {
        const run = habitatRules.rulesForRun(habitatRules.rulesForModel(
            { ...PUBLISHED, cut_offs: { ...PUBLISHED.cut_offs, Mud: 0.8 } }, SUBSTRATES
        ));
        expect(run.cut_offs).toEqual({ Rock: 0.45, Mud: 0.95, Sand: 0.4, Cobble: 0.35, Boulder: 0.3 });
        expect(habitatRules.effectiveCutOffs(habitatRules.rulesForModel(PUBLISHED, SUBSTRATES)).Mud).toBe(0.7);
    });

    test('sends a run the never-together group narrowed to the substrates the model has', () => {
        const run = habitatRules.rulesForRun(habitatRules.rulesForModel(PUBLISHED, SUBSTRATES));
        expect(run.exclusive).toEqual([['Mud', 'Sand']]);
    });

    test('refuses rules that do not describe the model', () => {
        const refused = (published) => () => habitatRules.rulesForModel(published, SUBSTRATES);
        expect(refused(null)).toThrow(habitatRules.HabitatRulesError);
        expect(refused({ ...PUBLISHED, substrates: [...SUBSTRATES].reverse() })).toThrow(/in that order/);
        expect(refused({ ...PUBLISHED, cut_offs: { ...PUBLISHED.cut_offs, Sand: 1.4 } })).toThrow(/Sand/);
        expect(refused({ ...PUBLISHED, crop: { x0: 0.75, y0: 0.5, x1: 0.25, y1: 1 } })).toThrow(/crop/);
        expect(refused({ ...PUBLISHED, input_size: 0 })).toThrow(/input size/);
    });
});

describe('registering a trained habitat model', () => {
    test('is a habitat model with its five substrates and its rules', async () => {
        const { model, species } = await registerHabitat();

        expect(model.model_type).toBe(HABITAT_MODEL_TYPE);
        expect(model.decision_rules).toEqual(habitatRules.rulesForModel(PUBLISHED, SUBSTRATES));
        // All five from the Habitat list, though "Sand" is also a species on another list.
        expect(species.map((s) => s.comname).sort()).toEqual([...SUBSTRATES].sort());
        expect(new Set(species.map((s) => s.species_list))).toEqual(new Set(['Habitat']));
    });

    test('is refused when the trainer published no rules, since it could not be run', async () => {
        await expect(registerHabitat({ rules: null })).rejects.toThrow(/published no decision_rules/);
        await expect(registerHabitat({ rules: '{not json' })).rejects.toThrow(/cannot be read/);
    });

    test('is refused when a class is not on the Habitat list', async () => {
        // A "Sand" from another list, as the development database has on MBARI_315k.
        await expect(registerHabitat({ classes: ['Rock', 'Mud', ['Sand', `Jest-${runId}`], 'Cobble', 'Boulder'] }))
            .rejects.toThrow(/off the Habitat list: Sand \(Jest-/);
    });
});

describe('a habitat model runs on the habitat engine, and nothing else does', () => {
    const habitatModel = { name: 'jest habitat', model_type: HABITAT_MODEL_TYPE, decision_rules: {} };
    const speciesModel = { name: 'jest detector', model_type: 'detection', decision_rules: null };
    const ingestRepository = require('../repository/observation-ingest.repository');
    const withModel = (row) => jest.spyOn(ingestRepository, 'getModel').mockResolvedValue(row);
    afterEach(() => jest.restoreAllMocks());

    test('a habitat model on the species engine is refused', async () => {
        withModel(habitatModel);
        await expect(gpuService.refuseMismatchedHabitatModel({ engine: 'marp_tracking', model: { ml_model_id: 1 } }))
            .rejects.toThrow(/habitat model and runs on the marp_habitat engine/);
    });

    test('a species model on the habitat engine is refused', async () => {
        withModel(speciesModel);
        await expect(gpuService.refuseMismatchedHabitatModel({ engine: HABITAT_ENGINE, model: { ml_model_id: 1 } }))
            .rejects.toThrow(/runs habitat models only/);
    });

    test('a habitat model with no rules is refused', async () => {
        withModel({ ...habitatModel, decision_rules: null });
        await expect(gpuService.refuseMismatchedHabitatModel({ engine: HABITAT_ENGINE, model: { ml_model_id: 1 } }))
            .rejects.toThrow(/no decision rules/);
    });

    test('each on its own engine passes', async () => {
        withModel(habitatModel);
        await expect(gpuService.refuseMismatchedHabitatModel({ engine: HABITAT_ENGINE, model: { ml_model_id: 1 } })).resolves.toBeUndefined();
        withModel(speciesModel);
        await expect(gpuService.refuseMismatchedHabitatModel({ engine: 'marp_tracking', model: { ml_model_id: 1 } })).resolves.toBeUndefined();
    });

    test('a habitat model\'s lease carries its rules with the cut-offs to apply', async () => {
        const stored = habitatRules.rulesForModel(PUBLISHED, SUBSTRATES);
        const gpuRepository = require('../repository/gpu.repository');
        const modelArtifactService = require('../service/model-artifact.service');
        jest.spyOn(modelArtifactService, 'describeIfUnrecordedById').mockResolvedValue(undefined);
        jest.spyOn(gpuRepository, 'modelForLease').mockResolvedValue({
            model_type: HABITAT_MODEL_TYPE, architecture_version: 'vit_base_patch14_dinov2', decision_rules: stored,
        });

        const spec = await gpuService.describeModelForLease({ engine: HABITAT_ENGINE, model: { ml_model_id: 1 } });

        expect(spec.model.task).toBe(HABITAT_MODEL_TYPE);
        expect(spec.model.decision_rules).toEqual(habitatRules.rulesForRun(stored));
        expect(spec.model.decision_rules.cut_offs.Mud).toBe(0.7);
    });
});

describe('changing a habitat model\'s never-together groups (R9)', () => {
    let habitatId;
    let detectorId;
    const route = (id) => `/api/v2/model/${id}/never-together`;

    beforeAll(async () => {
        const insert = async (name, type, rules) => (await db.sequelize.query(
            `INSERT INTO ml_models (name, model_type, status, decision_rules, created_at, updated_at)
             VALUES (:name, :type, 'active', CAST(:rules AS jsonb), now(), now()) RETURNING id`,
            { replacements: { name, type, rules: rules ? JSON.stringify(rules) : null }, type: QueryTypes.SELECT }
        ))[0].id;
        habitatId = await insert(`jest-habitat-rules-${runId}`, HABITAT_MODEL_TYPE, habitatRules.rulesForModel(PUBLISHED, SUBSTRATES));
        detectorId = await insert(`jest-detector-rules-${runId}`, 'detection', null);
    });

    afterAll(async () => {
        await db.sequelize.query('DELETE FROM ml_models WHERE id IN (:ids)', { replacements: { ids: [habitatId, detectorId] } });
    });

    const stored = async () => (await db.sequelize.query(
        'SELECT decision_rules FROM ml_models WHERE id = :id', { replacements: { id: habitatId }, type: QueryTypes.SELECT }
    ))[0].decision_rules;

    test('replaces the groups and nothing else in the rules', async () => {
        const res = await global.api.put(route(habitatId)).send({ groups: [['Mud', 'Sand'], ['Cobble', 'Boulder']] });
        expect(res.status).toBe(200);
        const rules = await stored();
        expect(rules.exclusive).toEqual([['Mud', 'Sand'], ['Cobble', 'Boulder']]);
        expect(rules.tuned_cut_offs).toEqual(PUBLISHED.cut_offs);

        // Gravel, though this model has none, and an empty list meaning none.
        await global.api.put(route(habitatId)).send({ groups: [['Mud', 'Sand', 'Gravel']] }).expect(200);
        expect((await stored()).exclusive).toEqual([['Mud', 'Sand', 'Gravel']]);
        await global.api.put(route(habitatId)).send({ groups: [] }).expect(200);
        expect((await stored()).exclusive).toEqual([]);
    });

    test('refuses a group it cannot apply, and changes nothing', async () => {
        await global.api.put(route(habitatId)).send({ groups: [['Mud', 'Sand', 'Gravel']] }).expect(200);
        for (const groups of [[['Mud']], [['Mud', 'Kelp']], [['Mud', 'Mud']], 'Mud, Sand', undefined]) {
            const res = await global.api.put(route(habitatId)).send({ groups });
            expect(res.status).toBe(400);
        }
        expect((await stored()).exclusive).toEqual([['Mud', 'Sand', 'Gravel']]);
    });

    test('refuses a model that is not a habitat model, and one that does not exist', async () => {
        await global.api.put(route(detectorId)).send({ groups: [['Mud', 'Sand']] }).expect(400);
        await global.api.put(route(2147483000)).send({ groups: [['Mud', 'Sand']] }).expect(404);
    });
});
