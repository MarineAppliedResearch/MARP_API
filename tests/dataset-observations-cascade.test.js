/**
 * Tests that the `dataset_observations` cascade removes the membership row and
 * never a parent.
 *
 * R22 of #103, and the human asked for it by name. A wrong referential action
 * is silent: nothing fails, nothing logs, and the first time anybody notices is
 * when a dataset or an observation is gone. This is the one place in the phase
 * where getting it backwards destroys scientific data.
 *
 * **It is proved rather than read off the catalogue.** Querying `pg_constraint`
 * proves what was declared, not what happens -- a cascade declared in the wrong
 * direction reads as a perfectly healthy constraint. So every test here seeds a
 * dataset, an observation and a membership row, performs a real delete, and
 * asserts what survived.
 *
 * Everything runs inside a transaction that is always rolled back, so real
 * deletes can be performed without the development database paying for them.
 * The cascade fires inside the transaction, which is what is being measured.
 *
 * Observations are inserted with SQL rather than through the model: the model
 * declares the primary key without `autoIncrement`, so Sequelize sends an
 * explicit null and the insert fails. See #62.
 *
 * @fileoverview Tests for the dataset_observations referential actions (#103 R22).
 * @author Isaac Travers
 * @module tests/dataset-observations-cascade
 */

const db = require('../model');

const { QueryTypes } = db.Sequelize;

describe('dataset_observations cascade (#103 R22)', () => {

    /**
     * Seeds a dataset, an observation and the membership row joining them.
     *
     * @async
     * @param {Object} transaction - Transaction to seed within; always rolled back.
     * @returns {Promise<{datasetId: number, observationId: number, membershipId: number}>} The new ids.
     */
    async function seedMembership(transaction) {
        const [dataset] = await db.sequelize.query(
            `INSERT INTO datasets (name, created_at, updated_at)
             VALUES ('jest-cascade-dataset', NOW(), NOW())
             RETURNING id`,
            { type: QueryTypes.SELECT, transaction }
        );

        // The sequence assigns the id here. The repository's max(id) + 1 rule
        // is not reproduced deliberately -- this test is about the constraint,
        // and #62 is somebody else's.
        const [observation] = await db.sequelize.query(
            `INSERT INTO observations ("obsID", comname, "createdAt", "updatedAt")
             VALUES (999001, 'Jest Cascade Subject', NOW(), NOW())
             RETURNING observation_id`,
            { type: QueryTypes.SELECT, transaction }
        );

        const [membership] = await db.sequelize.query(
            `INSERT INTO dataset_observations
                 (dataset_id, observation_id, inclusion_type, created_at, updated_at)
             VALUES (:datasetId, :observationId, 'train', NOW(), NOW())
             RETURNING id`,
            {
                type: QueryTypes.SELECT,
                replacements: { datasetId: dataset.id, observationId: observation.observation_id },
                transaction,
            }
        );

        return {
            datasetId: dataset.id,
            observationId: observation.observation_id,
            membershipId: membership.id,
        };
    }

    /**
     * Counts the rows matching one id, so "gone" and "survived" are the same
     * assertion in both directions.
     *
     * @async
     * @param {string} table - Table to count in.
     * @param {string} column - Identifying column.
     * @param {number} value - Identifier to count.
     * @param {Object} transaction - Transaction to read within.
     * @returns {Promise<number>} How many rows match.
     */
    async function countById(table, column, value, transaction) {
        const [row] = await db.sequelize.query(
            `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${column}" = :value`,
            { type: QueryTypes.SELECT, replacements: { value }, transaction }
        );
        return row.n;
    }

    it('removes the membership row but keeps the observation when a dataset is deleted', async () => {
        const transaction = await db.sequelize.transaction();

        try {
            const { datasetId, observationId, membershipId } = await seedMembership(transaction);

            expect(await countById('dataset_observations', 'id', membershipId, transaction)).toBe(1);

            await db.sequelize.query(
                'DELETE FROM datasets WHERE id = :datasetId',
                { replacements: { datasetId }, transaction }
            );

            // The cascade reaches the join row and stops there. If it ever
            // reached the observation, a curator tidying up a training set
            // would silently destroy annotation.
            expect(await countById('dataset_observations', 'id', membershipId, transaction)).toBe(0);
            expect(await countById('observations', 'observation_id', observationId, transaction)).toBe(1);
        } finally {
            await transaction.rollback();
        }
    });

    it('removes the membership row but keeps the dataset when an observation is deleted', async () => {
        const transaction = await db.sequelize.transaction();

        try {
            const { datasetId, observationId, membershipId } = await seedMembership(transaction);

            await db.sequelize.query(
                'DELETE FROM observations WHERE observation_id = :observationId',
                { replacements: { observationId }, transaction }
            );

            // The direction Delete Mode exercises. The membership goes with the
            // observation -- that loss is accepted, and it is why nothing in
            // MARP records that the observation was ever in the dataset -- but
            // the dataset itself must still be there.
            expect(await countById('dataset_observations', 'id', membershipId, transaction)).toBe(0);
            expect(await countById('datasets', 'id', datasetId, transaction)).toBe(1);
        } finally {
            await transaction.rollback();
        }
    });

    it('deletes an observation that is in a dataset rather than refusing it', async () => {
        const transaction = await db.sequelize.transaction();

        try {
            const { observationId } = await seedMembership(transaction);

            // D3 was settled against the recommendation on exactly this point:
            // a delete must not be blocked. RESTRICT would raise here, and a
            // reviewer would be told to go and unpick a training set first.
            await expect(
                db.sequelize.query(
                    'DELETE FROM observations WHERE observation_id = :observationId',
                    { replacements: { observationId }, transaction }
                )
            ).resolves.toBeDefined();

            expect(await countById('observations', 'observation_id', observationId, transaction)).toBe(0);
        } finally {
            await transaction.rollback();
        }
    });
});
