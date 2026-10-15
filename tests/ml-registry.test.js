/**
 * What the model registry can now say about itself (#104, gap 28).
 *
 * Three things the screens assumed and the API did not have: which model is
 * preferred, what a model's version chain is, and whether a dataset is still
 * building. Plus a fourth that was simply missing -- `/v2/training_run` could
 * create a run and fetch one by id, and had no way to find one, so no screen
 * could show a training history at all.
 *
 * The version chain is the part worth testing properly. `ml_models` has no
 * versions array: a chain is `parent_model_id` and has to be walked, and the
 * walk goes **up to the root and then back down**, so that asking about a
 * version in the middle returns its ancestors as well as its descendants. A
 * test that only asked the root would pass on a walk that went one way.
 *
 * @fileoverview Route tests for preferred models, version chains, dataset status and run listing.
 * @author Isaac Travers
 * @module tests/ml-registry
 */

const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run. @type {string} */
const marker = `registry-${Date.now()}`;

/** Model ids created here, removed youngest first in afterAll. @type {Array<number>} */
const createdModelIds = [];

/** Dataset ids created here. @type {Array<number>} */
const createdDatasetIds = [];

/** Training run ids created here. @type {Array<number>} */
const createdRunIds = [];

/**
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Selected rows.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * Put a model in the registry.
 *
 * @param {Object} options
 * @param {string} options.suffix - Distinguishes it within this run.
 * @param {string} options.modelType - Its `model_type`.
 * @param {?number} [options.parentId] - The version it descends from.
 * @param {boolean} [options.preferred] - Whether it is the preferred one of its type.
 * @returns {Promise<number>} Its id.
 */
async function addModel({ suffix, modelType, parentId = null, preferred = false }) {
    const [model] = await query(
        `INSERT INTO ml_models (name, model_type, parent_model_id, status, preferred, created_at, updated_at)
         VALUES (:name, :modelType, :parentId, 'trained', :preferred, NOW(), NOW())
         RETURNING id`,
        { name: `${marker}-${suffix}`, modelType, parentId, preferred }
    );

    createdModelIds.push(model.id);

    return model.id;
}

afterAll(async () => {
    if (createdRunIds.length) {
        await db.sequelize.query('DELETE FROM training_runs WHERE id IN (:ids)', {
            replacements: { ids: createdRunIds },
        });
    }

    if (createdDatasetIds.length) {
        await db.sequelize.query('DELETE FROM datasets WHERE id IN (:ids)', {
            replacements: { ids: createdDatasetIds },
        });
    }

    /* Youngest first: a parent cannot go while a child still points at it. */
    for (const id of [...createdModelIds].reverse()) {
        await db.sequelize.query('DELETE FROM ml_models WHERE id = :id', { replacements: { id } });
    }
});

describe('R6 — a model can be preferred, one per type', () => {
    test('the flag reads back off the registry', async () => {
        const id = await addModel({ suffix: 'pref-a', modelType: `${marker}-detect`, preferred: true });

        const response = await global.api.get('/api/v2/ml_models');

        expect(response.status).toBe(200);

        const mine = response.body.find((model) => model.id === id);

        expect(mine.preferred).toBe(true);
    });

    test('a model is not preferred unless it says so', async () => {
        const id = await addModel({ suffix: 'pref-b', modelType: `${marker}-detect` });

        const [model] = await query('SELECT preferred FROM ml_models WHERE id = :id', { id });

        expect(model.preferred).toBe(false);
    });

    test('a second preferred model of the same type is refused', async () => {
        /* The constraint, not the application, is what has to hold this: a
           check in a service is bypassed by the next caller that does not
           call it. */
        await expect(
            addModel({ suffix: 'pref-c', modelType: `${marker}-detect`, preferred: true })
        ).rejects.toThrow();
    });

    test('another model type has its own preferred model', async () => {
        const id = await addModel({ suffix: 'pref-d', modelType: `${marker}-segment`, preferred: true });

        const [model] = await query('SELECT preferred FROM ml_models WHERE id = :id', { id });

        expect(model.preferred).toBe(true);
    });
});

describe('R7 — a model\'s version chain', () => {
    /** The three-deep chain, oldest first. @type {Array<number>} */
    const chain = [];

    beforeAll(async () => {
        const first = await addModel({ suffix: 'v1', modelType: `${marker}-chain` });
        const second = await addModel({ suffix: 'v2', modelType: `${marker}-chain`, parentId: first });
        const third = await addModel({ suffix: 'v3', modelType: `${marker}-chain`, parentId: second });

        chain.push(first, second, third);
    });

    test('asking the root returns the whole chain, oldest first', async () => {
        const response = await global.api.get(`/api/v2/ml_models/${chain[0]}/versions`);

        expect(response.status).toBe(200);
        expect(response.body.map((model) => model.id)).toEqual(chain);
    });

    test('asking the middle version returns its ancestors as well as its children', async () => {
        const response = await global.api.get(`/api/v2/ml_models/${chain[1]}/versions`);

        /* The half a one-directional walk would miss. A version three along is
           still one of the model's versions. */
        expect(response.body.map((model) => model.id)).toEqual(chain);
    });

    test('asking the newest version returns the whole chain too', async () => {
        const response = await global.api.get(`/api/v2/ml_models/${chain[2]}/versions`);

        expect(response.body.map((model) => model.id)).toEqual(chain);
    });

    test('a model with no parent and no child is its own chain', async () => {
        const lonely = await addModel({ suffix: 'lonely', modelType: `${marker}-lonely` });

        const response = await global.api.get(`/api/v2/ml_models/${lonely}/versions`);

        expect(response.body.map((model) => model.id)).toEqual([lonely]);
    });

    test('an unknown model is a 404, not an empty list', async () => {
        const response = await global.api.get('/api/v2/ml_models/999999999/versions');

        /* Empty would read as "a model with no versions", which cannot happen:
           a model is always in its own chain. */
        expect(response.status).toBe(404);
    });
});

describe('R8 — a dataset says whether it is built', () => {
    test('a new dataset starts as a draft', async () => {
        const [dataset] = await query(
            `INSERT INTO datasets (name, created_at, updated_at)
             VALUES (:name, NOW(), NOW()) RETURNING id, status`,
            { name: `${marker}-dataset` }
        );

        createdDatasetIds.push(dataset.id);

        expect(dataset.status).toBe('draft');
    });

    test('the four states round-trip through the listing', async () => {
        const id = createdDatasetIds[0];

        for (const status of ['building', 'ready', 'failed', 'draft']) {
            await db.sequelize.query('UPDATE datasets SET status = :status WHERE id = :id', {
                replacements: { status, id },
            });

            const response = await global.api.get('/api/v2/dataset');
            const mine = response.body.find((dataset) => dataset.id === id);

            expect(mine.status).toBe(status);
        }
    });
});

describe('R8 — the backfill does not describe a finished dataset as unstarted', () => {
    test('a dataset that existed before the column becomes ready, not draft', async () => {
        /* The migration's backfill ran against an empty table on this machine,
           so observing the database proves nothing about it. This runs the
           statement itself, against a row that looks like one that predates the
           column, inside a transaction that is rolled back -- so the claim is
           tested without the database keeping any of it.

           It matters because the column's default is `draft`, and every dataset
           that already exists is a finished one with its sample count filled in.
           Taking the default would have made the API start describing complete
           datasets as unstarted, which is a value becoming wrong rather than an
           application breaking. */
        const transaction = await db.sequelize.transaction();

        try {
            const [[existing]] = await db.sequelize.query(
                `INSERT INTO datasets (name, num_samples, status, created_at, updated_at)
                 VALUES (:name, 4200, 'draft', NOW(), NOW())
                 RETURNING id, status`,
                { replacements: { name: `${marker}-pre-existing` }, transaction }
            );

            expect(existing.status).toBe('draft');

            // Verbatim from 20261015120100, which is the point.
            await db.sequelize.query("UPDATE datasets SET status = 'ready'", { transaction });

            const [[after]] = await db.sequelize.query(
                'SELECT status FROM datasets WHERE id = :id',
                { replacements: { id: existing.id }, transaction }
            );

            expect(after.status).toBe('ready');
        } finally {
            await transaction.rollback();
        }
    });
});

describe('R9 — training runs can be listed', () => {
    /** @type {number} */
    let modelId;

    beforeAll(async () => {
        modelId = await addModel({ suffix: 'runs', modelType: `${marker}-runs` });

        for (const notes of ['first', 'second']) {
            const [run] = await query(
                `INSERT INTO training_runs (model_id, notes, created_at, updated_at)
                 VALUES (:modelId, :notes, NOW(), NOW()) RETURNING id`,
                { modelId, notes: `${marker}-${notes}` }
            );

            createdRunIds.push(run.id);
        }
    });

    test('the collection read exists at all', async () => {
        const response = await global.api.get('/api/v2/training_run');

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
    });

    test('narrowing by model returns only that model\'s runs', async () => {
        const response = await global.api.get('/api/v2/training_run').query({ model_id: modelId });

        expect(response.body.map((run) => run.id).sort()).toEqual([...createdRunIds].sort());
        for (const run of response.body) {
            expect(run.model_id).toBe(modelId);
        }
    });

    test('runs come back newest first', async () => {
        const response = await global.api.get('/api/v2/training_run').query({ model_id: modelId });
        const times = response.body.map((run) => new Date(run.created_at).getTime());

        expect(times).toEqual([...times].sort((a, b) => b - a));
    });
});
