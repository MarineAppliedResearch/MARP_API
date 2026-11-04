'use strict';

/**
 * A model says what it is: its task, engine, architecture, file format and version label.
 *
 * #321. `ml_models` grew by drift. `model_type` was documented as a family (`yolov8`) and
 * written as a task (`detection`); `architecture_version` was documented as a variant and
 * written as the starting checkpoint's name, or a training phase (`mixed`); `status` was
 * documented as draft/training/trained/archived and written as `active`. Settled with Isaac
 * on 2026-10-31:
 *
 * - **Rewritten in place.** `model_type` is the task and `architecture_version` the
 *   architecture (`yolov8x`, `yolo11m-cls`). **Every original value that changes is
 *   appended to `notes`**, in one fixed sentence, which `down` reads back -- chosen over
 *   separate columns, knowing a query outside MARP reading the old values will not find
 *   them there.
 * - **Status is `active` or `archived`.** `trained` becomes `active`: those are the older
 *   YOLOv8 detectors, which Isaac confirmed are usable. Anything else nobody sets
 *   (`draft`, `training`) becomes `archived`, so nothing of unknown standing is offered
 *   for new jobs; its original is in `notes` like the rest.
 * - **An older `YOLOv8` model** is task `detection`, engine `ultralytics`, architecture
 *   `yolov8`. The API refines that from the weights where they are on disk (`yolov8x`),
 *   in `describeIfUnrecorded`.
 * - **A value that is not an architecture** (a checkpoint name, a phase) is cleared to
 *   null, original in `notes`, for the API to fill from the weights.
 *
 * Adds `engine`, `file_format` and `version_label`, all nullable; `version_label` is the
 * free label Isaac chose over version numbers, blank until somebody types one.
 *
 * @fileoverview Migration rewriting ml_models to say what each model is.
 * @module migrations/a-model-says-what-it-is
 */

const { guardDataIntegrity } = require('../db/data-integrity');

/** The tasks `model_type` holds from now on. */
const TASKS = ['detection', 'classification', 'segmentation', 'pose', 'obb'];

/** An architecture name as Ultralytics writes one: yolov8x, yolo11m-cls. */
const ARCHITECTURE = /^yolo(v?\d+)[nsmlx]?(-(cls|seg|pose|obb))?$/i;

/** The sentence a rewritten row's originals are kept in. `down` parses it. */
const NOTE = 'Before #321:';

/**
 * What one row becomes.
 *
 * @param {Object} row - `{model_type, architecture_version, status, engine}`.
 * @returns {{model_type, architecture_version, status, engine, note: ?string}} The rewrite,
 *   with the sentence recording what changed, or null when nothing did.
 */
function rewrite(row) {
    const family = /yolo(v?\d+)/i.exec(row.model_type || '');
    const next = {
        model_type: TASKS.includes(row.model_type) ? row.model_type
            : family ? 'detection' : row.model_type,
        architecture_version: row.architecture_version && ARCHITECTURE.test(row.architecture_version)
            ? row.architecture_version
            : family ? `yolo${family[1].toLowerCase()}` : null,
        status: ['active', 'archived'].includes(row.status) ? row.status
            : row.status === 'trained' ? 'active' : 'archived',
        engine: family ? 'ultralytics' : row.engine,
    };

    const changed = ['model_type', 'architecture_version', 'status']
        .filter((key) => (next[key] ?? null) !== (row[key] ?? null))
        .map((key) => `${key} was ${row[key] === null ? 'null' : `'${String(row[key]).replace(/'/g, "''")}'`}`);

    return { ...next, note: changed.length ? `${NOTE} ${changed.join('; ')}.` : null };
}

module.exports = {
    rewrite,

    async up(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            await guardDataIntegrity({
                sequelize: queryInterface.sequelize,
                transaction,
                label: 'a model says what it is',
                tables: ['ml_models'],
                work: async () => {
                    await queryInterface.addColumn('ml_models', 'engine', {
                        type: Sequelize.STRING(32),
                        allowNull: true,
                        comment: 'What runs the weights, e.g. "ultralytics". Read from the weights where they are on disk.',
                    }, { transaction });
                    await queryInterface.addColumn('ml_models', 'file_format', {
                        type: Sequelize.STRING(16),
                        allowNull: true,
                        comment: 'Format of the weights file, e.g. "pt".',
                    }, { transaction });
                    await queryInterface.addColumn('ml_models', 'version_label', {
                        type: Sequelize.STRING(64),
                        allowNull: true,
                        comment: 'A free version label somebody typed. Null until one is.',
                    }, { transaction });

                    const rows = await queryInterface.sequelize.query(
                        'SELECT id, model_type, architecture_version, status, engine, notes FROM ml_models ORDER BY id',
                        { type: Sequelize.QueryTypes.SELECT, transaction }
                    );

                    for (const row of rows) {
                        const next = rewrite(row);
                        if (!next.note && next.engine === row.engine) continue;

                        await queryInterface.sequelize.query(
                            `UPDATE ml_models
                                SET model_type = :model_type,
                                    architecture_version = :architecture_version,
                                    status = :status,
                                    engine = :engine,
                                    notes = CASE WHEN CAST(:note AS text) IS NULL THEN notes
                                                 WHEN notes IS NULL OR notes = '' THEN CAST(:note AS text)
                                                 ELSE notes || E'\\n' || CAST(:note AS text) END
                              WHERE id = :id`,
                            { replacements: { ...next, id: row.id }, transaction }
                        );
                    }

                    await queryInterface.changeColumn('ml_models', 'status', {
                        type: Sequelize.STRING,
                        allowNull: false,
                        defaultValue: 'active',
                        comment: 'Lifecycle state: "active" (usable) or "archived" (kept for history, not offered for new jobs).',
                    }, { transaction });
                },
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    async down(queryInterface, Sequelize) {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            const rows = await queryInterface.sequelize.query(
                `SELECT id, notes FROM ml_models WHERE notes LIKE :pattern`,
                { replacements: { pattern: `%${NOTE}%` }, type: Sequelize.QueryTypes.SELECT, transaction }
            );

            for (const row of rows) {
                const lines = row.notes.split('\n');
                const index = lines.findIndex((line) => line.startsWith(NOTE));
                const restored = {};

                for (const [, key, value] of lines[index].matchAll(/(model_type|architecture_version|status) was (null|'((?:[^']|'')*)')/g)) {
                    restored[key] = value === 'null' ? null : value.slice(1, -1).replace(/''/g, "'");
                }
                lines.splice(index, 1);

                const sets = Object.keys(restored).map((key) => `${key} = :${key}`);
                await queryInterface.sequelize.query(
                    `UPDATE ml_models SET ${[...sets, 'notes = :notes'].join(', ')} WHERE id = :id`,
                    { replacements: { ...restored, notes: lines.length ? lines.join('\n') : null, id: row.id }, transaction }
                );
            }

            await queryInterface.changeColumn('ml_models', 'status', {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: 'draft',
            }, { transaction });
            await queryInterface.removeColumn('ml_models', 'version_label', { transaction });
            await queryInterface.removeColumn('ml_models', 'file_format', { transaction });
            await queryInterface.removeColumn('ml_models', 'engine', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
