/**
 * Every local link in this app points at a file that exists.
 *
 * Written because the one link *into* the application was broken for a day and nothing
 * noticed. `index.html` is the door — the main dashboard links to `/apps/ml-dashboard/`
 * and nothing else — and it still redirected to `./mockups/dashboard.html`, a path that
 * stopped existing when the screens moved out of `mockups/` and became the application.
 *
 * It survived because **every other check here addresses a screen directly**.
 * `markup-check` reads each `.html` as a file, `screens-check` loads each by name. Not
 * one of them ever asked for the door, so the only way in was the only thing untested,
 * and the person who found it was the human trying to use it.
 *
 * So this follows links rather than enumerating pages: `href`, `src`, and the `url=` of
 * a `<meta http-equiv="refresh">`, which is the one that broke and the one a link checker
 * written the obvious way would have missed.
 *
 * **Local paths only.** An `http://` link is somebody else's uptime, a `#fragment` is the
 * same page, and a `data:` URI is not a path. Checking those would make this fail for
 * reasons that are not about this app.
 *
 *   node frontend/apps/ml-dashboard/tools/links-check.mjs
 *
 * @fileoverview Checks that local links and redirects resolve to files on disk.
 * @author Isaac Travers
 * @module tools/links-check
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The application's own directory. */
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where a path beginning `/` resolves from, as the server serves it. */
const WEB_ROOT = resolve(APP, '..', '..');

/** What is being linked to, and the attribute that did it. */
const LINK_PATTERNS = [
    [/\b(?:href|src)\s*=\s*"([^"]+)"/gi, 'href/src'],
    /* The one that broke. A refresh carries its target inside a `content` attribute,
       after `url=`, which no amount of looking at `href` will ever find. */
    [/<meta[^>]+http-equiv\s*=\s*"refresh"[^>]*content\s*=\s*"[^"]*url=([^"';]+)/gi, 'meta refresh'],
];

/** Links that are not paths on this disk. */
const NOT_A_PATH = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:|data:)/i;

const problems = [];
let checked = 0;

for (const file of readdirSync(APP).filter((name) => name.endsWith('.html'))) {
    const source = readFileSync(join(APP, file), 'utf8');

    for (const [pattern, kind] of LINK_PATTERNS) {
        for (const [, target] of source.matchAll(pattern)) {
            const link = target.trim();

            if (!link || NOT_A_PATH.test(link)) continue;

            // A query or a fragment addresses the same file; strip before resolving.
            const path = link.split(/[?#]/)[0];

            if (!path) continue;

            const absolute = path.startsWith('/')
                ? join(WEB_ROOT, path)
                : resolve(APP, path);

            checked += 1;

            if (!existsSync(absolute)) {
                problems.push(`${file}: ${kind} "${link}" points at nothing`);

                continue;
            }

            /* A directory resolves only if it has an index, because that is what the
               server will look for -- and a directory link with no index is exactly the
               shape of the bug this exists to catch. */
            if (statSync(absolute).isDirectory() && !existsSync(join(absolute, 'index.html'))) {
                problems.push(`${file}: ${kind} "${link}" is a directory with no index.html`);
            }
        }
    }
}

/* The door specifically, because it is the only way in and it is the thing that broke:
   the main dashboard links to `/apps/ml-dashboard/`, so an index that does not land a
   reader on a screen is this app being unreachable however well its screens work. */
const door = join(APP, 'index.html');

if (!existsSync(door)) {
    problems.push('there is no index.html, so /apps/ml-dashboard/ has no door');
} else {
    const source = readFileSync(door, 'utf8');
    const [, redirect] = source.match(/content\s*=\s*"[^"]*url=([^"';]+)/i) || [];

    if (!redirect) {
        problems.push('index.html does not redirect anywhere, so the door opens on itself');
    } else if (!existsSync(resolve(APP, redirect.trim().split(/[?#]/)[0]))) {
        problems.push(`index.html redirects to "${redirect.trim()}", which does not exist`);
    }
}

for (const problem of problems) console.log(`[x] ${problem}`);

console.log(
    problems.length
        ? `\n${problems.length} broken ${problems.length === 1 ? 'link' : 'links'} of ${checked} checked.`
        : `${checked} local links resolve, and the door opens on a screen.`
);

process.exit(problems.length ? 1 : 0);
