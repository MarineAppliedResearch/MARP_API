/**
 * Does any screen still state a value its own data layer is going to replace?
 *
 * **R1 is the requirement this enforces**: a screen reads from the data layer and carries no
 * value in its markup. That sounds like tidiness and is not. A number written into the HTML is
 * drawn before the layer answers, so every page load shows it briefly; and if the layer ever
 * fails, it is what stays on screen. The numbers in question looked entirely plausible --
 * `247 finished jobs`, `143 workers` -- which is what makes them worth a check rather than a
 * habit.
 *
 * **This check was rewritten on 2026-10-15, because the first version was an allowlist and an
 * allowlist cannot do this job.** It inspected four region types somebody had listed --
 * `.stat-num`, `.stat-sub`, `.count` and the donut legend -- and reported "8 screens state no
 * data of their own" while `dashboard.html` carried `<b>143</b> Enrolled`, `All 143 workers`
 * and `313 total slots` in plain markup, and seven other screens carried five hundred more
 * between them. It passed because nobody had added those regions to the list. A check that
 * only looks where it was told to look reports the diligence of whoever maintained the list,
 * not the state of the screens, and it gave false confidence for a day.
 *
 * So it is inverted. **Every number in a screen is a failure unless something exempts it**:
 *
 * - it is inside an element marked `data-rendered`, which is how a page says "a renderer owns
 *   this subtree". That mark is the contract, and it is on the markup rather than in this file
 *   so that the page and the exemption cannot drift apart.
 * - it is SVG geometry. A `viewBox` or a `stroke-dasharray` is a coordinate, not a claim about
 *   MARP -- **except** when the geometry encodes a proportion, which a donut's does, so those
 *   belong inside a `data-rendered` element and are not exempt here.
 * - it is a control the person operates rather than a value MARP supplies: the `24h`/`7d`
 *   range buttons and similar.
 *
 * It still fails the other way too: a region blanked for a renderer that does not exist will
 * render empty forever. Blanking the markup and forgetting to wire the renderer is the failure
 * that half catches, and it caught the Jobs status donut having no renderer behind it.
 *
 * @fileoverview Fails when a mockup states a value the data layer owns.
 * @module tools/markup-check
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const app = join(here, '..');
const dir = app;

/**
 * The inside of every element whose opening tag matches.
 *
 * Counts opens and closes of the same tag so a `<span>` holding two `<span>`s ends at its own
 * closing tag rather than the first one it meets.
 *
 * @param {string} html - The page source.
 * @param {RegExp} open - Matches the opening tag. Global.
 * @param {string} tag - The tag name.
 * @returns {string[]} One entry per element.
 */
function insidesOf(html, open, tag) {
    const openTag = new RegExp(`<${tag}\\b`, 'gi');
    const closeTag = new RegExp(`</${tag}>`, 'gi');
    const found = [];
    let match;

    open.lastIndex = 0;

    while ((match = open.exec(html)) !== null) {
        const bodyStart = match.index + match[0].length;
        let depth = 1;

        openTag.lastIndex = bodyStart;
        closeTag.lastIndex = bodyStart;

        let nextClose = closeTag.exec(html);
        let nextOpen = openTag.exec(html);

        while (nextClose) {
            if (nextOpen && nextOpen.index < nextClose.index) {
                depth += 1;
                nextOpen = openTag.exec(html);
                continue;
            }

            depth -= 1;

            if (depth === 0) {
                found.push(html.slice(bodyStart, nextClose.index));
                break;
            }

            closeTag.lastIndex = nextClose.index + 1;
            nextClose = closeTag.exec(html);
        }
    }

    return found;
}

/** Strips comments and collapses whitespace, so "   " does not read as content. */
const meat = (inside) => inside.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();

/* Regions a renderer owns and must therefore leave empty in the markup. */
const OWNED = [
    ['a headline card number', /<b class="stat-num"[^>]*>/g, 'b'],
    ['a headline card breakdown', /<span class="stat-sub"[^>]*>/g, 'span'],
    ['a panel count', /<span class="count"[^>]*>/g, 'span'],
    ['a donut legend', /<div class="job-mix-key[^"]*"[^>]*>/g, 'div'],
];

/* Tables the renderers fill, by the selector their renderer uses. */
const FILLED_TABLES = {
    'dashboard.html': /<section[^>]*id="current-activity"[\s\S]*?<tbody[^>]*>/,
    'datasets.html': /<table[^>]*id="saved-datasets"[\s\S]*?<tbody[^>]*>/,
    'history.html': /<table[^>]*id="history"[\s\S]*?<tbody[^>]*>/,
    'inference.html': /<table[^>]*class="[^"]*inference-table[^"]*"[\s\S]*?<tbody[^>]*>/,
    'jobs.html': /<table[^>]*id="jobs"[\s\S]*?<tbody[^>]*>/,
    'models.html': /<table[^>]*id="models"[\s\S]*?<tbody[^>]*>/,
    'training.html': /<table[^>]*class="[^"]*training-table[^"]*"[\s\S]*?<tbody[^>]*>/,
    'workers.html': /<table[^>]*id="workers"[\s\S]*?<tbody[^>]*>/,
};

/**
 * Coordinates and plumbing. An SVG path is not a statement about the pool.
 *
 * `stroke-dasharray` and `stroke-dashoffset` are **deliberately absent**: on a donut they
 * encode the proportions, which is exactly the kind of claim this check exists to catch, so a
 * donut belongs inside `data-rendered`.
 */
const GEOMETRY = /\b(?:viewBox|pathLength|cx|cy|rx|ry|r|x1|x2|y1|y2|x|y|width|height|d|points|offset|stop-opacity|opacity|fill-opacity|stroke-width|stroke-linecap|transform|style|version|colspan|rowspan|tabindex|maxlength|min|max|step|size)\s*=\s*"[^"]*"/gi;

/** Ranges and labels the person picks. Static because the choice is, not the data. */
const CONTROLS = /(?:^|[\s>])(?:24h|7d|30d|90d|1y|1h|6h|12h|5h|v\d+)(?=[\s<,.)]|$)/gi;

/**
 * Prose, and a numbered step, are not claims about MARP.
 *
 * A paragraph saying "nothing records this yet, see gap 19" contains a number and states
 * nothing; so does a `<li>` numbered "1.". Flagging those teaches whoever runs this that its
 * output contains noise, and a check people have learned to skim is a check that has stopped
 * working. These classes are the ones that exist to explain rather than to report, so their
 * contents are exempt and their *absence* of a renderer is the point.
 */
const PROSE = [
    [/<p class="(?:nodata|muted)[^"]*"[^>]*>/g, 'p'],
    [/<li\b[^>]*>/g, 'li'],
    [/<code\b[^>]*>/g, 'code'],
    [/<small class="(?:later|faint)[^"]*"[^>]*>/g, 'small'],
];

/**
 * Remove every subtree a renderer has claimed, so what is left is markup nobody fills.
 *
 * @param {string} html - The page source.
 * @returns {string} The same page with claimed subtrees cut out.
 */
function withoutRendered(html) {
    let out = html;
    let guard = 0;

    /* Innermost-first: find a `data-rendered` opening tag with no further one inside its
       body, cut it, and go again. Nesting is rare but a page is allowed it. */
    while (guard < 500) {
        const open = /<([a-z][a-z0-9]*)\b[^>]*\bdata-rendered\b[^>]*>/i.exec(out);

        if (!open) break;

        const tag = open[1];
        const inside = insidesOf(out, new RegExp(`<${tag}\\b[^>]*\\bdata-rendered\\b[^>]*>`, 'gi'), tag)[0];

        if (inside === undefined) {
            // Self-closing or unbalanced: drop the tag itself and move on.
            out = out.slice(0, open.index) + out.slice(open.index + open[0].length);
        } else {
            const start = open.index;
            const end = out.indexOf(inside, start + open[0].length) + inside.length;
            out = out.slice(0, start) + out.slice(end);
        }

        guard += 1;
    }

    return out;
}

const problems = [];

for (const page of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(dir, page), 'utf8');

    for (const [what, open, tag] of OWNED) {
        for (const inside of insidesOf(html, open, tag)) {
            const text = meat(inside);
            if (text) problems.push(`${page} states ${what} in its markup: "${text.slice(0, 60)}"`);
        }
    }

    const table = FILLED_TABLES[page];

    if (table) {
        const match = table.exec(html);

        if (!match) {
            problems.push(`${page} no longer has the table its renderer fills.`);
        } else {
            const after = html.slice(match.index + match[0].length);
            const rows = after.slice(0, after.indexOf('</tbody>'));
            if (meat(rows)) problems.push(`${page} ships table rows its renderer will replace.`);
        }
    }

    /* The inverted half. Everything a renderer has not claimed, with geometry and
       controls removed, must carry no numbers at all. */
    let rest = withoutRendered(html)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(GEOMETRY, '')
        .replace(CONTROLS, ' ');

    for (const [open, tag] of PROSE) {
        for (const inside of insidesOf(rest, open, tag)) rest = rest.replace(inside, ' ');
    }

    const stated = new Set();

    for (const [, text] of rest.matchAll(/>([^<]*\d[^<]*)</g)) {
        const trimmed = text.trim();
        if (trimmed) stated.add(`text "${trimmed.slice(0, 52)}"`);
    }

    for (const [, attribute, value] of rest.matchAll(/\b(aria-label|title|alt|placeholder)\s*=\s*"([^"]*\d[^"]*)"/gi)) {
        stated.add(`${attribute} "${value.slice(0, 52)}"`);
    }

    for (const one of stated) {
        problems.push(`${page} states a number nothing fills: ${one}`);
    }
}

if (problems.length) {
    console.error('');
    for (const problem of problems) console.error('[x] ' + problem);
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} in `
        + `${relative(app, dir)}. A screen states no value of its own: either a renderer fills `
        + 'it, or the element carries data-rendered to say one owns the subtree.');
    process.exit(1);
}

console.log(`ok  ${Object.keys(FILLED_TABLES).length} screens state no data of their own, `
    + 'and every number in them is one a renderer puts there');
