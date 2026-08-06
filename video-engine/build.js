/**
 * Bundles the video-engine source into the single self-contained script
 * the browser test harness (and later, the C# WebView2 page) loads, and
 * copies video-engine/assets/ alongside it.
 *
 * Output deliberately goes under frontend/apps/VideoPlayer/dist/ -- a
 * "dist" path segment is already excluded by jsdoc.config.json's
 * excludePattern, so the bundled/minified/sourcemapped build artifact
 * (which inlines mp4box's own source, JSDoc comments and all) never gets
 * parsed into the generated developer docs alongside real source.
 *
 * Assets (e.g. the MARP mark placeholder logo) live under
 * video-engine/assets/, not inlined into the JS bundle and not referenced
 * from MARP_API's own /assets/ route -- this package needs to work as a
 * standalone library with no dependency on the app it happens to be
 * developed alongside, so its own assets ship in its own folder,
 * copied to dist/assets/ next to the bundle every build.
 *
 * @fileoverview esbuild bundler script for the video-engine package.
 * @author Isaac Travers
 * @module video-engine/build
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

/**
 * Runs the esbuild bundle step, then copies video-engine/assets/ into the
 * same output directory as the bundle.
 *
 * @async
 * @returns {Promise<void>}
 */
async function build() {
    const outDir = path.join(__dirname, '..', 'frontend', 'apps', 'VideoPlayer', 'dist');

    await esbuild.build({
        entryPoints: [path.join(__dirname, 'src', 'index.js')],
        bundle: true,
        format: 'iife',
        globalName: 'MarpVideoEngine',
        outfile: path.join(outDir, 'marp-video-engine.js'),
        target: ['chrome94'],
        sourcemap: true,
        logLevel: 'info',
    });

    fs.cpSync(path.join(__dirname, 'assets'), path.join(outDir, 'assets'), { recursive: true });
    console.log(`copied video-engine/assets/ -> ${path.join(outDir, 'assets')}`);
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
