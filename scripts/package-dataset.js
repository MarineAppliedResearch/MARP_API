/**
 * Packages a built YOLO dataset into one archive MARP can serve to a worker.
 *
 * The legacy builders write a dataset as a tree on the machine that built it, with a
 * `classnames.yaml` naming absolute paths on that machine. A GPU worker somewhere else
 * cannot use either of those things, so this turns a tree into a single file addressed by
 * its hash, and records it on the `datasets` row.
 *
 * **What goes in, and what does not.** `train/` and `eval/` with their labels, plus a
 * normalized `data.yaml`. Two directories are deliberately left out:
 *
 * - `for_human_review/` -- review imagery, not training data.
 * - `crops/` -- only ever used by the three-phase curriculum pipeline, which was an
 *   experiment that did not work out. Training is one ordinary run over one dataset now,
 *   so the crops tree is dead weight that would add hundreds of megabytes to every fetch.
 *
 * **The yaml is rewritten, not copied.** A dataset built for the phase pipeline carries
 * three (`crops-`, `frames-`, `mixed-`) and the right one for an ordinary run is the
 * frames one: train plus eval and nothing else. Choosing here rather than on the worker
 * means the worker never has to know the phases existed. The paths are made relative on
 * the way in, because absolute ones describe a machine rather than a dataset.
 *
 * **tar, uncompressed, on purpose.** A dataset is overwhelmingly JPEG, which does not
 * compress, so gzip would spend minutes of CPU to save almost nothing. Uncompressed tar
 * also streams, and Python reads it with the standard library, so the worker needs no
 * dependency to unpack it.
 *
 *   node scripts/package-dataset.js --dir "<dataset folder>" --name rockfish5
 *   node scripts/package-dataset.js --dir "..." --name rockfish5 --apply
 *
 * Dry run by default: it reports what it would include and writes nothing.
 * Run from the repository root, so `dotenv` finds `.env`.
 *
 * @fileoverview Packages a YOLO dataset tree into a servable archive and records it.
 * @module scripts/package-dataset
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const db = require('../model');

// One definition, shared with the route that serves these, so the writer and the
// reader can never disagree about where archives are.
const { DATASET_DIRECTORY: ARCHIVE_DIRECTORY, DATASET_PATH_PREFIX: ARCHIVE_PATH_PREFIX } = require('../config/gpu-orchestration');


/** The splits that make up a training archive, as <archive member> => <source folder>. */
const SPLITS = [['train', 'train'], ['eval', 'eval']];


/**
 * Reads a flag's value from argv.
 *
 * @param {string} flag - The flag name, including dashes.
 * @returns {string|undefined} The value that followed it.
 */
function arg(flag) {
    const at = process.argv.indexOf(flag);
    return at === -1 ? undefined : process.argv[at + 1];
}


/**
 * Picks the YAML that describes an ordinary training run.
 *
 * @param {string} dir - The dataset folder.
 * @returns {string} Path to the chosen YAML.
 * @throws {Error} When the folder carries none.
 */
function chooseYaml(dir) {
    /* `frames-` first: it is train plus eval, which is exactly one ordinary run.
       `classnames.yaml` is what the simpler datasets carry and means the same thing.
       `mixed-` is never chosen -- it pulls in the crops tree this archive excludes. */
    for (const candidate of ['frames-classnames.yaml', 'classnames.yaml']) {
        const full = path.join(dir, candidate);
        if (fs.existsSync(full)) return full;
    }
    throw new Error(
        `no frames-classnames.yaml or classnames.yaml in ${dir}; `
        + 'a crops-only or mixed dataset cannot be an ordinary training run'
    );
}


/**
 * Rewrites a dataset YAML so its paths describe the archive rather than a machine.
 *
 * @param {string} yamlPath - The chosen source YAML.
 * @returns {{text: string, classes: number, names: string[]}} The normalized YAML.
 */
function normalizeYaml(yamlPath) {
    const source = fs.readFileSync(yamlPath, 'utf8');

    /* Parsed by hand rather than with a YAML dependency: these files are written by our
       own builder and are a names list, an `nc`, and two paths. Anything else in one is
       something we did not write and should be looked at rather than silently re-emitted. */
    const names = [];
    let inNames = false;
    for (const line of source.split(/\r?\n/)) {
        if (/^names:\s*$/.test(line)) { inNames = true; continue; }
        if (inNames && /^\s*-\s+/.test(line)) { names.push(line.replace(/^\s*-\s+/, '').trim()); continue; }
        if (inNames && line.trim() && !/^\s*-\s+/.test(line)) inNames = false;
    }
    if (!names.length) throw new Error(`no class names found in ${yamlPath}`);

    /* Relative, and pointing at where this script puts the splits inside the archive.
       The worker makes them absolute against wherever it unpacked, which is the one
       thing it cannot know in advance (#67 R12). */
    const text = [
        'names:',
        ...names.map((name) => `- ${name}`),
        `nc: ${names.length}`,
        'train: train/images',
        'val: eval/images',
        '',
    ].join('\n');

    return { text, classes: names.length, names };
}


/**
 * Counts the image files in a split.
 *
 * @param {string} dir - The split's images folder.
 * @returns {number} How many images it holds.
 */
function countImages(dir) {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((name) => /\.(jpe?g|png)$/i.test(name)).length;
}


/**
 * Packages the dataset and records it.
 *
 * @async
 * @returns {Promise<void>} Resolves when the report is printed and any writes committed.
 */
async function main() {
    const dir = arg('--dir');
    const name = arg('--name');
    const apply = process.argv.includes('--apply');

    if (!dir || !name) throw new Error('usage: --dir <dataset folder> --name <dataset name> [--apply]');
    if (!fs.existsSync(dir)) throw new Error(`no such dataset folder: ${dir}`);

    const yamlPath = chooseYaml(dir);
    const { text: yamlText, classes, names } = normalizeYaml(yamlPath);

    const counts = Object.fromEntries(
        SPLITS.map(([member]) => [member, countImages(path.join(dir, member, 'images'))])
    );
    const samples = Object.values(counts).reduce((sum, n) => sum + n, 0);

    console.log(apply ? '== packaging ==' : '== dry run; nothing will be written ==');
    console.log(`dataset:  ${name}`);
    console.log(`from:     ${dir}`);
    console.log(`yaml:     ${path.basename(yamlPath)} -> data.yaml with relative paths`);
    console.log(`classes:  ${classes} (${names.join(', ')})`);
    console.log(`images:   ${samples} (${SPLITS.map(([m]) => `${m} ${counts[m]}`).join(', ')})`);
    console.log('excluded: for_human_review/ (not training data), crops/ (curriculum phases, retired)');

    if (!apply) {
        console.log('\nnothing written. Re-run with --apply.');
        return;
    }

    fs.mkdirSync(ARCHIVE_DIRECTORY, { recursive: true });
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-dataset-'));
    const partial = path.join(ARCHIVE_DIRECTORY, `packaging-${process.pid}.tar.partial`);

    try {
        fs.writeFileSync(path.join(staging, 'data.yaml'), yamlText, 'utf8');

        /* One tar call, not two, and every `-C` absolute while `-f` stays a bare
           filename in the directory tar runs in.

           Both halves of that are scars. GNU tar reads `-f C:\path` as `host:path`
           and tries to reach a machine called `C` -- "Cannot connect to C: resolve
           failed", on a local file -- so the archive is named relative to `cwd`.
           And appending with `-rf` across directories failed on a 4.9 GB archive
           with "Cannot read: Bad file descriptor", so the yaml goes in during the
           create rather than afterwards. `-C` applies to the members that follow
           it, which is what lets two directories contribute to one archive. */
        const present = SPLITS.map(([member]) => member).filter((m) => fs.existsSync(path.join(dir, m)));

        execFileSync('tar', [
            /* `labels.cache` is Ultralytics' scan of a split and it stores the
               absolute image paths of the machine that scanned it. Shipped to a
               worker it is stale state naming directories that do not exist there,
               and Ultralytics trusts it ahead of re-scanning. The worker builds
               its own. */
            '--exclude', '*.cache',
            '-cf', path.basename(partial),
            '-C', path.resolve(dir), ...present,
            '-C', path.resolve(staging), 'data.yaml',
        ], { cwd: ARCHIVE_DIRECTORY, stdio: 'inherit' });

        /* Hashed by streaming: the archive is gigabytes and must never be held in memory. */
        const digest = crypto.createHash('sha256');
        await new Promise((done, fail) => {
            fs.createReadStream(partial)
                .on('data', (chunk) => digest.update(chunk))
                .on('end', done)
                .on('error', fail);
        });
        const sha256 = digest.digest('hex');
        const bytes = fs.statSync(partial).size;

        /* Content-addressed, so packaging the same dataset twice is the same file and
           re-running this script is not a way to accumulate copies. */
        const finalName = `${sha256}.tar`;
        const finalPath = path.join(ARCHIVE_DIRECTORY, finalName);
        if (fs.existsSync(finalPath)) fs.rmSync(partial); else fs.renameSync(partial, finalPath);

        const archivePath = `${ARCHIVE_PATH_PREFIX}/${finalName}`;
        /* Updated when the dataset is already known, inserted when it is not.
           `ON CONFLICT` cannot do this: `datasets.name` carries no unique index, so a
           re-package would quietly add a second row for the same dataset and the list
           of datasets would grow every time somebody rebuilt one. */
        const [existing] = await db.sequelize.query(
            'SELECT id FROM datasets WHERE name = :name ORDER BY id LIMIT 1',
            { replacements: { name }, type: db.Sequelize.QueryTypes.SELECT, logging: false }
        );

        let datasetId;
        if (existing) {
            datasetId = existing.id;
            await db.sequelize.query(
                `UPDATE datasets SET location = :location, num_samples = :samples,
                        num_classes = :classes, status = 'ready', archive_path = :archivePath,
                        archive_sha256 = :sha256, archive_bytes = :bytes,
                        class_names = :classNames::jsonb, updated_at = now()
                 WHERE id = :id`,
                {
                    replacements: {
                        id: datasetId, location: dir, samples, classes, archivePath, sha256, bytes,
                        /* In index order. A YOLO label file carries a class index, and
                           an index means nothing without the list it indexes into. */
                        classNames: JSON.stringify(names),
                    },
                    logging: false,
                }
            );
        } else {
            const [inserted] = await db.sequelize.query(
                `INSERT INTO datasets (name, description, location, num_samples, num_classes,
                                       source, status, archive_path, archive_sha256, archive_bytes,
                                       class_names, created_at, updated_at)
                 VALUES (:name, :description, :location, :samples, :classes,
                         'legacy import', 'ready', :archivePath, :sha256, :bytes,
                         :classNames::jsonb, now(), now())
                 RETURNING id`,
                {
                    replacements: {
                        name,
                        description: `Packaged from ${dir} for remote training.`,
                        location: dir,
                        samples,
                        classes,
                        archivePath,
                        sha256,
                        bytes,
                        classNames: JSON.stringify(names),
                    },
                    type: db.Sequelize.QueryTypes.INSERT,
                    logging: false,
                }
            );
            datasetId = inserted[0].id;
        }

        console.log(`\narchive:  ${archivePath}`);
        console.log(`sha256:   ${sha256}`);
        console.log(`bytes:    ${bytes.toLocaleString()}`);
        console.log(`dataset row: #${datasetId}${existing ? ' (updated)' : ' (new)'}`);
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        if (fs.existsSync(partial)) fs.rmSync(partial, { force: true });
    }
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exit(1);
    });
