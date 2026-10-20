/**
 * Building a training dataset out of MARP's own observations.
 *
 * The slow, side-effecting half of #268: cut the frames, write the labels, package the
 * archive, record what went in. The decisions live next door in
 * `service/dataset-build-plan.js`, which is pure and tested in milliseconds; this file is
 * the part that talks to ffmpeg, Jellyfin and the disk.
 *
 * **A second consumer of the thumbnail extractor, not a second extractor.** It already
 * cuts a set of frames from one video in a single ffmpeg pass, already resolves a video
 * through Jellyfin, and already has a concurrency ceiling that exists to protect the
 * media server. #268 predicted a dataset build would want the same capability; it does,
 * and the way to not drift from it is to call it.
 *
 * **The archive is the shape `scripts/package-dataset.js` produces**, because that is
 * what the worker already fetches, verifies and trains on
 * (`MarineAppliedResearch/marp-inference-worker#67`): `train/images`, `train/labels`,
 * `eval/images`, `eval/labels` and a `data.yaml`, in one tar named for its own SHA-256.
 *
 * @fileoverview Runs a queued dataset build.
 * @author Isaac Travers
 * @module service/dataset-build
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const logger = require('../logger/api.logger');
const jellyfinRepository = require('../repository/jellyfin.repository');
const mosaicRepository = require('../repository/mosaic.repository');
const buildRepository = require('../repository/dataset-build.repository');
const extraction = require('./thumbnail-extraction.service');
const plan = require('./dataset-build-plan');

/*
 * Where packaged archives live, and what the row says about them.
 *
 * Taken from the orchestration config rather than computed here, because #269 made the
 * root configurable with `DATASET_STORAGE_DIR` -- a database and the archives it names
 * are one unit, and an API serving that database from a second checkout resolved its own
 * tree, found nothing and answered 404. Two definitions of this path would put a build's
 * output somewhere the route serving it does not look.
 */
const { DATASET_DIRECTORY: ARCHIVE_DIRECTORY, DATASET_PATH_PREFIX: ARCHIVE_PATH_PREFIX } =
    require('../config/gpu-orchestration');

/** Identifies this API to Jellyfin, the way the thumbnail path does. */
const MEDIA_CLIENT_IDENTITY = { client: 'MARP API', device: 'dataset-build' };

/**
 * The archive's `data.yaml`.
 *
 * Relative paths, pointing at where this writes the splits inside the archive. The worker
 * makes them absolute against wherever it unpacked, which is the one thing it cannot know
 * in advance (#67 R12).
 *
 * @param {Array<Object>} classes - From `vocabulary`, index order.
 * @returns {string} The file's text.
 */
function dataYaml(classes) {
    return [
        'names:',
        ...classes.map((entry) => `- ${entry.comname}`),
        `nc: ${classes.length}`,
        'train: train/images',
        'val: eval/images',
        '',
    ].join('\n');
}

/**
 * Cut one video's frames and write them with their labels.
 *
 * **One ffmpeg pass for the whole video**, however many observations are in it. Opening
 * the video is the expensive part and the frames taken from it are nearly free, so a pass
 * per observation would take hours where this takes minutes.
 *
 * Frames the extractor could not produce are skipped rather than failing the build: a
 * video whose last second is truncated should cost the frames at the end, not the dataset.
 * How many were lost comes back so the caller can report it.
 *
 * @async
 * @param {Object} entry - One `extractionPlan` entry: `{split, video, frames}`.
 * @param {string} staging - The build's staging directory.
 * @returns {Promise<{written: number, missing: number}>} What it managed.
 */
async function cutVideo(entry, staging) {
    const resolved = await jellyfinRepository.resolveVideoSource(entry.video, 1, MEDIA_CLIENT_IDENTITY);
    const streamUrl = await jellyfinRepository.buildDirectStreamUrl(resolved.item.id, MEDIA_CLIENT_IDENTITY);
    const probe = await extraction.probeStream(streamUrl);

    if (!probe.fps) {
        throw new Error(`${entry.video} reported no frame rate, so its frames cannot be addressed.`);
    }

    const wanted = [...entry.frames.keys()].sort((a, b) => a - b);
    const images = path.join(staging, entry.split, 'images');
    const labels = path.join(staging, entry.split, 'labels');

    fs.mkdirSync(images, { recursive: true });
    fs.mkdirSync(labels, { recursive: true });

    const cut = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-build-'));

    try {
        await extraction.extractFrames(streamUrl, wanted, probe.fps, cut);

        let written = 0;
        let missing = 0;

        for (let i = 0; i < wanted.length; i++) {
            const frame = wanted[i];

            /* The extractor names its output `frame-%04d.png`, by position in the list it
               was given -- that is how one pass stays addressable. Taken from the loop
               rather than by searching the list: `indexOf` inside the loop is quadratic,
               and this list runs to tens of thousands. */
            const produced = path.join(cut, `frame-${String(i + 1).padStart(4, '0')}.png`);

            if (!fs.existsSync(produced)) {
                missing += 1;

                continue;
            }

            /* The video's name is in the filename, not just the frame number: two videos
               in one split both have a frame 1200, and one would overwrite the other. */
            const stem = `${path.parse(entry.video).name}_${String(frame).padStart(8, '0')}`;

            fs.renameSync(produced, path.join(images, `${stem}.png`));
            fs.writeFileSync(path.join(labels, `${stem}.txt`), `${entry.frames.get(frame).join('\n')}\n`, 'utf8');
            written += 1;
        }

        return { written, missing };
    } finally {
        fs.rmSync(cut, { recursive: true, force: true });
    }
}

/**
 * Package a staging directory into one content-addressed tar.
 *
 * **Named for its own SHA-256**, so building the same dataset twice is the same file and
 * a rebuild is not a way to accumulate copies. Hashed by streaming, because the archive
 * is gigabytes and must never be held in memory.
 *
 * @param {string} staging - The directory holding `train/`, `eval/` and `data.yaml`.
 * @returns {{path: string, sha256: string, bytes: number}} Where it went and what it is.
 */
function packageArchive(staging) {
    fs.mkdirSync(ARCHIVE_DIRECTORY, { recursive: true });

    const partialName = `building-${process.pid}-${Date.now()}.tar`;
    const partial = path.join(ARCHIVE_DIRECTORY, partialName);
    const present = ['train', 'eval', 'data.yaml'].filter(
        (name) => fs.existsSync(path.join(staging, name))
    );

    /* **A bare filename, with `cwd` set.** `tar -cf C:\\...` is read as a remote host
       called `C`, because a colon in an archive path means `host:path` to GNU tar. The
       first real build failed exactly there. `-C` takes a full path safely: it is a
       directory to change to, never parsed for a host. `package-dataset.js` writes it
       the same way for the same reason. */
    execFileSync('tar', ['-cf', partialName, '-C', staging, ...present], {
        cwd: ARCHIVE_DIRECTORY,
        stdio: 'pipe',
    });

    /* Streamed, not read. `readFileSync` on a 5 GB archive is 5 GB of heap and the
       process dies before it hashes anything -- which is the whole reason
       `package-dataset.js` streams it too. */
    const digest = crypto.createHash('sha256');
    const reader = fs.openSync(partial, 'r');
    const chunk = Buffer.alloc(1024 * 1024);

    try {
        let read = fs.readSync(reader, chunk, 0, chunk.length, null);

        while (read > 0) {
            digest.update(chunk.subarray(0, read));
            read = fs.readSync(reader, chunk, 0, chunk.length, null);
        }
    } finally {
        fs.closeSync(reader);
    }

    const sha256 = digest.digest('hex');
    const bytes = fs.statSync(partial).size;
    const finalPath = path.join(ARCHIVE_DIRECTORY, `${sha256}.tar`);

    if (fs.existsSync(finalPath)) fs.rmSync(partial);
    else fs.renameSync(partial, finalPath);

    return { path: `${ARCHIVE_PATH_PREFIX}/${sha256}.tar`, sha256, bytes };
}

/**
 * Run one queued build, if there is one.
 *
 * Returns what happened rather than throwing, because the caller is a loop and a build
 * that failed is not a reason to stop taking the next one.
 *
 * **Cancellation is checked between videos.** The thing being interrupted is an ffmpeg
 * pass, and the useful place to stop is between two of them: stopping mid-pass leaves a
 * half-written frame to clean up and saves seconds.
 *
 * @async
 * @returns {Promise<?Object>} What it did, or null when nothing was queued.
 */
async function runOne() {
    const claimed = await buildRepository.claimBuild();

    if (!claimed) return null;

    const { job, attempt } = claimed;
    const spec = job.spec || {};
    const datasetId = spec.dataset_id;
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-dataset-'));

    try {
        await buildRepository.reportProgress(attempt.id, { phase: 'selecting', unit: 'frames' });

        /* Two shapes, because the builder has two. A dashboard build is a union of
           queries each sent to a split by the person assembling it, and the splits it
           declared are honoured. A build that only named filters gets the ratios. */
        let rows;
        let splits;

        if (Array.isArray(spec.subsets) && spec.subsets.length) {
            const selected = [];

            for (const subset of spec.subsets) {
                selected.push({
                    split: subset.split || 'train',
                    rows: await mosaicRepository.selectForBuild({ filters: subset.filters || {} }),
                });
            }

            splits = plan.assignFromSubsets(selected);
            rows = [...splits.values()].flat();
        } else {
            rows = await mosaicRepository.selectForBuild({ filters: spec.filters || {} });
            splits = plan.assignSplits(
                plan.connectedGroups(rows),
                spec.splits || { train: 0.8, eval: 0.2 }
            );
        }

        if (!rows.length) {
            throw new Error('Those filters match no promoted observation with keyframes and a species.');
        }

        const classes = plan.vocabulary(rows);
        const videos = plan.extractionPlan(splits, classes);
        const total = [...videos.values()].reduce((sum, entry) => sum + entry.frames.size, 0);

        await buildRepository.reportProgress(attempt.id, {
            phase: 'extracting', done: 0, total, unit: 'frames',
        });

        let done = 0;
        let missing = 0;

        for (const entry of videos.values()) {
            if (await buildRepository.isCancelled(job.id)) {
                await buildRepository.failBuild({
                    jobId: job.id,
                    attemptId: attempt.id,
                    datasetId,
                    reason: 'Cancelled while extracting.',
                    cancelled: true,
                });

                return { cancelled: true, jobId: job.id };
            }

            const cut = await cutVideo(entry, staging);

            done += cut.written;
            missing += cut.missing;

            await buildRepository.reportProgress(attempt.id, {
                phase: 'extracting', done, total, unit: 'frames',
            });
        }

        if (!done) {
            throw new Error('No frame could be cut from any of the videos these observations name.');
        }

        fs.writeFileSync(path.join(staging, 'data.yaml'), dataYaml(classes), 'utf8');

        await buildRepository.reportProgress(attempt.id, { phase: 'packaging', done, total, unit: 'frames' });

        const archive = packageArchive(staging);

        const members = [];

        for (const [split, included] of splits) {
            for (const row of included) members.push({ observation_id: row.observation_id, split });
        }

        await buildRepository.recordBuild({
            jobId: job.id,
            attemptId: attempt.id,
            datasetId,
            members,
            classes,
            archive,
            samples: done,
        });

        logger.info(`Dataset ${datasetId} built: ${done} images, ${classes.length} classes, `
            + `${archive.sha256.slice(0, 12)}`);

        return { jobId: job.id, datasetId, images: done, missing, classes: classes.length, archive };
    } catch (error) {
        await buildRepository.failBuild({
            jobId: job.id,
            attemptId: attempt.id,
            datasetId,
            reason: String(error && error.message ? error.message : error).slice(0, 2000),
        });

        logger.error(`Dataset build ${job.id} failed: ${error && error.message}`);

        return { jobId: job.id, datasetId, failed: true, reason: error && error.message };
    } finally {
        // Gigabytes of frames, whatever happened. The archive is already out of here.
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

/** The poller's own state. One build at a time, by construction. */
const live = { started: false, timer: null, running: false };

/** How long to wait before looking for another build when there was none. */
const IDLE_MS = 15000;

/**
 * Take builds as they are queued, one at a time.
 *
 * **One at a time deliberately.** A build is a second consumer of the same media server
 * the thumbnail extractor protects with a concurrency ceiling (`task-118`, R20), and two
 * builds would double the load on Jellyfin without anybody having chosen that. It is also
 * disk-bound: two builds staging tens of gigabytes at once is a full disk rather than
 * twice the throughput.
 *
 * Never throws out of the loop. `runOne` already turns a failed build into a failed row,
 * so anything reaching here is a bug in the loop itself and stopping the poller over it
 * would silently end dataset building until somebody restarted the API.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loop() {
    if (!live.started) return;

    let worked = false;

    try {
        live.running = true;
        worked = Boolean(await runOne());
    } catch (error) {
        logger.error(`Dataset build loop: ${error && error.message}`);
    } finally {
        live.running = false;
    }

    if (!live.started) return;

    // Straight on to the next when one was just built; a queue is usually more than one.
    live.timer = setTimeout(loop, worked ? 0 : IDLE_MS);

    if (live.timer.unref) live.timer.unref();
}

/**
 * Start taking queued builds.
 *
 * @returns {{started: boolean}} Whether the poller is now running.
 */
function start() {
    if (live.started) return { started: true };

    live.started = true;
    live.timer = setTimeout(loop, 0);

    if (live.timer.unref) live.timer.unref();

    return { started: true };
}

/**
 * Stop taking new builds.
 *
 * Does not interrupt one in flight: a build part-way through has gigabytes staged and the
 * tidy place to stop is where `runOne` already checks for cancellation.
 *
 * @returns {{stopped: boolean, running: boolean}} Whether one is still finishing.
 */
function stop() {
    live.started = false;

    if (live.timer) clearTimeout(live.timer);

    live.timer = null;

    return { stopped: true, running: live.running };
}

module.exports = {
    ARCHIVE_DIRECTORY,
    cutVideo,
    dataYaml,
    packageArchive,
    runOne,
    start,
    stop,
};
