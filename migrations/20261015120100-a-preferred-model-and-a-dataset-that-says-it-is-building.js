'use strict';

/**
 * Marks one model per type as preferred, and lets a dataset say it is still building
 * (#104, gap 28).
 *
 * **Preferred.** The ML Dashboard's model registry shows which model a job should reach
 * for by default, and `ml_models` had nothing to say it. Per `model_type` rather than one
 * across the registry: a single preferred model would mean choosing between detection and
 * segmentation, which is not a choice anybody wants to make. A partial unique index
 * enforces the "one per type" so two cannot be preferred at once -- partial, so the index
 * is over the handful of true rows rather than every model in the registry.
 *
 * **Dataset status.** `datasets` carries `num_samples`, `num_classes`, `location` and
 * `source`, and nothing that says whether the thing is finished. The Datasets screen draws
 * a build in progress and has had no API behind it.
 *
 * This is a **recorded fact, not a derived one**: whoever creates or updates the dataset
 * sets it through the routes that already exist. MARP does not run the build and this does
 * not pretend it does -- what performs a dataset build is gap 19 and still open. The column
 * means "what the thing doing the building last said".
 *
 * Existing rows become `ready` rather than taking the `draft` default. Every dataset in the
 * database now is a finished one with its sample count filled in, so defaulting them to
 * `draft` would make the API start describing complete datasets as unstarted -- a value
 * becoming wrong is the loss the platform rules are about, even though the application
 * would still work.
 *
 * No `guardDataIntegrity`: columns added and filled in place, nothing deleted or
 * re-inserted, no foreign key touched.
 *
 * @fileoverview Migration adding ml_models.preferred and datasets.status.
 * @author Isaac Travers
 * @module migrations/a-preferred-model-and-a-dataset-that-says-it-is-building
 */

/** What a dataset can be. `draft` is where one starts; `ready` is where every existing one already is. */
const DATASET_STATUSES = ['draft', 'building', 'ready', 'failed'];

/** @type {Object} */
module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.addColumn('ml_models', 'preferred', {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                comment: 'True on the one model of its model_type that jobs should reach for by default.',
            }, { transaction });

            // Partial: only the preferred rows are in the index, so it costs nothing
            // on a registry where most models are not preferred.
            await queryInterface.addIndex('ml_models', ['model_type'], {
                name: 'ml_models_one_preferred_per_type_idx',
                unique: true,
                where: { preferred: true },
                transaction,
            });

            // A string with a checked vocabulary rather than a PostgreSQL ENUM,
            // which is how `ml_models.status` next door already does it. A real
            // enum type would be stricter and would also make adding a status a
            // migration on the type; the neighbouring column settled that
            // trade-off already and two patterns for one idea is worse than
            // either.
            await queryInterface.addColumn('datasets', 'status', {
                type: Sequelize.STRING(16),
                allowNull: false,
                defaultValue: 'draft',
                comment: `What the process building this dataset last reported, one of ${DATASET_STATUSES.join(', ')}. MARP does not run the build.`,
            }, { transaction });

            // Everything that exists already is finished, whatever the default says.
            await queryInterface.sequelize.query(
                `UPDATE datasets SET status = 'ready'`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeColumn('datasets', 'status', { transaction });
            await queryInterface.removeIndex('ml_models', 'ml_models_one_preferred_per_type_idx', { transaction });
            await queryInterface.removeColumn('ml_models', 'preferred', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
