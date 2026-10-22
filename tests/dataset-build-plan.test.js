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
    NEAR_MISS_FRAMES,
    assignFromSubsets,
    assignSplits,
    boxAt,
    connectedGroups,
    extractionPlan,
    vocabulary,
} = require('../service/dataset-build-plan');

const {
    DEFAULT_IMAGE,
    SPLIT_DIRECTORIES,
    dataYaml,
    directoryFor,
    imageSettings,
} = require('../service/dataset-build.service');

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
        /* Far enough apart to be a different scene. One frame apart used to be enough
           for this test; it is not any more, because a frame apart is the same picture
           and the near-miss buffer now says so. */
        const rows = selected([
            observation({ id: 1, first: 100, last: 200 }),
            observation({ id: 2, first: 200 + NEAR_MISS_FRAMES + 1, last: 400 }),
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

describe('near-miss leakage (#268)', () => {

    /* Frame-exact overlap is the obvious leak. Two observations a few frames apart are
       nearly the same picture -- same seabed, same lighting, the animal barely moved --
       and splitting those across train and eval scores the model on what it memorised.
       Isaac: "we don't want to think our training is better than it is." */

    test('observations within the buffer are one scene', () => {
        const rows = selected([
            observation({ id: 1, first: 100, last: 200 }),
            // Five frames later: a different observation, the same picture.
            observation({ id: 2, first: 205, last: 300 }),
        ]);

        expect(connectedGroups(rows)).toHaveLength(1);
    });

    test('observations beyond the buffer are separate', () => {
        const rows = selected([
            observation({ id: 1, first: 100, last: 200 }),
            observation({ id: 2, first: 200 + NEAR_MISS_FRAMES + 1, last: 900 }),
        ]);

        expect(connectedGroups(rows)).toHaveLength(2);
    });

    test('the buffer can be set, because the right distance is empirical', () => {
        const rows = selected([
            observation({ id: 1, first: 100, last: 200 }),
            observation({ id: 2, first: 260, last: 300 }),
        ]);

        // 60 apart: one scene at the default, two with no buffer at all.
        expect(connectedGroups(rows, NEAR_MISS_FRAMES)).toHaveLength(1);
        expect(connectedGroups(rows, 0)).toHaveLength(2);
    });

    test('the buffer never joins across videos', () => {
        // Frame numbers are per video; proximity between two of them means nothing.
        const rows = selected([
            observation({ id: 1, video: 'a.mp4', first: 100, last: 200 }),
            observation({ id: 2, video: 'b.mp4', first: 201, last: 300 }),
        ]);

        expect(connectedGroups(rows)).toHaveLength(2);
    });
});

describe('stratified splits (#268)', () => {

    /** Frames of one species in one split. */
    const framesOf = (rows, species) => rows
        .filter((r) => r.species_id === species)
        .reduce((sum, r) => sum + (r.last_framenum - r.first_framenum + 1), 0);

    /**
     * The real shape, taken from the build this was written for.
     *
     * **Synthetic fixtures were too tidy to show the failure.** Even groups of similar
     * size spread a rare species acceptably by accident, so a size-only split passed
     * every tidy test. On the real selection it does not: the test split gets *none* of
     * the rarest species and validation gets 8 per cent where it asked for 20.
     *
     * What matters here and was missing before: sizes spanning 31 to 1,319 frames, and
     * groups carrying two species at once. Those are what make a size-only split follow
     * the common species and drag the rare one wherever it happens to go.
     *
     * Counts are frames per species per connected group, from the 115 promoted
     * observations at confidence 0.5 and above.
     */
    const REAL_GROUPS = [
        { W: 140 }, { C: 325 }, { C: 476 }, { C: 111 }, { C: 88, W: 88 }, { C: 121 },
        { W: 115 }, { C: 480 }, { C: 98 }, { W: 342, C: 133 }, { F: 490, C: 906 },
        { C: 79, W: 33 }, { F: 120 }, { F: 202 }, { C: 135 }, { F: 206 }, { F: 200 },
        { C: 144 }, { C: 172, W: 60 }, { C: 144 }, { C: 1207, F: 163 }, { F: 78 },
        { F: 63 }, { W: 38 }, { W: 62 }, { W: 427 }, { W: 398 }, { W: 1319 }, { F: 253 },
        { F: 70 }, { F: 51 }, { C: 106 }, { F: 41, C: 71 }, { F: 76 }, { C: 48 },
        { F: 79 }, { F: 116 }, { C: 123 }, { C: 202 }, { C: 73 }, { F: 81, W: 34 },
        { C: 138 }, { C: 50 }, { C: 31 }, { C: 175 }, { C: 152 }, { C: 520 }, { C: 127 },
        { C: 122 }, { W: 168 }, { C: 304 }, { W: 518 }, { W: 185 }, { C: 102 },
        { W: 201 },
    ];

    /** Species ids, and which is rarest. */
    const SPECIES = { C: 1, W: 2, F: 3 };

    /** The real groups as rows, each group its own scene. */
    const realCorpus = () => {
        const rows = [];
        let at = 0;
        let id = 1;

        for (const group of REAL_GROUPS) {
            /* Every observation of a group starts at the same frame, so the group holds
               together whatever the buffer is, and the next group starts well clear. */
            const start = at;
            let longest = 0;

            for (const [key, size] of Object.entries(group)) {
                rows.push(observation({
                    id: id++, first: start, last: start + size - 1,
                    species: SPECIES[key], comname: key,
                }));
                longest = Math.max(longest, size);
            }

            at = start + longest + NEAR_MISS_FRAMES + 1000;
        }

        return selected(rows);
    };

    test('on the real shape, every species lands close to its requested share', () => {
        /* The failure, measured: without stratification this selection gives the test
           split 0 per cent of the rarest species and validation 8 per cent of a
           requested 20. A model evaluated on a species its test set has none of tells
           you nothing about that species at all. */
        const splits = assignSplits(
            connectedGroups(realCorpus()),
            { train: 0.7, validation: 0.2, test: 0.1 }
        );

        for (const species of Object.values(SPECIES)) {
            const total = [...splits.values()].reduce((sum, rows) => sum + framesOf(rows, species), 0);

            expect(framesOf(splits.get('train'), species) / total).toBeCloseTo(0.7, 1);
            expect(framesOf(splits.get('validation'), species) / total).toBeCloseTo(0.2, 1);
            expect(framesOf(splits.get('test'), species) / total).toBeCloseTo(0.1, 1);
        }
    });

    /** Many groups, one species far rarer than the other. */
    const corpus = () => selected([
        ...Array.from({ length: 30 }, (unused, i) => observation({
            id: i + 1, first: i * 2000, last: i * 2000 + 300, species: 1, comname: 'Common',
        })),
        /* Twelve groups of a rare species, scattered so each is its own scene.
           **Twelve rather than four, and that is a real limit rather than a tuned
           fixture.** Groups are placed whole, so a split asking for a tenth of four
           groups gets none of them -- no stratification can divide four things into
           70/20/10. Worth knowing when a build covers few encounters of a rare
           species: its smallest split may legitimately hold none. */
        ...Array.from({ length: 12 }, (unused, i) => observation({
            id: 100 + i, first: 500000 + i * 5000, last: 500000 + i * 5000 + 200,
            species: 2, comname: 'Rare',
        })),
    ]);

    test('a rare species reaches every split', () => {
        /* The failure this exists to prevent: four groups of a rare species, placed by
           overall size alone, can all land in train -- and the model is then evaluated
           on a species eval has none of, which tells you nothing about either. */
        const splits = assignSplits(connectedGroups(corpus()), { train: 0.7, eval: 0.3 });

        for (const [, rows] of splits) {
            expect(framesOf(rows, 2)).toBeGreaterThan(0);
        }
    });

    test('the rare species is split close to the requested shares', () => {
        const splits = assignSplits(connectedGroups(corpus()), { train: 0.75, eval: 0.25 });
        const rare = [...splits.values()].reduce((sum, rows) => sum + framesOf(rows, 2), 0);

        expect(framesOf(splits.get('train'), 2) / rare).toBeCloseTo(0.75, 1);
    });

    test('the overall shares are still close to what was asked for', () => {
        // Stratifying must not cost the thing it was added beside.
        const splits = assignSplits(connectedGroups(corpus()), { train: 0.7, eval: 0.3 });
        const frames = (rows) => rows.reduce((s, r) => s + (r.last_framenum - r.first_framenum + 1), 0);
        const total = frames([...splits.values()].flat());

        expect(frames(splits.get('train')) / total).toBeCloseTo(0.7, 1);
    });

    test('three splits work, because train/validation/test is the real case', () => {
        const splits = assignSplits(
            connectedGroups(corpus()),
            { train: 0.7, validation: 0.2, test: 0.1 }
        );

        expect([...splits.keys()].sort()).toEqual(['test', 'train', 'validation']);
        for (const [, rows] of splits) expect(framesOf(rows, 2)).toBeGreaterThan(0);
    });

    test('the same query rebuilds the same dataset', () => {
        /* Isaac: "we want to be able to rebuild the same exact dataset using the same
           queries." Stratifying must not introduce any randomness. */
        const ids = (m, name) => m.get(name).map((r) => r.observation_id).sort((a, b) => a - b);
        const once = assignSplits(connectedGroups(corpus()), { train: 0.7, eval: 0.3 });
        const again = assignSplits(connectedGroups(corpus()), { train: 0.7, eval: 0.3 });

        expect(ids(once, 'train')).toEqual(ids(again, 'train'));
        expect(ids(once, 'eval')).toEqual(ids(again, 'eval'));
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

describe('splits the builder declared (#268)', () => {

    /** Where each observation ended up. */
    const placement = (splits) => {
        const where = new Map();

        for (const [name, rows] of splits) {
            for (const row of rows) where.set(row.observation_id, name);
        }

        return where;
    };

    test('each subset goes to the split it asked for', () => {
        const where = placement(assignFromSubsets([
            { split: 'train', rows: [observation({ id: 1, first: 100, last: 200 })] },
            { split: 'eval', rows: [observation({ id: 2, first: 9000, last: 9100 })] },
        ]));

        expect(where.get(1)).toBe('train');
        expect(where.get(2)).toBe('eval');
    });

    test('an observation matched by two subsets keeps the first one', () => {
        // Re-querying the same dives into a second split must not move what is placed.
        const shared = observation({ id: 1, first: 100, last: 200 });

        const where = placement(assignFromSubsets([
            { split: 'train', rows: [shared] },
            { split: 'eval', rows: [shared, observation({ id: 2, first: 9000, last: 9100 })] },
        ]));

        expect(where.get(1)).toBe('train');
        expect(where.get(2)).toBe('eval');
    });

    test('a group spanning two splits is pulled whole into the earlier one', () => {
        /* The case the rule exists for: two animals in overlapping frames, sent to
           different splits by different queries. Leaving them apart puts the same
           picture in train and eval, and the evaluation is then scored on what the
           model memorised. */
        const where = placement(assignFromSubsets([
            { split: 'train', rows: [observation({ id: 1, first: 100, last: 200 })] },
            { split: 'eval', rows: [observation({ id: 2, first: 150, last: 250 })] },
        ]));

        expect(where.get(2)).toBe('train');
        expect(where.get(1)).toBe('train');
    });

    test('no frame ends up in two splits, whatever the subsets asked for', () => {
        const splits = assignFromSubsets([
            { split: 'train', rows: [observation({ id: 1, first: 0, last: 100 })] },
            { split: 'eval', rows: [observation({ id: 2, first: 90, last: 190 })] },
            { split: 'train', rows: [observation({ id: 3, first: 180, last: 280 })] },
            { split: 'eval', rows: [observation({ id: 4, first: 5000, last: 5100 })] },
        ]);

        const seen = new Map();

        for (const [name, rows] of splits) {
            for (const row of rows) {
                for (let f = row.first_framenum; f <= row.last_framenum; f++) {
                    const key = `${row.video_source}:${f}`;

                    if (seen.has(key)) expect(seen.get(key)).toBe(name);
                    else seen.set(key, name);
                }
            }
        }

        // 1, 2 and 3 are one chain; 4 is on its own in eval.
        expect(splits.get('eval').map((r) => r.observation_id)).toEqual([4]);
    });
});

describe('every split reaches the archive (#268)', () => {

    /* The screen offers Train, Validation and Test. The archive said `train` and `eval`.
       A subset sent to either of the other two was cut, recorded as a member of the
       dataset, and then left out of the tar -- so the dataset claimed observations its
       own archive did not hold, and nothing said so. */

    test('every split the screen offers has a place in the archive', () => {
        for (const offered of ['train', 'validation', 'test']) {
            expect(() => directoryFor(offered)).not.toThrow();
        }
    });

    test('validation goes where val: already points', () => {
        // `val:` *means* validation. A third directory would have the worker reading
        // one split and the dataset describing another.
        expect(directoryFor('validation')).toBe(directoryFor('eval'));
    });

    test('test gets a directory of its own', () => {
        expect(directoryFor('test')).toBe('test');
        expect(directoryFor('test')).not.toBe(directoryFor('train'));
    });

    test('an unknown split is refused, not given a directory nobody packages', () => {
        expect(() => directoryFor('holdout')).toThrow(/not a split/i);
    });

    test('data.yaml names the test split only when there is one', () => {
        const classes = [{ species_id: 1, comname: 'Anemone', class_index: 0 }];

        expect(dataYaml(classes, ['train', 'eval'])).not.toMatch(/^test:/m);
        expect(dataYaml(classes, ['train', 'eval', 'test'])).toMatch(/^test: test\/images$/m);
    });

    test('a two-split yaml is unchanged by the test split existing as an option', () => {
        const classes = [{ species_id: 1, comname: 'Anemone', class_index: 0 }];

        expect(dataYaml(classes)).toBe(
            ['names:', '- Anemone', 'nc: 1', 'train: train/images', 'val: eval/images', ''].join('\n')
        );
    });

    test('the directories packaged are every one a split can write', () => {
        // The guard against the original bug: the packager takes this set, so a split
        // that can be written is a split that is packaged.
        for (const split of Object.keys(SPLIT_DIRECTORIES)) {
            expect(Object.values(SPLIT_DIRECTORIES)).toContain(directoryFor(split));
        }
    });
});

describe('how a frame is written (#268)', () => {

    /* JPEG by default because every dataset MARP has trained on is JPEG and the source
       is already-lossy H.264 -- but switchable, because that is today's evidence rather
       than a law, and these datasets run to 50,000 frames where the difference is about
       20 GB against about 85 GB. */

    test('the default is JPEG, and it writes .jpg', () => {
        expect(DEFAULT_IMAGE.format).toBe('jpeg');
        expect(imageSettings().extension).toBe('jpg');
        expect(imageSettings().quality).toBe(DEFAULT_IMAGE.quality);
    });

    test('the default quality is not below what the legacy datasets were built at', () => {
        // rockfish5's frames are about 364 KB; quality 90 measured 246 KB on the same
        // frames, so a new dataset at 90 would be more compressed than the ones the
        // existing models learned on.
        expect(DEFAULT_IMAGE.quality).toBeGreaterThan(90);
    });

    test('png can be asked for, and writes .png', () => {
        const settings = imageSettings({ format: 'png' });

        expect(settings.format).toBe('png');
        expect(settings.extension).toBe('png');
    });

    test('the quality can be set', () => {
        expect(imageSettings({ format: 'jpeg', quality: 85 }).quality).toBe(85);
    });

    test('an unknown format is refused rather than quietly defaulted', () => {
        // A dataset built in a format nobody asked for is one somebody has to rebuild
        // to find out about.
        expect(() => imageSettings({ format: 'webp' })).toThrow(/not an image format/i);
    });

    test('a quality outside 1-100 is refused', () => {
        expect(() => imageSettings({ quality: 0 })).toThrow(/between 1 and 100/i);
        expect(() => imageSettings({ quality: 101 })).toThrow(/between 1 and 100/i);
    });

    test('png with a quality is refused, because png would ignore it', () => {
        expect(() => imageSettings({ format: 'png', quality: 90 })).toThrow(/lossless/i);
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
        // Centre-origin: the keyframe's own x and y, not x + width / 2.
        expect(entry.frames.get(10)).toEqual(['0 0.200000 0.400000 0.100000 0.200000']);
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

    /* **`x, y` is the centre.** These tests asserted `x + width / 2` until 2026-10-21,
       which is what the code did, and both were wrong: every label was shifted half a
       box right and down, off the animal. `service/thumbnail-geometry.js` records the
       answer (F1) -- centre-origin, confirmed by eye in the spike, where the top-left
       reading "contains bare rubble". The real-video suite caught it; no fixture here
       could, because a box at 0.3 with width 0.2 is in range read either way. */
    const boxes = [
        { framenum: 0, x: 0.3, y: 0.3, width: 0.2, height: 0.2 },
        { framenum: 10, x: 0.7, y: 0.7, width: 0.2, height: 0.2 },
    ];

    test('it moves between the keyframes either side', () => {
        expect(boxAt(boxes, 5).cx).toBeCloseTo(0.5, 6);
    });

    test('it lands exactly on a keyframe, at the centre the keyframe records', () => {
        expect(boxAt(boxes, 0).cx).toBeCloseTo(0.3, 6);
        expect(boxAt(boxes, 10).cx).toBeCloseTo(0.7, 6);
    });

    test('a box running off the edge is clipped to what is in the picture', () => {
        /* Real boxes do run off: measured over 78 keyframes they span [-0.0105, 1.0275]
           horizontally. YOLO reads a box as a region of the image, so the part outside
           the frame is not in the picture and must not be in the label. Clipped and
           re-centred rather than clamped -- clamping the centre keeps a width reaching
           outside and describes a box bigger than the animal in view. */
        const edge = [{ framenum: 0, x: 0.95, y: 0.5, width: 0.2, height: 0.2 }];
        const box = boxAt(edge, 0);

        // Spanned 0.85..1.05; what is in the picture is 0.85..1.
        expect(box.cx).toBeCloseTo(0.925, 6);
        expect(box.w).toBeCloseTo(0.15, 6);
        expect(box.cy).toBeCloseTo(0.5, 6);
    });

    test('every coordinate it produces lies inside the frame', () => {
        /* The property the real build broke: a label carrying 1.012 is one the trainer
           silently clips, so the box it trains on is not the box anybody drew. */
        for (const x of [-0.05, 0, 0.5, 1, 1.05]) {
            for (const w of [0.05, 0.4, 0.9]) {
                const box = boxAt([{ framenum: 0, x, y: x, width: w, height: w }], 0);

                if (!box) continue;

                for (const value of [box.cx, box.cy, box.w, box.h]) {
                    expect(value).toBeGreaterThanOrEqual(0);
                    expect(value).toBeLessThanOrEqual(1);
                }
            }
        }
    });

    test('a box entirely outside the frame is no box at all', () => {
        const gone = [{ framenum: 0, x: 1.4, y: 0.5, width: 0.2, height: 0.2 }];

        expect(boxAt(gone, 0)).toBeNull();
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
