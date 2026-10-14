/**
 * Does the data layer still agree with the API about what the words mean?
 *
 * `mockups/api.js` is a plain script served to a browser and
 * `config/gpu-orchestration.js` is CommonJS on the server, so the enums cannot
 * be shared by importing -- the data layer writes them out. Two copies of a
 * list is two things to get wrong, and the one that would be wrong is the one
 * the screens read.
 *
 * So this is the check that makes the copy safe. It requires the server's own
 * module and compares it against the arrays in the data layer, and it fails
 * when a state is added on one side and not the other. Without it, adding a job
 * state to MARP would leave the dashboard quietly unable to draw it -- and
 * nothing would say so, because a state that never arrives looks exactly like a
 * state that never happens.
 *
 * This is deliberately *not* a check that the design vocabulary matches. It
 * does not: a job is `leased` in the API and `running` on screen, and that
 * mapping is the screen's to make. See `DESIGN.md`, "State".
 *
 * @fileoverview Fails when the data layer's enums drift from the API's.
 * @module tools/api-contract-check
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = fileURLToPath(new URL('.', import.meta.url));
const app = join(here, '..');
const repo = join(app, '..', '..', '..');

const require = createRequire(import.meta.url);

/* The server's own definitions. Required rather than parsed, so this cannot
   drift from what the running API actually believes. */
const orchestration = require(join(repo, 'config', 'gpu-orchestration.js'));

const source = readFileSync(join(app, 'mockups', 'api.js'), 'utf8');

/**
 * Reads one `const NAME = [ ... ];` array out of the data layer.
 *
 * Parsed rather than imported because the file is a browser script that touches
 * `window` and `location` the moment it runs, and a check should not need a DOM.
 *
 * @param {string} name - The constant's name.
 * @returns {?string[]} Its values, or null when it is not there at all.
 */
function arrayFrom(name) {
    const match = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    if (!match) return null;
    return match[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

/* Not every enum the dashboard copies belongs to the GPU orchestrator. A
   model's lifecycle is declared on the model itself and reaches the outside
   world through the generated contract, so that is where it is read from --
   and it has to be read from somewhere, because the Models screen was built
   against "Ready / Testing / Error", three words MARP has never used. */
const contract = JSON.parse(readFileSync(join(repo, 'docs', 'openapi.generated.json'), 'utf8'));

/**
 * One property's `enum` out of the generated contract.
 *
 * @param {string} schema - Schema name, e.g. `MlModel`.
 * @param {string} property - Property name, e.g. `status`.
 * @returns {?string[]} Its values, or null when the contract does not declare one.
 */
function enumFromContract(schema, property) {
    const node = contract.components
        && contract.components.schemas
        && contract.components.schemas[schema];
    const field = node && node.properties && node.properties[property];
    return field && Array.isArray(field.enum) ? field.enum : null;
}

/* Each pair is a list the data layer copies and MARP owns. `name` is what the
   data layer calls it; `theirs` is where the real definition lives. */
const PAIRS = [
    { name: 'JOB_KINDS', theirs: orchestration.JOB_KINDS, from: 'config/gpu-orchestration.js' },
    { name: 'JOB_STATES', theirs: orchestration.JOB_STATES, from: 'config/gpu-orchestration.js' },
    { name: 'WORKER_STATES', theirs: orchestration.WORKER_STATES, from: 'config/gpu-orchestration.js' },
    { name: 'MODEL_STATUSES', theirs: enumFromContract('MlModel', 'status'), from: 'docs/openapi.generated.json (MlModel.status)' },
];

const problems = [];

for (const { name, theirs, from } of PAIRS) {
    const ours = arrayFrom(name);

    if (!ours) {
        problems.push(`${name} is not declared in mockups/api.js.`);
        continue;
    }
    if (!Array.isArray(theirs)) {
        problems.push(`${name} is not declared by ${from}.`);
        continue;
    }

    /* Order matters as well as membership: these are written out as the server
       writes them, and a reordered copy is a copy somebody has edited by hand. */
    if (ours.join(',') !== theirs.join(',')) {
        problems.push(
            `${name} has drifted.\n`
            + `      api.js: ${ours.join(', ')}\n`
            + `      MARP:   ${theirs.join(', ')}   (${from})`
        );
    }
}

/* The live attempt states are a subset rather than a copy: the pool view only
   ever shows an attempt that has not finished, so this fails on a state the
   data layer invented and not on one it leaves out. */
const live = arrayFrom('LIVE_ATTEMPT_STATES') || [];
const allAttempt = orchestration.ATTEMPT_STATES || [];
const invented = live.filter((s) => !allAttempt.includes(s));

if (invented.length) {
    problems.push(`LIVE_ATTEMPT_STATES names ${invented.join(', ')}, which MARP has no such attempt state for.`);
}

if (problems.length) {
    for (const problem of problems) console.error(`[x] ${problem}`);
    console.error(`\n${problems.length} contract problem${problems.length === 1 ? '' : 's'} in `
        + `${relative(repo, join(app, 'mockups', 'api.js'))}. Each line above says where MARP `
        + 'declares the real list.');
    process.exit(1);
}

console.log(`ok  ${PAIRS.length + 1} enums agree with MARP (orchestrator config and the generated contract)`);
