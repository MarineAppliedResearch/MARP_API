/**
 * Creates the tables that record how inference was run, one setting at a time.
 *
 * Two runs of one model over one video at confidence 0.60 and 0.001 are different
 * scientific instruments, and until now the database could not tell them apart.
 * The worker already logs what it applies, but only as a line of text inside an
 * event, and it logs a default as the phrase "(ultralytics defaults)" rather than
 * as the value that was used.
 *
 * **Normalised rather than a `jsonb` column, deliberately.** Settled on #232: the
 * aim is that every setting is queryable on its own, and that the schema says
 * what each one is. So there are three tables rather than one blob:
 *
 *   inference_settings          the catalogue: what a setting is, its engine, its type
 *   gpu_attempt_settings        what an attempt ran with, one row per setting
 *   gpu_attempt_ignored_params  what a job asked for and the worker did not honour
 *
 * **Not the existing `hyperparameters` table.** That one hangs off `training_runs`
 * through a `NOT NULL` key and holds a single `jsonb` blob. It describes training,
 * and it is the shape #232 decided against.
 *
 * **One row per setting rather than a column per setting**, because settings
 * belong to an engine and engines differ: `marp_tracking` has a dozen, `mock` has
 * none, and a segmentation engine will have its own. A new setting is then a
 * catalogue row, not a migration.
 *
 * The worker reports all of this as a `settings` event, before the first frame,
 * so an attempt that later fails still has its record. This migration widens the
 * event kinds to accept it.
 *
 * Refs MarineAppliedResearch/MARP_API#232.
 *
 * @fileoverview Migration creating inference_settings, gpu_attempt_settings and gpu_attempt_ignored_params.
 * @author Isaac Travers
 * @module migrations/create-inference-settings-tables
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * How a value is stored. Each maps to one value column on `gpu_attempt_settings`,
 * so a setting keeps its real type rather than becoming text.
 *
 * @constant
 * @type {Array<string>}
 */
const VALUE_TYPES = ['real', 'int', 'bool', 'text'];

/**
 * Where a recorded value came from. `job` means the spec set it, `default` means
 * it did not and the worker or Ultralytics supplied it, and `engine` means a
 * constant in the engine that no job can set.
 *
 * @constant
 * @type {Array<string>}
 */
const SOURCES = ['job', 'default', 'engine'];

/**
 * Event kinds before and after. `settings` is a worker's report of what it applied.
 *
 * @constant
 * @type {Object}
 */
const EVENT_KINDS = {
    before: ['metric', 'log', 'note'],
    after: ['metric', 'log', 'note', 'settings'],
};

/**
 * Renders a list as a SQL `IN (...)` body. Every value here is a constant in this
 * file, never input.
 *
 * @param {Array<string>} values - Allowed values.
 * @returns {string} Quoted, comma-separated values.
 */
function inList(values) {
    return values.map((value) => `'${value}'`).join(', ');
}

/** @type {Object} */
module.exports = {
    /**
     * Creates the three tables and widens the event kinds.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the tables exist.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            // Additive: new tables, and a check constraint that accepts more than
            // it did. The guard should report nothing moved in the tables it
            // watches, and running it proves that rather than asserting it.
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['gpu_job_attempts', 'gpu_job_events'],
                label: 'inference-settings',
                work: async () => {
                    await sequelize.query(
                        `CREATE TABLE inference_settings (
                            id          SERIAL PRIMARY KEY,
                            engine      VARCHAR(64) NOT NULL,
                            name        VARCHAR(64) NOT NULL,
                            value_type  VARCHAR(8)  NOT NULL
                                        CHECK (value_type IN (${inList(VALUE_TYPES)})),
                            description TEXT,
                            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            CONSTRAINT inference_settings_engine_name_unique UNIQUE (engine, name)
                        )`,
                        { transaction }
                    );

                    await sequelize.query(
                        `COMMENT ON TABLE inference_settings IS
                         'The catalogue of settings an inference engine can run with: what each is, which engine it belongs to, and the type its value holds. A setting a worker reports that is not here yet is added rather than refused, so a newer worker never loses its record.'`,
                        { transaction }
                    );

                    await sequelize.query(
                        `CREATE TABLE gpu_attempt_settings (
                            attempt_id  INTEGER NOT NULL
                                        REFERENCES gpu_job_attempts (id)
                                        ON UPDATE CASCADE ON DELETE CASCADE,
                            setting_id  INTEGER NOT NULL
                                        REFERENCES inference_settings (id)
                                        ON UPDATE CASCADE ON DELETE RESTRICT,
                            value_real  DOUBLE PRECISION,
                            value_int   BIGINT,
                            value_bool  BOOLEAN,
                            value_text  TEXT,
                            source      VARCHAR(8) NOT NULL
                                        CHECK (source IN (${inList(SOURCES)})),
                            recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            PRIMARY KEY (attempt_id, setting_id),
                            -- Exactly one value column is set, and which one is
                            -- the catalogue's value_type. A row with none is not
                            -- a record of anything.
                            CONSTRAINT gpu_attempt_settings_one_value
                                CHECK (num_nonnulls(value_real, value_int, value_bool, value_text) = 1)
                        )`,
                        { transaction }
                    );

                    // "Which attempts ran with setting X" is the query this table
                    // exists for. attempt_id is already the key's leading column.
                    await sequelize.query(
                        'CREATE INDEX gpu_attempt_settings_setting_id_idx ON gpu_attempt_settings (setting_id)',
                        { transaction }
                    );

                    await sequelize.query(
                        `COMMENT ON TABLE gpu_attempt_settings IS
                         'The value of every setting an attempt actually ran with, reported by the worker before its first frame. source says whether the job asked for it, a default supplied it, or it is an engine constant. The first report for an attempt is the record and is never overwritten.'`,
                        { transaction }
                    );

                    await sequelize.query(
                        `CREATE TABLE gpu_attempt_ignored_params (
                            attempt_id      INTEGER NOT NULL
                                            REFERENCES gpu_job_attempts (id)
                                            ON UPDATE CASCADE ON DELETE CASCADE,
                            key             VARCHAR(128) NOT NULL,
                            requested_value TEXT,
                            recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            PRIMARY KEY (attempt_id, key)
                        )`,
                        { transaction }
                    );

                    await sequelize.query(
                        `COMMENT ON TABLE gpu_attempt_ignored_params IS
                         'Keys a job spec set that the worker did not honour, and the value the job asked for, as the JSON it was sent in. A setting silently not applied is what made a run at the MBARI deep-sea settings indistinguishable from one at the defaults.'`,
                        { transaction }
                    );

                    // Accept the worker's settings report as an event kind.
                    await sequelize.query(
                        'ALTER TABLE gpu_job_events DROP CONSTRAINT gpu_job_events_kind_check',
                        { transaction }
                    );
                    await sequelize.query(
                        `ALTER TABLE gpu_job_events
                           ADD CONSTRAINT gpu_job_events_kind_check
                           CHECK (kind IN (${inList(EVENT_KINDS.after)}))`,
                        { transaction }
                    );

                    return null;
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the three tables and narrows the event kinds back.
     *
     * The `settings` events are deleted first, because the narrower constraint
     * cannot be added while they exist. They are meaningless without the tables
     * this also drops, and they only exist because of this migration.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the tables are gone.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            const [, removed] = await sequelize.query(
                "DELETE FROM gpu_job_events WHERE kind = 'settings'",
                { transaction }
            );
            console.log(`[inference-settings] down: removed ${removed?.rowCount ?? 0} settings event(s)`);

            await sequelize.query(
                'ALTER TABLE gpu_job_events DROP CONSTRAINT gpu_job_events_kind_check',
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE gpu_job_events
                   ADD CONSTRAINT gpu_job_events_kind_check
                   CHECK (kind IN (${inList(EVENT_KINDS.before)}))`,
                { transaction }
            );

            await sequelize.query('DROP TABLE IF EXISTS gpu_attempt_ignored_params', { transaction });
            await sequelize.query('DROP TABLE IF EXISTS gpu_attempt_settings', { transaction });
            await sequelize.query('DROP TABLE IF EXISTS inference_settings', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
