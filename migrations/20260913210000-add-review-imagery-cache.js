/**
 * Adds full-frame cache state beside each observation thumbnail and the one
 * persisted storage policy used by both artifact kinds.
 *
 * Every new column is operational, re-creatable state. No observation,
 * keyframe, or review row is transformed.
 *
 * Refs #176, #178.
 */

'use strict';

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024 * 1024;

module.exports = {
    async up(queryInterface, Sequelize) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            const columns = {
                thumbnail_accessed_at: { type: Sequelize.DATE, allowNull: true },
                thumbnail_evicted_at: { type: Sequelize.DATE, allowNull: true },
                full_frame_status: { type: Sequelize.STRING(16), allowNull: true },
                full_frame_permanent: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
                full_frame_framenum: { type: Sequelize.INTEGER, allowNull: true },
                full_frame_subset: { type: Sequelize.STRING(64), allowNull: true },
                full_frame_box: { type: Sequelize.JSONB, allowNull: true },
                full_frame_filename: { type: Sequelize.STRING(255), allowNull: true },
                full_frame_content_type: { type: Sequelize.STRING(64), allowNull: true },
                full_frame_byte_size: { type: Sequelize.BIGINT, allowNull: true },
                full_frame_width: { type: Sequelize.INTEGER, allowNull: true },
                full_frame_height: { type: Sequelize.INTEGER, allowNull: true },
                full_frame_generation: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
                full_frame_last_error: { type: Sequelize.TEXT, allowNull: true },
                full_frame_requested_at: { type: Sequelize.DATE, allowNull: true },
                full_frame_claimed_at: { type: Sequelize.DATE, allowNull: true },
                full_frame_completed_at: { type: Sequelize.DATE, allowNull: true },
                full_frame_accessed_at: { type: Sequelize.DATE, allowNull: true },
                full_frame_evicted_at: { type: Sequelize.DATE, allowNull: true },
            };

            for (const [name, definition] of Object.entries(columns)) {
                await queryInterface.addColumn('observation_thumbnails', name, definition, { transaction });
            }

            /* Names are hashes of bytes, so identical imagery intentionally shares
               one file. A row-level unique constraint turns that deduplication into
               an extraction failure for two observations on the same video frame. */
            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   DROP CONSTRAINT IF EXISTS observation_thumbnails_filename_key`,
                { transaction }
            );

            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   ADD CONSTRAINT observation_thumbnails_full_frame_status_check
                   CHECK (full_frame_status IS NULL OR full_frame_status IN ('queued', 'ready', 'failed'))`,
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE observation_thumbnails
                   ADD CONSTRAINT observation_thumbnails_full_frame_permanent_check
                   CHECK (NOT full_frame_permanent OR full_frame_status = 'failed')`,
                { transaction }
            );
            await sequelize.query(
                `CREATE INDEX observation_thumbnails_full_frame_queue_idx
                   ON observation_thumbnails (full_frame_requested_at, observation_id)
                   WHERE full_frame_status = 'queued'`,
                { transaction }
            );

            await queryInterface.createTable('review_imagery_settings', {
                id: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    primaryKey: true,
                    defaultValue: 1,
                },
                max_bytes: {
                    type: Sequelize.BIGINT,
                    allowNull: false,
                    defaultValue: DEFAULT_MAX_BYTES,
                },
                low_watermark_percent: {
                    type: Sequelize.SMALLINT,
                    allowNull: false,
                    defaultValue: 90,
                },
                eviction_order: {
                    type: Sequelize.STRING(32),
                    allowNull: false,
                    defaultValue: 'full_frames_first',
                },
                changed_by_user_id: {
                    type: Sequelize.INTEGER,
                    allowNull: true,
                    references: { model: 'users', key: 'user_id' },
                    onDelete: 'SET NULL',
                    onUpdate: 'CASCADE',
                },
                changed_at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal('NOW()'),
                },
            }, { transaction });

            await sequelize.query(
                `ALTER TABLE review_imagery_settings
                   ADD CONSTRAINT review_imagery_settings_singleton_check CHECK (id = 1)`,
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE review_imagery_settings
                   ADD CONSTRAINT review_imagery_settings_max_check CHECK (max_bytes > 0)`,
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE review_imagery_settings
                   ADD CONSTRAINT review_imagery_settings_watermark_check
                   CHECK (low_watermark_percent BETWEEN 50 AND 99)`,
                { transaction }
            );
            await sequelize.query(
                `ALTER TABLE review_imagery_settings
                   ADD CONSTRAINT review_imagery_settings_order_check
                   CHECK (eviction_order IN ('full_frames_first', 'oldest_first', 'thumbnails_first'))`,
                { transaction }
            );
            await sequelize.query(
                `INSERT INTO review_imagery_settings
                    (id, max_bytes, low_watermark_percent, eviction_order, changed_at)
                 VALUES (1, :maxBytes, 90, 'full_frames_first', NOW())`,
                { replacements: { maxBytes: DEFAULT_MAX_BYTES }, transaction }
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
            await queryInterface.dropTable('review_imagery_settings', { transaction });
            await queryInterface.removeIndex(
                'observation_thumbnails', 'observation_thumbnails_full_frame_queue_idx', { transaction }
            );
            await sequelize.query(
                'ALTER TABLE observation_thumbnails DROP CONSTRAINT observation_thumbnails_full_frame_permanent_check',
                { transaction }
            );
            await sequelize.query(
                'ALTER TABLE observation_thumbnails DROP CONSTRAINT observation_thumbnails_full_frame_status_check',
                { transaction }
            );

            for (const name of [
                'full_frame_evicted_at', 'full_frame_accessed_at', 'full_frame_completed_at',
                'full_frame_claimed_at', 'full_frame_requested_at', 'full_frame_last_error',
                'full_frame_generation', 'full_frame_height', 'full_frame_width',
                'full_frame_byte_size', 'full_frame_content_type', 'full_frame_filename',
                'full_frame_box', 'full_frame_subset', 'full_frame_framenum', 'full_frame_permanent',
                'full_frame_status', 'thumbnail_evicted_at', 'thumbnail_accessed_at'
            ]) {
                await queryInterface.removeColumn('observation_thumbnails', name, { transaction });
            }


            /* Down restores the older one-row-per-file schema. Duplicate cache
               references are safely made re-creatable before the constraint returns. */
            await sequelize.query(
                `WITH duplicates AS (
                     SELECT observation_thumbnail_id,
                            row_number() OVER (PARTITION BY filename ORDER BY observation_id) AS copy
                       FROM observation_thumbnails
                      WHERE filename IS NOT NULL
                 )
                 UPDATE observation_thumbnails t
                    SET status = 'failed', permanent = false, filename = NULL,
                        content_type = NULL, byte_size = NULL, width = NULL, height = NULL,
                        last_error = 'Cache reference reset while reverting shared review imagery.'
                   FROM duplicates d
                  WHERE t.observation_thumbnail_id = d.observation_thumbnail_id AND d.copy > 1`,
                { transaction }
            );
            await sequelize.query(
                `DO $$ BEGIN
                   IF NOT EXISTS (
                       SELECT 1 FROM pg_constraint
                        WHERE conrelid = 'observation_thumbnails'::regclass
                          AND conname = 'observation_thumbnails_filename_key'
                   ) THEN
                       ALTER TABLE observation_thumbnails
                         ADD CONSTRAINT observation_thumbnails_filename_key UNIQUE (filename);
                   END IF;
                 END $$`,
                { transaction }
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
