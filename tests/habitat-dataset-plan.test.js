/**
 * Choosing a habitat dataset's frames from habitat stretches (#287).
 *
 * Pure: no database rows are read or written. The rules are the ones settled with Isaac from
 * the feasibility work, and each test names the one it holds.
 *
 * @fileoverview Unit tests for service/habitat-dataset-plan.js.
 * @module tests/habitat-dataset-plan
 */

const {
    SUBSTRATES, framesForSession, splitDives, seededShuffle,
} = require('../service/habitat-dataset-plan');

/** A stretch in one file that starts at the session clock's zero. */
const stretch = (name, startS, endS, file = 'a.mp4', offsetS = 0) => ({
    name, file, startMs: startS * 1000, endMs: endS * 1000, offsetMs: offsetS * 1000,
});

const labelsOf = (frames) => frames.map((f) => [f.positionMs / 1000, f.labels]);

describe('the frames a habitat session yields', () => {
    it('takes one every 10 s of the file inside the stretches', () => {
        const frames = framesForSession([stretch('Rock', 5, 45)]);
        expect(frames.map((f) => f.positionMs / 1000)).toEqual([10, 20, 30, 40]);
        expect(frames.every((f) => f.file === 'a.mp4')).toBe(true);
    });

    it('labels a frame with every substrate covering it, in the settled order', () => {
        expect(SUBSTRATES).toEqual(['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder']);
        const frames = framesForSession([stretch('Sand', 0, 60), stretch('Boulder', 15, 35)]);
        expect(labelsOf(frames)).toEqual([
            [10, [0, 0, 1, 0, 0]],
            [20, [0, 0, 1, 0, 1]],
            [30, [0, 0, 1, 0, 1]],
            [40, [0, 0, 1, 0, 0]],
            [50, [0, 0, 1, 0, 0]],
        ]);
    });

    it('keeps 2 s clear of any change of substrate, a stretch\'s own start included', () => {
        // Changes at 0, 19, 41 and 60: frames at 0, 20, 40 and 60 are within 2 s of one.
        const frames = framesForSession([stretch('Mud', 0, 60), stretch('Cobble', 19, 41)]);
        expect(frames.map((f) => f.positionMs / 1000)).toEqual([10, 30, 50]);
        expect(framesForSession([stretch('Mud', 0, 41), stretch('Rock', 41, 70)])
            .map((f) => f.positionMs / 1000)).toEqual([10, 20, 30, 50, 60]);
    });

    it('skips a moment no stretch covers: a gap is unknown, not bare seabed', () => {
        const frames = framesForSession([stretch('Rock', 0, 25), stretch('Rock', 55, 90)]);
        expect(frames.map((f) => f.positionMs / 1000)).toEqual([10, 20, 60, 70, 80]);
    });

    it('ignores what is not a substrate, such as Off Bottom', () => {
        const frames = framesForSession([stretch('Off Bottom', 0, 60), stretch('Rock', 30, 60)]);
        expect(frames.map((f) => f.positionMs / 1000)).toEqual([40, 50]);
    });

    it('works each file on its own grid, and compares changes across files on the clock', () => {
        // The second file starts 100 s into the session, so its Cobble starting at 3 s is a
        // change at 103 on the session clock, and a.mp4's end at 100 is one too.
        const frames = framesForSession([
            stretch('Sand', 0, 100, 'a.mp4', 0),
            stretch('Sand', 0, 30, 'b.mp4', 100),
            stretch('Cobble', 3, 30, 'b.mp4', 100),
        ]);
        expect(frames.filter((f) => f.file === 'a.mp4').map((f) => f.positionMs / 1000)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
        // b.mp4: 0 is within 2 s of a.mp4's end (100) and of the Cobble start (103); 10 and 20 are kept.
        expect(labelsOf(frames.filter((f) => f.file === 'b.mp4'))).toEqual([[10, [0, 0, 1, 1, 0]], [20, [0, 0, 1, 1, 0]]]);
    });
});

describe('splitting by whole dives', () => {
    const lines = (project, dives) => dives.flatMap((d) => [{ project, dive: d }, { project, dive: d }]);

    it('puts every line of a dive in one split, 70/15/15 within each project', () => {
        const split = splitDives([
            ...lines('CAMPA 2024', Array.from({ length: 20 }, (_, i) => `D${i + 1}`)),
            ...lines('CAMPA-2025', Array.from({ length: 10 }, (_, i) => `D${i + 1}`)),
        ]);
        const count = (project, which) => [...split].filter(([k, v]) => k.startsWith(`${project}|`) && v === which).length;
        expect([count('CAMPA 2024', 'train'), count('CAMPA 2024', 'val'), count('CAMPA 2024', 'test')]).toEqual([14, 3, 3]);
        expect([count('CAMPA-2025', 'train'), count('CAMPA-2025', 'val'), count('CAMPA-2025', 'test')]).toEqual([7, 2, 1]);
        // A dive name shared by two projects is two dives.
        expect(split.has('CAMPA 2024|D1') && split.has('CAMPA-2025|D1')).toBe(true);
    });

    it('gives the same split whatever order the lines arrive in', () => {
        const dives = Array.from({ length: 12 }, (_, i) => `D${i + 1}`);
        const forward = splitDives(lines('P', dives));
        const backward = splitDives(lines('P', [...dives].reverse()));
        expect([...backward].sort()).toEqual([...forward].sort());
    });

    it('keeps the feasibility plan\'s shuffle, so the same dives land in the same splits', () => {
        // plan.js's generator at seed 287, copied unchanged; pinned so a change to it is caught.
        expect(seededShuffle(['a', 'b', 'c', 'd', 'e'], 287)).toEqual(['b', 'e', 'd', 'a', 'c']);
    });
});
