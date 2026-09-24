/**
 * Seeds the catalogue with the settings the `marp_tracking` engine has today.
 *
 * These are the values `TrackingEngine.run()` resolves before the first frame in
 * marp-inference-worker: the detection confidence, the Ultralytics `predict()`
 * settings a job is allowed to set, ByteTrack's four, and one engine constant.
 *
 * Seeded rather than left for the first report to create, because a catalogue
 * row carries a description and a declared type, and one registered by a worker
 * carries only what the report implies. A setting that arrives later and is not
 * here is still added by the API; this is what makes the known ones
 * self-describing from the start.
 *
 * Refs MarineAppliedResearch/MARP_API#232.
 *
 * @fileoverview Migration seeding inference_settings for the marp_tracking engine.
 * @author Isaac Travers
 * @module migrations/seed-inference-settings-catalogue
 */

'use strict';

const { guardDataIntegrity } = require('../db/data-integrity');

/**
 * The engine these settings belong to, as the worker names it.
 *
 * @constant
 * @type {string}
 */
const ENGINE = 'marp_tracking';

/**
 * Every setting, with its type and a description written for whoever is reading
 * an attempt's record.
 *
 * @constant
 * @type {Array<{name: string, value_type: string, description: string}>}
 */
const SETTINGS = [
    {
        name: 'confidence',
        value_type: 'real',
        description: 'Detection confidence floor passed to predict(). A detection scoring below it is discarded before tracking. The rockfish regime ran at 0.60 and the deep-sea regime at 0.001; they are different instruments.',
    },
    {
        name: 'iou',
        value_type: 'real',
        description: 'IoU threshold for non-maximum suppression in predict(). Overlapping detections above it are merged into one.',
    },
    {
        name: 'imgsz',
        value_type: 'int',
        description: 'Size in pixels each frame is resized to before the detector sees it. Larger finds smaller animals and costs more.',
    },
    {
        name: 'augment',
        value_type: 'bool',
        description: 'Test-time augmentation in predict(): each frame is also run flipped and rescaled, and the results combined.',
    },
    {
        name: 'agnostic_nms',
        value_type: 'bool',
        description: 'Whether non-maximum suppression ignores class, so two overlapping boxes of different species merge into one.',
    },
    {
        name: 'max_det',
        value_type: 'int',
        description: 'Most detections predict() keeps on one frame.',
    },
    {
        name: 'half',
        value_type: 'bool',
        description: 'Whether inference ran in 16-bit floating point rather than 32.',
    },
    {
        name: 'track_thresh',
        value_type: 'real',
        description: 'ByteTrack: detections scoring above this are matched first and may open a new track.',
    },
    {
        name: 'match_thresh',
        value_type: 'real',
        description: 'ByteTrack: how close a detection has to be to an existing track to be matched to it.',
    },
    {
        name: 'track_buffer',
        value_type: 'int',
        description: 'ByteTrack: frames a track is kept after it was last seen, before it is ended.',
    },
    {
        name: 'mot20',
        value_type: 'bool',
        description: 'ByteTrack: MOT20 mode, which changes how detections are fused with tracks in crowded scenes.',
    },
    {
        name: 'class_match_iou',
        value_type: 'real',
        description: 'Engine constant, not settable by a job. IoU above which a track\'s box is taken to be the detection that produced it, so the track inherits that detection\'s class.',
    },
];

/** @type {Object} */
module.exports = {
    /**
     * Inserts every setting that is not already there, so it is safe to re-run.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once every setting exists.
     * @throws {Error} Re-throws after rolling back if any insert fails.
     */
    async up(queryInterface) {
        const { sequelize } = queryInterface;
        const { QueryTypes } = sequelize.constructor;
        const transaction = await sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize,
                transaction,
                tables: ['inference_settings'],
                label: 'inference-settings-catalogue',
                work: async () => {
                    const existing = await sequelize.query(
                        'SELECT name FROM inference_settings WHERE engine = :engine',
                        { replacements: { engine: ENGINE }, type: QueryTypes.SELECT, transaction }
                    );
                    const alreadyThere = new Set(existing.map((row) => row.name));

                    const toInsert = SETTINGS.filter((setting) => !alreadyThere.has(setting.name));

                    for (const setting of toInsert) {
                        await sequelize.query(
                            `INSERT INTO inference_settings (engine, name, value_type, description)
                             VALUES (:engine, :name, :valueType, :description)`,
                            {
                                replacements: {
                                    engine: ENGINE,
                                    name: setting.name,
                                    valueType: setting.value_type,
                                    description: setting.description,
                                },
                                transaction,
                            }
                        );
                    }

                    console.log(
                        `[inference-settings-catalogue] ${toInsert.length} added, `
                        + `${SETTINGS.length - toInsert.length} already present`
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
     * Removes the seeded settings that no attempt has recorded a value against.
     *
     * A referenced one is kept, and said so. Undoing the seed must not quietly take
     * an attempt's record with it, and deleting it would fail the RESTRICT key
     * anyway -- which, since migrations are undone in reverse order, would stop a
     * full rollback here rather than at the table migration below this one, whose
     * down drops the whole feature deliberately.
     *
     * @async
     * @param {Object} queryInterface - Sequelize QueryInterface used to run schema changes.
     * @returns {Promise<void>} Resolves once the unreferenced seeded rows are gone.
     * @throws {Error} Re-throws after rolling back if any delete fails.
     */
    async down(queryInterface) {
        const { sequelize } = queryInterface;
        const transaction = await sequelize.transaction();

        try {
            const [, result] = await sequelize.query(
                `DELETE FROM inference_settings s
                  WHERE s.engine = :engine
                    AND s.name IN (:names)
                    AND NOT EXISTS (SELECT 1 FROM gpu_attempt_settings v WHERE v.setting_id = s.id)`,
                {
                    replacements: { engine: ENGINE, names: SETTINGS.map((setting) => setting.name) },
                    transaction,
                }
            );

            const removed = result?.rowCount ?? 0;
            console.log(
                `[inference-settings-catalogue] down: removed ${removed}, `
                + `kept ${SETTINGS.length - removed} that an attempt has recorded against`
            );

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
