'use strict';

/**
 * The sha256 of a registered model's weights, recorded rather than recomputed.
 *
 * A training job's spec has to carry `spec.model.sha256` -- the worker fetches the
 * weights, hashes what arrived and refuses a mismatch -- and `validateSubmittedModel`
 * requires it. Nothing recorded it. For the models MARP trained the digest existed only
 * inside a sentence in `notes` ("Weights 5e5aaa5a... trained by GPU job 21542."), and for
 * the fourteen imported ones it existed nowhere at all: `scripts/stage-model-artifact.js`
 * hashed the file and *printed* it for a person to paste into a spec by hand. So the
 * Training screen could not compose a spec, and the one training run that has succeeded
 * got its spec typed.
 *
 * **Recorded, not computed on demand, and that is the decision rather than the
 * implementation.** The alternative was to hash the artifact inside the submit handler.
 * Isaac answered the same question today about dataset image counts: *"i'd rather not
 * have to count the images in each archive every time we have to load the thing, it'd
 * probably be better to record it in the database?"* A hash of an immutable artifact is a
 * constant, and paying for it on every submit is paying repeatedly for a fact that never
 * changes. It also makes the digest something a screen can show before you submit, which
 * a number computed inside a handler can never be.
 *
 * **Symmetry with the dataset half.** `datasets.archive_sha256` is already a column,
 * filled when the archive is packaged, and `submitTrainingJob` composes `spec.dataset`
 * from it. A model artifact is the same kind of thing -- immutable bytes with a name --
 * and having one recorded while the other was recomputed is an asymmetry nobody would be
 * able to justify later.
 *
 * **Nullable, and null means not known.** A model whose weights are not on this machine
 * has an unknown checksum, which is a different fact from having none;
 * `scripts/backfill-model-artifact-sha256.js` records nothing rather than an empty string
 * for those, the same way the split-image backfill leaves an uncountable archive alone.
 * A job cannot be submitted against a model with a null here, which is the correct
 * refusal: the worker would have nothing to verify the download against.
 *
 * **Not unique.** Two registrations can legitimately point at the same bytes -- a model
 * re-registered under a second name, or an import of a file MARP already holds -- and a
 * unique index would refuse the second one for no benefit.
 *
 * @fileoverview Migration adding ml_models.artifact_sha256.
 * @module migrations/a-registered-model-records-its-own-checksum
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.addColumn('ml_models', 'artifact_sha256', {
                type: Sequelize.STRING(64),
                allowNull: true,
                comment: 'Lowercase sha256 of the weights at storage_path, so a job spec can '
                    + 'be composed without re-hashing the file. Null means not known -- the '
                    + 'artifact is not on this machine -- which is not the same as none.',
            }, { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await queryInterface.removeColumn('ml_models', 'artifact_sha256', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
