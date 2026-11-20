/**
 * File: scripts/import-habitat-model.js
 * Purpose: Register a habitat model trained outside MARP, so habitat lines can be run on it.
 * Context: MARP_API#287. Isaac, 2026-11-20: bring the feasibility experiment's trained model
 *          into MARP and start using it, rather than spending a weekend training one through
 *          MARP first. The experiment saved each model as a timm state dict -- the same file
 *          MARP's habitat trainer writes -- beside a `_results.json` holding the cut-offs it
 *          chose on the tuning dives, its crop and its input size. This reads the two and
 *          registers the model with `registerHabitatModel`, exactly as a habitat model MARP
 *          trained is registered, the settled stretch rules (Mud's +0.2 among them) included.
 *
 *          Reads nothing but the two files it is given; prints what it would register and
 *          writes nothing unless `--apply` is passed. Running it twice registers once.
 *
 * Usage:
 *   node scripts/import-habitat-model.js --weights <model.pt> --results <model_results.json> \
 *       --name <model name> [--apply]
 *
 * Reads the same DB_* settings as everything else, through model/index.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** The experiment's class order: its training script's, and so its head's. */
const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];

/** The crops the experiment named, as fractions of the frame. Only the habitat crop is kept. */
const CROPS = { habitat: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1.0 } };

/**
 * The value after a flag, or null.
 *
 * @param {string} flag
 * @returns {?string}
 */
function option(flag) {
    const at = process.argv.indexOf(flag);
    return at > -1 && process.argv[at + 1] ? process.argv[at + 1] : null;
}

/**
 * What a habitat trainer would have published, from the experiment's results file.
 *
 * @param {Object} results - The parsed `_results.json`.
 * @returns {{substrates: Array<string>, cut_offs: Object, crop: Object, input_size: number}}
 * @throws {Error} When the file does not describe a habitat-crop model of the five substrates.
 */
function publishedFrom(results) {
    const settings = results.settings || {};
    const thresholds = results.thresholds || {};
    const crop = CROPS[settings.crop];
    if (!crop) throw new Error(`crop "${settings.crop}" is not the habitat crop; only habitat-crop models are imported`);
    const names = Object.keys(thresholds);
    if (names.length !== SUBSTRATES.length || SUBSTRATES.some((name) => !(name in thresholds))) {
        throw new Error(`cut-offs are for ${names.join(', ')}, not ${SUBSTRATES.join(', ')}`);
    }
    return {
        substrates: SUBSTRATES,
        // Two places, as the trainer rounds them: 0.39999999999999997 is 0.40.
        cut_offs: Object.fromEntries(SUBSTRATES.map((name) => [name, Math.round(thresholds[name] * 100) / 100])),
        crop,
        input_size: Number(settings.size),
    };
}

async function main() {
    const weights = option('--weights');
    const resultsPath = option('--results');
    const name = option('--name');
    if (!weights || !resultsPath || !name) {
        throw new Error('usage: --weights <model.pt> --results <model_results.json> --name <model name> [--apply]');
    }

    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    const published = publishedFrom(results);
    const test = results.finetuned_test || {};
    const macro = SUBSTRATES.map((s) => (test[s] || {}).f1).filter((v) => typeof v === 'number');
    const notes = `Imported from the habitat feasibility experiment (#287): ${path.basename(weights)}, `
        + `test macro F1 ${macro.length ? (macro.reduce((a, b) => a + b, 0) / macro.length).toFixed(3) : 'unknown'}.`;

    console.log(`Would register "${name}": ${notes}`);
    console.log(`  cut-offs as tuned: ${JSON.stringify(published.cut_offs)}; crop ${JSON.stringify(published.crop)}; input ${published.input_size}`);
    if (!process.argv.includes('--apply')) {
        console.log('Nothing written. Pass --apply to register it.');
        return;
    }

    // Loaded only now, so a dry run needs no database.
    const db = require('../model');
    const { registerHabitatModel } = require('../repository/trained-model.repository');
    try {
        const transaction = await db.sequelize.transaction();
        try {
            const done = await registerHabitatModel({ db, weightsPath: weights, published, name, notes, transaction });
            await transaction.commit();
            console.log(done.existing
                ? `Already registered as model ${done.id} (${done.name}); nothing changed.`
                : `Registered model ${done.id} (${done.name}).`);
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } finally {
        await db.sequelize.close();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = { publishedFrom, SUBSTRATES };
