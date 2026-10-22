/**
 * A look at the pictures a build actually cut, read out of the archive it wrote.
 *
 * The Datasets screen showed four sample frames per dataset and they were four hardcoded
 * Jellyfin item ids -- the same four pictures on every row, of video that had nothing to
 * do with the dataset underneath them. They were removed rather than relabelled, which
 * left the screen saying a great deal about a dataset and showing none of it.
 *
 * **This reads the archive, and nothing is written at build time to make it possible.**
 * A packaged dataset is an uncompressed tar of `train/images`, `train/labels`, `eval/...`
 * and a `data.yaml`, so every frame is already there at a known offset; extracting
 * thumbnails during the build would be a second copy of the same pictures, a migration
 * for the datasets that already exist, and a change to the one service that must not
 * become less reliable. A preview is a dozen frames, and a dozen frames is a walk of the
 * tar's headers plus a dozen reads.
 *
 * **It is a preview, not a viewer.** Paging a whole dataset is a different feature with
 * different costs -- tens of thousands of images, where the full-size JPEGs served here
 * and the header walk below both stop being the right answer. Nothing here is built
 * toward it.
 *
 * @fileoverview Reads sample frames and their label boxes out of a dataset archive.
 * @module service/dataset-preview
 */

'use strict';

const fs = require('fs');

const gpuService = require('./gpu.service');
const { ApiError, ERROR_CODES } = require('../middleware/error-contract.middleware');

/** A tar header, and the alignment every member's data is padded to. */
const BLOCK = 512;

/** How many frames a preview shows when the caller does not say. */
const DEFAULT_LIMIT = 8;

/** The most it will show, because each one is a full-size frame over the wire. */
const MAX_LIMIT = 24;

/**
 * Archive directory to split name.
 *
 * The inverse of the builder's own map, and deliberately not imported from it: that one
 * is many-to-one -- `eval` and `validation` both write `eval/` -- so inverting it at
 * runtime would pick whichever key came last. What a reader wants back is the directory
 * the archive actually holds.
 */
const SPLIT_OF = { train: 'train', eval: 'eval', test: 'test' };

/**
 * Chosen frames, by archive hash and size of the sample.
 *
 * **Safe to cache indefinitely, which is a property of the thing rather than an
 * optimisation.** An archive is named for its own SHA-256, so a key here can never
 * describe different bytes than it did when it was written; a dataset whose archive is
 * re-packaged gets a new hash and a new key. Capped only to bound memory.
 */
const chosen = new Map();

/** How many archives' selections to keep. Each is a few dozen small objects. */
const CACHE_LIMIT = 8;

/**
 * Reads a NUL-terminated field out of a tar header.
 *
 * @param {Buffer} header - The 512-byte block.
 * @param {number} at - Where the field starts.
 * @param {number} length - How long it is.
 * @returns {string} The field, without its padding.
 */
function field(header, at, length) {
    const raw = header.subarray(at, at + length);
    const end = raw.indexOf(0);

    return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8').trim();
}

/**
 * Walks a tar's headers and hands back every regular file in it.
 *
 * **Headers only.** Each member's data is skipped by arithmetic rather than read, so the
 * cost of this is one 512-byte read per member regardless of how large the members are --
 * a few megabytes of reads against a 541 MB archive. That is what makes reading the
 * archive directly cheap enough to do on a request, and it is only true because the tar
 * is uncompressed, which `package-dataset.js` explains it is on purpose.
 *
 * @param {string} absolutePath - The archive.
 * @returns {Array<{name: string, offset: number, size: number}>} Its regular files, in
 * the order the archive holds them, with `offset` the first byte of each one's data.
 */
function members(absolutePath) {
    const fd = fs.openSync(absolutePath, 'r');

    try {
        const total = fs.fstatSync(fd).size;
        const header = Buffer.allocUnsafe(BLOCK);
        const found = [];

        /* Set by a GNU long-name entry, which carries the real path as its *data* and
           applies to the member after it. Our own stems are short, but the video's name
           is in every filename and a long Jellyfin name pushes the path past the 100
           bytes a tar header has for one. Without this, those frames come back named
           after a truncation and nothing matches their labels. */
        let longName = null;

        for (let at = 0; at + BLOCK <= total;) {
            if (fs.readSync(fd, header, 0, BLOCK, at) < BLOCK) break;

            // Two zero blocks end a tar; one is enough to know the members are done.
            if (header[0] === 0) break;

            const size = parseInt(field(header, 124, 12), 8) || 0;
            const data = at + BLOCK;
            const next = data + Math.ceil(size / BLOCK) * BLOCK;
            const type = String.fromCharCode(header[156]);

            if (type === 'L') {
                const name = Buffer.allocUnsafe(size);

                fs.readSync(fd, name, 0, size, data);
                longName = name.toString('utf8').replace(/\0+$/, '');
            } else {
                const prefix = field(header, 345, 155);
                const short = field(header, 0, 100);

                // '0' and an empty type are both an ordinary file; directories are '5'.
                if (type === '0' || type === '\0') {
                    found.push({
                        name: longName || (prefix ? `${prefix}/${short}` : short),
                        offset: data,
                        size,
                    });
                }

                longName = null;
            }

            at = next;
        }

        return found;
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Reads one member's bytes.
 *
 * @param {string} absolutePath - The archive.
 * @param {{offset: number, size: number}} member - Where in it.
 * @returns {Buffer} Its contents.
 */
function read(absolutePath, member) {
    if (!member.size) return Buffer.alloc(0);

    /* **Opened and read at a position, not `readFileSync` with a range.** A ranged
       `readFileSync` still stats the whole file and refuses anything over 2 GiB, which
       the first real archive here is -- 2.4 GB, and it failed on the frame rather than
       on the walk, so the preview came back empty with a message about file size. A
       positioned read is indifferent to how large the file around it is. */
    const fd = fs.openSync(absolutePath, 'r');

    try {
        const buffer = Buffer.allocUnsafe(member.size);
        const got = fs.readSync(fd, buffer, 0, member.size, member.offset);

        return got === member.size ? buffer : buffer.subarray(0, got);
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Parses a YOLO label file into boxes.
 *
 * Every number is normalised to the image, and **x and y are the box's centre**, which is
 * the convention YOLO uses and the one `keyframes` turned out to use as well. A reader
 * that treats them as the top-left corner draws every box down and to the right by half
 * its own size, which looks close enough to be believed.
 *
 * A line that is not five numbers is dropped rather than failing the preview: the frame
 * is still worth showing, and a label file the builder did not write is a different
 * problem from the one this is for.
 *
 * @param {Buffer} buffer - The `.txt` beside the image.
 * @returns {Array<{class_index: number, cx: number, cy: number, w: number, h: number}>}
 */
function boxesIn(buffer) {
    return buffer.toString('utf8').split(/\r?\n/).reduce((boxes, line) => {
        const parts = line.trim().split(/\s+/).map(Number);

        if (parts.length === 5 && parts.every((n) => Number.isFinite(n))) {
            const [classIndex, cx, cy, w, h] = parts;

            boxes.push({ class_index: classIndex, cx, cy, w, h });
        }

        return boxes;
    }, []);
}

/**
 * Picks the frames to show, spread across the whole archive.
 *
 * **Spread rather than the first N, and that is the difference between a preview and a
 * wall of one picture.** The archive holds each video's frames together and
 * consecutively -- a build interpolates between keyframes, so the first dozen entries are
 * a dozen images of the same animal a fortieth of a second apart. Taking them at an even
 * stride costs the same walk and shows the videos, the splits and the species the build
 * actually covered.
 *
 * @param {Array<{name: string, offset: number, size: number}>} all - Every member.
 * @param {number} limit - How many frames to show.
 * @returns {Array<Object>} The chosen frames, with their label member beside each.
 */
function pick(all, limit) {
    const byName = new Map(all.map((member) => [member.name, member]));
    const images = all.filter((member) => /^(train|eval|test)\/images\/.+\.(jpe?g|png)$/i.test(member.name));

    if (!images.length) return [];

    const take = Math.min(limit, images.length);

    /* **Both ends included, not a stride of `length / take`.** That stride stops short of
       the tail by one whole step -- over ten train frames and two eval it picked 0, 3, 6
       and 9 and never reached eval at all, which is the one thing a reader most wants the
       sample to show was built. Spreading from the first image to the last fixes where it
       mattered and costs nothing. */
    const last = images.length - 1;

    return Array.from({ length: take }, (unused, i) => {
        const image = images[take === 1 ? 0 : Math.round((i * last) / (take - 1))];
        const [directory, , file] = image.name.split('/');
        const stem = file.replace(/\.[^.]+$/, '');

        return {
            image,
            label: byName.get(`${directory}/labels/${stem}.txt`) || null,
            split: SPLIT_OF[directory] || directory,
            stem,
        };
    });
}

/**
 * The frames a dataset's preview shows, and the boxes drawn on them.
 *
 * @async
 * @param {number|string} datasetId - `datasets.id`.
 * @param {number} [limit] - How many frames; clamped to {@link MAX_LIMIT}.
 * @returns {Promise<{sha256: string, total: number, frames: Array<Object>}>} `total` is
 * every image in the archive, not how many are shown, so the screen can say what it is
 * showing a sample of.
 * @throws {ApiError} 404 when the dataset has no archive to read.
 */
async function preview(datasetId, limit = DEFAULT_LIMIT) {
    const archive = await gpuService.datasetArchive(datasetId);
    const wanted = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
    const key = `${archive.sha256}:${wanted}`;

    if (!chosen.has(key)) {
        const all = members(archive.absolutePath);

        chosen.set(key, {
            absolutePath: archive.absolutePath,
            total: all.filter((member) => /^(train|eval|test)\/images\//.test(member.name)).length,
            frames: pick(all, wanted),
        });

        while (chosen.size > CACHE_LIMIT) chosen.delete(chosen.keys().next().value);
    }

    const selection = chosen.get(key);

    return {
        sha256: archive.sha256,
        total: selection.total,
        frames: selection.frames.map((picked, index) => ({
            index,
            split: picked.split,
            stem: picked.stem,
            bytes: picked.image.size,
            /* Read here rather than held in the cache: a label file is a few dozen bytes
               and this answer is fetched once per dataset per reader, so keeping them
               would be caching to save a read that has already happened. */
            boxes: picked.label ? boxesIn(read(selection.absolutePath, picked.label)) : [],
        })),
    };
}

/**
 * One preview frame's bytes.
 *
 * **Addressed by its position in the preview, not by its filename.** The archive is
 * immutable and content-addressed, so the walk above returns the same order every time
 * and a position is a stable address; taking a filename from the caller instead would put
 * a caller-supplied path into a file read, which is the shape of the traversal bug the
 * archive route itself carries a comment about avoiding.
 *
 * @async
 * @param {number|string} datasetId - `datasets.id`.
 * @param {number|string} index - Which frame of the preview.
 * @param {number} [limit] - The sample size the index was taken against.
 * @returns {Promise<{buffer: Buffer, contentType: string, sha256: string, stem: string}>}
 * @throws {ApiError} 404 when there is no such frame.
 */
async function frame(datasetId, index, limit = DEFAULT_LIMIT) {
    const { sha256 } = await preview(datasetId, limit);
    const wanted = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
    const selection = chosen.get(`${sha256}:${wanted}`);
    const at = Number(index);
    const picked = Number.isInteger(at) && at >= 0 ? selection.frames[at] : null;

    if (!picked) {
        throw new ApiError(404, ERROR_CODES.NOT_FOUND, `Dataset ${datasetId} has no preview frame ${index}.`);
    }

    return {
        buffer: read(selection.absolutePath, picked.image),
        contentType: /\.png$/i.test(picked.image.name) ? 'image/png' : 'image/jpeg',
        sha256,
        stem: picked.stem,
    };
}

module.exports = {
    preview,
    frame,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
