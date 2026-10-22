/**
 * Records how many images of each species each split of an already-built dataset holds.
 *
 * `dataset_split_species` is written by the build from `20261022230000` onwards, so every
 * dataset built before that has a species breakdown in observations and no bar to put
 * beside it. That is all four that exist, which would make the panel's new bars empty on
 * the only datasets anybody has.
 *
 * **Counting the archive is the right mechanism exactly once**, for the same reason the
 * per-split counts are backfilled that way: the number cannot change afterwards, since an
 * archive is named for its own hash. It is a heavier read than that one -- every label
 * file rather than every header, fifty thousand of them on the larger datasets -- which
 * is why the build counts as it writes and this exists only to catch up.
 *
 * **Distinct classes per frame, not label lines.** Three urchins in one frame are three
 * lines and one picture of an urchin. It follows that these sum to more than
 * `dataset_splits.images`, which is a property of the data rather than a discrepancy.
 *
 * **An archive it cannot read records nothing, not zero**, and neither does a dataset
 * with no class vocabulary: a class index means nothing without the `dataset_classes`
 * rows that name it, and guessing would put a bar under the wrong species.
 *
 * A script rather than a data migration, because it depends on files being present on the
 * machine that runs it -- a migration would record itself applied on a server whose
 * archives live elsewhere and leave the rows empty for ever.
 *
 *   node scripts/backfill-split-species-images.js            # dry run; writes nothing
 *   node scripts/backfill-split-species-images.js --apply
 *   node scripts/backfill-split-species-images.js --apply --dataset 7
 *
 * Idempotent: it replaces a dataset's rows wholesale, so running it twice is running it
 * once. Run from the repository root, so `dotenv` finds `.env`.
 *
 * @fileoverview Backfills dataset_split_species for datasets built before it was recorded.
 * @module scripts/backfill-split-species-images
 */

'use strict';

const db = require('../model');
const preview = require('../service/dataset-preview.service');
const { SPLIT_DIRECTORIES } = require('../service/dataset-build.service');

/**
 * Every dataset that has membership, so there is a split to record anything against.
 *
 * @async
 * @param {number|null} only - One dataset id, or null for all of them.
 * @returns {Promise<Object[]>} `{id, name}`.
 */
async function candidates(only) {
    return db.sequelize.query(
        `SELECT d.id, d.name
           FROM datasets d
          WHERE EXISTS (SELECT 1 FROM dataset_observations o WHERE o.dataset_id = d.id)
            AND (:only::int IS NULL OR d.id = :only)
          ORDER BY d.id`,
        { replacements: { only }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
    );
}

/**
 * The class vocabulary the build wrote, as the map the label files need read through.
 *
 * @async
 * @param {number} datasetId - The dataset.
 * @returns {Promise<Map<number, number>>} Class index to `species.id`.
 */
async function vocabularyOf(datasetId) {
    const rows = await db.sequelize.query(
        `SELECT class_index, species_id
           FROM dataset_classes
          WHERE dataset_id = :datasetId
            AND species_id IS NOT NULL
          ORDER BY class_index`,
        { replacements: { datasetId }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
    );

    return new Map(rows.map((row) => [row.class_index, row.species_id]));
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
 * Works out and records one dataset's per-species, per-split image counts.
 *
 * @async
 * @param {Object} dataset - From {@link candidates}.
 * @param {boolean} apply - Whether to write.
 * @returns {Promise<string>} What happened, for the report.
 */
async function backfill(dataset, apply) {
    const splits = await splitsOf(dataset.id);

    if (!splits.length) return 'no membership';

    const vocabulary = await vocabularyOf(dataset.id);

    /* Without the vocabulary a class index is an integer with no meaning. Recording
       nothing leaves the bars unknown, which is true; recording something would put one
       species' pictures under another's name. */
    if (!vocabulary.size) return 'no class vocabulary';

    let byDirectory;

    try {
        byDirectory = await preview.splitClassImages(dataset.id);
    } catch (error) {
        // The ordinary case for a legacy import: no archive to count.
        return `no archive (${error.message.replace(/\.$/, '')})`;
    }

    /* `validation` and `eval` both live in `eval/`, so a dataset carrying both has no way
       to say which of them an image belongs to. Recorded only where one split owns the
       directory; the others keep nothing, which the panel reads as not known. */
    const owners = {};

    for (const split of splits) {
        const directory = SPLIT_DIRECTORIES[split];

        if (directory) owners[directory] = (owners[directory] || 0) + 1;
    }

    const writes = [];
    const report = [];
    let unnamed = 0;

    for (const split of splits) {
        const directory = SPLIT_DIRECTORIES[split];
        const counts = directory && owners[directory] === 1 ? byDirectory[directory] : null;

        if (!counts) {
            report.push(`${split}=unknown`);

            continue;
        }

        let species = 0;

        for (const [klass, images] of counts) {
            const speciesId = vocabulary.get(klass);

            /* A class the vocabulary does not name cannot be attributed. Counted and
               reported rather than dropped silently, because more than a couple of these
               means the archive and the vocabulary are not the same build. */
            if (!speciesId) {
                unnamed += images;

                continue;
            }

            writes.push({ split, speciesId, images });
            species += 1;
        }

        report.push(`${split}=${species} species`);
    }

    if (!writes.length) return `${report.join(', ')} (nothing to record)`;

    if (apply) {
        const transaction = await db.sequelize.transaction();

        try {
            /* Replaced wholesale, the way `recordBuild` does it, so a re-run after a
               species was removed from the dataset does not leave its bar behind. */
            await db.sequelize.query(
                'DELETE FROM dataset_split_species WHERE dataset_id = :datasetId',
                { replacements: { datasetId: dataset.id }, transaction, logging: false }
            );

            for (const row of writes) {
                await db.sequelize.query(
                    `INSERT INTO dataset_split_species
                         (dataset_id, split, species_id, images, created_at, updated_at)
                     VALUES (:datasetId, :split, :speciesId, :images, NOW(), NOW())`,
                    {
                        replacements: { datasetId: dataset.id, ...row },
                        transaction,
                        logging: false,
                    }
                );
            }

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();

            throw error;
        }
    }

    return `${report.join(', ')}${unnamed ? `, ${unnamed} unnamed-class images skipped` : ''}`;
}

/**
 * Reports what it would do, or does it.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const apply = process.argv.includes('--apply');
    const at = process.argv.indexOf('--dataset');
    const only = at === -1 ? null : Number(process.argv[at + 1]);

    if (at !== -1 && !Number.isInteger(only)) {
        throw new Error('--dataset takes a dataset id.');
    }

    console.log(apply ? '== recording ==' : '== dry run; nothing will be written ==');

    const datasets = await candidates(only);

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
