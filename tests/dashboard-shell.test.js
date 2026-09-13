/**
 * The legacy dashboard's shell: the palette, the logo and the shared account menu.
 *
 * **Deliberately a small file-reading check, and deliberately not a browser tier.** The
 * whole of `frontend/apps/dashboard` is being redesigned, so #151 gave it the MARP look
 * roughly and stopped: the tokens, the compact logo, and the one account menu the other
 * three applications draw. Building a render tier for an application that is about to be
 * replaced would cost more than the restyle did.
 *
 * What this holds is that those three things cannot quietly fall out of any of the four
 * pages -- a link dropped, a page added without them, or a hex written back in. What it
 * cannot see is what a browser draws, which was checked once by hand when the change was
 * made and is recorded in `.marp/verification.md`.
 *
 * Same shape and the same reasoning as `landing-copy` and `docs-branding`: an invariant
 * about what the repository contains.
 *
 * @module tests/dashboard-shell
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'apps', 'dashboard');

/** Every page of the legacy dashboard. */
const PAGES = ['index.html', 'admin.html', 'user-activity.html', 'user-hours.html'];

const raw = Object.fromEntries(
    PAGES.map((page) => [page, fs.readFileSync(path.join(APP, page), 'utf8')]));

const partial = fs.readFileSync(
    path.join(ROOT, 'frontend', 'shared', 'partials', 'header.html'), 'utf8');

/** The pages that draw their header from the shared partial rather than their own navbar. */
const FROM_PARTIAL = ['user-activity.html', 'user-hours.html'];

describe('the legacy dashboard shell', () => {
    describe.each(PAGES)('%s', (page) => {
        /** The component, not a fourth copy of it. */
        it('loads the shared account menu', () => {
            expect(raw[page]).toMatch(/<link rel="stylesheet" href="\/assets\/css\/account-menu\.css">/);
            expect(raw[page]).toMatch(/<script src="\/assets\/js\/account-menu\.js" defer><\/script>/);
        });

        /**
         * The palette has to reach the page from somewhere: the two Bootstrap pages link
         * `tokens.css` themselves, and the two partial pages get it through `shell.css`,
         * which imports it.
         */
        it('is given the MARP palette', () => {
            const linksTokens = /href="\/assets\/css\/tokens\.css"/.test(raw[page]);
            const linksShell = /href="\/shared\/assets\/css\/shell\.css"/.test(raw[page]);

            expect(linksTokens || linksShell).toBe(true);
        });

        /**
         * Bootstrap paints its own ground, so a dark page needs it told. One attribute is
         * the whole of making its cards, tables and forms legible here; the alternative was
         * a pile of overrides for an application that is being replaced.
         */
        it('asks Bootstrap for its dark mode', () => {
            expect(raw[page]).toMatch(/<html lang="en" data-bs-theme="dark">/);
        });

        /** The account control itself, on the component's own hooks. */
        it('carries the account control the component wires', () => {
            const markup = FROM_PARTIAL.includes(page) ? partial : raw[page];

            expect(markup).toMatch(/data-account\b/);
            expect(markup).toMatch(/data-account-button/);
            expect(markup).toMatch(/data-account-menu/);
            expect(markup).toMatch(/data-account-signout/);
        });

        /** The compact mark, which is the treatment every other application uses. */
        it('draws the MARP logo', () => {
            const markup = FROM_PARTIAL.includes(page) ? partial : raw[page];

            expect(markup).toMatch(/marp-logo-compact\.png/);
        });

        /**
         * The palette is a set of names pointing at tokens. A hex here is the thing #151
         * was told not to do, and it is also how this page stops following the palette when
         * the palette moves.
         */
        it('states no colour of its own in its palette block', () => {
            const block = raw[page].match(/:root\s*\{[^}]*\}/);

            if (!block) return;              // the two partial pages declare no palette

            expect(block[0]).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        });
    });

    /**
     * The menu is one component in one place. Three applications reached that point in
     * #151 and this is the fourth; a copy here would be the drift that change removed.
     */
    it('defines no account menu of its own anywhere', () => {
        for (const page of PAGES) {
            expect(raw[page]).not.toMatch(/class="menu"/);
            expect(raw[page]).not.toMatch(/id="userMenu"/);
        }
    });

    /**
     * No human identity is a literal in any of these pages either (#151 R25). The account
     * menu is told who is signed in by the session; a name typed into a page is true for
     * one person and quietly false for everybody else.
     */
    it('names nobody', () => {
        for (const page of PAGES) {
            expect(raw[page]).not.toMatch(/Isaac|Travers/i);
        }
    });
});
