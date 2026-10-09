/**
 * Gives observations a model wrote the same `videoLocation` the annotation GUI writes.
 *
 * Every observation identifies its video by the file's name on disk, extension
 * included, in both `video_source` and `videoLocation`: the GUI looks the video
 * up in Jellyfin by that filename. The GPU ingest used to leave `videoLocation`
 * null and carry `jellyfin_item_id` instead, which the GUI cannot open from and
 * which is not stable -- item ids change when items change on the Jellyfin
 * server. The ingest now writes the filename; this fills in the rows it wrote
 * before.
 *
 * Only rows a model wrote (`ml_model_id` set) with no `videoLocation` and a
 * `video_source` to copy. A row a person wrote is never touched. In production no
 * observation records a model, so this changes nothing there.
 *
 * `video_source` is copied as it is. Names like `20200621_000532_Fwd.mp4.mp4` are
 * the real names of those files on disk, not an error to correct.
 *
 * @fileoverview Migration filling videoLocation on machine-written observations.
 * @author Isaac Travers
 * @module migrations/fill-inference-video-location
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * The trigger that bumps `observations.version` on every row change, from
 * `20260909120000-add-observations-version-and-model.js`. Switched off around
 * the fill so versions stay where they are.
 *
 * @constant
 * @type {string}
 */
const VERSION_TRIGGER = 'observations_bump_version_trigger';

/** @type {Object} */
module.exports = {
    /**
     * Copies `video_source` into an empty `videoLocation` on every observation a
     * model wrote.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the rows are filled.
     * @throws {Error} Re-throws after rolling back if the statement fails or the
     * integrity guard finds a row lost.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                label: 'inference videoLocation',
                tables: ['observations'],
                work: async () => {
                    // Not an edit to the annotation, so it must not move
                    // `version`: reviews record the version they were made
                    // against, and this would make every reviewed inference
                    // observation look changed since review. Only this trigger,
                    // and inside the transaction, so a failure leaves it on.
                    await sequelize.query(
                        `ALTER TABLE observations DISABLE TRIGGER ${VERSION_TRIGGER}`,
                        { transaction }
                    );

                    // One statement: this is over a hundred thousand rows on a
                    // development database, and the rule is a single predicate.
                    const [, result] = await sequelize.query(
                        `UPDATE observations
                            SET "videoLocation" = video_source
                          WHERE ml_model_id IS NOT NULL
                            AND "videoLocation" IS NULL
                            AND video_source IS NOT NULL`,
                        { transaction }
                    );

                    await sequelize.query(
                        `ALTER TABLE observations ENABLE TRIGGER ${VERSION_TRIGGER}`,
                        { transaction }
                    );

                    console.log(`[inference videoLocation] ${result.rowCount} observation(s) filled.`);
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Empties `videoLocation` again on rows a model wrote where it equals
     * `video_source`.
     *
     * Rows the ingest wrote after `up` are emptied as well, which is the state
     * the ingest used to leave them in.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the rows are emptied.
     * @throws {Error} Re-throws after rolling back if the statement fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            // Versions stay put on the way back too, for the same reason as `up`.
            await sequelize.query(`ALTER TABLE observations DISABLE TRIGGER ${VERSION_TRIGGER}`, { transaction });
            await sequelize.query(
                `UPDATE observations
                    SET "videoLocation" = NULL
                  WHERE ml_model_id IS NOT NULL
                    AND "videoLocation" = video_source`,
                { transaction }
            );
            await sequelize.query(`ALTER TABLE observations ENABLE TRIGGER ${VERSION_TRIGGER}`, { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
