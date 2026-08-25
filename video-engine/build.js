/**
 * Bundles the video-engine source into the single self-contained script a
 * consumer loads -- the browser test harness, and the C# WebView2 host's
 * player page.
 *
 * One file is the whole point: the bundle carries the engine, the player UI
 * (markup, stylesheet, and the placeholder mark as an inlined data URI), so
 * a consumer copying one script gets a complete working player with no
 * assets folder to keep in sync and no relative paths to break inside a
 * WebView2 virtual-host mapping.
 *
 * Output deliberately goes under frontend/apps/VideoPlayer/dist/ -- a
 * "dist" path segment is already excluded by jsdoc.config.json's
 * excludePattern, so the bundled/minified/sourcemapped build artifact
 * (which inlines mp4box's own source, JSDoc comments and all) never gets
 * parsed into the generated developer docs alongside real source.
 *
 * video-engine/assets/ is kept as the source of truth for the mark, but is
 * no longer copied next to the bundle: src/ui/logo.js holds the downscaled
 * WebP the player actually displays.
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
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
