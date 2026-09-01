/**
 * Corrects one session's timecode sync from the command line.
 *
 * The same operation the annotation GUI performs through
 * `POST /api/v2/sessions/:id/resync` -- a thin wrapper over
 * `repository/timecode_sync.repository.js`, so there is one implementation and the
 * two cannot drift.
 *
 * Exists for the case the GUI cannot cover: running a correction against production
 * before a GUI build has been promoted there, and auditing the whole database rather
 * than one session.
 *
 * Dry run unless `--apply`.
 *
 * Refs MarineAppliedResearch/VIDEO_PROCESSING_GUI#213.
 *
 * Usage:
 *   # what a correction would do. Writes nothing.
 *   node scripts/resync-session.js --session 3693 --frames -3
 *
 *   # from a reading off the burnt-in clock
 *   node scripts/resync-session.js --session 3693 \
 *     --at 00:01:10.3200000 --says 20:20:31.1600000
 *
 *   # commit it
 *   node scripts/resync-session.js --session 3693 --frames -3 --apply \
 *     --note "burnt-in clock read 3 frames earlier at 8 positions"
 *
 *   # undo it: apply the opposite shift. Nothing records that a correction
 *   # happened, so this is why the tool prints the undo line.
 *   node scripts/resync-session.js --session 3693 --shift 120 --apply
 *
 *   # how much of the database has derived values this arithmetic can reproduce
 *   node scripts/resync-session.js --audit
 *
 * `--clip <video_source>` and `--from <media position>` narrow the scope, which is
 * how a clip resynced part way through gets two corrections rather than one wrong
 * one. `--allow-partial` proceeds when some tc or frame values cannot be reproduced
 * and would be left as recorded.
 *
 * Points at whichever database `.env` names, and says which one before writing.
 *
 * @fileoverview Command-line wrapper over the timecode resync repository.
 * @author Isaac Travers
 * @module scripts/resync-session
 */

'use strict';

const db = require('../model');
const timecodeSync = require('../repository/timecode_sync.repository');
const { auditDerivedColumns, reportAudit } = require('../db/timecode');

/**
 * Parses `--flag value` arguments.
 *
 * @param {Array<string>} argv - Arguments after the script path.
 * @returns {Object<string, string|boolean>} Parsed flags.
 */
function parseArgs(argv) {
    const args = {};

    for (let i = 0; i < argv.length; i += 1) {
        if (!argv[i].startsWith('--')) continue;

        const name = argv[i].slice(2);
        const next = argv[i + 1];

        // A negative number is a value, not the next flag.
        if (next === undefined || (next.startsWith('--') && !/^--?\d/.test(next))) {
            args[name] = true;
        } else {
            args[name] = next;
            i += 1;
        }
    }

    return args;
}

/**
 * Prints a preview in a form that can be read at a glance.
 *
 * @param {Object} preview - As returned by the repository.
 * @returns {void}
 */
function report(preview) {
    console.log(`\nsession ${preview.sessionId}`
        + `${preview.videoSource ? `, clip ${preview.videoSource}` : ''}`
        + `${preview.fromMediaPosition ? `, from media ${preview.fromMediaPosition}` : ''}`);
    console.log(`${preview.observationsInScope} observations in scope, `
        + `${preview.observationsToCorrect} correctable`);
    console.log(`shift ${preview.shiftMs} ms (${preview.frames} frames at 25 fps)`);

    if (preview.anchor) {
        console.log(`anchored at media ${preview.anchor.mediaPosition}: `
            + `stored ${preview.anchor.storedWas}, picture said ${preview.anchor.pictureSaid}`);
    }

    console.log('');
    console.table([
        { column: 'actualPosition', rewritten: preview.observationsToCorrect, 'left as recorded': 0 },
        { column: 'tc', rewritten: preview.counts.tcRewritten, 'left as recorded': preview.counts.tcLeftAlone },
        { column: 'frame', rewritten: preview.counts.frameRewritten, 'left as recorded': preview.counts.frameLeftAlone },
        { column: 'etc', rewritten: preview.counts.etcShifted, 'left as recorded': preview.observationsToCorrect - preview.counts.etcShifted },
        { column: 'mediaPosition', rewritten: 0, 'left as recorded': preview.observationsToCorrect },
    ]);

    if (preview.counts.unreadable > 0) {
        console.log(`${preview.counts.unreadable} observation(s) have an unreadable `
            + 'actualPosition and are skipped entirely.');
    }

    console.table(preview.sample.map((row) => ({
        obsID: row.obsID,
        media: String(row.mediaPosition).slice(0, 12),
        'tc now': row.tcBefore,
        'tc after': row.tcAfter + (row.tcRewritten ? '' : ' (kept)'),
        'frame now': row.frameBefore,
        'frame after': row.frameAfter + (row.frameRewritten ? '' : ' (kept)'),
        'etc now': row.etcBefore || '',
        'etc after': row.etcAfter || '',
    })));
}

/**
 * Entry point.
 *
 * @async
 * @returns {Promise<void>}
 */
async function main() {
    const args = parseArgs(process.argv.slice(2));

    const config = db.sequelize.config;
    console.log(`Database: ${config.database} on ${config.host}:${config.port}`);

    if (args.audit) {
        const sessionId = args.session && args.session !== true ? Number(args.session) : undefined;
        const audit = await auditDerivedColumns(db.sequelize, { sessionId });

        console.log('');
        reportAudit(audit, 'audit');

        return;
    }

    if (!args.session || args.session === true) {
        console.error('Give --session <id>, or --audit. See the header of this file.');
        process.exitCode = 1;
        return;
    }

    const request = {
        sessionId: Number(args.session),
        videoSource: args.clip && args.clip !== true ? args.clip : null,
        fromMediaPosition: args.from && args.from !== true ? args.from : null,
        atMediaPosition: args.at && args.at !== true ? args.at : null,
        trueActualTime: args.says && args.says !== true ? args.says : null,
        shiftMs: args.shift && args.shift !== true ? Number(args.shift) : undefined,
        frames: args.frames && args.frames !== true ? Number(args.frames) : undefined,
        allowPartial: Boolean(args['allow-partial']),
        note: args.note && args.note !== true ? args.note : null,
    };

    try {
        if (!args.apply) {
            report(await timecodeSync.preview(request));
            console.log('\nDry run. Nothing written. Add --apply to make the correction.');
            return;
        }

        const result = await timecodeSync.apply(request);

        report(result);

        console.log(`\nApplied. ${result.observationsCorrected} observations corrected.`);
        console.log('Nothing records that this happened, so keep this line:');
        console.log(`  node scripts/resync-session.js --session ${result.sessionId} `
            + `--shift ${result.undoWith.shiftMs} --apply`);
    } catch (error) {
        console.error(`\n${error.message}`);
        process.exitCode = 1;
    }
}

main()
    .then(() => db.sequelize.close())
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
        return db.sequelize.close();
    });
