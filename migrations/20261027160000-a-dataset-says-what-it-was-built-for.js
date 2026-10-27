/**
 * A dataset says which task it was built for, and how its pictures were cut.
 *
 * **Every dataset MARP has built so far is a detection dataset, and nothing in the row
 * said so** -- it did not need to, because there was only one kind. A classification
 * dataset is a different thing on disk (class folders, no `data.yaml`) and a different
 * thing to train, so a reader that cannot tell them apart will hand one to the wrong
 * trainer. The existing rows are backfilled to `detection`, which is what they are.
 *
 * **`crop_source` is the requirement that came out of the worker's objection**, and it is
 * worth writing down why it is a column rather than a convention. A classification build
 * turns one annotated box into one picture, and *which pixels* is a judgement: the mosaic
 * tile a reviewer actually saw, a tighter crop, the whole frame. Baking that in with
 * nothing in the record to say what was chosen produces two datasets that look identical
 * and trained on different things. So the build records it, and a model trained on one of
 * these can be traced to the pixels it learned from.
 *
 * **`task` has a check constraint and `crop_source` deliberately does not.** They are
 * different kinds of value. `task` is the schema's own vocabulary -- two words that the
 * dashboard, the worker and this table all have to agree on -- and a third one arriving
 * should be a migration that everybody notices. `crop_source` is a record of what a build
 * did, and the lesson from `gpu_attempt_settings.source` earlier today is exact: a value
 * the gate did not know cost the entire report it arrived in. A crop method this database
 * has not seen must be recorded, not refused, because refusing it loses the only evidence
 * of how those pictures were made.
 *
 * Null `crop_source` means nothing cut anything -- a detection dataset holds whole frames.
 *
 * Refs MarineAppliedResearch/MARP_API#268
 *
 * @fileoverview Migration adding datasets.task and datasets.crop_source.
 * @module migrations/a-dataset-says-what-it-was-built-for
 */

/** What `task` may say. Two, because MARP trains two kinds of model. */
const TASKS = ['detection', 'classification'];

/**
 * Renders a list as a SQL `IN (...)` body. Every value here is a constant in this file.
 *
 * @param {Array<string>} values - Allowed values.
 * @returns {string} Quoted, comma-separated values.
 */
function inList(values) {
    return values.map((value) => `'${value}'`).join(', ');
}

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                `ALTER TABLE datasets
                   ADD COLUMN IF NOT EXISTS task VARCHAR(16),
                   ADD COLUMN IF NOT EXISTS crop_source VARCHAR(32)`,
                { transaction }
            );

            /* **Backfilled before the column is made NOT NULL**, and the value is a fact
               rather than a default: every dataset built before this migration came out of
               the frame-cutting path, which is detection. */
            const [, filled] = await sequelize.query(
                "UPDATE datasets SET task = 'detection' WHERE task IS NULL",
                { transaction }
            );

            console.log(`[dataset-task] up: named ${filled?.rowCount ?? 0} existing dataset(s) detection`);

            await sequelize.query(
                `ALTER TABLE datasets
                   ALTER COLUMN task SET NOT NULL,
                   ALTER COLUMN task SET DEFAULT 'detection'`,
                { transaction }
            );

            await sequelize.query(
                `ALTER TABLE datasets
                   ADD CONSTRAINT datasets_task_check CHECK (task IN (${inList(TASKS)}))`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON COLUMN datasets.task IS
                 'Which kind of model this dataset was built to train. A detection dataset holds whole frames with YOLO label files and a data.yaml; a classification dataset holds one picture per annotated box, in a folder named for its class, with no data.yaml. Backfilled to detection, which is what every dataset built before this column was.'`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON COLUMN datasets.crop_source IS
                 'How a classification dataset''s pictures were cut from their frames, e.g. mosaic_thumbnail for the observation thumbnail a reviewer sees. Null on a detection dataset, which holds whole frames and crops nothing. Recorded rather than assumed: which pixels a crop took is a judgement, and two datasets made by different judgements look identical without this.'`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            /* Dropping the columns loses which datasets were classification, and that is
               not recoverable from the rest of the row -- so the down says it rather than
               leaving somebody to find out. */
            const [rows] = await sequelize.query(
                "SELECT count(*)::int AS n FROM datasets WHERE task = 'classification'",
                { transaction }
            );

            console.log(
                `[dataset-task] down: ${rows?.[0]?.n ?? 0} classification dataset(s) `
                + 'will no longer say so; their archives still hold class folders.'
            );

            await sequelize.query(
                'ALTER TABLE datasets DROP CONSTRAINT IF EXISTS datasets_task_check',
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE datasets
                   DROP COLUMN IF EXISTS task,
                   DROP COLUMN IF EXISTS crop_source`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
