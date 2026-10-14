/**
 * The processor account every inference session belongs to.
 *
 * The annotation GUI reaches a session through its processor -- processor, then
 * project, then session -- so a session with no processor can only be found
 * through View -> By Dive. Inference writes sessions nobody processed by hand,
 * so they all belong to this one account; which model wrote a session's
 * observations is shown separately, from `observations.ml_model_id`.
 *
 * Looked up by name, never by id: `users.name` is unique and ids differ
 * between databases. The account is created by
 * `migrations/20261006120000-create-inference-processor.js`.
 *
 * Deliberately outside `migrations/`, which the migrator globs for files to run.
 *
 * @fileoverview Name and lookup of the inference processor account.
 * @author Isaac Travers
 * @module db/inference-processor
 */

'use strict';

const { QueryTypes } = require('sequelize');

/**
 * Display name of the inference processor. This is what the GUI's processor
 * list shows.
 *
 * @constant
 * @type {string}
 */
const INFERENCE_PROCESSOR_NAME = 'MARP Inference';

/**
 * The inference processor's `user_id` in this database.
 *
 * Throws rather than returning null: a session written without it is the very
 * thing this account exists to prevent, and is invisible from the GUI's
 * opening screen without saying so.
 *
 * @async
 * @param {Object} sequelize - Sequelize instance.
 * @param {Object} [transaction] - Transaction to read inside.
 * @returns {Promise<number>} The account's `user_id`.
 * @throws {Error} When the account does not exist, which means the migration has not run.
 */
async function inferenceProcessorId(sequelize, transaction) {
    const [row] = await sequelize.query(
        'SELECT user_id FROM users WHERE name = :name',
        { replacements: { name: INFERENCE_PROCESSOR_NAME }, type: QueryTypes.SELECT, transaction }
    );

    if (!row) {
        throw new Error(
            `No "${INFERENCE_PROCESSOR_NAME}" user in this database. `
            + 'Run `npx sequelize-cli db:migrate`; it creates the account inference sessions belong to.'
        );
    }

    return row.user_id;
}

module.exports = {
    INFERENCE_PROCESSOR_NAME,
    inferenceProcessorId,
};
