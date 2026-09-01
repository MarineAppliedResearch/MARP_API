/**
 * Creates an application token from the command line.
 *
 * Every route now requires a permission (#50), so an application that is not a
 * browser -- the annotation GUI, the inference worker -- needs a token before it
 * can call anything. Tokens can be created through `POST /api/v2/tokens`, but that
 * needs an admin session, which is a chicken-and-egg problem on a fresh database
 * and awkward on production where nobody wants to log a browser in.
 *
 * The raw token is shown once and never again: only its SHA-256 hash and a short
 * prefix are stored. Losing it means creating another one.
 *
 * Usage:
 *   node scripts/create-application-token.js --app "MARE Video Processing GUI" --preset annotation-gui
 *   node scripts/create-application-token.js --app "Inference worker" --permissions observations:read,models:write
 *   node scripts/create-application-token.js --presets
 *
 * Options:
 *   --app <name>            The application the token belongs to. Reused if it exists.
 *   --preset <name>         A recorded permission set (see --presets).
 *   --permissions <a,b,c>   Permission keys, instead of a preset.
 *   --expires <date>        Expiry, as anything Date can parse. Default: never.
 *   --description <text>    Description, used only when creating the application.
 *
 * Points at whichever database `.env` names, the same as the API itself, and says
 * which one it wrote to -- so a production token cannot be mistaken for a
 * development one.
 *
 * @fileoverview Command-line creation of service application tokens.
 * @author Isaac Travers
 * @module scripts/create-application-token
 */

'use strict';

const db = require('../model');
const tokens = require('../repository/v2_tokens.repository');

/**
 * Recorded permission sets, so what an application needs is written down rather
 * than reconstructed from whoever created its token last.
 *
 * @constant
 * @type {Object<string, {description: string, permissions: Array<string>}>}
 */
const PRESETS = {
    'annotation-gui': {
        description: 'The Windows annotation GUI (VIDEO_PROCESSING_GUI).',
        permissions: [
            'species:read',
            'observations:read',
            'observations:write',
            'keyframes:read',
            'keyframes:write',
            'sessions:read',
            'sessions:write',
            'projects:read',
            'users:read',
            'reports:read',
            'metaInfo:read',
        ],
    },
};

/**
 * Parse `--flag value` arguments into an object. Unknown flags are returned too,
 * so a typo shows up as an unused key rather than being silently dropped.
 *
 * @param {Array<string>} argv - Arguments, excluding node and the script path.
 * @returns {Object<string, string|boolean>} The parsed flags.
 */
function parseArgs(argv) {
    const args = {};

    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];

        if (!token.startsWith('--')) {
            continue;
        }

        const name = token.slice(2);
        const next = argv[i + 1];

        if (next === undefined || next.startsWith('--')) {
            args[name] = true;
        } else {
            args[name] = next;
            i += 1;
        }
    }

    return args;
}

/**
 * Prints the available presets and what each one grants.
 *
 * @returns {void}
 */
function printPresets() {
    console.log('Presets:');

    for (const [name, preset] of Object.entries(PRESETS)) {
        console.log(`\n  ${name} -- ${preset.description}`);
        preset.permissions.forEach((key) => console.log(`      ${key}`));
    }
}

/**
 * Finds an application by name, or creates it.
 *
 * Reused rather than duplicated, because two applications with the same name is
 * a mess nobody untangles later and this script will be run more than once for
 * the same client.
 *
 * @async
 * @param {string} name - Application name.
 * @param {string} [description] - Used only when creating.
 * @returns {Promise<Object>} The application record.
 */
async function findOrCreateApp(name, description) {
    const existing = await db.service_clients.findOne({ where: { name } });

    if (existing) {
        console.log(`Application "${name}" already exists (id ${existing.service_client_id}).`);
        return existing;
    }

    const created = await tokens.createApp({ name, description: description || null });

    console.log(`Created application "${name}" (id ${created.service_client_id}).`);

    return created;
}

/**
 * Creates the token and prints it.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.presets) {
        printPresets();
        return;
    }

    if (!args.app || args.app === true) {
        console.error('An application name is required: --app "MARE Video Processing GUI"');
        console.error('Run with --presets to see the recorded permission sets.');
        process.exitCode = 1;
        return;
    }

    let permissions;

    if (args.preset) {
        const preset = PRESETS[args.preset];

        if (!preset) {
            console.error(`Unknown preset "${args.preset}". Run with --presets to list them.`);
            process.exitCode = 1;
            return;
        }

        permissions = preset.permissions;
    } else if (args.permissions && args.permissions !== true) {
        permissions = args.permissions.split(',').map((key) => key.trim()).filter(Boolean);
    } else {
        console.error('Give either --preset <name> or --permissions <a,b,c>.');
        process.exitCode = 1;
        return;
    }

    // Named before anything is written, so a token meant for development cannot be
    // created against production unnoticed.
    const config = db.sequelize.config;
    console.log(`Database: ${config.database} on ${config.host}:${config.port}\n`);

    const app = await findOrCreateApp(args.app, args.description === true ? null : args.description);

    const expiresAt = args.expires && args.expires !== true ? new Date(args.expires) : null;

    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        console.error(`Cannot read "${args.expires}" as a date.`);
        process.exitCode = 1;
        return;
    }

    const token = await tokens.createToken({
        serviceClientId: app.service_client_id,
        expiresAt,
    });

    await tokens.setTokenPermissions(token.service_token_id, permissions, null);

    console.log(`\nCreated token ${token.service_token_id} with ${permissions.length} permissions:`);
    permissions.forEach((key) => console.log(`  ${key}`));
    console.log(`\nExpires: ${expiresAt ? expiresAt.toISOString() : 'never'}`);

    // Shown once. Only the hash is stored.
    console.log('\n----- the token, which is not recoverable after this -----');
    console.log(token.rawToken);
    console.log('---------------------------------------------------------');
}

main()
    .then(() => db.sequelize.close())
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
        return db.sequelize.close();
    });
