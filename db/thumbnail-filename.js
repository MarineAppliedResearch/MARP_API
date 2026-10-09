/**
 * What an observation thumbnail is called on disk.
 *
 * One rule, in one place, because two things have to agree about it exactly:
 * `service/thumbnail-extraction.service.js` writes the file and
 * `scripts/rename-thumbnails-by-content.js` renames the ones written before this
 * existed. Same reason `db/corpus.js` holds the table list rather than either of
 * the scripts that use it.
 *
 * **The name is a digest of the bytes, and that is a correctness property rather
 * than a tidiness one.** The name used to be `${observation_id}.jpg`, and
 * `observation_id` is assigned as `max(observation_id) + 1` *per database* (#62) --
 * so two independent databases hand out overlapping ranges by construction and
 * both own `582.jpg`. `routes/thumbnail.routes.js` serves whatever the row names
 * after checking only that the file exists; it compares no `byte_size`, no `width`
 * and no `height`. A collision there is not a broken tile. It is a 200, a
 * plausible ETag, and a confident picture of the wrong animal, which a reviewer
 * reads as a bad detection and may delete.
 *
 * Identical bytes give an identical name, so two rows may share one file. That is
 * the mechanism, not an accident of it, and it has a consequence worth writing
 * down: **no row owns its file.** Nothing may delete a JPEG on the strength of one
 * row having stopped pointing at it.
 *
 * Refs #62.
 *
 * @fileoverview The content-addressed name of a stored thumbnail.
 * @module db/thumbnail-filename
 * @author Isaac Travers
 */

'use strict';

const crypto = require('crypto');

/**
 * The digest that names a tile.
 *
 * sha256, and the whole of it. A truncated digest would reintroduce by arithmetic
 * the collision this exists to remove by construction -- at 440,000 tiles a 64-bit
 * prefix is already a birthday problem somebody would have to reason about, and
 * nothing is bought by making them.
 *
 * @constant
 * @type {string}
 */
const HASH_ALGORITHM = 'sha256';

/**
 * The extension every stored tile carries. One format, so this is a fact rather
 * than a guess -- `config/thumbnails.js` writes JPEG and only JPEG.
 *
 * @constant
 * @type {string}
 */
const EXTENSION = '.jpg';

/**
 * How a content-addressed name looks, for anything that needs to recognise one.
 *
 * Used by the rename script to tell a file that is already named by its bytes
 * from one that is not, which is what makes a second run a no-op.
 *
 * @constant
 * @type {RegExp}
 */
const CONTENT_NAME_PATTERN = /^[0-9a-f]{64}\.jpg$/;

/**
 * Name a tile by its bytes.
 *
 * @param {Buffer} buffer - The JPEG.
 * @returns {string} `<sha256 hex>.jpg`, relative to the storage directory.
 */
function thumbnailFilename(buffer) {
    return crypto.createHash(HASH_ALGORITHM).update(buffer).digest('hex') + EXTENSION;
}

module.exports = {
    HASH_ALGORITHM,
    EXTENSION,
    CONTENT_NAME_PATTERN,
    thumbnailFilename,
};
