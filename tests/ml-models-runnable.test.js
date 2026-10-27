/**
 * Which models a picker may offer for inference.
 *
 * **Found live, not predicted.** Driving the Inference tab in a browser showed its model
 * picker offering `yolo11m-cls` and `yolov8m-cls` — the two pretrained base models
 * registered that morning — alongside the trained detectors. Job submission refuses a
 * base model outright, so the picker was offering something the API would reject, and
 * underneath that is the reason the guard exists at all: a base model carries the
 * upstream vocabulary rather than MARP species, so running one over video would resolve
 * ImageNet class names against `species.comname` and write invented records into a
 * scientific record.
 *
 * **Two things are asserted here and the second matters as much as the first.** That
 * `runnable=inference` excludes base models, and that **the default still returns
 * everything** — a base model is a real registered model and the registry screen should
 * show it. Narrowing the default would be a silent change to what this route has always
 * returned, and the kind that is noticed only when a screen stops listing something.
 *
 * @fileoverview The model list's inference filter.
 * @author Isaac Travers
 * @module tests/ml-models-runnable
 */

'use strict';

const { QueryTypes } = require('sequelize');

const db = require('../model');

/** Unique per run, so a failed run's leftovers are recognisable. */
const runId = Date.now();

/** What this file created, torn down in reverse. */
const made = { baseId: null, trainedId: null };

/**
 * Run one statement.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Bound values.
 * @returns {Promise<Array<Object>>} Rows, when there are any.
 */
function query(sql, replacements = {}) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

beforeAll(async () => {
    const [base] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, is_base, created_at, updated_at)
         VALUES (:name, 'classification', 'active', false, true, NOW(), NOW())
         RETURNING id`,
        { name: `jest-runnable-base-${runId}` }
    );

    made.baseId = base.id;

    const [trained] = await query(
        `INSERT INTO ml_models (name, model_type, status, preferred, is_base, created_at, updated_at)
         VALUES (:name, 'detection', 'active', false, false, NOW(), NOW())
         RETURNING id`,
        { name: `jest-runnable-trained-${runId}` }
    );

    made.trainedId = trained.id;
});

afterAll(async () => {
    for (const id of [made.baseId, made.trainedId]) {
        if (id) await db.sequelize.query('DELETE FROM ml_models WHERE id = :id', { replacements: { id }, logging: false });
    }
});

describe('GET /ml_models', () => {
    it('offers every model by default, base ones included', async () => {
        // The published behaviour. A base model is a real registered model and the
        // registry screen should show it; narrowing this would be a silent contract
        // change noticed only when a screen stopped listing something.
        const res = await global.api.get('/api/v2/ml_models');

        expect(res.status).toBe(200);

        const ids = res.body.map((m) => m.id);

        expect(ids).toContain(made.baseId);
        expect(ids).toContain(made.trainedId);
    });

    it('excludes base models when asked what inference can run', async () => {
        const res = await global.api.get('/api/v2/ml_models?runnable=inference');

        expect(res.status).toBe(200);

        const ids = res.body.map((m) => m.id);

        expect(ids).not.toContain(made.baseId);
        expect(ids).toContain(made.trainedId);
    });

    it('carries is_base on every row, so a caller can tell without asking twice', async () => {
        const res = await global.api.get('/api/v2/ml_models');
        const base = res.body.find((m) => m.id === made.baseId);

        expect(base.is_base).toBe(true);
    });

    it('ignores a narrowing it does not know rather than refusing it', async () => {
        // A caller asking for something MARP has no concept of is better served the
        // whole list than a 400 it has no way to act on.
        const res = await global.api.get('/api/v2/ml_models?runnable=something_else');

        expect(res.status).toBe(200);
        expect(res.body.map((m) => m.id)).toContain(made.baseId);
    });
});
