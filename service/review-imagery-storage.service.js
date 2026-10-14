/** Shared accounting and eviction for Mosaic thumbnails and full frames. */

'use strict';

const fs = require('fs');
const path = require('path');

const repository = require('../repository/review-imagery.repository');
const { STORAGE_DIR, FULL_FRAME_STORAGE_DIR } = require('../config/thumbnails');
const {
    lowWatermarkBytes,
    orderEvictionCandidates,
    validateSettings,
} = require('./review-imagery-policy');

function numberSettings(row) {
    return {
        maxBytes: Number(row.max_bytes),
        lowWatermarkPercent: Number(row.low_watermark_percent),
        evictionOrder: row.eviction_order,
        changedByUserId: row.changed_by_user_id,
        changedAt: row.changed_at,
    };
}

async function status() {
    const [rawSettings, rawUsage] = await Promise.all([
        repository.readSettings(), repository.usage()
    ]);
    const settings = numberSettings(rawSettings);
    const thumbnailBytes = Number(rawUsage.thumbnail_bytes);
    const fullFrameBytes = Number(rawUsage.full_frame_bytes);

    return {
        ...settings,
        thumbnailBytes,
        fullFrameBytes,
        totalBytes: thumbnailBytes + fullFrameBytes,
        storageLocations: {
            thumbnails: STORAGE_DIR,
            fullFrames: FULL_FRAME_STORAGE_DIR,
        },
    };
}

async function updateSettings(input, userId) {
    const settings = validateSettings(input);
    const previousRow = await repository.readSettings();
    const previous = numberSettings(previousRow);
    await repository.writeSettings(settings, userId);
    try {
        const eviction = await enforceLimit();
        return { ...(await status()), eviction };
    } catch (error) {
        /* A filesystem failure must not leave a newly lowered limit active while
           the cache still exceeds it. Preserve the policy that was active before. */
        await repository.writeSettings({
            maxBytes: previous.maxBytes,
            lowWatermarkPercent: previous.lowWatermarkPercent,
            evictionOrder: previous.evictionOrder,
        }, previous.changedByUserId);
        throw error;
    }
}

function directoryFor(kind) {
    return kind === 'full_frame' ? FULL_FRAME_STORAGE_DIR : STORAGE_DIR;
}

/** Resolves and accounts for a private artifact without exposing storage work to routes. */
async function prepareDownload(kind, row) {
    const fullFrame = kind === 'full_frame';
    const filename = fullFrame ? row.full_frame_filename : row.filename;
    const absolutePath = path.join(directoryFor(kind), filename);

    if (!fs.existsSync(absolutePath)) {
        await repository.markFileEvicted(kind, filename);
        return null;
    }

    await repository.touch(kind, Number(row.observation_id));
    return {
        absolutePath,
        contentType: (fullFrame ? row.full_frame_content_type : row.content_type) || 'image/jpeg',
        etag: fullFrame
            ? `"observation-full-frame-${row.observation_id}-${row.full_frame_generation}"`
            : `"observation-thumbnail-${row.observation_id}-${row.generation}"`,
    };
}

async function evict(candidate) {
    const original = path.join(directoryFor(candidate.kind), candidate.filename);
    const parked = `${original}.evicting`;
    let parkedFile = false;

    if (fs.existsSync(original)) {
        fs.renameSync(original, parked);
        parkedFile = true;
    }

    try {
        const changed = await repository.markFileEvicted(candidate.kind, candidate.filename);
        if (!changed) {
            if (parkedFile) fs.renameSync(parked, original);
            return false;
        }
        if (parkedFile) {
            if (await repository.referenceCount(candidate.kind, candidate.filename) > 0) {
                fs.renameSync(parked, original);
            } else {
                fs.rmSync(parked, { force: true });
            }
        }
        return true;
    } catch (error) {
        if (parkedFile && fs.existsSync(parked)) fs.renameSync(parked, original);
        throw error;
    }
}

/** Deletes replaced content-addressed bytes only after their last row stops using them. */
async function removeIfUnreferenced(kind, filename) {
    if (!filename || await repository.referenceCount(kind, filename) > 0) return false;
    fs.rmSync(path.join(directoryFor(kind), filename), { force: true });
    return true;
}

async function enforceLimit() {
    const current = await status();
    if (current.totalBytes <= current.maxBytes) {
        return { evicted: 0, bytesFreed: 0, totalBytes: current.totalBytes };
    }

    const target = lowWatermarkBytes(current.maxBytes, current.lowWatermarkPercent);
    const candidates = orderEvictionCandidates(
        await repository.evictionCandidates(), current.evictionOrder
    );
    let totalBytes = current.totalBytes;
    let evicted = 0;
    let bytesFreed = 0;

    for (const candidate of candidates) {
        if (totalBytes <= target) break;
        if (await evict(candidate)) {
            const bytes = Number(candidate.byte_size);
            totalBytes -= bytes;
            bytesFreed += bytes;
            evicted += 1;
        }
    }

    return { evicted, bytesFreed, totalBytes };
}

module.exports = {
    evictArtifact: evict,
    enforceLimit,
    prepareDownload,
    removeIfUnreferenced,
    status,
    updateSettings,
};
