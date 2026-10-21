/**
 * The corpus a dataset-build test builds from, and the extractor it builds with.
 *
 * Shared by `tests/dataset-build-runner.test.js` and
 * `tests/dataset-build-lifecycle.test.js`, which ask different questions of the same
 * four observations: one asserts what a finished build produced, the other what a
 * cancelled, retried or failed one left behind. Seeding it twice would be two
 * descriptions of one shape, and the shape is the part the assertions depend on.
 *
 * **Everything here is seeded and removed by the suite that calls it.** CI builds an
 * empty database, so a test that borrows an existing row passes here and fails there;
 * `tests/setup/corpus-guard.js` fails a file that leaves one behind.
 *
 * ## What the corpus is, and why each row is the shape it is
 *
 * Three videos, four observations, three species:
 *
 * | video | observation | species | frames |
 * | --- | --- | --- | --- |
 * | one | first | A | 100–102 |
 * | one | second | B | 101–103 |
 * | two | third | B | 200–202 |
 * | three | fourth | C | 300–301 |
 *
 * `first` and `second` **overlap at frames 101 and 102**, which is the whole reason the
 * split rule exists: they are one connected group and must land in one split, and the
 * frames they share carry two label lines rather than one. A build that splits them is
 * evaluated on pictures it trained on, and nothing downstream can tell.
 *
 * Species are named `A`, `B`, `C` within a run so the vocabulary's order is a fact the
 * test can state: it is assigned by common name, so A is class 0 and C is class 2.
 *
 * ## The extractor is stubbed, and nothing else is
 *
 * A real build opens an H.264 stream over the network and takes minutes. The stub stands
 * in for exactly two calls -- `probeStream` and `extractFrames` -- and everything around
 * them stays real: the selection query, the planner, the JPEG re-encode, `tar`, the
 * hash, and every row written. It writes real 8x8 PNGs because the re-encode is real;
 * handing `sharp` an empty file would fail for a reason that has nothing to do with the
 * build.
 *
 * Stubbed with `jest.spyOn` rather than `jest.mock`, so the modules the application
 * loads are the application's own. Replacing the extraction service wholesale would
 * change what every route in `app.js` was built against, for the sake of two functions.
 *
 * @fileoverview Seeding, cleanup and a stubbed extractor for dataset-build tests.
 * @author Isaac Travers
 * @module tests/fixtures/dataset-build-fixture
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sharp = require('sharp');

const db = require('../../model');

const { QueryTypes } = db.Sequelize;

/** Frame rate the stubbed probe reports. The corpus is addressed in frames, not seconds. */
const FPS = 25;

/**
 * One encoded 8x8 PNG, made once and written many times.
 *
 * The frames have to be real images because the builder re-encodes them, and the
 * batching test asks for more than eight hundred of them -- encoding each one through
 * `sharp` made the stub cost more than the code it stands in for. The bytes are
 * identical for every frame, which no assertion depends on.
 *
 * @type {?Buffer}
 */
let framePng = null;

/**
 * The PNG every stubbed frame is written from.
 *
 * @async
 * @returns {Promise<Buffer>} The encoded image.
 */
async function pngBytes() {
    if (!framePng) {
        framePng = await sharp({
            create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 120, b: 200 } },
        }).png().toBuffer();
    }

    return framePng;
}

/**
 * Runs one statement and returns its rows.
 *
 * @param {string} sql - The statement.
 * @param {Object} [replacements] - Named replacements.
 * @returns {Promise<Array<Object>>} The rows.
 */
function q(sql, replacements = {}) {
    return db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

/**
 * Seed the corpus described above.
 *
 * @async
 * @param {string|number} runId - Distinguishes this run's rows in a shared database.
 * @returns {Promise<Object>} Every id it created, plus the video names.
 */
async function seedCorpus(runId) {
    const seeded = {
        runId,
        projectId: null,
        sessionId: null,
        /* Every session, so a test that wants observations the other builds cannot see
           can add one and still be cleaned up by `removeCorpus`. */
        sessionIds: [],
        speciesIds: [],
        observationIds: [],
        keyframeIds: [],
        videos: {
            one: `jest-build-one-${runId}.mp4`,
            two: `jest-build-two-${runId}.mp4`,
            three: `jest-build-three-${runId}.mp4`,
            /* For the batching test, which seeds its own long observation in its own
               session so the builds above cannot see it. */
            long: `jest-build-long-${runId}.mp4`,
        },
        names: {},
    };

    const [project] = await q(
        `INSERT INTO projects (name, "createdAt", "updatedAt")
         VALUES (:name, NOW(), NOW()) RETURNING project_id`,
        { name: `Jest Build Project ${runId}` }
    );

    seeded.projectId = project.project_id;

    seeded.sessionId = await addSession(seeded, 'A');

    /* Named A, B and C so the vocabulary's order -- assigned by common name -- is
       something the tests can state rather than discover. `taxserial` is unique and
       within INTEGER. */
    for (const letter of ['A', 'B', 'C']) {
        const comname = `Jest Build ${letter} ${runId}`;
        const [species] = await q(
            `INSERT INTO species (taxserial, species_list, comname, species, is_active, created_at, updated_at)
             VALUES (:taxserial, 'JestBuildList', :comname, :scientific, true, NOW(), NOW())
             RETURNING id`,
            {
                taxserial: (Date.now() % 2000000000) + seeded.speciesIds.length,
                comname,
                scientific: `Jestus buildus ${letter}`,
            }
        );

        seeded.speciesIds.push(species.id);
        seeded.names[letter] = comname;
    }

    const [speciesA, speciesB, speciesC] = seeded.speciesIds;

    seeded.first = await addObservation(seeded, { obsID: 1, speciesId: speciesA, video: seeded.videos.one });
    await addKeyframes(seeded, seeded.first, [100, 102]);

    seeded.second = await addObservation(seeded, { obsID: 2, speciesId: speciesB, video: seeded.videos.one });
    await addKeyframes(seeded, seeded.second, [101, 103]);

    seeded.third = await addObservation(seeded, { obsID: 3, speciesId: speciesB, video: seeded.videos.two });
    await addKeyframes(seeded, seeded.third, [200, 202]);

    seeded.fourth = await addObservation(seeded, { obsID: 4, speciesId: speciesC, video: seeded.videos.three });
    await addKeyframes(seeded, seeded.fourth, [300, 301]);

    return seeded;
}

/**
 * Insert one session under the fixture's project, and record it for cleanup.
 *
 * A second session is how a test gets observations the other builds cannot see: every
 * build here filters on `session`, so rows in another session are invisible to them
 * without any test having to know what the others selected.
 *
 * @async
 * @param {Object} seeded - The accumulating fixture.
 * @param {string} label - Distinguishes this session from the fixture's others.
 * @returns {Promise<number>} The new session id.
 */
async function addSession(seeded, label) {
    const [session] = await q(
        `INSERT INTO sessions (project_id, user_id, dive, line, "lineId", type, "createdAt", "updatedAt")
         VALUES (:projectId, 1, :dive, 'L1', :lineId, 'transect', NOW(), NOW())
         RETURNING session_id`,
        {
            projectId: seeded.projectId,
            dive: `J${label}${seeded.runId}`.slice(-6),
            lineId: `LID-JB-${label}-${seeded.runId}`,
        }
    );

    seeded.sessionIds.push(session.session_id);

    return session.session_id;
}

/**
 * Insert one observation and record it for cleanup.
 *
 * SQL rather than `db.observations.create`, because the model declares the key without
 * `autoIncrement` -- the repository assigns `max(id) + 1` itself -- so Sequelize sends an
 * explicit null and the insert fails. Tracked in #62.
 *
 * @async
 * @param {Object} seeded - The accumulating fixture.
 * @param {Object} row - `{obsID, speciesId, video, sessionId}`.
 * @returns {Promise<number>} The new observation id.
 */
async function addObservation(seeded, { obsID, speciesId, video, sessionId }) {
    const [inserted] = await q(
        `INSERT INTO observations
             (session_id, project_id, "obsID", confidence, comname, species_id, video_source, tc,
              "createdAt", "updatedAt")
         VALUES (:sessionId, :projectId, :obsID, 0.9, :comname, :speciesId, :video, '10:00:00',
                 NOW(), NOW())
         RETURNING observation_id`,
        {
            sessionId: sessionId || seeded.sessionId,
            projectId: seeded.projectId,
            obsID,
            comname: `Jest Build ${seeded.runId}`,
            speciesId,
            video,
        }
    );

    seeded.observationIds.push(inserted.observation_id);

    return inserted.observation_id;
}

/**
 * Draw keyframes on an observation at the given frame numbers.
 *
 * The box is the same at both ends on purpose: the frames between are interpolated, and
 * a box that does not move makes every interpolated label a value the test can predict.
 *
 * **Centred at 0.5, and that is load-bearing.** `keyframes.x, y` is the *centre* of the
 * box, not its top-left corner -- confirmed in `service/thumbnail-geometry.js` and now
 * said so on the model. This seeded (0.25, 0.25) while the runner still read a corner,
 * which was consistent then and became two different things afterwards: read as a centre,
 * a box of size 0.5 at (0.25, 0.25) sits flush against the top and left edges, so it was
 * silently running through the clipping path and the expected label changed from
 * `0.5 0.5 0.5 0.5` to `0.25 0.25 0.5 0.5`.
 *
 * Recentred rather than rewriting that expectation. A box centred at 0.5 and half the
 * frame wide spans 0.25 to 0.75, touches no edge, and needs no clipping -- so the label
 * is the fixture's own numbers, which is what makes it predictable. Clipping has its own
 * coverage in the real-video suite, which is what found the corner-origin bug by
 * asserting every coordinate lies in 0..1 and getting 1.012.
 *
 * @async
 * @param {Object} seeded - The accumulating fixture.
 * @param {number} observationId - Which observation.
 * @param {number[]} framenums - Where the boxes are.
 * @returns {Promise<void>}
 */
async function addKeyframes(seeded, observationId, framenums) {
    for (const framenum of framenums) {
        const [inserted] = await q(
            `INSERT INTO keyframes
                 (observation_id, subset, comname, type, framenum, x, y, width, height,
                  "createdAt", "updatedAt")
             VALUES (:observationId, 'train', :comname, 'box', :framenum,
                     0.5, 0.5, 0.5, 0.5, NOW(), NOW())
             RETURNING keyframe_id`,
            { observationId, framenum, comname: `Jest Build ${seeded.runId}` }
        );

        seeded.keyframeIds.push(inserted.keyframe_id);
    }
}

/**
 * Remove every row the fixture created, in dependency order.
 *
 * @async
 * @param {Object} seeded - What {@link seedCorpus} returned.
 * @returns {Promise<void>}
 */
async function removeCorpus(seeded) {
    if (!seeded) return;

    if (seeded.keyframeIds.length) {
        await db.sequelize.query('DELETE FROM keyframes WHERE keyframe_id IN (:ids)', {
            replacements: { ids: seeded.keyframeIds },
        });
    }

    if (seeded.observationIds.length) {
        await db.sequelize.query('DELETE FROM observations WHERE observation_id IN (:ids)', {
            replacements: { ids: seeded.observationIds },
        });
    }

    if (seeded.speciesIds.length) {
        await db.sequelize.query('DELETE FROM species WHERE id IN (:ids)', {
            replacements: { ids: seeded.speciesIds },
        });
    }

    if (seeded.sessionIds.length) {
        await db.sequelize.query('DELETE FROM sessions WHERE session_id IN (:ids)', {
            replacements: { ids: seeded.sessionIds },
        });
    }

    if (seeded.projectId) {
        await db.sequelize.query('DELETE FROM projects WHERE project_id = :id', {
            replacements: { id: seeded.projectId },
        });
    }
}

/**
 * Stand in for the two calls that reach the media server.
 *
 * The returned handle records what was asked for, so a test can assert that a build
 * stopped before extracting rather than after -- "no frames were cut" is otherwise
 * indistinguishable from "the frames were cut and then thrown away".
 *
 * @param {Object} modules - `{jellyfin, extraction}`, the real modules to spy on.
 * @param {Object} [behaviour] - `{onExtract, omit}`; see below.
 * @returns {Object} `{calls, restore}`.
 */
function stubExtraction({ jellyfin, extraction }, behaviour = {}) {
    const calls = { probes: [], extractions: [] };

    const resolve = jest.spyOn(jellyfin, 'resolveVideoSource')
        .mockImplementation(async (name) => ({ item: { id: `jest-item-${name}` } }));

    const stream = jest.spyOn(jellyfin, 'buildDirectStreamUrl')
        .mockImplementation(async (id) => `http://jest.invalid/stream/${id}`);

    const probe = jest.spyOn(extraction, 'probeStream')
        .mockImplementation(async (url) => {
            calls.probes.push(url);

            return { width: 8, height: 8, codec: 'h264', fps: FPS, duration: 60 };
        });

    const extract = jest.spyOn(extraction, 'extractFrames')
        .mockImplementation(async (url, frames, fps, destination) => {
            calls.extractions.push({ url, frames: [...frames], fps, destination });

            /* A hook for the tests that need something to happen *during* extraction --
               a cancellation arriving between videos, or a failure. */
            if (behaviour.onExtract) await behaviour.onExtract(calls.extractions.length, frames);

            const files = [];
            const bytes = await pngBytes();

            for (let i = 0; i < frames.length; i++) {
                /* `omit` is how "the extractor could not produce that frame" is said: the
                   builder names its output by position in the list it was given, so a
                   missing file is a gap rather than a shift. */
                if (behaviour.omit && behaviour.omit(frames[i], calls.extractions.length)) continue;

                const file = path.join(destination, `frame-${String(i + 1).padStart(4, '0')}.png`);

                fs.writeFileSync(file, bytes);
                files.push(file);
            }

            return { files, ptsTimes: frames.map((f) => f / fps), seconds: 0.01 };
        });

    return {
        calls,
        restore() {
            resolve.mockRestore();
            stream.mockRestore();
            probe.mockRestore();
            extract.mockRestore();
        },
    };
}

/**
 * The staging and cut directories a build would leave behind, right now.
 *
 * A build stages gigabytes of frames in the system temp directory and removes them in a
 * `finally`. "It left nothing behind" is only checkable by looking, and looking by name
 * is the one thing that can see a build that failed half way.
 *
 * @returns {string[]} The directory names, sorted.
 */
function stagingDirectories() {
    return fs.readdirSync(os.tmpdir())
        .filter((name) => name.startsWith('marp-dataset-') || name.startsWith('marp-build-'))
        .sort();
}

module.exports = {
    FPS,
    addKeyframes,
    addObservation,
    addSession,
    removeCorpus,
    seedCorpus,
    stagingDirectories,
    stubExtraction,
};
