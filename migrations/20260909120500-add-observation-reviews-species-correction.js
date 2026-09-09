/**
 * Widens `observation_reviews` so a species correction can be recorded in it.
 *
 * **A correction is a review decision**, settled by the human on 2026-09-09 and
 * recorded as A1 in `.marp/task.md`. So it is a row in this log rather than a
 * separate audit table beside it -- which means the table needs a vocabulary it
 * does not have and two columns nothing else uses.
 *
 * **`purpose = 'scientific'`, `decision = 'corrected'`** (A2). One row, not two:
 * the correction does not also write a training-purpose row. The consequence is
 * deliberate and is why the derivation needs a boundary rather than a bare
 * "latest row" -- a scientific-purpose row cannot end the training round by
 * being the latest row for a purpose it does not carry. Migration
 * `20260909120600` is that boundary.
 *
 * **Two species columns, not one and not a `reason`** (D2). Two, because after a
 * *second* correction the observation's current species is no longer what the
 * first correction changed *to*, so a single `previous_species_id` leaves the
 * chain unreconstructable -- and #68 asks a correction to record "actor, time,
 * previous classification, new classification, and observation version". Not
 * `reason`, which holds the reviewer-facing flag vocabulary in `varchar(64)`:
 * putting a species *name* there would reintroduce the exact failure `comname`
 * documents, a text label going stale underneath the record. A key, not a name.
 *
 * **`previous_species_id` is nullable and `corrected_species_id` is not.** About
 * 4% of production rows carry no `species_id` at all -- 438,988 of 440,102 have
 * a `taxserial` and the backfill could not resolve the rest
 * (`20260901120500-add-observations-species-id.js`, Refs #52). So "the species
 * before the correction" is legitimately absent rather than merely unknown,
 * while "the species it was corrected to" never is.
 *
 * Adds columns and widens a constraint; it moves no data. The integrity guard is
 * what proves that rather than assuming it.
 *
 * Refs #111.
 *
 * @fileoverview Migration widening observation_reviews for the species correction.
 * @author Isaac Travers
 * @module migrations/add-observation-reviews-species-correction
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/** The vocabulary before this migration, restored by `down`. */
const PURPOSE_DECISION_CHECK_BEFORE = `
    (purpose = 'scientific' AND decision IN ('reviewed', 'flagged', 'withdrawn'))
 OR (purpose = 'training'   AND decision IN ('promoted', 'excluded', 'withdrawn'))
`;

/**
 * The vocabulary after: `corrected` joins the scientific purpose and nothing
 * else changes.
 *
 * Training gains no `corrected`, which is what makes the boundary in
 * `20260909120600` load-bearing rather than a convenience.
 */
const PURPOSE_DECISION_CHECK_AFTER = `
    (purpose = 'scientific' AND decision IN ('reviewed', 'flagged', 'withdrawn', 'corrected'))
 OR (purpose = 'training'   AND decision IN ('promoted', 'excluded', 'withdrawn'))
`;

/**
 * Ties the corrected species to the corrected decision, in both directions.
 *
 * One expression rather than two, so neither half can hold on its own: a
 * correction cannot be recorded without saying what it changed *to*, and an
 * ordinary decision cannot pretend to be one by carrying a species. The second
 * direction is the one that is easy to leave out and is the one that matters --
 * without it a `reviewed` row could carry a `corrected_species_id` and every
 * reader of the log would have to decide for itself what that meant.
 *
 * `previous_species_id` is deliberately not constrained: it is null for a
 * correction of an observation that had no species, and null for every
 * non-correction, so it carries no signal to enforce.
 */
const CORRECTED_SPECIES_CHECK = `
    (decision = 'corrected' AND corrected_species_id IS NOT NULL)
 OR (decision <> 'corrected' AND corrected_species_id IS NULL)
`;

/** @type {Object} */
module.exports = {
    /**
     * Adds the two species columns and rebuilds the vocabulary CHECK.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once the columns and constraints exist.
     * @throws {Error} Re-throws after rolling back if anything fails or rows are lost.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['observation_reviews', 'observation_review_current', 'observations', 'species'],
                label: 'observation-reviews-species',
                work: async () => {
                    await queryInterface.addColumn(
                        'observation_reviews',
                        'previous_species_id',
                        {
                            type: Sequelize.INTEGER,
                            allowNull: true,
                            references: { model: 'species', key: 'id' },
                            // RESTRICT, matching reviewer_id: an actor or a
                            // value that a record is *about* must not be able to
                            // vanish from it. Deliberately unlike
                            // observations.species_id, which uses SET NULL --
                            // that column holds a live value, this one holds a
                            // historical one, and emptying it would silently
                            // gut an audit row. Species are retired with
                            // is_active rather than deleted, so nothing is
                            // blocked in practice (A9).
                            onDelete: 'RESTRICT',
                            onUpdate: 'CASCADE',
                            comment: 'The species the observation carried before this correction. Null when it had none -- about 4% of rows legitimately do not -- and null on every decision that is not a correction.',
                        },
                        { transaction }
                    );

                    await queryInterface.addColumn(
                        'observation_reviews',
                        'corrected_species_id',
                        {
                            type: Sequelize.INTEGER,
                            allowNull: true,
                            references: { model: 'species', key: 'id' },
                            onDelete: 'RESTRICT',
                            onUpdate: 'CASCADE',
                            comment: 'The species this correction changed the observation to. NOT NULL for a correction and null for every other decision, enforced by observation_reviews_corrected_species_check rather than by the column, because the rule is about the pair.',
                        },
                        { transaction }
                    );

                    // Rebuilt rather than added to: a CHECK is replaced whole,
                    // and dropping before adding keeps the name stable so the
                    // tests that assert on it by name go on working.
                    await sequelize.query(
                        `ALTER TABLE observation_reviews
                           DROP CONSTRAINT observation_reviews_purpose_decision_check`,
                        { transaction }
                    );

                    await sequelize.query(
                        `ALTER TABLE observation_reviews
                           ADD CONSTRAINT observation_reviews_purpose_decision_check
                           CHECK (${PURPOSE_DECISION_CHECK_AFTER})`,
                        { transaction }
                    );

                    await sequelize.query(
                        `ALTER TABLE observation_reviews
                           ADD CONSTRAINT observation_reviews_corrected_species_check
                           CHECK (${CORRECTED_SPECIES_CHECK})`,
                        { transaction }
                    );
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Removes the columns and restores the narrower vocabulary.
     *
     * The correction rows go with the columns, which is honest rather than
     * lossless: there is nowhere else for them, and a `corrected` row left
     * behind would violate the restored CHECK. Anything already corrected stays
     * corrected on `observations.species_id` -- `down` does not put a species
     * back, because it cannot know whether a later correction superseded it.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the columns and constraint are gone.
     * @throws {Error} Re-throws after rolling back if anything fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            // The correction rows first: they are the only rows the restored
            // vocabulary cannot hold, so leaving them would make the CHECK
            // unaddable and the rollback fail halfway.
            await sequelize.query(
                "DELETE FROM observation_reviews WHERE decision = 'corrected'",
                { transaction }
            );

            await sequelize.query(
                `ALTER TABLE observation_reviews
                   DROP CONSTRAINT observation_reviews_corrected_species_check`,
                { transaction }
            );

            await sequelize.query(
                `ALTER TABLE observation_reviews
                   DROP CONSTRAINT observation_reviews_purpose_decision_check`,
                { transaction }
            );

            await sequelize.query(
                `ALTER TABLE observation_reviews
                   ADD CONSTRAINT observation_reviews_purpose_decision_check
                   CHECK (${PURPOSE_DECISION_CHECK_BEFORE})`,
                { transaction }
            );

            await queryInterface.removeColumn('observation_reviews', 'corrected_species_id', { transaction });
            await queryInterface.removeColumn('observation_reviews', 'previous_species_id', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
