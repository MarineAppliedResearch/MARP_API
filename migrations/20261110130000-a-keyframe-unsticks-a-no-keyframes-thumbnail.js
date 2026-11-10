/**
 * A keyframe written to an observation whose thumbnail failed for having no keyframes queues
 * that thumbnail again (#347).
 *
 * `thumbnails_enqueue_for_keyframe` (20260910120000) inserts a queue entry when a keyframe is
 * written and does nothing to a row that exists, deliberately: a ready picture is not redone,
 * and a permanent failure is not retried behind the media server's back. But one permanent
 * failure is about the keyframes themselves. An observation seen with none is failed with
 * "The observation has no keyframes, so it has no bounding box and can never have a cropped
 * picture", and that stops being true the moment one arrives. Left alone, the row stayed
 * failed for ever: the retry route, the replacement route and the sweeper all refuse a
 * permanent failure. The habitat model's stretches (#287) are posted first and given their
 * keyframes after, and 275 of them were stuck this way in a test copy.
 *
 * So the function now also re-queues **that** failure, and only that one, for the
 * observations the statement gave keyframes. Every other permanent failure keeps today's
 * behaviour. No request has reached the media server for such a row -- it was failed before
 * a stream was opened -- so queueing it once is not a retry against Jellyfin.
 *
 * The failure is recognised by its message, copied here as it stands in
 * `service/thumbnail-extraction.service.js` (`NO_KEYFRAMES_ERROR`) on the day this was
 * written, because a migration has to keep saying what it did. `tests/thumbnails.test.js`
 * records a failure through that constant and checks the keyframe unsticks it, so the two
 * cannot drift apart unnoticed.
 *
 * Nothing existing is rewritten: rows already stuck stay as they are until a keyframe is
 * written or the retry route is asked, which now accepts them once they have keyframes.
 * `down` restores the original function.
 *
 * Refs #347, #287.
 *
 * @fileoverview Migration teaching the keyframe trigger to re-queue a no-keyframes failure.
 * @module migrations/a-keyframe-unsticks-a-no-keyframes-thumbnail
 */

'use strict';

/** The trigger function, as 20260910120000 named it. */
const FUNCTION_NAME = 'thumbnails_enqueue_for_keyframe';

/** The one permanent failure a keyframe answers, as the extractor records it. */
const NO_KEYFRAMES_ERROR = 'The observation has no keyframes, so it has no bounding box and can never have a cropped picture.';

/** The insert both versions make, unchanged. */
const ENQUEUE = `
                     INSERT INTO observation_thumbnails
                         (observation_id, status, permanent, generation, attempts,
                          requested_at, created_at, updated_at)
                     SELECT DISTINCT i.observation_id, 'queued', false, 1, 0,
                            NOW(), NOW(), NOW()
                       FROM inserted i
                     ON CONFLICT (observation_id) DO NOTHING;`;

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(
            `CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger AS $$
             BEGIN
                 ${ENQUEUE}

                 -- #347: the one failure a keyframe answers. Reset as requestRefresh resets
                 -- a row whose keyframes were edited, so the first candidate is tried again.
                 UPDATE observation_thumbnails t
                    SET status = 'queued',
                        permanent = false,
                        request_priority = 1,
                        candidate_index = 0,
                        claimed_at = NULL,
                        completed_at = NULL,
                        requested_at = NOW(),
                        updated_at = NOW()
                   FROM (SELECT DISTINCT observation_id FROM inserted) i
                  WHERE t.observation_id = i.observation_id
                    AND t.status = 'failed'
                    AND t.permanent
                    AND t.last_error = '${NO_KEYFRAMES_ERROR}';

                 RETURN NULL;
             END;
             $$ LANGUAGE plpgsql`
        );
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(
            `CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger AS $$
             BEGIN
                 ${ENQUEUE}

                 RETURN NULL;
             END;
             $$ LANGUAGE plpgsql`
        );
    },
};
