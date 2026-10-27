'use strict';

/**
 * A fourth setting source: `resolved`, the value the engine actually ran with.
 *
 * `gpu_attempt_settings.source` has said where a value came from -- the job spec, a
 * default, or an engine constant -- and that was the whole story while a worker reported
 * its settings once, before its first frame. Training broke that assumption.
 *
 * **Ultralytics resolves `optimizer: auto` into three values and never writes them back.**
 * `build_optimizer` picks an optimizer, a learning rate and a momentum, keeps all three in
 * local variables, and leaves `trainer.args` saying `auto` and `lr0: 0.01`. Probed against
 * 8.4.145, a run that asked for `auto` got `AdamW` at `lr0: 0.002`. Worse, `auto` also
 * *discards* an `lr0` the submitter did send -- Ultralytics logs that it is doing so -- so
 * a person who set a learning rate and left the optimizer on Auto did not get their
 * learning rate, and nothing recorded it.
 *
 * So the worker now sends a second settings report from `on_train_start`, after the
 * optimizer exists, with the values read off the live optimizer rather than off the
 * arguments. Those entries carry `source: 'resolved'`, and this widens the check
 * constraint to accept them.
 *
 * **It is a source rather than a second table, because it answers the same question.**
 * *What did this attempt run with* is one question, and the answer for most settings is
 * the requested value. Splitting the three that differ into their own table would make
 * every reader join two places to answer one thing.
 *
 * **Requested is not overwritten anywhere it is the only record.** `gpu_jobs.spec` keeps
 * what was asked for, untouched; a `resolved` row replaces the stored value for that name
 * on the attempt, and the disagreement between the two is readable because both survive.
 * The table comment is updated to say so -- it claimed the first report is never
 * overwritten, which stops being true for exactly this one case.
 *
 * **Additive and reversible.** The constraint accepts more than it did, so nothing
 * existing can violate it. `down` narrows it again and deletes any `resolved` row first,
 * because the narrower constraint cannot be added while one exists -- the same thing the
 * migration that created these tables does with its events.
 *
 * `VARCHAR(8)` holds `resolved` exactly, so the column is not altered.
 *
 * @fileoverview Migration allowing gpu_attempt_settings.source = 'resolved'.
 * @module migrations/a-setting-can-say-what-the-engine-resolved-it-to
 */

/** What `source` could say before, and what it can say now. */
const SOURCES = {
    before: ['job', 'default', 'engine'],
    after: ['job', 'default', 'engine', 'resolved'],
};

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
                'ALTER TABLE gpu_attempt_settings DROP CONSTRAINT gpu_attempt_settings_source_check',
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE gpu_attempt_settings
                   ADD CONSTRAINT gpu_attempt_settings_source_check
                   CHECK (source IN (${inList(SOURCES.after)}))`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON TABLE gpu_attempt_settings IS
                 'The value of every setting an attempt actually ran with, reported by the worker. source says whether the job asked for it, a default supplied it, it is an engine constant, or the engine resolved it at startup. The first report for an attempt is the record; a later entry marked resolved replaces the stored value for that name, because the engine can override what was asked for and the run has to say what it actually used.'`,
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
            /* The rows have to go before the constraint narrows, and they are meaningless
               under the old rule anyway: without `resolved` there is no way to say that a
               value came from the engine rather than from the request. */
            const [, removed] = await sequelize.query(
                "DELETE FROM gpu_attempt_settings WHERE source = 'resolved'",
                { transaction }
            );

            console.log(`[resolved-settings] down: removed ${removed?.rowCount ?? 0} resolved setting(s)`);

            await sequelize.query(
                'ALTER TABLE gpu_attempt_settings DROP CONSTRAINT gpu_attempt_settings_source_check',
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE gpu_attempt_settings
                   ADD CONSTRAINT gpu_attempt_settings_source_check
                   CHECK (source IN (${inList(SOURCES.before)}))`,
                { transaction }
            );

            await sequelize.query(
                `COMMENT ON TABLE gpu_attempt_settings IS
                 'The value of every setting an attempt actually ran with, reported by the worker before its first frame. source says whether the job asked for it, a default supplied it, or it is an engine constant. The first report for an attempt is the record and is never overwritten.'`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
