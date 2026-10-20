/**
 * Tests for the dataset build planner.
 *
 * Pure functions over rows, so these run in milliseconds with no database and no ffmpeg.
 * That is deliberate: this is where the two claims live that a bad dataset would hide.
 *
 * - **Nothing leaks across splits.** If two observations share a frame and land in
 *   different splits, the model is evaluated on a picture it trained on. The number that
 *   comes back is flattering and wrong, and nothing downstream can tell.
 * - **A class index means one species, always.** The index is written into every label
 *   file. Get the order wrong on a rebuild and every label in the archive now names a
 *   different animal, which no test of the training code could catch.
 *
 * Both are invisible in a built dataset -- you would have to re-derive the membership to
 * see either -- which is why they are asserted here rather than left to an end-to-end run.
 *
 * Refs MarineAppliedResearch/MARP_API#268.
 *
 * @fileoverview Unit tests for grouping, splitting and vocabulary.
 * @author Isaac Travers
 * @module tests/dataset-build-plan
 */

const {
    assignSplits,
    boxAt,
    connectedGroups,
    extractionPlan,
    vocabulary,
} = require('../service/dataset-build-plan');

/**
 * One selected observation.
 *
 * @param {Object} row - `{id, video, first, last, species, comname, boxes}`.
 * @returns {Object} A row shaped like the selection query's.
 */
function observation({ id, video = 'a.mp4', first, last, species = 1, comname = 'Anemone', boxes }) {
    return {
        observation_id: id,
        video_source: video,
        species_id: species,
        comname,
        first_framenum: first,
        last_framenum: last,
        keyframes: boxes || [
            { framenum: first, x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
            { framenum: last, x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        ],
    };
}

/** The selection query orders by video then first frame; the grouper relies on it. */
const selected = (rows) => [...rows].sort(
    (a, b) => String(a.video_source).localeCompare(String(b.video_source))
        || a.first_framenum - b.first_framenum
        || a.observation_id - b.observation_id
);

describe('connected frame groups (#268)', () => {

    test('observations that overlap are one group', () => {
        const rows = selected([
            observation({ id: 1, first: 100, last: 200 }),
            observation({ id: 2, first: 150, last: 250 }),
        ]);

        expect(connectedGroups(rows)).toHaveLength(1);
    });

    test('observations that do not overlap are separate groups', () => {
        const rows = selected([
            observation({ id: 1, first: 100, last: 200 }),
            observation({ id: 2, first: 201, last: 300 }),
        ]);

        expect(connectedGroups(rows)).toHaveLength(2);
    });

    test('touching at a single frame is an overlap, because that frame holds both', () => {
        const rows = selected([
            observation({ id: 1, first: 100, last: 200 }),
            observation({ id: 2, first: 200, last: 300 }),
        ]);

        expect(connectedGroups(rows)).toHaveLength(1);
    });

    test('overlap is transitive: a chain through the middle is one group', () => {
        // A and C never touch. B reaches both, so all three share frames by way of it,
        // and splitting the chain anywhere puts one of B's frames on both sides.
        const rows = selected([
            observation({ id: 1, first: 100, last: 150 }),
            observation({ id: 2, first: 140, last: 260 }),
            observation({ id: 3, first: 250, last: 300 }),
        ]);

        const groups = connectedGroups(rows);

        expect(groups).toHaveLength(1);
        expect(groups[0].map((r) => r.observation_id).sort()).toEqual([1, 2, 3]);
    });

    test('the same frame numbers in different videos are not connected', () => {
        // Frame numbers are per video; comparing them across two means nothing.
        const rows = selected([
            observation({ id: 1, video: 'a.mp4', first: 100, last: 200 }),
            observation({ id: 2, video: 'b.mp4', first: 100, last: 200 }),
        ]);

        expect(connectedGroups(rows)).toHaveLength(2);
    });

    test('a long observation keeps the group open past a short one inside it', () => {
        // Reach is the furthest frame any member got to, not the last one seen. Using
        // the last row's end would close the group at 160 and leak frames 161-400.
        const rows = selected([
            observation({ id: 1, first: 100, last: 400 }),
            observation({ id: 2, first: 150, last: 160 }),
            observation({ id: 3, first: 390, last: 500 }),
        ]);

        expect(connectedGroups(rows)).toHaveLength(1);
    });
});

describe('split assignment (#268)', () => {

    test('a connected group is never split', () => {
        const rows = selected([
            observation({ id: 1, first: 100, last: 200 }),
            observation({ id: 2, first: 150, last: 250 }),
            observation({ id: 3, first: 1000, last: 1100 }),
            observation({ id: 4, first: 2000, last: 2100 }),
        ]);

        const splits = assignSplits(connectedGroups(rows), { train: 0.5, eval: 0.5 });
        const where = new Map();

        for (const [name, members] of splits) {
            for (const row of members) where.set(row.observation_id, name);
        }

        expect(where.get(1)).toBe(where.get(2));
    });

    test('no frame appears in two splits', () => {
        /* The property the rule exists for, asserted directly rather than through the
           grouping: every frame of every observation, and which split it ended in. */
        const rows = selected(Array.from({ length: 40 }, (unused, i) => observation({
            id: i + 1,
            first: i * 50,
            last: i * 50 + 80,
        })));

        const splits = assignSplits(connectedGroups(rows), { train: 0.7, eval: 0.3 });
        const seen = new Map();

        for (const [name, members] of splits) {
            for (const row of members) {
                for (let f = row.first_framenum; f <= row.last_framenum; f++) {
                    const key = `${row.video_source}:${f}`;

                    if (seen.has(key)) expect(seen.get(key)).toBe(name);
                    else seen.set(key, name);
                }
            }
        }

        expect(seen.size).toBeGreaterThan(0);
    });

    test('the realised shares are close to the requested ones', () => {
        const rows = selected(Array.from({ length: 60 }, (unused, i) => observation({
            id: i + 1,
            first: i * 200,
            // Varied lengths, so a split measured in observations would miss badly.
            last: i * 200 + 10 + (i % 7) * 30,
        })));

        const splits = assignSplits(connectedGroups(rows), { train: 0.8, eval: 0.2 });
        const frames = (members) => members.reduce(
            (sum, r) => sum + (r.last_framenum - r.first_framenum + 1), 0
        );
        const total = frames([...splits.values()].flat());

        expect(frames(splits.get('train')) / total).toBeCloseTo(0.8, 1);
        expect(frames(splits.get('eval')) / total).toBeCloseTo(0.2, 1);
    });

    test('it is deterministic, so a rebuild is comparable with what it replaces', () => {
        const rows = selected(Array.from({ length: 25 }, (unused, i) => observation({
            id: i + 1, first: i * 100, last: i * 100 + 40 + i,
        })));

        const once = assignSplits(connectedGroups(rows), { train: 0.7, eval: 0.3 });
        const again = assignSplits(connectedGroups(rows), { train: 0.7, eval: 0.3 });
        const ids = (m, name) => m.get(name).map((r) => r.observation_id).sort((a, b) => a - b);

        expect(ids(once, 'train')).toEqual(ids(again, 'train'));
        expect(ids(once, 'eval')).toEqual(ids(again, 'eval'));
    });

    test('a split asking for nothing is refused rather than silently emptied', () => {
        expect(() => assignSplits([], { train: 0, eval: 0 })).toThrow(/above zero/i);
    });
});

describe('the vocabulary (#268)', () => {

    test('indexes are dense, zero-based and ordered by common name', () => {
        const rows = [
            observation({ id: 1, first: 1, last: 2, species: 77, comname: 'Zebra goby' }),
            observation({ id: 2, first: 3, last: 4, species: 12, comname: 'Anemone' }),
            observation({ id: 3, first: 5, last: 6, species: 40, comname: 'Mussel' }),
        ];

        expect(vocabulary(rows)).toEqual([
            { species_id: 12, comname: 'Anemone', class_index: 0 },
            { species_id: 40, comname: 'Mussel', class_index: 1 },
            { species_id: 77, comname: 'Zebra goby', class_index: 2 },
        ]);
    });

    test('the order does not depend on the order the rows arrived in', () => {
        const rows = [
            observation({ id: 1, first: 1, last: 2, species: 77, comname: 'Zebra goby' }),
            observation({ id: 2, first: 3, last: 4, species: 12, comname: 'Anemone' }),
        ];

        const forwards = vocabulary(rows);
        const backwards = vocabulary([...rows].reverse());

        expect(backwards).toEqual(forwards);
    });

    test('a species appearing many times gets one index', () => {
        const rows = [
            observation({ id: 1, first: 1, last: 2, species: 5, comname: 'Anemone' }),
            observation({ id: 2, first: 3, last: 4, species: 5, comname: 'Anemone' }),
        ];

        expect(vocabulary(rows)).toHaveLength(1);
    });
});

describe('the extraction plan (#268)', () => {

    test('a frame shared by two observations carries both boxes', () => {
        const rows = selected([
            observation({ id: 1, first: 100, last: 120, species: 1, comname: 'Anemone' }),
            observation({ id: 2, first: 110, last: 130, species: 2, comname: 'Mussel' }),
        ]);

        const classes = vocabulary(rows);
        const splits = assignSplits(connectedGroups(rows), { train: 1 });
        const plan = extractionPlan(splits, classes);
        const [entry] = [...plan.values()];

        // Frame 115 is inside both spans, so its label file has two lines. One line per
        // observation would write the same image twice and keep only one of them.
        expect(entry.frames.get(115)).toHaveLength(2);
        expect(entry.frames.get(105)).toHaveLength(1);
    });

    test('a label line is the class index and the box as fractions of the frame', () => {
        const rows = [observation({
            id: 1, first: 10, last: 10, species: 3, comname: 'Anemone',
            boxes: [{ framenum: 10, x: 0.2, y: 0.4, width: 0.1, height: 0.2 }],
        })];

        const plan = extractionPlan(
            assignSplits(connectedGroups(rows), { train: 1 }),
            vocabulary(rows)
        );
        const [entry] = [...plan.values()];

        // Centre, not corner: 0.2 + 0.1/2 and 0.4 + 0.2/2.
        expect(entry.frames.get(10)).toEqual(['0 0.250000 0.500000 0.100000 0.200000']);
    });

    test('videos are planned per split, so one pass never mixes them', () => {
        const rows = selected([
            observation({ id: 1, video: 'a.mp4', first: 100, last: 120 }),
            observation({ id: 2, video: 'a.mp4', first: 5000, last: 5020 }),
        ]);

        const splits = assignSplits(connectedGroups(rows), { train: 0.5, eval: 0.5 });
        const plan = extractionPlan(splits, vocabulary(rows));

        expect(plan.size).toBe(2);
        expect(new Set([...plan.values()].map((p) => p.split))).toEqual(new Set(['train', 'eval']));
    });
});

describe('the interpolated box (#268)', () => {

    const boxes = [
        { framenum: 0, x: 0, y: 0, width: 0.2, height: 0.2 },
        { framenum: 10, x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    ];

    test('it moves between the keyframes either side', () => {
        expect(boxAt(boxes, 5).cx).toBeCloseTo(0.3, 6);
    });

    test('it lands exactly on a keyframe', () => {
        expect(boxAt(boxes, 0).cx).toBeCloseTo(0.1, 6);
        expect(boxAt(boxes, 10).cx).toBeCloseTo(0.5, 6);
    });

    test('outside the keyframes there is nothing to interpolate, so no box', () => {
        // Holding the last box still past the end is a claim nobody made about where
        // the animal was.
        expect(boxAt(boxes, 11)).toBeNull();
        expect(boxAt([], 5)).toBeNull();
    });

    test('a single keyframe gives a box at its own frame and nowhere else', () => {
        const one = [{ framenum: 7, x: 0.1, y: 0.1, width: 0.2, height: 0.2 }];

        expect(boxAt(one, 7)).not.toBeNull();
        expect(boxAt(one, 8)).toBeNull();
    });
});
