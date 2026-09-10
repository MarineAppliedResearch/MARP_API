/**
 * Adds `observations.version` for optimistic concurrency and
 * `observations.ml_model_id` for model provenance, plus the trigger that
 * maintains `version`.
 *
 * **The trigger is not an implementation detail, it is the whole mechanism.**
 * Sequelize's optimistic locking lives only on instance `save` and instance
 * `destroy` (`node_modules/sequelize/lib/model.js:2388`, `:2141`); static
 * `Model.update` -- `BULKUPDATE`, `:1887` -- never references the version
 * attribute at all. Every observation write in this repository is static
 * (`repository/observation.repository.js:303`, `:339`, `:697`, `:739`), so
 * `version: true` on the model would leave the token frozen at 1 on every write
 * the annotation GUI performs. A token that some writers do not increment is
 * worse than no token: it makes a stale overwrite look like a successful
 * conditional write. Hence the database maintains it, and nothing in the
 * application may assign it.
 *
 * Because the trigger is invisible to anyone reading `model/observation.model.js`,
 * the column comment says so too, and `tests/observation-version.test.js` proves
 * an ordinary static update through the repository moves it.
 *
 * `version` means exactly "this observation row changed" -- a keyframe edit does
 * not move it, which is why `observation_reviews` records the annotation
 * fingerprint separately.
 *
 * Nothing is backfilled. `ml_models` holds no rows and no model has ever written
 * an observation here, so every existing row is unattributable whatever column
 * is added; a backfill to "hand entered" would be an unverifiable claim about
 * the scientific record. Null means "no model recorded" and nothing more.
 *
 * Both columns are catalog-only adds on PostgreSQL >= 11 (a non-volatile default
 * needs no table rewrite), so this is a metadata change on a 440,000-row table
 * rather than a rewrite.
 *
 * Refs #103.
 *
 * @fileoverview Migration adding observations.version, its trigger, and observations.ml_model_id.
 * @author Isaac Travers
 * @module migrations/add-observations-version-and-model
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * Name of the trigger function, used by both directions so a rename cannot
 * drift between them.
 *
 * @constant
 * @type {string}
 */
const FUNCTION_NAME = 'observations_bump_version';

/**
 * Name of the BEFORE UPDATE trigger on `observations`.
 *
 * @constant
 * @type {string}
 */
const TRIGGER_NAME = 'observations_bump_version_trigger';

/** @type {Object} */
module.exports = {
    /**
     * Adds both columns and creates the version trigger and its function.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the columns and the trigger exist.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            // Nothing here backfills, so the guard should report two columns
            // added and zero rows changed. Running it anyway is the point: it
            // proves the phase is additive rather than asserting it.
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'observations version+model',
                tables: ['observations', 'ml_models'],
                work: async () => {
                    await queryInterface.addColumn(
                        'observations',
                        'version',
                        {
                            type: Sequelize.INTEGER,
                            allowNull: false,
                            defaultValue: 1,
                            comment:
                                'Optimistic-concurrency token for this observation row. Maintained by the observations_bump_version_trigger BEFORE UPDATE trigger, not by the application or the ORM, so it moves whatever code path performs the write. Never assign it from a client; a client value is overwritten by OLD.version + 1. It records that this row changed, not that its keyframes did.',
                        },
                        { transaction }
                    );

                    await queryInterface.addColumn(
                        'observations',
                        'ml_model_id',
                        {
                            type: Sequelize.INTEGER,
                            allowNull: true,
                            references: { model: 'ml_models', key: 'id' },
                            // Keep the observation if the model identity is
                            // removed; which model produced it is provenance,
                            // not a dependency of the scientific record.
                            onDelete: 'SET NULL',
                            onUpdate: 'CASCADE',
                            comment:
                                'The ML model identity that produced this observation. Null means "no model recorded" and nothing more -- it does not assert hand entry. Every row predating this column is null because no model had ever written an observation, so null mixes hand entry with unrecorded attribution; requiring the link on a worker write path is an API contract, not a column.',
                        },
                        { transaction }
                    );

                    // Not indexed deliberately. The Model filter is Phase 4's,
                    // `ml_models` holds no rows, and a column null on every row
                    // wants a partial index chosen against a real distribution.

                    await sequelize.query(
                        `CREATE FUNCTION ${FUNCTION_NAME}() RETURNS trigger AS $$
                         BEGIN
                             -- OLD.version, never NEW.version: a client that
                             -- sends a version cannot set the token forward or
                             -- back, which is what makes it trustworthy.
                             NEW.version := OLD.version + 1;
                             RETURN NEW;
                         END;
                         $$ LANGUAGE plpgsql`,
                        { transaction }
                    );

                    // The WHEN clause means an update that changes nothing does
                    // not inflate the token. Every real write through the
                    // repository moves `updatedAt`, so it always fires there.
                    await sequelize.query(
                        `CREATE TRIGGER ${TRIGGER_NAME}
                         BEFORE UPDATE ON observations
                         FOR EACH ROW
                         WHEN (OLD.* IS DISTINCT FROM NEW.*)
                         EXECUTE FUNCTION ${FUNCTION_NAME}()`,
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
     * Drops the trigger, its function and both columns.
     *
     * The trigger goes first: dropping the function while the trigger still
     * depends on it fails, and dropping `version` while the trigger reads it
     * would too.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once both columns and the trigger are gone.
     * @throws {Error} Re-throws after rolling back if any statement fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                `DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON observations`,
                { transaction }
            );
            await sequelize.query(
                `DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`,
                { transaction }
            );

            await queryInterface.removeColumn('observations', 'ml_model_id', { transaction });
            await queryInterface.removeColumn('observations', 'version', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
