/**
 * A habitat model keeps its decision rules, and a dataset can be built for one (#287).
 *
 * Settled with Isaac on 2026-11-10 (MARP_API#287):
 *
 * - **Habitat models are their own kind**, `model_type = 'habitat'` (question 4): a
 *   multi-label substrate classifier, kept apart from species detection and classification so
 *   no picker or check mistakes one for the other. `model_type` has no check constraint, so
 *   nothing changes there; `datasets.task`, which a trained model's type is read from, does,
 *   and gains `habitat`.
 * - **A model's cut-offs and stretch rules are stored with it** (question 3), in
 *   `ml_models.decision_rules`, shown on the Models screen and sent with each run. Shape and
 *   validation: `db/habitat-rules.js`. Null on every model that is not a habitat model.
 *
 * Both additions; no existing row changes. `down` removes them, and refuses while a habitat
 * dataset exists rather than leave a row the restored check would reject.
 *
 * Refs #287.
 *
 * @fileoverview Migration adding ml_models.decision_rules and the habitat dataset task.
 * @module migrations/a-habitat-model-keeps-its-rules
 */

'use strict';

/** What `datasets.task` allowed before this, and after. */
const BEFORE = ['detection', 'classification'];
const AFTER = [...BEFORE, 'habitat'];

const inList = (values) => values.map((value) => `'${value}'`).join(', ');

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (transaction) => {
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

            await q('ALTER TABLE ml_models ADD COLUMN decision_rules JSONB');
            await q(`COMMENT ON COLUMN ml_models.decision_rules IS
                'A habitat model''s decision rules (#287): its substrates in output order, the cut-off for each picked on its tuning dives, the crop and input size it was trained on, and the stretch rules (frames a second, averaging, raises, substrates never together, minimum stretch, bridged break). Sent to the worker with every run. Null on any other kind of model. Shape: db/habitat-rules.js.'`);

            await q('ALTER TABLE datasets DROP CONSTRAINT datasets_task_check');
            await q(`ALTER TABLE datasets ADD CONSTRAINT datasets_task_check CHECK (task IN (${inList(AFTER)}))`);
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (transaction) => {
            const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

            const [rows] = await q("SELECT count(*)::int AS n FROM datasets WHERE task = 'habitat'");
            if (rows[0].n > 0) {
                throw new Error(`${rows[0].n} habitat dataset(s) exist; the earlier check would reject them`);
            }
            await q('ALTER TABLE datasets DROP CONSTRAINT datasets_task_check');
            await q(`ALTER TABLE datasets ADD CONSTRAINT datasets_task_check CHECK (task IN (${inList(BEFORE)}))`);
            await q('ALTER TABLE ml_models DROP COLUMN decision_rules');
        });
    },
};
