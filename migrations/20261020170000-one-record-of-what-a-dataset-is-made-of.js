'use strict';

/**
 * Settles two records of the same fact into one.
 *
 * `datasets.class_names` (#265) and `dataset_classes` (#268) were written within hours of
 * each other, by two agents, for the same question: which classes is a dataset made of,
 * and in what order. Both are reasonable; having both is not. The human settled it on
 * 2026-10-20: *"I'm not sure if we want it both ways, we should just decide what the best
 * thing to do is and settle on that."*
 *
 * **`dataset_classes` is the one that stays**, because the question actually asked of it
 * is a join. Registering a trained model has to say which *species* the model knows, and
 * `class_names` answers with strings that have to be matched against `species.comname`
 * every time -- a match that works today for `rockfish5` and breaks the first time a
 * species is renamed, which has already happened in this platform. An index means a
 * species; the name is how it is printed.
 *
 * **Nothing is dropped until it has been moved.** The names are resolved to species and
 * written as `dataset_classes` rows first, keeping their order, because the order is the
 * meaning. A dataset whose names do not all resolve **stops this migration** rather than
 * losing them: that dataset's vocabulary exists in exactly one place and a column drop
 * would be the end of it. The error names the dataset and the names that failed, so the
 * fix is a species row or a corrected name rather than a puzzle.
 *
 * Refs MarineAppliedResearch/MARP_API#268, #265.
 *
 * @fileoverview Migration folding datasets.class_names into dataset_classes.
 * @author Isaac Travers
 * @module migrations/one-record-of-what-a-dataset-is-made-of
 */

/** @type {Object} */
module.exports = {
    /**
     * Moves every recorded class name into `dataset_classes`, then drops the column.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when there is one record left.
     * @throws {Error} When a name cannot be resolved to a species.
     */
    async up(queryInterface) {
        const { QueryTypes } = queryInterface.sequelize;
        const transaction = await queryInterface.sequelize.transaction();

        try {
            const named = await queryInterface.sequelize.query(
                `SELECT id, name, class_names
                   FROM datasets
                  WHERE class_names IS NOT NULL
                    AND jsonb_array_length(class_names) > 0`,
                { type: QueryTypes.SELECT, transaction }
            );

            const unresolved = [];

            for (const dataset of named) {
                const names = dataset.class_names.map(String);

                for (let index = 0; index < names.length; index++) {
                    const [species] = await queryInterface.sequelize.query(
                        /* `is_active` is deliberately not filtered on: a dataset built
                           against a species that has since been retired still trained on
                           it, and the record of what it contains must not change because
                           the catalogue did. */
                        'SELECT id FROM species WHERE comname = :name ORDER BY id LIMIT 1',
                        { replacements: { name: names[index] }, type: QueryTypes.SELECT, transaction }
                    );

                    if (!species) {
                        unresolved.push(`${dataset.name} (${dataset.id}): "${names[index]}"`);

                        continue;
                    }

                    await queryInterface.sequelize.query(
                        `INSERT INTO dataset_classes
                             (dataset_id, species_id, class_index, created_at, updated_at)
                         VALUES (:datasetId, :speciesId, :classIndex, NOW(), NOW())
                         ON CONFLICT (dataset_id, class_index) DO NOTHING`,
                        {
                            replacements: {
                                datasetId: dataset.id,
                                speciesId: species.id,
                                classIndex: index,
                            },
                            transaction,
                        }
                    );
                }
            }

            if (unresolved.length) {
                throw new Error(
                    'These recorded class names match no species, and dropping the column '
                    + `would lose them:\n  ${unresolved.join('\n  ')}\n`
                    + 'Add the species, or correct the name, then run this again.'
                );
            }

            await queryInterface.removeColumn('datasets', 'class_names', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Puts the column back, filled from `dataset_classes`.
     *
     * Reversible in substance rather than byte for byte: a name that was recorded as
     * something other than the species' current `comname` comes back as the current one.
     * That is the correction this migration exists to make, so a rollback keeping the
     * stale spelling would be undoing it twice.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @param {Object} Sequelize - Sequelize data types.
     * @returns {Promise<void>} Resolves when the column is back.
     */
    async down(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.addColumn('datasets', 'class_names', {
                type: Sequelize.JSONB,
                allowNull: true,
                comment:
                    'The class names the archive was packaged with, in index order, as a JSON '
                    + 'array. A YOLO label file carries a class index, so the order is part of '
                    + 'the meaning. NULL when the dataset has never been packaged.',
            }, { transaction });

            await queryInterface.sequelize.query(
                `UPDATE datasets d
                    SET class_names = v.names
                   FROM (
                        SELECT dc.dataset_id,
                               jsonb_agg(s.comname ORDER BY dc.class_index) AS names
                          FROM dataset_classes dc
                          JOIN species s ON s.id = dc.species_id
                         GROUP BY dc.dataset_id
                   ) v
                  WHERE v.dataset_id = d.id`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
