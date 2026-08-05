/**
 * Bundles the video-engine source into the single self-contained script
 * the browser test harness (and later, the C# WebView2 page) loads.
 *
 * Output deliberately goes under frontend/apps/VideoPlayer/dist/ -- a
 * "dist" path segment is already excluded by jsdoc.config.json's
 * excludePattern, so the bundled/minified/sourcemapped build artifact
 * (which inlines mp4box's own source, JSDoc comments and all) never gets
 * parsed into the generated developer docs alongside real source.
 *
 * @fileoverview esbuild bundler script for the video-engine package.
 * @author Isaac Travers
 * @module video-engine/build
 */

const esbuild = require('esbuild');
const path = require('path');

/**
 * Runs the esbuild bundle step.
 *
 * @async
 * @returns {Promise<void>}
 */
async function build() {
    await esbuild.build({
        entryPoints: [path.join(__dirname, 'src', 'index.js')],
        bundle: true,
        format: 'iife',
        globalName: 'MareVideoEngine',
        outfile: path.join(__dirname, '..', 'frontend', 'apps', 'VideoPlayer', 'dist', 'mare-video-engine.js'),
        target: ['chrome94'],
        sourcemap: true,
        logLevel: 'info',
    });
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
