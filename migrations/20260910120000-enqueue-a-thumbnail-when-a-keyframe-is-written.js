/**
 * Enqueues a thumbnail when a **keyframe** is written, from a database trigger.
 *
 * #118's A3 was reversed by the human on 2026-09-10 -- *"one of our key criteria
 * is that the user never has to wait. So trying to load the page should not be
 * the thing that makes the back end work. When the observation is created, it
 * should get enqueued."* -- and this is the second half of that correction.
 *
 * **Why a trigger rather than a call in the application.** The first attempt put
 * the enqueue in `repository/observation-ingest.repository.js`, which covers the
 * GPU path and **silently misses every hand-annotated observation**: the
 * annotation GUI creates them through `POST /api/v2/observation` and
 * `POST /api/v2/keyframe`, which go through two different repositories, and the
 * ingest goes through a third with its own raw SQL. That is three write paths, and
 * a second call site is how one of them gets forgotten -- the failure would look
 * fine for months, because the machine path is the one anybody tests.
 *
 * This repository has already answered exactly this question once.
 * `observations.version` is maintained by `observations_bump_version_trigger`
 * rather than by the application, and its own column comment says why: *"not by
 * the application or the ORM, so it moves whatever code path performs the
 * write."* The same reasoning applies here and nothing about it is weaker. One
 * place, and it covers the ingest's raw SQL, the ORM's nested `include` on an
 * observation create, the ORM's `bulkCreate` on the keyframe route, and a hand
 * `INSERT` by somebody fixing data.
 *
 * **Why the keyframe rather than the observation.** A thumbnail is a crop of a
 * box, and the box comes from keyframes -- #118's F6 is explicit that an
 * observation with no keyframes can never have a picture, which is why permanent
 * failure exists at all. So enqueueing when an *observation* is created is wrong
 * wherever the keyframes arrive afterwards: the extractor would claim a row with
 * no box, record a **permanent** failure, and never look again. That is worse than
 * the gap it was meant to close. Hanging off the keyframe is order-independent --
 * whether the keyframes come nested in the observation create or in a later
 * request, the enqueue happens when the box exists and not before.
 *
 * An observation that never gets a keyframe gets no row from **this** trigger, which
 * is right: there is no box, so enqueueing it would earn a permanent failure that no
 * later keyframe could undo. R28's page backstop may still enqueue it when somebody
 * actually looks, and that is the honest moment to record that it can never have a
 * picture.
 *
 * **Idempotent, and it has to be.** `ON CONFLICT (observation_id) DO NOTHING`, so
 * a track's 38 keyframes enqueue once, a later keyframe on the same observation
 * adds nothing, and a row that is already `ready` is never reset to `queued` --
 * re-extracting a picture that exists is what the retry route is for.
 *
 * **Statement-level with a transition table**, not `FOR EACH ROW`: the ingest
 * writes thousands of keyframes per job and `bulkCreate` sends them as one
 * statement, so a per-row trigger would do thousands of upserts where one
 * `SELECT DISTINCT` does. PostgreSQL 10 introduced transition tables and this
 * platform runs 18.
 *
 * INSERT only. An **updated** keyframe box does change what the right picture is,
 * but re-extracting on update would fight with `ready` rows for no request from
 * anybody; the retry route is the way to ask for a new one. DELETE is not a
 * trigger either -- `ON DELETE CASCADE` from `observations` already takes the
 * thumbnail row with the observation, and deleting one keyframe of a track does
 * not invalidate the picture.
 *
 * No data is transformed and no existing row is touched -- in particular **nothing
 * is backfilled**, so R4 still holds for the ~440,000 observations that predate
 * this and #121 is still what gives them a picture. So this does not go through
 * `db/data-integrity.js`, for the same reason
 * `20260909130000-create-observation-thumbnails.js` does not.
 *
 * Refs #118, #121, MarineAppliedResearch/MARP_API#68.
 *
 * @fileoverview Migration adding the keyframe trigger that enqueues a thumbnail.
 * @author Isaac Travers
 * @module migrations/enqueue-a-thumbnail-when-a-keyframe-is-written
 */

'use strict';

/**
 * The trigger function's name. Named once so `up` and `down` cannot disagree.
 *
 * @constant
 * @type {string}
 */
const FUNCTION_NAME = 'thumbnails_enqueue_for_keyframe';

/**
 * The trigger's name.
 *
 * @constant
 * @type {string}
 */
const TRIGGER_NAME = 'keyframes_enqueue_thumbnail_trigger';

/** @type {Object} */
module.exports = {
    /**
     * Creates the trigger function and the statement-level trigger.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the trigger exists.
     * @throws {Error} Re-throws after rolling back if creation fails.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                `CREATE FUNCTION ${FUNCTION_NAME}() RETURNS trigger AS $$
                 BEGIN
                     -- DISTINCT because one statement carries every keyframe of a
                     -- track and they all name the same observation.
                     --
                     -- The column list is spelled out here rather than left to
                     -- defaults on purpose: a migration is a record of what was
                     -- done to a database on a particular day, and it has to keep
                     -- saying the same thing even after the table's defaults
                     -- change.
                     INSERT INTO observation_thumbnails
                         (observation_id, status, permanent, generation, attempts,
                          requested_at, created_at, updated_at)
                     SELECT DISTINCT i.observation_id, 'queued', false, 1, 0,
                            NOW(), NOW(), NOW()
                       FROM inserted i
                     -- DO NOTHING, never DO UPDATE: a row that is already ready
                     -- must not be reset to queued by a later keyframe, and a
                     -- row recorded as permanently failed must not be re-queued
                     -- behind the media server's back. Asking again is the retry
                     -- route's job, on a button a person pressed.
                     ON CONFLICT (observation_id) DO NOTHING;

                     -- AFTER STATEMENT, so the return value is ignored.
                     RETURN NULL;
                 END;
                 $$ LANGUAGE plpgsql`,
                { transaction }
            );

            await sequelize.query(
                `CREATE TRIGGER ${TRIGGER_NAME}
                 AFTER INSERT ON keyframes
                 REFERENCING NEW TABLE AS inserted
                 FOR EACH STATEMENT
                 EXECUTE FUNCTION ${FUNCTION_NAME}()`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops the trigger and then its function.
     *
     * The trigger goes first: dropping the function while a trigger depends on it
     * fails. The queue rows it created are left alone -- they are re-derivable
     * work orders, not a record, and dropping them would strand a tile at
     * PREPARING.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once both are gone.
     * @throws {Error} Re-throws after rolling back if the drop fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                `DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON keyframes`,
                { transaction }
            );

            await sequelize.query(
                `DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
