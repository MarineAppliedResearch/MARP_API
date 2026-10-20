'use strict';

/**
 * Records the class names a dataset was packaged with.
 *
 * A model has to say which species it was trained on -- the tracking engine refuses
 * weights whose vocabulary disagrees with what MARP registered for them -- and when a
 * training run finishes there is nowhere to get that from.
 *
 * The designed route is `datasets` -> `dataset_observations` -> `observations` -> species.
 * That join is correct and **empty**: `dataset_observations` holds no rows for any
 * dataset, because the legacy builder's code for it was never enabled. Building a dataset
 * from MARP, which is what would populate it, is #268.
 *
 * What does exist is the archive's own `data.yaml`, which names the classes in index
 * order, and `scripts/package-dataset.js` already parses it. So the dataset records what
 * it was packaged with, and registration resolves those names against `species.comname`.
 * Checked against the catalogue for rockfish5: 11 of 11 resolve to exactly one species.
 *
 * **Order is the whole point, so this is an array and not a set.** A YOLO label file
 * carries a class index, and an index means nothing without the list it indexes into. A
 * join table would lose that unless it carried a position column, which is a list wearing
 * a disguise.
 *
 * Nullable, because a dataset nobody has packaged has no classes recorded, and that is the
 * normal state of every row that exists today.
 *
 * No `guardDataIntegrity`: one nullable column, no backfill in the migration, nothing
 * re-inserted and no reference touched.
 *
 * Refs #265, #268.
 *
 * @fileoverview Migration adding datasets.class_names.
 * @author Isaac Travers
 * @module migrations/a-dataset-remembers-its-classes
 */

/** @type {Object} */
module.exports = {
    /**
     * Adds the nullable `class_names` array.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @param {Object} Sequelize - Sequelize data types.
     * @returns {Promise<void>} Resolves when the column exists.
     */
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('datasets', 'class_names', {
            type: Sequelize.JSONB,
            allowNull: true,
            comment:
                'The class names the archive was packaged with, in index order, as a JSON '
                + 'array. A YOLO label file carries a class index, so the order is part of '
                + 'the meaning. NULL when the dataset has never been packaged.',
        });
    },

    /**
     * Removes it.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when it is gone.
     */
    async down(queryInterface) {
        await queryInterface.removeColumn('datasets', 'class_names');
    },
};
