/**
 * A fifth setting source: `worker`, a fact about the run only the worker can state.
 *
 * **This is not a nicety; without it the report is refused.** `gpu_attempt_settings.source`
 * has said where a value came from -- the job spec, a default, an engine constant, or what
 * the engine resolved at startup -- and the worker now reports three entries that are none
 * of those: `compute_device`, `compute_device_index` and `train_script_commit`. They are
 * not settings anybody chose. Nobody submits a graphics card.
 *
 * Until this lands, `source: "worker"` fails `requiredEnum` in the service and the request
 * is a 400 -- **and a settings report does not travel alone.** It arrives in an event batch
 * beside metrics and logs, and the whole batch is refused together, so one unrecognised
 * source costs the epochs that shared the POST. The worker already learned this on the type
 * vocabulary and says so in its own comment: *"A type the contract does not know would
 * otherwise cost the entire report, and the entire report is what run 205 lost."* This is
 * the same failure on the next field along.
 *
 * **A fifth source rather than a second table, for the reason `resolved` was.** It answers
 * the same question -- what did this attempt actually run with -- and the only thing that
 * differs is who is in a position to know. A reader that does not care which of the five it
 * was reads the value and is right.
 *
 * **`worker` is first-wins, like everything that is not `resolved`.** These values settle
 * once, before the model loads, and nothing later can revise them: the card does not change
 * mid-run. Only `resolved` replaces, because only the engine overrules a request.
 *
 * Refs MarineAppliedResearch/MARP_API#268
 *
 * @fileoverview Migration allowing gpu_attempt_settings.source = 'worker'.
 * @module migrations/a-setting-can-come-from-the-worker-itself
 */

/** What `source` could say before, and what it can say now. */
const SOURCES = {
    before: ['job', 'default', 'engine', 'resolved'],
    after: ['job', 'default', 'engine', 'resolved', 'worker'],
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

/** What the table says it holds, before and after. */
const COMMENTS = {
    before:
        'The value of every setting an attempt actually ran with, reported by the worker. source says whether the job asked for it, a default supplied it, it is an engine constant, or the engine resolved it at startup. The first report for an attempt is the record; a later entry marked resolved replaces the stored value for that name, because the engine can override what was asked for and the run has to say what it actually used.',
    after:
        'The value of every setting an attempt actually ran with, reported by the worker. source says whether the job asked for it, a default supplied it, it is an engine constant, the engine resolved it at startup, or the worker is stating a fact about the machine that nobody chose -- the card it ran on, the slot, the revision of the training script. The first report for an attempt is the record; a later entry marked resolved replaces the stored value for that name, because the engine can override what was asked for and the run has to say what it actually used.',
};

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
                `COMMENT ON TABLE gpu_attempt_settings IS '${COMMENTS.after}'`,
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
            /* The rows go before the constraint narrows. They are not recoverable under
               the old rule -- there is no source left that means "the worker observed
               this" -- and relabelling them `engine` would claim the engine chose a
               graphics card. Losing the row is honest; mislabelling it is not. */
            const [, removed] = await sequelize.query(
                "DELETE FROM gpu_attempt_settings WHERE source = 'worker'",
                { transaction }
            );

            console.log(`[worker-settings] down: removed ${removed?.rowCount ?? 0} worker setting(s)`);

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
                `COMMENT ON TABLE gpu_attempt_settings IS '${COMMENTS.before}'`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
