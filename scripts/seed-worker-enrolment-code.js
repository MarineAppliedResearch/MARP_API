/**
 * Seeds the standing enrolment code a volunteer's worker activates with.
 *
 * A volunteer should install `marp-inference-worker` and have it join the pool with
 * nothing to paste and no account to make. `POST /api/v2/gpu/workers/activate` is
 * already unauthenticated for exactly that reason -- the code *is* the credential --
 * and `worker_activation_codes` already carries `max_uses`, `use_count` and
 * `revoked_at`. What was missing was a code with more than one use in it: every code
 * minted so far was single-use and spent, so every new machine needed somebody with
 * `admin` to mint another. That does not scale past the people in the room.
 *
 * So this writes **one long-lived, many-use code** and the installer carries it.
 *
 * **The code is a shared secret, and that is the deliberate trade.** Anyone holding
 * the installer can enrol a worker and be handed job specs carrying playable video
 * URLs. That is the price of zero setup, it was settled with the human on
 * 2026-09-18, and the mitigations are the ones already in the schema: `revoked_at`
 * kills it for everyone at once, `max_uses` caps the blast radius, and each machine
 * still exchanges it for its **own** individually revocable credential -- so
 * removing one volunteer never means rotating the rest.
 *
 * It is **not** minted through `service/worker_provisioning.service.js`, and that is
 * not an oversight. That path caps `ttl_minutes` at 10080 (seven days), which is
 * right for a code a person mints by hand for one machine and wrong for a standing
 * one, and it generates the code itself -- while an installer has to be *built*
 * against a value that is already known. Both differences are about this being
 * deployment configuration rather than an operator action.
 *
 * The value never enters the repository. Give it with `--code`, or in
 * `MARP_WORKER_ENROLMENT_CODE`; with neither, one is generated and printed once.
 * The database stores only a prefix and a SHA-256, so a lost code cannot be read
 * back out -- re-run with the same `--code` to reinstate it, or seed a new one and
 * rebuild the installer.
 *
 * Idempotent on the code's own hash: re-running with the same value updates that
 * row's expiry and allowance rather than making a second one.
 *
 * Usage:
 *   node scripts/seed-worker-enrolment-code.js                     # what it would do
 *   node scripts/seed-worker-enrolment-code.js --apply
 *   node scripts/seed-worker-enrolment-code.js --apply --code activate_xxx
 *   node scripts/seed-worker-enrolment-code.js --revoke --apply    # kill it everywhere
 *
 * @fileoverview Seeds the standing worker enrolment code.
 * @author Isaac Travers
 * @module scripts/seed-worker-enrolment-code
 */

'use strict';

require('dotenv').config();

const crypto = require('crypto');

const db = require('../model');

/** What the row is called, and how a re-run finds the one it already wrote. */
const LABEL = 'Standing volunteer enrolment code';

/**
 * How many machines may enrol on it before it stops working.
 *
 * The schema's own ceiling, because the useful failure here is a cap that is never
 * reached: a volunteer whose install fails because the pool grew faster than
 * expected has no way to tell that from a broken build, and will not try twice.
 * `revoked_at` is the control that is meant to be used.
 */
const MAX_USES = 10000;

/** Ten years. Long enough that expiry is never the reason a volunteer is turned away. */
const YEARS = 10;

const hashSecret = (value) => crypto.createHash('sha256').update(value).digest('hex');
const rawSecret = () => `activate_${crypto.randomBytes(32).toString('base64url')}`;

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index === -1 ? null : process.argv[index + 1] || null;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const revoke = process.argv.includes('--revoke');
    const provided = argumentValue('--code') || process.env.MARP_WORKER_ENROLMENT_CODE || null;

    if (revoke) {
        const [count] = await db.worker_activation_codes.update(
            { revoked_at: new Date() },
            { where: { label: LABEL, revoked_at: null } }
        );
        console.log(apply
            ? `Revoked ${count} standing enrolment code(s). Every volunteer worker already`
              + ' activated keeps its own credential and goes on working.'
            : `Would revoke ${count} standing enrolment code(s). Re-run with --apply.`);
        if (!apply) return;
        return;
    }

    const code = provided || rawSecret();
    const generated = !provided;
    const hash = hashSecret(code);
    const expiresAt = new Date(Date.now() + YEARS * 365 * 24 * 60 * 60 * 1000);
    const existing = await db.worker_activation_codes.findOne({ where: { code_hash: hash } });

    if (!apply) {
        console.log(existing
            ? `Would refresh the existing standing code (id ${existing.id}, used `
              + `${existing.use_count} of ${existing.max_uses}) to ${MAX_USES} uses and a `
              + `${YEARS}-year expiry.`
            : `Would create a standing enrolment code, ${MAX_USES} uses, ${YEARS}-year expiry.`);
        if (generated) {
            console.log('A code would be generated. Re-run with --apply to see it, once.');
        }
        console.log('Re-run with --apply to write it.');
        return;
    }

    if (existing) {
        await existing.update({
            max_uses: MAX_USES, expires_at: expiresAt, revoked_at: null, label: LABEL,
        });
        console.log(`Refreshed the standing enrolment code (id ${existing.id}). It has been `
            + `used ${existing.use_count} time(s); that count is kept.`);
    } else {
        const row = await db.worker_activation_codes.create({
            code_prefix: code.slice(0, 16),
            code_hash: hash,
            label: LABEL,
            expires_at: expiresAt,
            max_uses: MAX_USES,
            created_by_user_id: null,
        });
        console.log(`Created the standing enrolment code (id ${row.id}).`);
    }

    if (generated) {
        console.log('');
        console.log('  The code, shown once. Only its hash is stored, so this cannot be');
        console.log('  read back out. Build it into the worker installer.');
        console.log('');
        console.log(`      ${code}`);
        console.log('');
    } else {
        console.log('Using the code supplied; not printed.');
    }
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exitCode = 1;
    });
