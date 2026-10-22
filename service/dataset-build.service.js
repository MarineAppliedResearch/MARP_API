/**
 * Building a training dataset out of MARP's own observations.
 *
 * The slow, side-effecting half of #268: cut the frames, write the labels, package the
 * archive, record what went in. The decisions live next door in
 * `service/dataset-build-plan.js`, which is pure and tested in milliseconds; this file is
 * the part that talks to ffmpeg, Jellyfin and the disk.
 *
 * **A second consumer of the thumbnail extractor, not a second extractor.** It already
 * cuts a set of frames from one video in a single ffmpeg pass and already resolves a
 * video through Jellyfin. #268 predicted a dataset build would want the same capability;
 * it does, and the way to not drift from it is to call it.
 *
 * **What it does not inherit is a concurrency ceiling**, and this said it did until
 * 2026-10-22. `MAX_CONCURRENT_STREAMS` is applied by the thumbnail *sweep*, which fans
 * out that many workers of its own; `extractFrames` and `probeStream` are plain functions
 * with no limiter in them. So builds and thumbnail extraction are not dividing a budget,
 * they are two independent loads on one media server, and the streams add. Worth knowing
 * before turning {@link concurrency} up: two builds beside a running sweep is five
 * streams, not three.
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

const sharp = require('sharp');

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

/**
 * What the builder's splits are called inside the archive.
 *
 * **The screen says Train, Validation and Test; the archive has always said `train` and
 * `eval`.** Validation *is* what `val:` means, so it maps onto the directory the worker
 * already reads rather than inventing a third. Test is genuinely a third split and gets
 * its own, named in `data.yaml` where Ultralytics looks for it.
 *
 * Until this existed, `cutVideo` wrote `validation/` and `test/` directories that
 * `packageArchive` then did not include, so those frames were cut, recorded as members
 * and silently dropped.
 */
const SPLIT_DIRECTORIES = {
    train: 'train',
    eval: 'eval',
    validation: 'eval',
    test: 'test',
};

/**
 * The archive directory one split writes into.
 *
 * Refuses an unknown name rather than inventing a directory for it: an unrecognised
 * split is a request that cannot be honoured, and the failure anybody wants is the build
 * saying so, not an archive quietly missing a third of itself.
 *
 * @param {string} split - The split's name, as the builder sent it.
 * @returns {string} The directory inside the archive.
 * @throws {Error} When the name is not one the archive has a place for.
 */
function directoryFor(split) {
    const directory = SPLIT_DIRECTORIES[split];

    if (!directory) {
        throw new Error(
            `"${split}" is not a split this archive has a place for; `
            + `it holds ${Object.keys(SPLIT_DIRECTORIES).join(', ')}`
        );
    }

    return directory;
}

/**
 * How a training frame is written, and the one place that decides it.
 *
 * **JPEG, because every dataset MARP has ever trained on is JPEG.**
 * `MARE_Video_Annotations/datasets/rockfish5/train` is JPEG at about 364 KB a frame, the
 * pretrained weights everyone fine-tunes from learned on JPEG (COCO, VOC, Open Images),
 * and the source here is H.264 video that has already discarded far more detail than
 * JPEG does -- writing PNG preserves the video's own compression artifacts exactly, at
 * nearly seven times the size. Measured on the same 219 frames: 1,690 KB each as PNG
 * against 246 KB at quality 90.
 *
 * At the 50,000-frame datasets this is for, that is the difference between about 20 GB
 * and about 85 GB.
 *
 * **Quality 95 rather than 90**, so a dataset built now is not *more* compressed than the
 * ones the existing models learned on: 90 came out at 246 KB against the legacy's 364.
 *
 * **Switchable per build**, because this is a judgement about today's evidence rather
 * than a law. If somebody later finds small distant animals need lossless frames, a
 * build asks for `{format: 'png'}` and nothing else has to change.
 */
const DEFAULT_IMAGE = { format: 'jpeg', quality: 95 };

/** The formats a build may ask for. */
const IMAGE_FORMATS = ['jpeg', 'png'];

/**
 * Settle how this build writes its frames.
 *
 * Refuses an unknown format rather than quietly falling back, because a dataset built in
 * a format nobody asked for is one somebody has to rebuild to find out.
 *
 * @param {Object} [asked] - `{format, quality}` from the job spec.
 * @returns {{format: string, quality: number, extension: string}} What to write.
 * @throws {Error} When the format is not one of {@link IMAGE_FORMATS}.
 */
function imageSettings(asked) {
    const format = String((asked && asked.format) || DEFAULT_IMAGE.format).toLowerCase();

    if (!IMAGE_FORMATS.includes(format)) {
        throw new Error(`"${format}" is not an image format this builds in; it writes ${IMAGE_FORMATS.join(' or ')}`);
    }

    const asksQuality = asked && asked.quality !== undefined && asked.quality !== null;
    const quality = asksQuality ? Number(asked.quality) : DEFAULT_IMAGE.quality;

    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
        throw new Error(`image quality must be between 1 and 100, not ${asked.quality}`);
    }

    // PNG is lossless, so a quality asked for alongside it would be ignored and the
    // asker would never know. Say so instead.
    if (format === 'png' && asksQuality) {
        throw new Error('png is lossless, so it takes no quality; drop it or ask for jpeg');
    }

    return { format, quality, extension: format === 'jpeg' ? 'jpg' : 'png' };
}

/**
 * How many frames one ffmpeg pass asks for.
 *
 * `extractFrames` builds a `select` expression with a term per frame, so the command line
 * grows with the batch: about forty characters each, against an operating-system limit
 * near 32 KB on Windows.
 *
 * **100 rather than 400, chosen for the person watching rather than for ffmpeg.** 400
 * took about ninety seconds a pass, so a four-hour build showed a number that sat still
 * for a minute and a half at a time and gave no way to tell working from wedged. A
 * hundred reports roughly every twenty seconds. The cost is one more seek into a video
 * already open on disk, which is cheap next to decoding; the command line stays near
 * 4 KB, far inside the limit.
 *
 * Found at 8,408 frames, where a build died with `spawn ENAMETOOLONG` after minutes of
 * extraction. Every build run by hand until then had been a few hundred frames, which is
 * why it had never shown.
 */
const FRAMES_PER_PASS = 100;

/**
 * The gap past which a pass ends and the next one seeks instead.
 *
 * Decoding through a gap costs the whole gap; seeking past it costs one seek. 250 frames
 * is ten seconds at 25fps -- long enough that the seek is worth it, short enough that
 * frames of one animal stay in one pass.
 *
 * Without this a pass could span minutes of video for a hundred frames and be killed by
 * the extractor's 120-second timeout, which is exactly what happened.
 *
 * @constant
 * @type {number}
 */
const SEEK_RATHER_THAN_DECODE = 250;

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
function dataYaml(classes, directories = ['train', 'eval']) {
    const lines = [
        'names:',
        ...classes.map((entry) => `- ${entry.comname}`),
        `nc: ${classes.length}`,
        'train: train/images',
        'val: eval/images',
    ];

    /* Ultralytics reads `test:` and leaves it alone unless asked to evaluate against it,
       which is what a held-out split is for. Written only when there is one, so a
       two-split dataset's yaml is byte-identical to what it was before. */
    if (directories.includes('test')) lines.push('test: test/images');

    return [...lines, ''].join('\n');
}

/**
 * Split the wanted frames into passes ffmpeg can serve without timing out.
 *
 * **A pass costs what it decodes, not what it keeps.** `extractFrames` seeks to the
 * first frame and decodes forward to the last, so a hundred frames spread across a video
 * makes ffmpeg read the whole span between them. Taking a hundred *by count* produced a
 * pass covering four and a half minutes of video, which the extractor's 120-second
 * timeout killed -- after it had already produced all hundred frames.
 *
 * So a pass breaks on a gap as well as on a count. Frames within one observation are
 * contiguous; the gaps are between observations, and skipping one with a fresh seek is
 * far cheaper than decoding through it.
 *
 * Found by the real-video suite on the second thing it caught, both times in work of
 * mine that every synthetic fixture had passed.
 *
 * @param {Array<number>} wanted - Frame numbers, ascending.
 * @returns {Array<Array<number>>} The passes, in order.
 */
function passes(wanted) {
    const out = [];
    let current = [];

    for (const frame of wanted) {
        const gap = current.length ? frame - current[current.length - 1] : 0;

        if (current.length && (current.length >= FRAMES_PER_PASS || gap > SEEK_RATHER_THAN_DECODE)) {
            out.push(current);
            current = [];
        }

        current.push(frame);
    }

    if (current.length) out.push(current);

    return out;
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
 * @param {Object} [image] - From {@link imageSettings}; how to write each frame.
 * @param {Function} [onBatch] - Called with the running count after each pass, so a
 * long video reports progress while it is still being cut rather than only when it
 * is finished. Returning exactly `false` stops the cut after that pass.
 * @returns {Promise<{written: number, missing: number}>} What it managed.
 */
async function cutVideo(entry, staging, image = imageSettings(), onBatch = null) {
    const resolved = await jellyfinRepository.resolveVideoSource(entry.video, 1, MEDIA_CLIENT_IDENTITY);
    const streamUrl = await jellyfinRepository.buildDirectStreamUrl(resolved.item.id, MEDIA_CLIENT_IDENTITY);
    const probe = await extraction.probeStream(streamUrl);

    if (!probe.fps) {
        throw new Error(`${entry.video} reported no frame rate, so its frames cannot be addressed.`);
    }

    const wanted = [...entry.frames.keys()].sort((a, b) => a - b);
    const directory = directoryFor(entry.split);
    const images = path.join(staging, directory, 'images');
    const labels = path.join(staging, directory, 'labels');

    fs.mkdirSync(images, { recursive: true });
    fs.mkdirSync(labels, { recursive: true });

    const cut = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-build-'));

    try {
        let written = 0;
        let missing = 0;

        /* **One pass per batch, not one pass per video.** `extractFrames` builds a
           `select` expression with a term per frame, so a video wanting 8,408 frames
           produced a command line of roughly 340 KB against a limit near 32 KB, and the
           build died with `spawn ENAMETOOLONG` after minutes of work. Every build run by
           hand before that had been a few hundred frames.

           It also keeps a second limit out of reach: the extractor names its output
           `frame-%04d.png`, so one pass over more than 9,999 frames would have begun
           overwriting its own output. A batch never comes close.

           And it makes progress move *within* a video rather than only between videos,
           which over a four-hour build is the difference between a number that climbs
           and one that sits still. */
        for (const batch of passes(wanted)) {

            // Its own directory, so position-within-batch stays the addressing.
            const batchDir = path.join(cut, String(batch[0]));

            fs.mkdirSync(batchDir, { recursive: true });
            await extraction.extractFrames(streamUrl, batch, probe.fps, batchDir);

            for (let i = 0; i < batch.length; i++) {
                const frame = batch[i];
                const produced = path.join(batchDir, `frame-${String(i + 1).padStart(4, '0')}.png`);

                if (!fs.existsSync(produced)) {
                    missing += 1;

                    continue;
                }

                /* The video's name is in the filename, not just the frame number: two
                   videos in one split both have a frame 1200, and one would overwrite
                   the other. */
                const stem = `${path.parse(entry.video).name}_${String(frame).padStart(8, '0')}`;

                /* The extractor writes PNG, because a thumbnail is cropped and
                   re-processed afterwards. A training frame is not, so it is re-encoded
                   here -- see `DEFAULT_IMAGE` for why that is JPEG. */
                const destination = path.join(images, `${stem}.${image.extension}`);

                if (image.format === 'png') fs.renameSync(produced, destination);
                else {
                    await sharp(produced).jpeg({ quality: image.quality, mozjpeg: true }).toFile(destination);
                    fs.rmSync(produced, { force: true });
                }

                fs.writeFileSync(path.join(labels, `${stem}.txt`), `${entry.frames.get(frame).join('\n')}\n`, 'utf8');
                written += 1;
            }

            // Converted or moved; nothing in here is wanted again, and a long video's
            // staging would otherwise hold every PNG it ever cut.
            fs.rmSync(batchDir, { recursive: true, force: true });

            /* The hook may stop the cut, not merely watch it. Cancellation used to be
               checked only between videos, so on an 8,000-frame video somebody pressing
               cancel waited minutes for a build they had already abandoned -- and the
               frames kept being written in the meantime. A pass is the natural place:
               it is seconds, and the staging directory is in a consistent state. */
            /* **Exactly `false`, not merely falsy, and that is deliberate.** A watcher
               that forgets to return anything gives `undefined`, which does not stop the
               cut -- so adding a second `onBatch` for logging cannot silently cancel
               somebody's four-hour build. Stopping is a thing a caller has to say. */
            if (onBatch && await onBatch(written) === false) {
                return { written, missing, stopped: true };
            }
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
 * @param {string} staging - The directory holding the splits and `data.yaml`.
 * @returns {{path: string, sha256: string, bytes: number}} Where it went and what it is.
 */
function packageArchive(staging) {
    fs.mkdirSync(ARCHIVE_DIRECTORY, { recursive: true });

    const partialName = `building-${process.pid}-${Date.now()}.tar`;
    const partial = path.join(ARCHIVE_DIRECTORY, partialName);

    /* Every split directory that was actually written, not a fixed pair. The fixed pair
       is how a subset sent to Test was cut, recorded as a member and then left out of
       the tar -- the dataset claiming observations its own archive did not hold. */
    const present = [...new Set(Object.values(SPLIT_DIRECTORIES)), 'data.yaml'].filter(
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
        /* Settled before anything is cut, so a bad format fails in a second rather than
           after an hour of extraction. */
        const image = imageSettings(spec.image);

        await buildRepository.reportProgress(attempt.id, { phase: 'selecting', unit: 'frames' });

        /* Two shapes, because the builder has two. A dashboard build is a union of
           queries each sent to a split by the person assembling it, and the splits it
           declared are honoured. A build that only named filters gets the ratios. */
        let rows;
        let splits;

        if (Array.isArray(spec.subsets) && spec.subsets.length) {
            const selected = [];

            for (const subset of spec.subsets) {
                const matched = await mosaicRepository.selectForBuild({ filters: subset.filters || {} });

                /* **A subset either names a split or names shares.** "These dives into
                   train" and "divide this query 70/20/10" are both things somebody says,
                   and a builder that only understood the first made them run the same
                   query three times to say the second. Shares are divided here, before
                   the subsets are reconciled, so the first-assignment rule still settles
                   an observation two subsets both matched. */
                if (subset.shares && Object.keys(subset.shares).length) {
                    const divided = plan.assignSplits(plan.connectedGroups(matched), subset.shares);

                    for (const [split, rowsIn] of divided) selected.push({ split, rows: rowsIn });
                } else {
                    selected.push({ split: subset.split || 'train', rows: matched });
                }
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

        /* **Counted off `splits`, the same way the membership rows are built at the end.**
           Not `rows.length`: in the subsets branch those are the same number, but taking
           it from the thing `recordBuild` also walks means the figure written here and
           the one written when the build finishes cannot drift apart -- they are one
           count made twice rather than two counts that ought to agree. */
        const included = [...splits.values()].reduce((sum, rowsIn) => sum + rowsIn.length, 0);

        /* Selection is done, so these two are final. They used to be written only by
           `recordBuild`, which meant Observations and Classes stayed blank for the hours a
           build spends cutting frames -- beside a frame count that was visibly climbing. */
        await buildRepository.recordSelection({
            datasetId,
            observations: included,
            classes: classes.length,
        });

        await buildRepository.reportProgress(attempt.id, {
            phase: 'extracting', done: 0, total, unit: 'frames',
        });

        let done = 0;
        let missing = 0;
        let at = 0;

        const total_videos = videos.size;

        for (const entry of videos.values()) {
            at += 1;

            /* **Which video, and how far through the list.** A build sits on one video
               for minutes and reports only when a pass finishes, so without this the
               screen is a number that does not move and no way to tell working from
               wedged. Isaac, watching one: "i can't really tell if it's still running
               or not... maybe seeing what video it is currently looking at".

               `progress_phase` is varchar(64) and a Jellyfin filename is long, so the
               name is trimmed from the left -- the end of these names is the timestamp
               that distinguishes them, and the start is the survey prefix every one of
               them shares. */
            const name = path.parse(entry.video).name;
            const room = 64 - `extracting  ${at}/${total_videos}  `.length;
            const shown = name.length > room ? `…${name.slice(-(room - 1))}` : name;
            const phase = `extracting ${at}/${total_videos} ${shown}`;

            await buildRepository.reportProgress(attempt.id, {
                phase, done, total, unit: 'frames',
            });
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

            /* Reported per batch rather than per video: one video can hold thousands of
               frames, and a reader watching a four-hour build needs the number to move
               before the video it is on is finished. `done` is the count before this
               video; the batch reports its own running total on top. */
            const before = done;
            const cut = await cutVideo(entry, staging, image, async (soFar) => {
                await buildRepository.reportProgress(
                    attempt.id, { phase, done: before + soFar, total, unit: 'frames' }
                );

                // Checked per pass rather than per video: a long video is minutes, and
                // somebody who pressed cancel should not wait out the rest of it.
                return !await buildRepository.isCancelled(job.id);
            });

            done += cut.written;
            missing += cut.missing;

            if (cut.stopped) {
                await buildRepository.failBuild({
                    jobId: job.id,
                    attemptId: attempt.id,
                    datasetId,
                    reason: 'Cancelled while extracting.',
                    cancelled: true,
                });

                return { cancelled: true, jobId: job.id };
            }

            await buildRepository.reportProgress(attempt.id, {
                phase, done, total, unit: 'frames',
            });
        }

        if (!done) {
            throw new Error('No frame could be cut from any of the videos these observations name.');
        }

        const written = [...new Set([...splits.keys()].map(directoryFor))];

        fs.writeFileSync(path.join(staging, 'data.yaml'), dataYaml(classes, written), 'utf8');

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
            /* Two different numbers, recorded as two. `num_samples` has meant *images*
               since before MARP built datasets -- `scripts/package-dataset.js` writes
               it, which is why rockfish5 is known as 11,845 images -- so redefining it
               would leave one column meaning images on every legacy row and something
               else on every new one, with nothing to tell them apart. The observation
               count is the genuinely new fact and gets the new column. */
            frames: done,
            observations: members.length,
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

/** The poller's own state. `inFlight` is how many builds are running right now. */
const live = { started: false, timer: null, inFlight: 0 };

/** How long to wait before looking for another build when there was none. */
const IDLE_MS = 15000;

/** How many builds run at once when nothing says otherwise. */
const DEFAULT_CONCURRENCY = 2;

/**
 * How many builds may run at once.
 *
 * **Read per tick rather than captured at startup**, which is the point of it being an
 * environment variable at all: Isaac asked for two or three *"and see how Jellyfin
 * copes"*, and a judgement formed by watching is worth nothing if changing it means
 * editing code. Restarting the API picks up a new value; nothing here caches it.
 *
 * **Two by default, and the reason is a media server rather than this process.** A build
 * holds one Jellyfin stream at a time -- `cutVideo` walks its videos in order and each
 * pass awaits the one before it -- so the ceiling here is very nearly a count of streams
 * MARP adds to whatever the thumbnail extractor is already pulling. That extractor runs
 * its own fan-out up to `MAX_CONCURRENT_STREAMS`, and the two numbers are not connected:
 * there is no shared limiter, so they add rather than divide a budget.
 *
 * A value below one would stop builds silently, which `DATASET_BUILDS=off` already says
 * out loud and means on purpose, so anything unparseable or less than one falls back to
 * the default instead.
 *
 * @returns {number} The ceiling, at least one.
 */
function concurrency() {
    const asked = Number(process.env.DATASET_BUILD_CONCURRENCY);

    return Number.isFinite(asked) && asked >= 1 ? Math.floor(asked) : DEFAULT_CONCURRENCY;
}

/**
 * Put the next tick on the clock, replacing whatever was pending.
 *
 * One timer, so a build finishing can bring the next tick forward without leaving the
 * idle one behind to fire as well.
 *
 * @param {number} delay - Milliseconds.
 * @returns {void}
 */
function schedule(delay) {
    if (!live.started) return;

    if (live.timer) clearTimeout(live.timer);

    live.timer = setTimeout(loop, delay);

    /* Does not hold the process open. A fifteen-second timer that did would make every
       `node` script that loaded this module hang on exit. */
    if (live.timer.unref) live.timer.unref();
}

/**
 * Take builds as they are queued, up to {@link concurrency} at once.
 *
 * **It used to be one at a time, and that was a decision rather than a limitation**: a
 * build is a second consumer of the media server the thumbnail extractor already loads,
 * and it stages tens of gigabytes. Isaac asked for two or three so he can watch what
 * Jellyfin does with it, which is the only way that number gets settled.
 *
 * **The runs are not awaited here.** A build is hours; a tick that waited for one could
 * not start a second. Each is tracked only by the count it increments, and a run
 * finishing brings the next tick forward so a queue drains without waiting out an idle
 * interval.
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

    try {
        /* Before taking new work, return anything a dead process left behind. A build
           abandoned by a restart sits `running` with nobody running it, and the dataset
           sits `building` for ever -- which is what the first fifty-minute build did,
           three times, while `npm run dev` restarted on file changes.

           **Safe with several builds live**, and that was checked rather than assumed:
           it reclaims on `lease_expires_at < NOW()`, and `reportProgress` pushes that an
           hour out on every report. A slow build is still a reporting build. */
        await buildRepository.reclaimAbandonedBuilds();

        /* And settle anything cancelled that no runner is going to notice. A build
           cancelled while still queued has nobody to tell -- `claimBuild` only looks at
           `queued` jobs, so it is never picked up and never reaches `failBuild` -- and
           its dataset would say `building` for ever. Here rather than at the moment of
           cancelling, because this also catches a cancel made from the Jobs screen or a
           script, which know nothing about datasets. */
        await buildRepository.settleCancelledBuilds();
    } catch (error) {
        logger.error(`Dataset build loop: ${error && error.message}`);
    }

    /* Fill the remaining slots. `runOne` claims with `FOR UPDATE SKIP LOCKED`, so two
       starts in the same tick take two different jobs or the second takes none -- they
       cannot both claim the same one. Starting them in one tick rather than one per tick
       is what lets a queue of three reach the ceiling immediately. */
    while (live.started && live.inFlight < concurrency()) {
        live.inFlight += 1;

        runOne()
            .catch((error) => {
                logger.error(`Dataset build: ${error && error.message}`);

                return null;
            })
            .then((result) => {
                live.inFlight -= 1;

                /* **Only when it actually built something.** A run that claimed nothing
                   has just told us the queue is empty, and bringing the next tick
                   forward on that would spin: an empty queue would start runs, find
                   nothing, reschedule at zero and do it again as fast as the database
                   could answer. When one really did finish, a slot is free and the next
                   build should not wait out the idle interval for it. */
                if (result) schedule(0);
            });
    }

    schedule(IDLE_MS);
}

/**
 * Start taking queued builds.
 *
 * @returns {{started: boolean}} Whether the poller is now running.
 */
function start() {
    if (live.started) return { started: true };

    /* **An off switch, because this poller claims work and nothing else here does.**
       Before #268 an API beside a test run only ever read, so a developer's dev server
       and `npm test` against one database did not interfere. Now any suite that inserts
       a queued build is racing a poller that will claim it within fifteen seconds --
       open an attempt, write an event -- and the corpus guard then reports the *test
       file* as having changed the database, which is a long way from the cause. It
       happened, to a suite that had done nothing wrong.

       `DATASET_BUILDS=off` is for an API that should serve but not build: a second dev
       server, or one left running beside a test run. */
    if (String(process.env.DATASET_BUILDS || '').toLowerCase() === 'off') {
        logger.info('Dataset builds are off (DATASET_BUILDS=off); this API serves but does not build.');

        return { started: false, reason: 'DATASET_BUILDS=off' };
    }

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
 * @returns {{stopped: boolean, running: number}} How many are still finishing. A count
 * rather than a flag now that more than one can be.
 */
function stop() {
    live.started = false;

    if (live.timer) clearTimeout(live.timer);

    live.timer = null;

    return { stopped: true, running: live.inFlight };
}

module.exports = {
    ARCHIVE_DIRECTORY,
    DEFAULT_CONCURRENCY,
    DEFAULT_IMAGE,
    FRAMES_PER_PASS,
    IMAGE_FORMATS,
    SEEK_RATHER_THAN_DECODE,
    SPLIT_DIRECTORIES,
    concurrency,
    cutVideo,
    directoryFor,
    imageSettings,
    dataYaml,
    packageArchive,
    passes,
    runOne,
    start,
    stop,
};
