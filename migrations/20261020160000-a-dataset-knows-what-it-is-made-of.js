'use strict';

/**
 * Lets a dataset record its own vocabulary, and lets a build be a job.
 *
 * Two changes, both for #268.
 *
 * **`dataset_classes`.** A class index in a YOLO label file is a number, and the number is
 * meaningless without the ordered list it indexes. `datasets.num_classes` says there are
 * eleven and nothing says which eleven or in what order, so a dataset MARP built could not
 * be read back -- and #265, registering the model a training run produced, needs exactly
 * that: which species the model was trained on, resolved by join rather than by matching
 * packaged class-name strings against `species.comname`. That string matching happens to
 * resolve 11 of 11 for `rockfish5`, which is luck rather than a design.
 *
 * A table rather than a JSONB column or a delimited string, because the thing asked of it
 * is a join to `species`. `class_index` is unique per dataset and so is `species_id`: one
 * index is one species and one species is one index, and a vocabulary that broke either
 * would produce label files nobody could interpret.
 *
 * `ON DELETE CASCADE` from `datasets`, because a vocabulary describes a dataset and has no
 * meaning without it -- unlike `dataset_observations`, whose observation FK is `RESTRICT`
 * so that an observation cannot vanish out from under a dataset that was built on it.
 *
 * **`dataset_build` as a job kind.** `gpu_jobs_kind_check` is a CHECK over a fixed list, so
 * the list has to be widened. The row is a `gpu_jobs` row even though no GPU touches the
 * work: what a build needs is a queue, a state machine, attempts, progress, cancellation
 * and a row the Jobs screen can already draw, and that is what the table is. The human
 * settled on 2026-10-20 that the API runs the build rather than a worker -- *"it doesn't
 * really make sense to be streaming the video over to a worker and then to re-download the
 * entire thing when it can just be a background thread on the API"* -- so `POST /gpu/poll`
 * never offers this kind, which is enforced in `config/gpu-orchestration.js` rather than
 * here.
 *
 * No `guardDataIntegrity`: this creates an empty table and widens a CHECK to accept one
 * more value. It transforms no existing row, deletes none, and makes no previously-valid
 * row invalid, so there is no count to compare and nothing to orphan.
 *
 * Refs MarineAppliedResearch/MARP_API#268, #265.
 *
 * @fileoverview Migration adding dataset_classes and the dataset_build job kind.
 * @author Isaac Travers
 * @module migrations/a-dataset-knows-what-it-is-made-of
 */

/** The kinds a `gpu_jobs` row may carry once this has run. */
const KINDS = ['inference', 'tracking', 'training', 'diagnostic', 'dataset_build'];

/** The kinds it carried before, for the rollback. */
const KINDS_BEFORE = ['inference', 'tracking', 'training', 'diagnostic'];

/**
 * Rewrites `gpu_jobs_kind_check` over the given list.
 *
 * Dropped and recreated rather than altered: PostgreSQL has no ALTER for a CHECK's
 * expression, and doing it in two statements inside the caller's transaction means a
 * failure leaves the old constraint in place rather than none at all.
 *
 * @param {Object} queryInterface - Sequelize query interface.
 * @param {Object} transaction - The transaction to run inside.
 * @param {string[]} kinds - The permitted kinds.
 * @returns {Promise<void>} Resolves when the constraint is in place.
 */
async function setKindCheck(queryInterface, transaction, kinds) {
    const list = kinds.map((kind) => `'${kind}'`).join(', ');

    await queryInterface.sequelize.query(
        'ALTER TABLE gpu_jobs DROP CONSTRAINT IF EXISTS gpu_jobs_kind_check',
        { transaction }
    );

    await queryInterface.sequelize.query(
        `ALTER TABLE gpu_jobs ADD CONSTRAINT gpu_jobs_kind_check CHECK (kind::text = ANY (ARRAY[${list}]::text[]))`,
        { transaction }
    );
}

/** @type {Object} */
module.exports = {
    /**
     * Creates `dataset_classes` and widens the job-kind check.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @param {Object} Sequelize - Sequelize data types.
     * @returns {Promise<void>} Resolves when both changes are in place.
     */
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.createTable('dataset_classes', {
                id: {
                    type: Sequelize.INTEGER,
                    primaryKey: true,
                    autoIncrement: true,
                    comment: 'Unique numeric identifier for this vocabulary entry.',
                },
                dataset_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    references: { model: 'datasets', key: 'id' },
                    onDelete: 'CASCADE',
                    onUpdate: 'CASCADE',
                    comment: 'The dataset whose vocabulary this belongs to.',
                },
                species_id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    references: { model: 'species', key: 'id' },
                    onDelete: 'RESTRICT',
                    onUpdate: 'CASCADE',
                    comment: 'The species this class index means.',
                },
                class_index: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    comment:
                        'The number written in the label files. Zero-based and dense, '
                        + 'matching the order of `names` in the archive\'s data.yaml.',
                },
                created_at: { type: Sequelize.DATE, allowNull: false },
                updated_at: { type: Sequelize.DATE, allowNull: false },
            }, { transaction });

            /* One index is one species, and one species is one index. Either being
               violated produces label files that cannot be read back. */
            await queryInterface.addConstraint('dataset_classes', {
                fields: ['dataset_id', 'class_index'],
                type: 'unique',
                name: 'dataset_classes_one_species_per_index',
                transaction,
            });

            await queryInterface.addConstraint('dataset_classes', {
                fields: ['dataset_id', 'species_id'],
                type: 'unique',
                name: 'dataset_classes_one_index_per_species',
                transaction,
            });

            await setKindCheck(queryInterface, transaction, KINDS);

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops `dataset_classes` and narrows the job-kind check back.
     *
     * **Refuses while a `dataset_build` row exists**, rather than failing obscurely when
     * the narrowed CHECK is validated against it. A rollback that cannot say why it will
     * not run is worse than one that will not run.
     *
     * @async
     * @param {Object} queryInterface - Sequelize query interface.
     * @returns {Promise<void>} Resolves when both changes are undone.
     */
    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            const [{ count }] = await queryInterface.sequelize.query(
                "SELECT count(*)::int AS count FROM gpu_jobs WHERE kind = 'dataset_build'",
                { type: queryInterface.sequelize.QueryTypes.SELECT, transaction }
            );

            if (count > 0) {
                throw new Error(
                    `${count} gpu_jobs rows have kind 'dataset_build'. Narrowing the check `
                    + 'would make them invalid; remove or re-kind them before rolling this back.'
                );
            }

            await queryInterface.dropTable('dataset_classes', { transaction });
            await setKindCheck(queryInterface, transaction, KINDS_BEFORE);

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
