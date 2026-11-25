/**
 * A dataset keeps a record of its pictures, and each picture can be reviewed (#271).
 *
 * Settled with Isaac on 2026-11-24: a built dataset is reviewed in the Mosaic one track at a
 * time, flipping through the pictures the dataset took from it. **The unit of review is the
 * picture** -- one frame of one track -- because the model trains mostly on frames between
 * keyframes, and the straight line between two keyframes can drift off the animal when the
 * ROV does not move in a straight line.
 *
 * **`dataset_pictures`** says which pictures a build cut for which observation, and what it
 * drew on them. The archive cannot say that: a YOLO label line carries a class and a box, not
 * the observation it came from. One row per dataset, observation and frame, so a frame
 * holding two animals is two rows sharing one picture.
 *
 * **`picture_reviews`** is the log of decisions about one frame of one observation, kept like
 * `observation_reviews`: a row per decision, never rewritten, so the last commit wins and
 * nothing is lost. It is about the observation, not the dataset -- a flagged picture is left
 * out of every dataset built afterwards -- and `dataset_id` only says where the reviewer
 * was looking.
 *
 * **Promoted or flagged, and no third state** (Isaac): a flag carries a reason saying what
 * is wrong, and fixing the box does not clear it. A reviewer promotes it again. `withdrawn`
 * is the Mosaic's take-back, which returns a picture to undecided.
 *
 * **`picture_review_current`** is a view rather than a projection table: one decision per
 * frame of an observation, read rarely and in small numbers, so there is no second copy to
 * keep in step.
 *
 * Refs MarineAppliedResearch/MARP_API#271
 *
 * @fileoverview Migration creating dataset_pictures, picture_reviews and picture_review_current.
 * @module migrations/a-dataset-keeps-its-pictures-and-each-can-be-reviewed
 */

'use strict';

module.exports = {
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query(
                `CREATE TABLE dataset_pictures (
                     id             SERIAL PRIMARY KEY,
                     dataset_id     INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
                     -- CASCADE, as dataset_observations: a deleted observation is gone from the
                     -- record, and a picture of it is not a reason to refuse the delete.
                     observation_id INTEGER NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
                     video_source   VARCHAR(512) NOT NULL,
                     framenum       INTEGER NOT NULL,
                     split          VARCHAR(16) NOT NULL,
                     drawn          JSONB NOT NULL,
                     picture        VARCHAR(512),
                     created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                     UNIQUE (dataset_id, observation_id, framenum)
                 )`,
                { transaction }
            );
            await sequelize.query(
                `COMMENT ON TABLE dataset_pictures IS
                   'Every picture a dataset build cut, per observation it was cut for (#271). A frame holding two animals is two rows sharing one picture.';
                 COMMENT ON COLUMN dataset_pictures.framenum IS
                   'The frame of the video, numbered as keyframes.framenum is.';
                 COMMENT ON COLUMN dataset_pictures.split IS
                   'The split the build put the picture in: train, val or test.';
                 COMMENT ON COLUMN dataset_pictures.drawn IS
                   'What the build labelled this observation with on this picture, exactly as written into the archive: {"box": {cx, cy, w, h}, "class_index"} for detection, {"labels": [substrate, ...]} for habitat.';
                 COMMENT ON COLUMN dataset_pictures.picture IS
                   'A small copy of the picture, relative to the dataset directory. Null when it could not be saved: a build never fails over one.'`,
                { transaction }
            );

            await sequelize.query(
                `CREATE TABLE picture_reviews (
                     id             SERIAL PRIMARY KEY,
                     observation_id INTEGER NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
                     framenum       INTEGER NOT NULL,
                     decision       VARCHAR(16) NOT NULL
                                    CHECK (decision IN ('promoted', 'flagged', 'withdrawn')),
                     reason         VARCHAR(255),
                     note           TEXT,
                     -- RESTRICT, as observation_reviews: a decision belongs to its reviewer.
                     reviewer_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
                     -- Where the reviewer was looking; the decision outlives the dataset.
                     dataset_id     INTEGER REFERENCES datasets(id) ON DELETE SET NULL,
                     decided_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                     created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
                 )`,
                { transaction }
            );
            await sequelize.query(
                `COMMENT ON TABLE picture_reviews IS
                   'The log of decisions about one frame of one observation, from reviewing a dataset (#271). Never rewritten: a new decision is a new row.';
                 COMMENT ON COLUMN picture_reviews.decision IS
                   'promoted or flagged; withdrawn takes a decision back, so the frame is undecided again.';
                 COMMENT ON COLUMN picture_reviews.reason IS
                   'Why it was flagged, from the reviewer-facing vocabulary. Enforced by the API, like observation_reviews.reason.'`,
                { transaction }
            );
            await sequelize.query(
                `CREATE INDEX picture_reviews_frame_decided_idx
                   ON picture_reviews (observation_id, framenum, decided_at DESC, id DESC)`,
                { transaction }
            );

            // The latest decision per frame of an observation, with a take-back meaning none.
            await sequelize.query(
                `CREATE VIEW picture_review_current AS
                 SELECT * FROM (
                     SELECT DISTINCT ON (observation_id, framenum) *
                       FROM picture_reviews
                      ORDER BY observation_id, framenum, decided_at DESC, id DESC
                 ) latest
                 WHERE decision <> 'withdrawn'`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await sequelize.query('DROP VIEW IF EXISTS picture_review_current', { transaction });
            await sequelize.query('DROP TABLE IF EXISTS picture_reviews', { transaction });
            await sequelize.query('DROP TABLE IF EXISTS dataset_pictures', { transaction });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
