/**
 * A habitat segment's picture: cut from its middle frame with the habitat crop when first
 * asked for, and kept (#287, A21).
 *
 * Only the media server is stubbed -- the video lookup, the probe and the decoded frame. The
 * crop, the file, the row and the route are the real ones.
 *
 * @fileoverview Endpoint tests for GET /api/v2/mosaic/habitat/segment-picture.
 * @module tests/habitat-segment-picture
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const db = require('../model');
const jellyfinRepository = require('../repository/jellyfin.repository');
const extraction = require('../service/thumbnail-extraction.service');
const { SEGMENT_DIR } = require('../service/habitat-segment-picture.service');

const { QueryTypes } = db.Sequelize;
const q = (sql, replacements = {}) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });

const runId = Date.now();
const VIDEO = `jest-segment-picture-${runId}.mp4`;
const MISSING = `jest-segment-picture-missing-${runId}.mp4`;
const ROUTE = '/api/v2/mosaic/habitat/segment-picture';
let decoded;

beforeEach(() => {
    decoded = [];
    jest.spyOn(jellyfinRepository, 'resolveVideoSource').mockImplementation(async (name) => {
        if (name === MISSING) throw new Error('nothing in the library by that name');
        return { item: { id: `jest-item-${runId}` }, score: 100 };
    });
    jest.spyOn(jellyfinRepository, 'buildDirectStreamUrl').mockResolvedValue('http://jest.invalid/stream');
    jest.spyOn(extraction, 'probeStream').mockResolvedValue({ width: 640, height: 360, codec: 'h264', fps: 30, duration: 600 });
    // A frame whose top half is white and bottom half dark, so the crop can be seen to be the
    // bottom middle: the habitat crop is y 0.5-1.0.
    jest.spyOn(extraction, 'extractFrames').mockImplementation(async (url, frames, fps, workDir) => {
        decoded.push(...frames);
        const file = path.join(workDir, 'frame-0001.png');
        const top = await sharp({ create: { width: 640, height: 180, channels: 3, background: { r: 250, g: 250, b: 250 } } }).png().toBuffer();
        await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 20, g: 40, b: 60 } } })
            .composite([{ input: top, top: 0, left: 0 }]).png().toFile(file);
        return { files: [file], ptsTimes: frames.map((f) => f / fps), seconds: 0.01 };
    });
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
    const rows = await q('SELECT filename FROM habitat_segment_pictures WHERE video_source IN (:videos)', { videos: [VIDEO, MISSING] });
    for (const row of rows) if (row.filename) fs.rmSync(path.join(SEGMENT_DIR, row.filename), { force: true });
    await q('DELETE FROM habitat_segment_pictures WHERE video_source IN (:videos) RETURNING 1', { videos: [VIDEO, MISSING] });
});

describe('a habitat segment\'s picture (#287, A21)', () => {
    test('is cut from the middle frame at the video\'s own rate, with the habitat crop', async () => {
        const res = await global.api.get(ROUTE).query({ video_source: VIDEO, media_ms: 12000 })
            .buffer(true).parse((r, done) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => done(null, Buffer.concat(chunks))); });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/image\/jpeg/);
        // 12 s at 30 frames a second.
        expect(decoded).toEqual([360]);

        // The crop is the frame's dark bottom half. Squared and padded as every thumbnail is, so
        // a strip of the white above it shows at the top; the tile's lower half is all dark.
        const { data } = await sharp(res.body).resize(4, 4, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
        expect(Math.max(...data.slice(8, 16))).toBeLessThan(80);
    });

    test('is kept: asked again, it is served without going back to the video', async () => {
        const res = await global.api.get(ROUTE).query({ video_source: VIDEO, media_ms: 12000 });
        expect(res.status).toBe(200);
        expect(decoded).toEqual([]);
        const [row] = await q('SELECT status, filename FROM habitat_segment_pictures WHERE video_source = :v', { v: VIDEO });
        expect(row.status).toBe('ready');
        expect(fs.existsSync(path.join(SEGMENT_DIR, row.filename))).toBe(true);
    });

    test('one that cannot be cut says why, and is not tried again at once', async () => {
        const first = await global.api.get(ROUTE).query({ video_source: MISSING, media_ms: 5000 });
        expect(first.status).toBe(404);
        expect(first.body.error.message).toMatch(/nothing in the library/);

        const second = await global.api.get(ROUTE).query({ video_source: MISSING, media_ms: 5000 });
        expect(second.status).toBe(404);
        expect(jellyfinRepository.resolveVideoSource).toHaveBeenCalledTimes(1);
    });

    test('a request without a video or a moment is refused', async () => {
        expect((await global.api.get(ROUTE).query({ media_ms: 5000 })).status).toBe(400);
        expect((await global.api.get(ROUTE).query({ video_source: VIDEO, media_ms: 'x' })).status).toBe(400);
    });
});
