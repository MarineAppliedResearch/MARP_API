/**
 * File: scripts/create-review-user.js
 * Purpose: Make a login that can actually use the mosaic reviewer, on a local
 *          development database.
 * Context: `/apps/marp-mosaic-review` is gated on `observations:read`
 *          (app.js) and `requirePermission` compares the key exactly
 *          (middleware/require-permission.middleware.js) -- so `admin` is not
 *          a bypass, and the bootstrap administrator cannot open the app at
 *          all. Nothing else could create such an account either: the V2
 *          users API needs an admin *session*, and on a fresh database the
 *          administrator has no username to sign in with.
 *
 *          `set-user-password.js` is the precedent and stops one step short --
 *          it gives an existing user a credential and grants nothing. This
 *          creates the account as well and grants the keys named, which is
 *          what a browser-driven run of the reviewer needs before it can see
 *          a single tile.
 *
 *          Idempotent: run it again to reset the password or add a key.
 *
 * Usage:
 *   node scripts/create-review-user.js --username walkthrough --password secret
 *   MARP_REVIEW_PASSWORD=secret node scripts/create-review-user.js --username walkthrough
 *   node scripts/create-review-user.js --username walkthrough \
 *     --permissions observations:read,observations:write,species:read
 *
 *   --username     The username to log in with. Required.
 *   --name         Display name. Defaults to the username.
 *   --password     The password. Read from MARP_REVIEW_PASSWORD when omitted,
 *                  and prompted for when that is unset too, so it stays out
 *                  of shell history.
 *   --permissions  Comma-separated permission keys. Defaults to the three the
 *                  mosaic reviewer needs.
 *
 * **Local development only.** It needs no authentication, which is exactly
 * why it is a script and must never become a route.
 *
 * Reads the same DB_* settings as everything else, through model/index.js.
 */

const readline = require('readline');
const argon2 = require('argon2');

const db = require('../model');

// model/index.js logs every statement, which for this script means the answer
// scrolls off behind a hundred lines of SQL. Silenced here only.
db.sequelize.options.logging = false;

/** Exit code for every refusal, so a caller can tell "no" from "broke". */
const EXIT_REFUSED = 1;

/**
 * What the mosaic reviewer needs, and no more.
 *
 * Read the mosaic pages and the thumbnails (`observations:read`), commit a
 * review, a training decision, a delete or a species correction
 * (`observations:write`), and search the species list the correction picker
 * offers (`species:read`). Deliberately not `admin`: an account that holds
 * everything cannot show that the gate works.
 */
const DEFAULT_PERMISSIONS = ['observations:read', 'observations:write', 'species:read'];

/**
 * Reads `--flag value` pairs from argv.
 *
 * @returns {Object} Flags by name, with `true` for valueless flags.
 */
function parseArguments() {
    const flags = {};
    const argv = process.argv.slice(2);

    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const key = argv[i].slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            flags[key] = next;
            i++;
        } else {
            flags[key] = true;
        }
    }
    return flags;
}

/**
 * Asks for a password without echoing it.
 *
 * @async
 * @returns {Promise<string>} What was typed.
 */
function promptForPassword() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

        // Suppressing the echo means the prompt itself is written once and
        // then nothing, rather than the password appearing in any scrollback
        // somebody later shares.
        const output = rl.output;
        rl.output = { write: (chunk) => { if (!rl._maskingActive) output.write(chunk); } };
        rl.question('Password: ', (answer) => {
            rl._maskingActive = false;
            output.write('\n');
            rl.close();
            resolve(answer);
        });
        rl._maskingActive = true;
    });
}

/**
 * @async
 * @returns {Promise<void>} Resolves once the account can log in and holds the
 *                          keys, or exits.
 */
async function main() {
    const flags = parseArguments();

    if (!flags.username || flags.username === true) {
        console.error('A --username is required.');
        process.exit(EXIT_REFUSED);
    }

    const username = String(flags.username);
    const name = flags.name && flags.name !== true ? String(flags.name) : username;

    // The environment sits between the flag and the prompt on purpose: a
    // recorded run needs the password without a human at the keyboard, and
    // putting it in argv would put it in shell history.
    const password = flags.password && flags.password !== true
        ? String(flags.password)
        : process.env.MARP_REVIEW_PASSWORD || await promptForPassword();

    if (!password) {
        console.error('No password given. Pass --password or set MARP_REVIEW_PASSWORD.');
        process.exit(EXIT_REFUSED);
    }

    const wanted = flags.permissions && flags.permissions !== true
        ? String(flags.permissions).split(',').map((k) => k.trim()).filter(Boolean)
        : DEFAULT_PERMISSIONS;

    // Refuse an unknown key rather than granting nothing quietly. The
    // catalogue is seeded by migration and grants to nobody by default, so a
    // typo here would otherwise read as a working account that gets 403 on
    // every request -- which looks like a broken app.
    const permissions = await db.permissions.findAll({ where: { key: wanted } });
    const missing = wanted.filter((k) => !permissions.some((p) => p.key === k));
    if (missing.length) {
        console.error(`No such permission key: ${missing.join(', ')}`);
        console.error('The catalogue is seeded by migration; see migrations/*seed-resource-permissions*.');
        process.exit(EXIT_REFUSED);
    }

    // Located by username first, because that is what a re-run has. The name
    // is unique too, so a clash on either has to be reported rather than
    // hitting a constraint.
    let user = await db.users.findOne({ where: { username } });
    if (!user) {
        const clash = await db.users.findOne({ where: { name } });
        if (clash) {
            console.error(`Display name '${name}' already belongs to user ${clash.user_id}.`);
            console.error('Pass --name to choose another.');
            process.exit(EXIT_REFUSED);
        }
        user = await db.users.create({ name, username, status: 'active' });
        console.log(`Created user ${user.user_id} '${name}'.`);
    } else {
        console.log(`User ${user.user_id} '${user.name}' already exists.`);
    }

    const passwordHash = await argon2.hash(password);
    const existing = await db.auth_identities.findOne({
        where: { user_id: user.user_id, provider: 'local' },
    });

    if (existing) {
        existing.password_hash = passwordHash;
        existing.password_changed_at = new Date();
        await existing.save();
        console.log('Password replaced.');
    } else {
        await db.auth_identities.create({
            user_id: user.user_id,
            provider: 'local',
            provider_subject: null,
            password_hash: passwordHash,
            password_changed_at: new Date(),
        });
        console.log('Local credential created.');
    }

    for (const permission of permissions) {
        const [, created] = await db.user_permissions.findOrCreate({
            where: { user_id: user.user_id, permission_id: permission.permission_id },
            defaults: {
                user_id: user.user_id,
                permission_id: permission.permission_id,
                granted_by_user_id: null,
            },
        });
        console.log(`  ${created ? 'granted' : 'already held'}  ${permission.key}`);
    }

    console.log('');
    console.log(`User ${user.user_id} can log in as '${username}' and holds ${permissions.length} permission(s).`);
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(`Failed: ${error.message}`);
        try { await db.sequelize.close(); } catch { /* closing is best effort */ }
        process.exit(EXIT_REFUSED);
    });
