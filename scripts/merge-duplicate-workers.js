/**
 * Collapse the worker pool back to one row per computer.
 *
 * A worker used to enrol under a random `local_id` kept in its state directory,
 * so a machine that lost that directory -- uninstalled, installed as another
 * user, pointed somewhere new -- came back as a stranger. Four computers held
 * eleven rows. The worker now derives its id from the machine, which stops new
 * duplicates; this merges the ones already recorded.
 *
 * **Merged, never deleted.** `gpu_job_attempts.worker_id` is `RESTRICT` and the
 * real machines carry thousands of attempts, so a duplicate's attempts are
 * repointed at the row that survives and only the empty husk is removed. The
 * attempt count before and after must be identical, and the script rolls back if
 * it is not: losing which machine ran a job is exactly the loss this is meant to
 * prevent.
 *
 * Build probes are different. `build-windows.ps1` checks an enrolment code
 * against the real endpoint, which enrols a worker as a side effect; it used to
 * use a fresh GUID per build and left one permanent row behind every time. Those
 * rows carry no attempts, so they are deleted outright -- and any that does
 * carry one is kept and reported rather than deleted.
 *
 * Dry run by default, in the house style: nothing is written without `--apply`.
 *
 *   node scripts/merge-duplicate-workers.js
 *   node scripts/merge-duplicate-workers.js --apply
 *
 * Run it from the repository root, so `dotenv` finds `.env`.
 *
 * @fileoverview Merges duplicate gpu_workers rows onto one row per machine.
 * @module scripts/merge-duplicate-workers
 */

'use strict';

const db = require('../model');

/** Whether anything may be written. */
const APPLY = process.argv.includes('--apply');

/** The name the build probe gives itself. Identified by prefix. */
const PROBE_PREFIX = 'buildcheck';

/**
 * The hostname inside a worker name.
 *
 * Enrolment used to append eight characters of the worker's own uuid, so one
 * computer produced `ABYSS-3dd10926`, `ABYSS-46f37134` and so on. Stripping that
 * suffix is what groups them; a name without one is already the hostname.
 *
 * @param {string} name - The recorded worker name.
 * @returns {string} The hostname it belongs to.
 */
function hostOf(name) {
    return String(name).replace(/-[0-9a-f]{8}$/i, '');
}


/**
 * Runs the merge, or reports what it would do.
 *
 * @async
 * @returns {Promise<void>} Resolves once the report is printed and any writes committed.
 */
async function main() {
    const q = (sql, options) => db.sequelize.query(sql, { logging: false, ...options });

    const [[before]] = await q('SELECT count(*)::int AS attempts FROM gpu_job_attempts');
    const [workers] = await q(
        'SELECT id, name, local_id, state, enrolled_at, last_seen_at FROM gpu_workers ORDER BY id'
    );
    const [counts] = await q(
        'SELECT worker_id, count(*)::int AS n FROM gpu_job_attempts '
        + 'WHERE worker_id IS NOT NULL GROUP BY worker_id'
    );
    const attempts = new Map(counts.map((row) => [Number(row.worker_id), Number(row.n)]));
    const countFor = (id) => attempts.get(Number(id)) || 0;

    /* Probes first: they are not computers and never were. */
    const probes = workers.filter((w) => String(w.name).startsWith(PROBE_PREFIX));
    const probesEmpty = probes.filter((w) => countFor(w.id) === 0);
    const probesKept = probes.filter((w) => countFor(w.id) > 0);

    /* Everything else groups by the hostname its name carries. A `jest-` row is
       left alone deliberately: it is a test leftover whose attempts are test
       data, and removing it here would take those with it. Reported, not touched. */
    const groups = new Map();
    for (const worker of workers) {
        if (String(worker.name).startsWith(PROBE_PREFIX)) continue;
        if (/^jest-/.test(String(worker.name))) continue;
        const host = hostOf(worker.name);
        if (!groups.has(host)) groups.set(host, []);
        groups.get(host).push(worker);
    }

    /* The row that survives is the one most recently heard from, because that is
       the one a human looking at the pool would recognise as the live machine.
       Never heard from at all sorts last; the higher id breaks a tie. */
    const seenAt = (w) => (w.last_seen_at ? new Date(w.last_seen_at).getTime() : -1);
    const merges = [];
    for (const [host, rows] of groups) {
        if (rows.length < 2) continue;
        const ordered = [...rows].sort((a, b) => seenAt(b) - seenAt(a) || Number(b.id) - Number(a.id));
        merges.push({ host, keeper: ordered[0], husks: ordered.slice(1) });
    }

    console.log(APPLY ? '== applying ==' : '== dry run; nothing will be written ==');
    console.log(`workers now: ${workers.length}, attempts: ${before.attempts}`);

    for (const { host, keeper, husks } of merges) {
        const moving = husks.reduce((sum, h) => sum + countFor(h.id), 0);
        console.log(`\n${host}: keep #${keeper.id} (${keeper.name}, ${countFor(keeper.id)} attempts)`);
        for (const husk of husks) {
            console.log(`  merge  #${husk.id} ${husk.name} - ${countFor(husk.id)} attempts move`);
        }
        console.log(`  ${moving} attempts repointed, ${husks.length} rows removed`);
    }

    console.log(`\nbuild probes: ${probesEmpty.length} removed`
        + (probesKept.length ? `, ${probesKept.length} kept because they hold attempts` : ''));

    const leftovers = workers.filter((w) => /^jest-/.test(String(w.name)));
    if (leftovers.length) {
        const held = leftovers.reduce((sum, w) => sum + countFor(w.id), 0);
        console.log(`test leftovers: ${leftovers.length} rows left alone (${held} attempts)`
            + ' - fix the suite that made them');
    }

    const removing = merges.reduce((sum, m) => sum + m.husks.length, 0) + probesEmpty.length;
    console.log(`\nwould leave ${workers.length - removing} worker rows, from ${workers.length}`);

    if (!APPLY) {
        console.log('\nnothing written. Re-run with --apply.');
        return;
    }

    await db.sequelize.transaction(async (transaction) => {
        for (const { keeper, husks } of merges) {

            /* The keeper is the live row, so its `local_id` is the one the
               machine still enrols under -- but it is often the youngest, and
               `enrolled_at` means "first seen" rather than "this row was made".
               Carrying the earliest enrolment and the latest sighting across
               keeps both facts true of the machine: without this, merging ABYSS
               moved its first sighting from September to October and quietly
               threw away that it had been in the pool all along. */
            await q('UPDATE gpu_workers SET enrolled_at = :first, last_seen_at = :last '
                + 'WHERE id = :keep',
                {
                    replacements: {
                        keep: keeper.id,
                        first: new Date(Math.min(...[keeper, ...husks]
                            .map((w) => new Date(w.enrolled_at).getTime())
                            .filter((t) => Number.isFinite(t)))),
                        last: new Date(Math.max(...[keeper, ...husks]
                            .map(seenAt)
                            .filter((t) => t > 0))),
                    },
                    transaction,
                });

            for (const husk of husks) {
                await q('UPDATE gpu_job_attempts SET worker_id = :keep WHERE worker_id = :husk',
                    { replacements: { keep: keeper.id, husk: husk.id }, transaction });
                await q('UPDATE worker_activation_codes SET consumed_by_worker_id = :keep '
                    + 'WHERE consumed_by_worker_id = :husk',
                    { replacements: { keep: keeper.id, husk: husk.id }, transaction });
                await q('DELETE FROM gpu_workers WHERE id = :husk',
                    { replacements: { husk: husk.id }, transaction });
            }
        }
        for (const probe of probesEmpty) {
            await q('DELETE FROM gpu_workers WHERE id = :id',
                { replacements: { id: probe.id }, transaction });
        }

        /* The invariant, checked inside the transaction so a violation rolls the
           whole thing back. An attempt may change owner; not one may disappear,
           and none may be left pointing at a row that no longer exists. */
        const [[after]] = await q('SELECT count(*)::int AS attempts FROM gpu_job_attempts',
            { transaction });
        const [[orphans]] = await q('SELECT count(*)::int AS n FROM gpu_job_attempts a '
            + 'LEFT JOIN gpu_workers w ON w.id = a.worker_id '
            + 'WHERE a.worker_id IS NOT NULL AND w.id IS NULL', { transaction });

        if (after.attempts !== before.attempts) {
            throw new Error(`attempts changed from ${before.attempts} to ${after.attempts}; rolled back`);
        }
        if (orphans.n !== 0) {
            throw new Error(`${orphans.n} attempts left without a worker; rolled back`);
        }
    });

    const [[final]] = await q('SELECT count(*)::int AS n FROM gpu_workers');
    console.log(`\ndone. ${final.n} worker rows, ${before.attempts} attempts, none orphaned.`);
}

main()
    .then(() => db.sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await db.sequelize.close();
        process.exit(1);
    });
