/**
 * Records how many images each split of an already-built dataset holds.
 *
 * `dataset_splits` is written by the build from `20261022190000` onwards, so every
 * dataset built before that has membership, a percentage and a blank where its image
 * count should be. That is most of what exists, and a Composition panel blank for
 * everything built before today is barely better than one showing percentages alone.
 *
 * **Counting the archive is the right mechanism exactly once.** The number cannot change
 * afterwards -- an archive is named for its own hash -- so this walks each tar's headers,
 * which is one 512-byte read per member and about 140 ms over a 2.4 GB archive, and
 * writes the result in. That is the same walk `service/dataset-preview.service.js` does
 * for the preview strip, reused rather than reimplemented.
 *
 * **An archive it cannot read records nothing, not zero.** A dataset whose file has been
 * moved away, or one the legacy packager made and never kept, has an unknown image count
 * -- and zero images in a split is a different fact, true of neither. Writing zeroes
 * would make the panel state a measurement nobody took.
 *
 * A script rather than a data migration, because it depends on files being present on the
 * machine that runs it: a migration that silently does nothing on a server whose archives
 * live elsewhere would record itself as applied and leave the rows empty for ever.
 *
 *   node scripts/backfill-split-images.js            # dry run; writes nothing
 *   node scripts/backfill-split-images.js --apply
 *
 * Idempotent: it replaces whatever it finds, so running it twice is running it once.
 * Run from the repository root, so `dotenv` finds `.env`.
 *
 * @fileoverview Backfills dataset_splits.images for datasets built before it was recorded.
 * @module scripts/backfill-split-images
 */

'use strict';

const db = require('../model');
const preview = require('../service/dataset-preview.service');
const { SPLIT_DIRECTORIES } = require('../service/dataset-build.service');

/**
 * Every dataset that has membership, so there is a split to record anything against.
 *
 * @async
 * @returns {Promise<Object[]>} `{id, name, archive_path}`.
 */
async function candidates() {
    return db.sequelize.query(
        `SELECT d.id, d.name, d.archive_path
           FROM datasets d
          WHERE EXISTS (SELECT 1 FROM dataset_observations o WHERE o.dataset_id = d.id)
          ORDER BY d.id`,
        { type: db.Sequelize.QueryTypes.SELECT, logging: false }
    );
}

/**
 * The splits one dataset's membership names.
 *
 * @async
 * @param {number} datasetId - The dataset.
 * @returns {Promise<string[]>} Its `inclusion_type` values.
 */
async function splitsOf(datasetId) {
    const rows = await db.sequelize.query(
        `SELECT DISTINCT inclusion_type AS split
           FROM dataset_observations
          WHERE dataset_id = :datasetId
          ORDER BY inclusion_type`,
        { replacements: { datasetId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
    );

    return rows.map((row) => row.split);
}

/**
 * Works out and records one dataset's per-split image counts.
 *
 * @async
 * @param {Object} dataset - From {@link candidates}.
 * @param {boolean} apply - Whether to write.
 * @returns {Promise<string>} What happened, for the report.
 */
async function backfill(dataset, apply) {
    const splits = await splitsOf(dataset.id);

    if (!splits.length) return 'no membership';

    let byDirectory;

    try {
        byDirectory = await preview.splitImages(dataset.id);
    } catch (error) {
        /* The ordinary case for a legacy import, and not a failure of this script: there
           is no archive to count, so the count stays unknown. */
        return `no archive (${error.message.replace(/\.$/, '')})`;
    }

    /* `validation` and `eval` both live in `eval/`, so a dataset carrying both has no way
       to say which of them an image belongs to. Recorded only where one split owns the
       directory; the others keep a null, which the panel reads as not known. */
    const owners = {};

    for (const split of splits) {
        const directory = SPLIT_DIRECTORIES[split];

        if (directory) owners[directory] = (owners[directory] || 0) + 1;
    }

    const recorded = [];

    for (const split of splits) {
        const directory = SPLIT_DIRECTORIES[split];
        const images = directory && owners[directory] === 1 ? byDirectory[directory] : undefined;

        if (images === undefined) {
            recorded.push(`${split}=unknown`);

            continue;
        }

        recorded.push(`${split}=${images}`);

        if (apply) {
            await db.sequelize.query(
                `INSERT INTO dataset_splits (dataset_id, split, images, created_at, updated_at)
                 VALUES (:datasetId, :split, :images, NOW(), NOW())
                 ON CONFLICT (dataset_id, split)
                 DO UPDATE SET images = EXCLUDED.images, updated_at = NOW()`,
                { replacements: { datasetId: dataset.id, split, images }, logging: false }
            );
        }
    }

    return recorded.join(', ');
}

/**
 * Reports what it would do, or does it.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const apply = process.argv.includes('--apply');

    console.log(apply ? '== recording ==' : '== dry run; nothing will be written ==');

    const datasets = await candidates();

    if (!datasets.length) {
        console.log('No dataset has membership recorded, so there is nothing to count.');

        return;
    }

    for (const dataset of datasets) {
        const outcome = await backfill(dataset, apply);

        console.log(`  ${String(dataset.id).padStart(5)}  ${dataset.name}: ${outcome}`);
    }

    if (!apply) console.log('\nnothing written. Re-run with --apply.');
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exitCode = 1;
    });
