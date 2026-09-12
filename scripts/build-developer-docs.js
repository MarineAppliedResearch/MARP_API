/**
 * Builds the generated developer documentation served at `/developer-docs`.
 *
 * Two steps, and the second one is why this script exists rather than a `&&`
 * between two commands.
 *
 * **jsdoc exits 1 even under `--lenient`.** It logs an error for every tag
 * expression it cannot parse -- this repository has nine, all of them
 * `import('pg').Client` and destructured `@param` records that jsdoc's grammar
 * predates -- then finishes the site and exits non-zero anyway. Chained with
 * `&&`, nothing after it ever runs. So the site was built and the assets were
 * never copied, which is the state #140 found.
 *
 * **The front page needs images at a path jsdoc will not produce.** jsdoc uses
 * `README.md` as the front page, and the README is written for GitHub: it
 * references its images relative to the repository root, as
 * `frontend/shared/assets/images/marp-logo.png`. Emitted into
 * `docs/developer/index.html`, that same markup resolves against *that*
 * directory, so the browser asks for
 * `docs/developer/frontend/shared/assets/images/marp-logo.png` and gets a 404 --
 * the logo, the mark in the footer, and all five application screenshots, on
 * every build.
 *
 * The fix is to make that path exist. The alternatives were to rewrite the
 * README (wrong on GitHub), to keep a second front page (two documents that
 * drift), or to reference `/assets/...` (only resolves through a running
 * server, and these files are also opened from disk). Mirroring the path costs
 * a copy and leaves one README that is correct in both places.
 *
 * jsdoc's own `templates.default.staticFiles` cannot do it: it strips the
 * include root from every path it copies, so it can only flatten the images
 * into the top of the output, which is not where the README looks for them.
 *
 * Run by `npm run docs:dev:build`.
 *
 * @module scripts/build-developer-docs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** The repository root, one level up from `scripts/`. */
const repositoryRoot = path.join(__dirname, '..');

/** Where jsdoc writes the site. Must match `opts.destination` in the config. */
const destinationRoot = path.join(repositoryRoot, 'docs', 'developer');

/**
 * Directories mirrored into the documentation output, each at the path the
 * built page already asks for. The entry is relative to the repository root and
 * is used unchanged as the destination under `docs/developer`, which is the
 * whole point: the source path and the published path are the same string.
 *
 * @constant
 * @type {string[]}
 */
const MIRRORED = [
    path.join('frontend', 'shared', 'assets', 'images')
];

/**
 * Copies one directory recursively, creating the destination as needed.
 *
 * @param {string} from absolute source directory.
 * @param {string} to absolute destination directory.
 * @returns {number} how many files were written.
 */
function copyDirectory(from, to) {
    fs.mkdirSync(to, { recursive: true });

    let written = 0;

    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);

        if (entry.isDirectory()) {
            written += copyDirectory(source, target);
            continue;
        }

        fs.copyFileSync(source, target);
        written += 1;
    }

    return written;
}

/**
 * Runs jsdoc against the checked-in configuration.
 *
 * Its exit code is returned rather than obeyed, because a tag jsdoc cannot
 * parse is not a reason to publish a site with no images on its front page.
 * It is still reported, so the count does not quietly grow.
 *
 * @returns {number} jsdoc's exit code.
 */
function runJsdoc() {
    const result = spawnSync(
        process.execPath,
        [
            path.join(repositoryRoot, 'node_modules', 'jsdoc', 'jsdoc.js'),
            '-c', path.join(repositoryRoot, 'jsdoc.config.json'),
            '--lenient'
        ],
        { cwd: repositoryRoot, stdio: 'inherit' }
    );

    if (result.error) {
        throw result.error;
    }

    return result.status;
}

/**
 * Builds the site and mirrors the assets its front page references.
 *
 * @returns {void}
 */
function main() {
    const jsdocExit = runJsdoc();

    // The one thing that really is fatal. Anything else and the images would be
    // copied into a directory this script created, producing a site made of
    // nothing but images, which looks like a build rather than a failure.
    if (!fs.existsSync(path.join(destinationRoot, 'index.html'))) {
        throw new Error(`jsdoc produced no index.html in ${destinationRoot} (exit ${jsdocExit})`);
    }

    for (const relative of MIRRORED) {
        const from = path.join(repositoryRoot, relative);

        if (!fs.existsSync(from)) {
            throw new Error(`nothing to mirror at ${relative}`);
        }

        const written = copyDirectory(from, path.join(destinationRoot, relative));

        console.log(`docs: mirrored ${written} file(s) into docs/developer/${relative.split(path.sep).join('/')}`);
    }

    if (jsdocExit !== 0) {
        console.log(`docs: jsdoc exited ${jsdocExit}; the site above is complete, the errors are unparsed tags`);
    }
}

main();
