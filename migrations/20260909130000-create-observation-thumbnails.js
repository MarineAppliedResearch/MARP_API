/**
 * Creates `observation_thumbnails` and `thumbnail_extraction_state`, the
 * per-observation thumbnail record and the extractor's own run state.
 *
 * **A table, not columns on `observations`** (R1). Two findings decide it on
 * their own and either would be enough: `observations."updatedAt"` is a mosaic
 * **sort field**, so a thumbnail write onto that row would reorder the mosaic
 * underneath a reviewer as pictures land; and `observations.version` is the three
 * commit routes' concurrency token, so a write anywhere near it would make every
 * commit `conflicted` because a picture arrived. #103 set the same precedent for
 * the same class of reason.
 *
 * **Readiness is not what this table is for.** The human challenged the premise
 * -- *"the thumbnail is a file; if the file doesn't serve, then we know that its
 * state isn't there"* -- and that is right about `ready`. What the filesystem
 * cannot express is the negative space, and three things force a row anyway:
 * absence cannot distinguish *not made yet* from *tried and failed* from *can
 * never be made*, and an observation with no keyframes proves the third exists;
 * a page fetch and a retry each re-queue whatever is missing, so without a record
 * of permanence a hopeless observation is re-enqueued on every page view for ever,
 * against the media server the concurrency bound exists to protect; and A8
 * requires the match score to be written down so the misses are countable, which
 * a file's absence records nothing about.
 *
 * The bytes live on disk under `storage/observation-thumbnails/`, the way species
 * pictures do, and `filename` is relative to it so nothing here depends on where
 * the API is deployed. `storage/` is git-ignored and a thumbnail has no seed set
 * to be re-imported from, so **the row is what says how to make the picture
 * again** (R10) -- that is why `framenum`, `subset`, `source_width` and
 * `source_height` are recorded rather than derived once and forgotten.
 *
 * No data is transformed and no existing row is touched, so this does not go
 * through `db/data-integrity.js`: it creates two empty tables, exactly as
 * `20260909120100-create-observation-reviews.js` does.
 *
 * Refs #118, MarineAppliedResearch/MARP_API#68.
 *
 * @fileoverview Migration creating the thumbnail record and the extractor run state.
 * @author Isaac Travers
 * @module migrations/create-observation-thumbnails
 */

'use strict';

/** @type {Object} */
module.exports = {
    /**
     * Creates both tables, the status check constraint, and the two indexes the
     * access patterns need.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @param {Object} Sequelize - Sequelize library, for data-type constructors.
     * @returns {Promise<void>} Resolves once both tables exist.
     * @throws {Error} Re-throws after rolling back if creation fails.
     */
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            await queryInterface.createTable(
                'observation_thumbnails',
                {
                    observation_thumbnail_id: {
                        // Its own sequence, assigned by the database. Deliberately
                        // not the `observations` pattern, where the application
                        // computes max(id) + 1 and the sequence drifts unused (#62).
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        primaryKey: true,
                        autoIncrement: true,
                        comment: 'Identifier for this thumbnail record.',
                    },
                    observation_id: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        unique: true,
                        references: { model: 'observations', key: 'observation_id' },
                        // One picture per tile, and Delete Mode is a real
                        // permanent delete -- so the row goes with the
                        // observation rather than orphaning the way
                        // subset_observations was found to (#103).
                        onDelete: 'CASCADE',
                        onUpdate: 'CASCADE',
                        comment: 'The observation this picture is of. Unique: one picture per tile.',
                    },
                    status: {
                        type: Sequelize.STRING(16),
                        allowNull: false,
                        defaultValue: 'queued',
                        comment: 'queued, ready or failed. The client\'s own three (F9). The absence of a row is a fourth thing entirely -- nothing has ever been asked for -- and is never written.',
                    },
                    permanent: {
                        type: Sequelize.BOOLEAN,
                        allowNull: false,
                        defaultValue: false,
                        comment: 'A failure retrying cannot help: no keyframes, no resolvable video, a match below the score bar, a frame past the end. Not tidiness -- without it a page of hopeless legacy rows hammers Jellyfin on every page view, on a button the page invites the reviewer to press.',
                    },
                    framenum: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'The absolute frame the picture was cut from (R8), so it can always be traced back and a re-extraction compared against it. Generally NOT one of the observation\'s keyframes: it is the frame at the observation\'s own time, with the box interpolated between the two that bracket it (A4).',
                    },
                    subset: {
                        type: Sequelize.STRING(64),
                        allowNull: true,
                        comment: 'Which track within the observation the box came from. keyframes.subset distinguishes independently tracked items; ingest defaults it to "1".',
                    },
                    filename: {
                        type: Sequelize.STRING(255),
                        allowNull: true,
                        unique: true,
                        comment: 'Path relative to storage/observation-thumbnails/. Null until a picture exists. The row may outlive the file -- storage is restored separately from the database -- and the serving route answers 404 with an explanation rather than throwing, exactly as the species picture routes do.',
                    },
                    content_type: {
                        type: Sequelize.STRING(64),
                        allowNull: true,
                        comment: 'MIME type, used directly as the Content-Type when serving.',
                    },
                    byte_size: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'Size of the file in bytes. Also what a mean-file-size measurement over a real corpus reads.',
                    },
                    width: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'Width of the stored tile, in pixels.',
                    },
                    height: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'Height of the stored tile, in pixels.',
                    },
                    source_width: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'Width of the decoded frame the crop was computed against (R6). Read from the decode itself, never stored or assumed: the box is normalised, so multiplying it by the wrong dimensions silently crops the wrong part of the seabed and reads as a bad detection rather than as a bug.',
                    },
                    source_height: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        comment: 'Height of the decoded frame the crop was computed against (R6).',
                    },
                    generation: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        defaultValue: 1,
                        comment: 'Bumped by every re-extraction, and what the served ETag is built from. The URL is stable per observation, so without this a replacement picture would be invisible behind a cached copy.',
                    },
                    attempts: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        defaultValue: 0,
                        comment: 'How many times extraction has been claimed for this row.',
                    },
                    last_error: {
                        type: Sequelize.TEXT,
                        allowNull: true,
                        comment: 'Why the last attempt failed, in words. Carries the match score for a video that did not clear the bar (A8) and both frame rates for a rate mismatch (R21), so the misses are countable rather than merely noticed. Never a stream URL: that embeds a Jellyfin access token.',
                    },
                    requested_at: {
                        type: Sequelize.DATE,
                        allowNull: true,
                        comment: 'When this thumbnail was first asked for. The queue is served in this order.',
                    },
                    claimed_at: {
                        type: Sequelize.DATE,
                        allowNull: true,
                        comment: 'When an extractor took this row, or null. With a timeout this is the lease that makes R18 true -- a row claimed by a process that then died becomes available again instead of stranding its tile at PREPARING for ever. Deliberately separate from requested_at: one timestamp cannot be both the queue order and the reclaim clock.',
                    },
                    completed_at: {
                        type: Sequelize.DATE,
                        allowNull: true,
                        comment: 'When extraction last finished, successfully or not.',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal('NOW()'),
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal('NOW()'),
                    },
                },
                { transaction }
            );

            // The vocabulary is spelled out here rather than read from
            // config/thumbnails.js, and that is the rule rather than an
            // oversight: a migration is a record of what was done to a database
            // on a particular day and has to keep saying the same thing for ever.
            // A vocabulary change needs a new migration, and the mismatch shows
            // up as a database error rather than as silence.
            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   ADD CONSTRAINT observation_thumbnails_status_check
                   CHECK (status IN ('queued', 'ready', 'failed'))`,
                { transaction }
            );

            // Only a failure can be permanent. A queued row that claims it can
            // never be made would never be drained and never be retried, which
            // is a tile stuck at PREPARING with nothing recording why.
            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   ADD CONSTRAINT observation_thumbnails_permanent_check
                   CHECK (NOT permanent OR status = 'failed')`,
                { transaction }
            );

            // The queue, and the only scan this table takes. Partial, because
            // `queued` is a small fraction of the table by design -- the working
            // set somebody is looking at, not the corpus.
            await sequelize.query(
                `CREATE INDEX observation_thumbnails_queued_idx
                   ON observation_thumbnails (requested_at, observation_id)
                   WHERE status = 'queued'`,
                { transaction }
            );

            // Created inside the transaction rather than CONCURRENTLY: the table
            // is new and therefore empty, so the build is instant. Said here so
            // the next person does not "fix" it to match migration
            // 20260909120400, which has to be non-transactional for the opposite
            // reason.

            // The mosaic's left join goes through the unique index on
            // observation_id that `unique: true` above already created, so no
            // second index is added for it.

            // The extractor's run state (R25). One row, ever: a service paused
            // because Jellyfin was struggling must still be paused after an API
            // restart, or the pause silently expires at the worst moment.
            await queryInterface.createTable(
                'thumbnail_extraction_state',
                {
                    id: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        primaryKey: true,
                        defaultValue: 1,
                        comment: 'Always 1. A single-row table, kept single by the check constraint below.',
                    },
                    run_state: {
                        type: Sequelize.STRING(16),
                        allowNull: false,
                        defaultValue: 'running',
                        comment: 'running or paused. Paused stops starting new extractions and lets in-flight ones finish -- killing an ffmpeg mid-decode wastes the Jellyfin stream it already paid for. There is no stopped: stop is pause plus discarding the queue, and a discarded row is simply absent again.',
                    },
                    changed_by_user_id: {
                        type: Sequelize.INTEGER,
                        allowNull: true,
                        references: { model: 'users', key: 'user_id' },
                        // Who paused it is provenance, not the record itself --
                        // the same call species_pictures.uploaded_by makes.
                        onDelete: 'SET NULL',
                        onUpdate: 'CASCADE',
                        comment: 'Who last changed the run state. Null for the seeded initial row.',
                    },
                    changed_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.literal('NOW()'),
                        comment: 'When the run state last changed.',
                    },
                    note: {
                        type: Sequelize.TEXT,
                        allowNull: true,
                        comment: 'Why, in the operator\'s words. Optional, and the only place the reason for a pause is recorded.',
                    },
                },
                { transaction }
            );

            await sequelize.query(
                `ALTER TABLE thumbnail_extraction_state
                   ADD CONSTRAINT thumbnail_extraction_state_singleton_check
                   CHECK (id = 1)`,
                { transaction }
            );

            await sequelize.query(
                `ALTER TABLE thumbnail_extraction_state
                   ADD CONSTRAINT thumbnail_extraction_state_run_state_check
                   CHECK (run_state IN ('running', 'paused'))`,
                { transaction }
            );

            // Seeded here so every reader can assume the row exists. A service
            // that has to cope with its own state being absent has two code
            // paths where one will do.
            await sequelize.query(
                `INSERT INTO thumbnail_extraction_state (id, run_state, changed_at)
                 VALUES (1, 'running', NOW())`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    /**
     * Drops both tables. Their constraints and indexes go with them.
     *
     * The JPEG files under `storage/observation-thumbnails/` are deliberately not
     * removed: this owns the database and the caller owns the storage directory,
     * the same split `species.repository.js` states about itself. Nothing is lost
     * either way -- a thumbnail is re-derivable from the database (R10), and once
     * these tables are gone the files are simply orphaned bytes to delete by hand.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once both tables are gone.
     */
    async down(queryInterface) {
        await queryInterface.dropTable('thumbnail_extraction_state');
        await queryInterface.dropTable('observation_thumbnails');
    },
};
