/**
 * Text and markup checks on the two public entry pages.
 *
 * The entry app is the only thing MARP serves to somebody who has not signed in,
 * and until #152 it had no test at any tier. This is the fast half: it reads
 * `index.html`, `how-it-works.html`, `landing.css` and `app.js` off disk and
 * asserts against their text. No server, no browser, no database -- the render
 * tier lives in `frontend/apps/entry/tests/` and needs all three.
 *
 * What it is really guarding is a page that nobody compiles. A renamed component
 * leaves dead markup behind, a copied sprite leaves an icon that draws nothing,
 * and a tired editor puts *seamless* back. None of those break anything loudly.
 *
 * @fileoverview Fast-tier copy and markup checks for the public landing pages.
 * @author Isaac Travers
 * @module tests/landing-copy
 */

const fs = require('fs');
const path = require('path');

/** Repository root, so the paths below read the same from any working directory. */
const ROOT = path.join(__dirname, '..');

/** The two public pages, by the name a failure message should use. */
const PAGES = {
    'index.html': path.join(ROOT, 'frontend', 'apps', 'entry', 'index.html'),
    'how-it-works.html': path.join(ROOT, 'frontend', 'apps', 'entry', 'how-it-works.html'),
};

/** Raw file text, comments and all. @type {Object<string,string>} */
const raw = Object.fromEntries(
    Object.entries(PAGES).map(([name, file]) => [name, fs.readFileSync(file, 'utf8')])
);

/**
 * The same pages with HTML comments removed.
 *
 * Comments are stripped for the word checks so that a comment explaining a rule
 * cannot trip the rule it explains. Attributes are deliberately left in: R8
 * governs the `<title>`, the `<meta name="description">` and the alt text, not
 * only body copy.
 *
 * @type {Object<string,string>}
 */
const stripped = Object.fromEntries(
    Object.entries(raw).map(([name, html]) => [name, html.replace(/<!--[\s\S]*?-->/g, '')])
);

const css = fs.readFileSync(path.join(ROOT, 'frontend', 'shared', 'assets', 'css', 'landing.css'), 'utf8');
const landingJs = fs.readFileSync(path.join(ROOT, 'frontend', 'shared', 'assets', 'js', 'landing.js'), 'utf8');
const accountJs = fs.readFileSync(
    path.join(ROOT, 'frontend', 'shared', 'assets', 'js', 'account-menu.js'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const pageNames = Object.keys(PAGES);

/**
 * Vocabulary R8 rules out, as one pattern each so a failure can name the phrase.
 *
 * Taken from the requirement rather than invented here. The test is the transplant
 * test made mechanical: every one of these could be lifted onto a defence
 * contractor's site with only the product name changed.
 *
 * @constant
 * @type {string[]}
 */
const BANNED = [
    'proven workflow',
    'trusted output',
    'purpose-built',
    'at scale',
    'unlock',
    'empower',
    'seamless',
    'transformative',
    'streamlined',
    'leverage',
    'robust',
    'revolutionize',
    'revolutionise',
    'cutting-edge',
    'best-in-class',
    'end-to-end',
    'holistic',
    'synergy',
];

/**
 * Every class token used in a `class="..."` attribute on a page.
 *
 * @param {string} html the page text.
 * @returns {Set<string>} class names, deduplicated.
 */
function classesUsed(html) {
    const used = new Set();

    for (const match of html.matchAll(/class="([^"]*)"/g)) {
        for (const token of match[1].split(/\s+/)) {
            if (token) used.add(token);
        }
    }

    return used;
}

/**
 * Does the stylesheet carry at least one rule mentioning this class?
 *
 * The lookahead is what stops `.button` being satisfied by `.button--primary`:
 * a class with a longer sibling would otherwise always look covered.
 *
 * @param {string} className the class token.
 * @returns {boolean} true when `landing.css` selects it somewhere.
 */
function styled(className) {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(`\\.${escaped}(?![\\w-])`).test(css);
}

/**
 * The text inside every heading on a page, plus the stage names in the lane
 * diagram -- which are card labels in everything but the tag they use.
 *
 * @param {string} html the page text.
 * @returns {string[]} trimmed heading text, tags removed.
 */
function headings(html) {
    const found = [];

    for (const match of html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
        found.push(match[1]);
    }
    for (const match of html.matchAll(/<span class="lane__name">([\s\S]*?)<\/span>/gi)) {
        found.push(match[1]);
    }

    return found.map((text) => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

/**
 * Every `href` on a page.
 *
 * @param {string} html the page text.
 * @returns {string[]} href values in document order.
 */
function hrefs(html) {
    return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

describe('landing page copy', () => {

    describe.each(pageNames)('%s', (page) => {

        /* One `it` per word rather than one loop inside a single test, so a
           failure names the offender in the test title as well as the message. */
        it.each(BANNED)('does not say "%s"', (phrase) => {
            const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const hit = pattern.exec(stripped[page]);

            expect(hit ? `${page} says "${hit[0]}"` : null).toBeNull();
        });

        /**
         * R14, and the one check that deliberately reads the comments too. An em
         * dash in a comment is the same tell as one in the copy: it says the text
         * was written by a machine, and the next person to edit the page copies
         * the house style they can see.
         */
        it('contains no em dash, comments included', () => {
            const index = raw[page].indexOf('—');
            const context = index === -1 ? null : raw[page].slice(Math.max(0, index - 60), index + 60);

            expect(context).toBeNull();
        });

        /**
         * R9. The repository was renamed away from MARE; a public page that still
         * says it is a page nobody re-read.
         */
        it('never says MARE', () => {
            const hit = /(?<![a-z0-9])mare(?![a-z0-9])/i.exec(stripped[page]);

            expect(hit ? `${page} says "${hit[0]}"` : null).toBeNull();
        });

        /**
         * R9 reaches further than the word itself. `Explore. Inform. Protect.` is
         * MARE's tagline, and it closed both of these pages for a fortnight before
         * anybody noticed: carrying the parent organisation's line is the same
         * failure as carrying its name, and the word MARE never appears in it. It
         * is a rule-of-three as well, which R14 forbids on its own, so a rework
         * into three other imperatives is not the fix either.
         *
         * The gap between the words has to tolerate markup, which is how this
         * check passed the first time it was pointed at the offending line: the
         * three words were `<span>`, `<strong>` and `<em>`, so anything matching
         * on punctuation alone walked straight past them.
         */
        it('does not close on a borrowed tagline', () => {
            const hit = /explore[\s\S]{0,80}?inform[\s\S]{0,80}?protect/i.exec(stripped[page]);

            expect(hit ? `${page} says "${hit[0]}"` : null).toBeNull();
        });

        /**
         * These pages ship when the thing they describe is finished, so they are
         * written from that side of the line: present tense, declarative, and no
         * hedging about what exists yet. The application cards are included in
         * that. What carries the honesty is the `Open` door, which two of the six
         * have and four do not, and that is a fact about the markup rather than a
         * qualifier in the copy.
         */
        it.each([
            'is being built',
            'is designed to',
            'aims to',
            'coming soon',
            'in development',
            'concept interface',
            'will be able to',
        ])('does not hedge with "%s"', (phrase) => {
            const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const hit = pattern.exec(stripped[page]);

            expect(hit ? `${page} says "${hit[0]}"` : null).toBeNull();
        });

        /**
         * MARP's claim is turnaround, and only turnaround. A dive happens, and the
         * reviewed science comes back in a time that would previously have been a
         * joke. It does **not** claim to be working while the vehicle is in the
         * water, and putting it there is an overclaim rather than a flourish.
         *
         * This is a check because the wrong version arrived from three directions
         * at once during #152's review: the reviewer's comment, the brief written
         * from it, and the draft that followed all said some form of *the science
         * starts moving while the data is still coming in*. It reads well, which
         * is exactly why it needs something mechanical standing in front of it.
         */
        it.each([
            'still in the water',
            'still down there',
            'while the survey is still',
            'while the vehicle is still',
            'during the dive',
            'in real time',
        ])('does not claim MARP works mid-survey with "%s"', (phrase) => {
            const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const hit = pattern.exec(stripped[page]);

            expect(hit ? `${page} says "${hit[0]}"` : null).toBeNull();
        });

        /**
         * `One record` was the hub label and the shorthand the whole architecture
         * section leant on. It is catchy and it is not true: MARP is a relational
         * scientific dataset with connected entities and provenance, so the
         * metaphor had quietly become a claim about the data model. The honest
         * version is that the video, the navigation, the observations, the review
         * decisions, the corrections and the analyses stay connected as the work
         * moves.
         */
        it('does not call MARP one record', () => {
            const hit = /one record/i.exec(stripped[page]);

            expect(hit ? `${page} says "${hit[0]}"` : null).toBeNull();
        });

        /**
         * The same correction as `one record`, arriving by a different route.
         * What MARP holds is *connected* data: the footage, where it was
         * recorded, what the models found, what biologists accepted or corrected
         * and the analyses built on them are separate things that stay attached
         * to each other. `the same data` and `the same record` both collapse that
         * into one blob and make a claim about the data model that is not true.
         */
        it.each(['the same data', 'that same record', 'the same record'])(
            'does not flatten connected data into "%s"',
            (phrase) => {
                const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                const hit = pattern.exec(stripped[page]);

                expect(hit ? `${page} says "${hit[0]}"` : null).toBeNull();
            }
        );

        /**
         * US spelling throughout, settled on the final wording pass. It matters
         * because the mixture is what looks wrong rather than either spelling:
         * the diagram label became `Analyze and report` and left `analysed` on a
         * card two sections away, which reads as a page nobody proofread. The
         * pattern deliberately allows `analyses`, the plural of analysis, which
         * is the same word in both.
         */
        it.each([
            'analyse',
            'behaviour',
            'organis',
            'recognis',
            'neighbour',
            'catalogu',
            'prioritis',
            'summaris',
            'optimis',
        ])('uses US spelling, not "%s"', (stem) => {
            const hit = new RegExp(`${stem}(?!s\\b)[a-z]*`, 'i').exec(stripped[page]);

            expect(hit ? `${page} says "${hit[0]}"` : null).toBeNull();
        });

        /**
         * R2. `Collect -> Review -> Process -> Assist -> Deliver` was the old
         * five-box workflow, and two of its names belong to nothing else on the
         * page -- so they are what a revival would show up as.
         */
        it('does not head a section or a card with Assist or Deliver', () => {
            const revived = headings(stripped[page])
                .filter((text) => /\b(assist|deliver)\b/i.test(text));

            expect(revived).toEqual([]);
        });

        /**
         * Each page carries its own trimmed sprite, which is exactly the
         * arrangement a copy-paste between them breaks: an icon drawn from a
         * symbol the other page defines renders as nothing at all, silently.
         */
        it('draws only icons it defines, and defines only icons it draws', () => {
            const defined = new Set(
                [...raw[page].matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1])
            );
            const drawn = new Set(
                [...raw[page].matchAll(/<use href="#([^"]+)"/g)].map((match) => match[1])
            );

            expect([...drawn].filter((id) => !defined.has(id))).toEqual([]);
            expect([...defined].filter((id) => !drawn.has(id))).toEqual([]);
        });

        /**
         * A renamed component leaves markup behind that still carries the old
         * class. Nothing renders differently until somebody notices the block is
         * unstyled, which on a page this long can take a while.
         */
        it('uses no class landing.css has no rule for', () => {
            const orphans = [...classesUsed(raw[page])].filter((name) => !styled(name));

            expect(orphans).toEqual([]);
        });

        /** R11: the shared stylesheet and script are what make the page a page. */
        it('links the shared stylesheet and script', () => {
            expect(raw[page]).toMatch(/<link rel="stylesheet" href="[^"]*assets\/css\/landing\.css">/);
            expect(raw[page]).toMatch(/<script src="[^"]*assets\/js\/landing\.js" defer><\/script>/);
        });

        /** R11: the login dialog, and the endpoint the shared script posts it to. */
        it('carries the login form', () => {
            expect(raw[page]).toMatch(/<form class="login-form" data-login-form/);
            expect(raw[page]).toMatch(/name="username"/);
            expect(raw[page]).toMatch(/name="password"/);
            expect(landingJs).toContain('/api/v2/auth/login');
        });
    });

    /** The long-form page is only reachable because `app.js` gives it a route. */
    it('serves how-it-works.html at /how-it-works', () => {
        expect(appJs).toMatch(/app\.get\(\s*'\/how-it-works'[\s\S]{0,400}?'how-it-works\.html'/);
    });

    /**
     * R14 reaches the shared script as well, because some of its strings are
     * copy: the login status line writes straight into the page. This was a
     * real miss -- "Signed in - redirecting" carried an em dash that neither
     * HTML file did, and checking only the two documents could never see it.
     */
    it('contains no em dash in the shared script either', () => {
        const index = landingJs.indexOf('—');
        const context = index === -1 ? null : landingJs.slice(Math.max(0, index - 60), index + 60);

        expect(context).toBeNull();
    });

    /**
     * R14 again, for the second shared script. `account-menu.js` writes the signed-in
     * line straight into the header, so its strings are copy on the page in exactly the
     * way the login status line is -- and a rule that covered only the first script would
     * have missed them for the same reason it once missed that one.
     */
    it('contains no em dash in the account menu script either', () => {
        const index = accountJs.indexOf('—');
        const context = index === -1 ? null : accountJs.slice(Math.max(0, index - 60), index + 60);

        expect(context).toBeNull();
    });

    /**
     * The account menu is one component in one place (#151). Three applications draw this
     * control now, and the point of the shared copy is that the third one was the last.
     */
    it('loads the shared account menu on both pages', () => {
        for (const page of pageNames) {
            expect(raw[page]).toMatch(/<script src="[^"]*assets\/js\/account-menu\.js" defer><\/script>/);
            expect(raw[page]).toMatch(/data-account\b/);
        }
    });

    /**
     * R11, across both pages. The landing page carries the doors into the two
     * applications that actually run; the docs links may sit on either page.
     */
    it('keeps the doors into the docs and the running applications', () => {
        const everywhere = pageNames.flatMap((page) => hrefs(raw[page]));

        for (const target of ['/api-docs', '/developer-docs', '/apps/marp-mosaic-review/', '/apps/marp-ml-dashboard/']) {
            expect(everywhere).toContain(target);
        }
    });

    /**
     * R11 and R15 together. The application cards moved off the landing page to
     * keep it short, so the landing page no longer carries the doors itself and
     * has to carry the way to them instead. Without this, cutting the handoff
     * would strand every application behind a page nothing links to.
     */
    it('points the landing page at the long-form page in more than one place', () => {
        const landing = hrefs(raw['index.html']);
        const onward = landing.filter((href) => href.startsWith('/how-it-works'));

        expect(onward.length).toBeGreaterThanOrEqual(2);
        expect(landing).toContain('/how-it-works#applications');
    });
});
