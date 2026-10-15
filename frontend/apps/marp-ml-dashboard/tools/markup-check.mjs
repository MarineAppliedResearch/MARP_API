/**
 * Does any screen still state a value its own data layer is going to replace?
 *
 * **R1 is the requirement this enforces**: a screen reads from the data layer
 * and carries no value in its markup. That sounds like tidiness and is not. A
 * number written into the HTML is drawn before the layer answers, so every page
 * load shows it briefly; and if the layer ever fails, it is what stays on
 * screen. The numbers in question looked entirely plausible -- `247 finished
 * jobs`, `143 workers` -- which is what makes them worth a check rather than a
 * habit. Two hundred and three of them survived the first seven screens being
 * wired, because each page was wired and nobody re-read the markup.
 *
 * It also fails the other way: a filled region that nothing fills is a region
 * that will render blank forever. Blanking the markup and forgetting to wire
 * the renderer is the failure this half catches, and it happened immediately --
 * the Jobs status donut had no renderer behind it.
 *
 * @fileoverview Fails when a mockup states a value the data layer owns.
 * @module tools/markup-check
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const app = join(here, '..');
const dir = join(app, 'mockups');

/**
 * The inside of every element whose opening tag matches.
 *
 * Counts opens and closes of the same tag so a `<span>` holding two `<span>`s
 * ends at its own closing tag rather than the first one it meets.
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
        let scan = bodyStart;

        while (depth > 0) {
            openTag.lastIndex = scan;
            closeTag.lastIndex = scan;
            const nextOpen = openTag.exec(html);
            const nextClose = closeTag.exec(html);
            if (!nextClose) break;

            if (nextOpen && nextOpen.index < nextClose.index) {
                depth += 1;
                scan = nextOpen.index + nextOpen[0].length;
            } else {
                depth -= 1;
                scan = nextClose.index + nextClose[0].length;
                if (depth === 0) found.push(html.slice(bodyStart, nextClose.index));
            }
        }
        open.lastIndex = scan;
    }
    return found;
}

/** Comments and whitespace are not content. @returns {string} */
const meat = (inside) => inside.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();

/* Regions a renderer owns. Each is `[description, opening-tag pattern, tag]`. */
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

const problems = [];

for (const page of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(dir, page), 'utf8');

    for (const [what, open, tag] of OWNED) {
        for (const inside of insidesOf(html, open, tag)) {
            const text = meat(inside);
            if (text) problems.push(`mockups/${page} states ${what} in its markup: "${text.slice(0, 60)}"`);
        }
    }

    /* The row a renderer writes over. One `<tr>` here is a row somebody will
       see before the data arrives, and keep seeing if it never does. */
    const table = FILLED_TABLES[page];
    if (!table) continue;
    const start = html.match(table);
    if (!start) {
        problems.push(`mockups/${page} no longer has the table its renderer fills; the check cannot see it.`);
        continue;
    }

    const after = html.slice(start.index + start[0].length);
    const body = after.slice(0, after.indexOf('</tbody>'));
    const rows = (body.match(/<tr\b/g) || []).length;
    if (rows) problems.push(`mockups/${page} writes ${rows} row${rows === 1 ? '' : 's'} into the table its data layer fills.`);
}

if (problems.length) {
    for (const problem of problems) console.error(`[x] ${problem}`);
    console.error(`\n${problems.length} place${problems.length === 1 ? '' : 's'} where a screen states what the `
        + 'data layer owns. A value in the markup is shown before the layer answers, and left '
        + 'on screen if it never does (#128, R1).');
    process.exit(1);
}

console.log(`ok  ${readdirSync(dir).filter((f) => f.endsWith('.html')).length} screens state no data of their own`);
