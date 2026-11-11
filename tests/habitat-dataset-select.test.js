/**
 * Selecting a habitat dataset's frames, and throwing out non-seabed ones (#287).
 *
 * Pure apart from the image library: the stretches are made-up rows, and the frames checked
 * for rejection are drawn here -- the stored example screens enlarged back to a frame, a flat
 * black frame, and noise standing in for seabed.
 *
 * @fileoverview Unit tests for service/habitat-dataset-select.js.
 * @module tests/habitat-dataset-select
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const { formatTimeSpan, deriveTc } = require('../db/timecode');
const { selectFrames, rejectionFor } = require('../service/habitat-dataset-select');
const REJECT = require('../db/habitat-reject-screens.json');

let nextId = 1;

/** A stretch row as the query returns it: clock start and end in seconds, one file from 0. */
const row = (session, comname, startS, endS, { promoted = true, project = 'CAMPA 2024', dive = 'D1', offsetS = 0 } = {}) => ({
    observation_id: nextId++, session_id: session, comname, project, dive,
    actualPosition: formatTimeSpan((startS + offsetS) * 1000), mediaPosition: formatTimeSpan(startS * 1000),
    tc: deriveTc((startS + offsetS) * 1000), etc: deriveTc((endS + offsetS) * 1000),
    video_source: `${session}.mp4`, training_decision: promoted ? 'promoted' : null,
});

describe('choosing a habitat dataset\'s frames', () => {
    test('frames every 10 s inside promoted stretches, labelled with what is over them', () => {
        const { frames, members } = selectFrames([row(1, 'Mud', 0, 45), row(1, 'Boulder', 15, 35)]);
        expect(frames.map((f) => [f.positionMs / 1000, f.labels])).toEqual([
            [10, [0, 1, 0, 0, 0]], [20, [0, 1, 0, 0, 1]], [30, [0, 1, 0, 0, 1]], [40, [0, 1, 0, 0, 0]],
        ]);
        expect(members.size).toBe(2);
    });

    test('a frame goes in only where every stretch over it is promoted', () => {
        const { frames } = selectFrames([row(2, 'Mud', 0, 45), row(2, 'Boulder', 15, 35, { promoted: false })]);
        expect(frames.map((f) => f.positionMs / 1000)).toEqual([10, 40]);
    });

    test('a frame labelled Mud and Sand goes in as labelled', () => {
        const { frames } = selectFrames([row(3, 'Mud', 0, 25), row(3, 'Sand', 0, 25)]);
        expect(frames.map((f) => f.labels)).toEqual([[0, 1, 1, 0, 0], [0, 1, 1, 0, 0]]);
    });

    test('a session whose times drift within a file is left out and listed', () => {
        const { frames, drifting } = selectFrames([row(4, 'Rock', 0, 60), row(4, 'Rock', 60, 120, { offsetS: 5 })]);
        expect(frames).toEqual([]);
        expect(drifting).toEqual([{ session_id: 4, files: [{ file: '4.mp4', spreadMs: 5000 }] }]);
    });

    test('whole dives go to one split', () => {
        const rows = [];
        for (let dive = 1; dive <= 10; dive += 1) {
            rows.push(row(100 + dive, 'Rock', 0, 25, { dive: `D${dive}` }), row(200 + dive, 'Rock', 0, 25, { dive: `D${dive}` }));
        }
        const { frames } = selectFrames(rows);
        const splitOfDive = new Map();
        for (const f of frames) {
            expect(splitOfDive.get(f.dive) || f.split).toBe(f.split);
            splitOfDive.set(f.dive, f.split);
        }
        expect([...splitOfDive.values()].filter((s) => s === 'train').length).toBe(7);
    });
});

describe('throwing out frames that are not seabed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-reject-'));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    /** A 640 x 360 frame from a 32 x 18 greyscale picture, enlarged. */
    const enlarged = async (name, pixels) => {
        const file = path.join(dir, `${name}.jpg`);
        await sharp(Buffer.from(pixels), { raw: { width: 32, height: 18, channels: 1 } })
            .resize(640, 360, { kernel: 'nearest' }).jpeg().toFile(file);
        return file;
    };

    test('the stored screens are recognised by name', async () => {
        expect(await rejectionFor(await enlarged('unplugged', REJECT.screens['device unplugged']))).toBe('device unplugged');
        expect(await rejectionFor(await enlarged('endline', REJECT.screens['end line card']))).toBe('end line card');
    });

    test('a flat frame is a blank screen', async () => {
        expect(await rejectionFor(await enlarged('black', new Array(32 * 18).fill(3)))).toBe('blank screen');
    });

    test('seabed is kept', async () => {
        let seed = 7;
        const noise = Array.from({ length: 32 * 18 }, () => { seed = (seed * 1103515245 + 12345) % 2147483648; return 60 + (seed % 120); });
        expect(await rejectionFor(await enlarged('seabed', noise))).toBeNull();
    });
});
