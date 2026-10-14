/**
 * The video player the Mosaic's video page loads is in the checkout (#181).
 *
 * It is installed from a marp-video-player release into
 * `frontend/shared/vendor/marp-video-player/`, and for a day its bundle was not in the
 * repository at all: `.gitignore` ignores every `dist`, so the install was committed
 * without the player, and it worked only on the machine that had run the install. CI
 * builds from a fresh checkout, so this fails there if that happens again.
 *
 * @fileoverview Tripwire for the vendored video player bundle.
 * @author Isaac Travers
 * @module tests/video-player-vendor
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', 'frontend', 'shared', 'vendor', 'marp-video-player');

describe('the vendored video player (#181)', () => {
    it('has its bundle in the checkout, not only on the machine that installed it', () => {
        const bundle = path.join(VENDOR, 'dist', 'marp-video-player.standalone.js');

        expect(fs.existsSync(bundle)).toBe(true);
        expect(fs.statSync(bundle).size).toBeGreaterThan(10000);
    });

    it('is the release PLAYER_VERSION says it is', () => {
        const recorded = fs.readFileSync(path.join(VENDOR, 'PLAYER_VERSION'), 'utf8').trim();
        const bundle = fs.readFileSync(path.join(VENDOR, 'dist', 'marp-video-player.standalone.js'), 'utf8');

        expect(bundle).toContain(`"${recorded}"`);
    });
});
