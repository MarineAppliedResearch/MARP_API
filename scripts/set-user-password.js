/**
 * File: scripts/set-user-password.js
 * Purpose: Give a user a local username and password, so somebody can log in.
 * Context: Closes the one gap that made a fresh deployment unusable. The
 *          bootstrap migration creates the first administrator and grants it
 *          the `admin` permission, but deliberately sets no credential -- a
 *          password hash in a committed migration would be a credential in
 *          source control. Passwords are otherwise set through the V2 users
 *          API, which requires an admin session. So on a new database the only
 *          administrator could not log in, and nothing could create a login
 *          for them: the account exists, holds every right, and is unreachable.
 *
 *          This is the way in. It is a script rather than a route because it
 *          needs no authentication, which is exactly why it must never be one.
 *
 * Usage:
 *   node scripts/set-user-password.js --name "Isaac" --username isaac --password secret
 *   node scripts/set-user-password.js --username isaac --password secret
 *
 *   --name      Display name of an existing user, as the bootstrap migration
 *               created it from BOOTSTRAP_ADMIN_NAME. Use this the first time,
 *               when the account has no username yet.
 *   --username  The username to log in with. Set on the account if absent.
 *   --password  The password. Prompted for if omitted, so it stays out of
 *               shell history.
 *   --list      Show users and whether each can log in, then exit.
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
        // then nothing, rather than the password appearing on screen and in
        // any scrollback somebody later shares.
        const output = rl.output;
        rl.output = { write: (chunk) => { if (!rl._maskingActive) output.write(chunk); } };
        rl.question('New password: ', (answer) => {
            rl._maskingActive = false;
            output.write('\n');
            rl.close();
            resolve(answer);
        });
        rl._maskingActive = true;
    });
}

/**
 * Prints every user and whether they hold a usable local credential.
 *
 * @async
 * @returns {Promise<void>} Resolves once printed.
 */
async function listUsers() {
    const users = await db.users.findAll({ order: [['user_id', 'ASC']] });

    console.log('');
    console.log('  id  name                      username             can log in  permissions');
    for (const user of users) {
        const identity = await db.auth_identities.findOne({
            where: { user_id: user.user_id, provider: 'local' },
        });
        const permissions = await db.user_permissions.count({ where: { user_id: user.user_id } });
        const canLogIn = Boolean(user.username && identity && identity.password_hash);

        console.log(
            '  ' + String(user.user_id).padEnd(4) +
            String(user.name || '-').padEnd(26) +
            String(user.username || '-').padEnd(21) +
            (canLogIn ? 'yes' : 'no ').padEnd(12) +
            permissions
        );
    }
    console.log('');
}

/**
 * @async
 * @returns {Promise<void>} Resolves once the credential is in place, or exits.
 */
async function main() {
    const flags = parseArguments();

    if (flags.list) {
        await listUsers();
        return;
    }

    if (!flags.username || flags.username === true) {
        console.error('A --username is required. See --list for existing accounts.');
        process.exit(EXIT_REFUSED);
    }

    // Located by display name when given, because that is all the bootstrap
    // migration sets: on a new database the administrator has a name and no
    // username at all, so there is nothing else to find it by.
    const where = flags.name && flags.name !== true
        ? { name: flags.name }
        : { username: flags.username };

    const user = await db.users.findOne({ where });
    if (!user) {
        console.error(`No user matching ${JSON.stringify(where)}.`);
        console.error('Run with --list to see which accounts exist.');
        process.exit(EXIT_REFUSED);
    }

    const password = flags.password && flags.password !== true
        ? String(flags.password)
        : await promptForPassword();

    if (!password) {
        console.error('No password given.');
        process.exit(EXIT_REFUSED);
    }

    if (user.username !== flags.username) {
        // Taken usernames are rejected rather than moved: the unique index
        // would refuse it anyway, and a clear message beats a constraint error.
        const clash = await db.users.findOne({ where: { username: flags.username } });
        if (clash && clash.user_id !== user.user_id) {
            console.error(`Username '${flags.username}' already belongs to user ${clash.user_id}.`);
            process.exit(EXIT_REFUSED);
        }
        user.username = flags.username;
        await user.save();
        console.log(`Username set to '${flags.username}'.`);
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

    const permissions = await db.user_permissions.count({ where: { user_id: user.user_id } });
    console.log('');
    console.log(`User ${user.user_id} (${user.name || 'no name'}) can now log in as '${user.username}'.`);
    console.log(`Holds ${permissions} permission(s).`);
    if (permissions === 0) {
        console.log('');
        console.log('No permissions, so every route will answer 403. An administrator can grant');
        console.log('them through the V2 users API.');
    }
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(`Failed: ${error.message}`);
        try { await db.sequelize.close(); } catch { /* closing is best effort */ }
        process.exit(EXIT_REFUSED);
    });
