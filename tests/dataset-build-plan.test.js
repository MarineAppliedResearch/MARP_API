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
    DEFAULT_FRAMES_PER_OBJECT,
    NEAR_MISS_FRAMES,
    assignFromSubsets,
    assignSplits,
    boxAt,
    classFolderName,
    classesJson,
    classificationDirectoryFor,
    classificationPlan,
    connectedGroups,
    estimateBuild,
    extractionPlan,
    pickFrames,
    sampleFrames,
    samplingSettings,
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

/**
 * The classification archive's shape, which is decided entirely by these functions.
 *
 * **A classification dataset has no `data.yaml`.** Ultralytics keeps no names list for
 * one: it reads the subfolder names and that is the whole class vocabulary. So the
 * directory layout is the contract, and every mistake available here produces an
 * archive that trains happily and means something other than what it says.
 */
describe('the classification archive layout', () => {

    /**
     * **`eval` is a detection directory and would be invisible to classify.** A
     * detection archive can call the held-out split anything because `data.yaml` names
     * it; a classification archive cannot, and Ultralytics looks for `val`. An archive
     * built through the detection mapping would ship `train/` and `eval/` and have no
     * validation split at all -- which reads as Ultralytics being broken.
     */
    test('the held-out split is val, not eval, whichever name the builder used', () => {
        expect(classificationDirectoryFor('train')).toBe('train');
        expect(classificationDirectoryFor('eval')).toBe('val');
        expect(classificationDirectoryFor('validation')).toBe('val');
        expect(classificationDirectoryFor('test')).toBe('test');
    });

    test('an unknown split is refused rather than given a directory', () => {
        expect(() => classificationDirectoryFor('holdout')).toThrow(/not a split/);
    });
});

/**
 * Turning a species name into a directory name, which the catalogue makes impossible
 * to do literally.
 *
 * Every case below is a real row in `species`, not an invented edge: the counts and
 * the names were read off the development catalogue before this was written.
 */
describe('the directory name a class gets', () => {

    /**
     * **The slash is the one that would have shipped.** `Blue/Deacon Rockfish` has
     * 5,576 observations, so it is in any realistic selection. Written literally it is
     * not a folder with a slash in its name -- there is no such thing -- it is two
     * nested folders, and Ultralytics reads the class as `Blue`.
     */
    test('a species whose name holds a path separator still gets one directory', () => {
        const folder = classFolderName({ species_id: 145, comname: 'Blue/Deacon Rockfish' });

        expect(folder).toBe('145_blue-deacon-rockfish');

        /* The assertion that matters: one path segment. A name that still contained a
           separator would pass a regex check on the text and still make two folders. */
        expect(folder.split('/')).toHaveLength(1);
        expect(folder.split('\\')).toHaveLength(1);
    });

    /**
     * **Two species, two directories, on a case-insensitive filesystem.** `Fish` and
     * `fish` are separate rows holding 194 and 124 observations. Folder names that
     * differed only in case would be one directory on Windows and on macOS, and 318
     * crops of two species would train as one class with nothing to say so.
     */
    test('two species whose names differ only in case do not collide', () => {
        const upper = classFolderName({ species_id: 801, comname: 'Fish' });
        const lower = classFolderName({ species_id: 802, comname: 'fish' });

        expect(upper).not.toBe(lower);

        /* Folded, because folding is what the filesystem does. Comparing them as
           written would pass while the directories still merged. */
        expect(upper.toLowerCase()).not.toBe(lower.toLowerCase());
    });

    /** Windows strips a trailing dot silently, so the directory stops being the name. */
    test('a name ending in a dot does not end in a dot', () => {
        expect(classFolderName({ species_id: 728, comname: 'UI Cancer sp.' }))
            .toBe('728_ui-cancer-sp');
    });

    /** The id alone is still unique, which is the point of putting it first. */
    test('a name with nothing alphanumeric in it leaves the id standing alone', () => {
        expect(classFolderName({ species_id: 99, comname: '???' })).toBe('99');
        expect(classFolderName({ species_id: 99, comname: '' })).toBe('99');
        expect(classFolderName({ species_id: 99, comname: null })).toBe('99');
    });

    /** Truncation must not reintroduce the trailing-separator problem it just solved. */
    test('a very long name is cut without leaving a dash on the end', () => {
        const folder = classFolderName({
            species_id: 834,
            comname: 'Lost/ abandoned/ or irretrievable instrument/marker',
        });

        expect(folder.startsWith('834_')).toBe(true);
        expect(folder.endsWith('-')).toBe(false);
    });
});

/**
 * `classes.json`, which is the only thing that makes the encoding reversible.
 *
 * **A classify model reports folder names.** Ultralytics has no other vocabulary, so a
 * model trained on this archive calls its class `145_blue-deacon-rockfish`. Without
 * this file, mapping that back to a species means parsing a convention; with it, the
 * archive says so in MARP's own words.
 */
describe('the vocabulary the archive carries', () => {
    const classes = [
        { species_id: 145, comname: 'Blue/Deacon Rockfish', class_index: 0 },
        { species_id: 801, comname: 'Fish', class_index: 1 },
    ];

    test('maps every folder back to its species and its exact name', () => {
        const written = JSON.parse(classesJson(classes, 'mosaic_thumbnail'));

        expect(written.classes).toHaveLength(2);

        const first = written.classes[0];

        expect(first.folder).toBe('145_blue-deacon-rockfish');

        /* **Untouched, slash and all.** The folder name is lossy on purpose; this is
           the half that is not, and a build that slugged it here too would record the
           encoding twice and the species nowhere. */
        expect(first.comname).toBe('Blue/Deacon Rockfish');
        expect(first.species_id).toBe(145);
        expect(first.class_index).toBe(0);
    });

    /** The archive says how its pictures were cut, for a reader holding only the tar. */
    test('says what it is and how its pictures were cut', () => {
        const written = JSON.parse(classesJson(classes, 'mosaic_thumbnail'));

        expect(written.task).toBe('classification');
        expect(written.crop_source).toBe('mosaic_thumbnail');
    });
});

/**
 * Which picture goes where, and the split rule it inherits.
 */
describe('the classification plan', () => {
    const classes = [
        { species_id: 10, comname: 'Yelloweye Rockfish', class_index: 0 },
        { species_id: 20, comname: 'Blue/Deacon Rockfish', class_index: 1 },
    ];

    const splits = new Map([
        ['train', [
            { observation_id: 3, species_id: 20 },
            { observation_id: 1, species_id: 10 },
        ]],
        ['validation', [{ observation_id: 2, species_id: 10 }]],
    ]);

    test('puts each observation in its split directory and its class folder', () => {
        const wanted = classificationPlan(splits, classes);

        expect(wanted).toHaveLength(3);

        const byObservation = new Map(wanted.map((item) => [item.observation_id, item]));

        expect(byObservation.get(3).directory).toBe('train');
        expect(byObservation.get(3).folder).toBe('20_blue-deacon-rockfish');

        /* `validation` is a split the screen offers and `val` is the directory classify
           reads; the plan keeps both, because the split is what the membership row and
           the per-split counts are recorded against. */
        expect(byObservation.get(2).split).toBe('validation');
        expect(byObservation.get(2).directory).toBe('val');
    });

    /**
     * **Deterministic, because the archive is named for its own hash.** `packageArchive`
     * takes the SHA-256 of the tar, so a build whose file order wandered would produce a
     * different archive -- and a different dataset row -- for a selection that had not
     * changed.
     */
    test('is ordered, so the same selection makes the same archive twice', () => {
        const once = classificationPlan(splits, classes).map((item) => item.observation_id);

        expect(once).toEqual([1, 3, 2]);
        expect(classificationPlan(splits, classes).map((item) => item.observation_id))
            .toEqual(once);
    });

    /**
     * A selection that disagrees with its own vocabulary is a bug in the build, not a
     * row to quietly drop -- dropping it would write a dataset smaller than its own
     * membership says, which is the failure the archive-versus-rows checks exist for.
     */
    test('refuses an observation whose species is not in the vocabulary', () => {
        const stray = new Map([['train', [{ observation_id: 9, species_id: 999 }]]]);

        expect(() => classificationPlan(stray, classes)).toThrow(/not in this build/);
    });
});

describe('frames per object (#296)', () => {

    /* Dataset 391 cut every frame of every track: 155,258 images of 1,683 animals, about
       92 near-copies each, and an epoch took 1 h 40 min. A build now takes N frames per
       object, spread across the track, seeded so a rebuild picks the same ones. */
    const sampling = (n, balance = false, seed = 7) => ({ frames_per_object: n, balance_classes: balance, seed });

    /** Every frame a class's box appears on, in a plan. */
    const framesOf = (plan, classIndex) => [...plan.values()].flatMap((entry) => [...entry.frames]
        .filter(([, lines]) => lines.some((line) => line.startsWith(`${classIndex} `)))
        .map(([frame]) => frame));

    test('takes at most N frames per object, one from each of N equal stretches', () => {
        const rows = [observation({ id: 1, first: 0, last: 999 })];
        const plan = extractionPlan(assignSplits(connectedGroups(rows), { train: 1 }), vocabulary(rows), sampling(10));
        const frames = framesOf(plan, 0).sort((a, b) => a - b);

        expect(frames).toHaveLength(10);
        // Spread: the i-th pick lies in the i-th hundred frames of the track.
        frames.forEach((frame, i) => {
            expect(frame).toBeGreaterThanOrEqual(i * 100);
            expect(frame).toBeLessThan((i + 1) * 100);
        });
    });

    test('a track shorter than N gives every frame it has', () => {
        const rows = [observation({ id: 1, first: 50, last: 55 })];
        const plan = extractionPlan(assignSplits(connectedGroups(rows), { train: 1 }), vocabulary(rows), sampling(10));

        expect(framesOf(plan, 0).sort((a, b) => a - b)).toEqual([50, 51, 52, 53, 54, 55]);
    });

    test('the picks are random within a stretch, not evenly spaced', () => {
        const available = Array.from({ length: 1000 }, (_, i) => i);
        const draws = [0.1, 0.9, 0.5];
        let k = 0;
        const picks = pickFrames(available, 10, () => draws[k++ % 3]);
        const gaps = new Set();

        for (let i = 1; i < picks.length; i++) gaps.add(picks[i] - picks[i - 1]);

        expect(gaps.size).toBeGreaterThan(1);
    });

    test('the same seed picks the same frames; another seed picks others', () => {
        const rows = [observation({ id: 1, first: 0, last: 999 }), observation({ id: 2, video: 'b.mp4', first: 0, last: 999 })];
        const splits = assignSplits(connectedGroups(rows), { train: 1 });

        const once = sampleFrames(splits, sampling(10, false, 42));
        const again = sampleFrames(splits, sampling(10, false, 42));
        const other = sampleFrames(splits, sampling(10, false, 43));

        expect([...again]).toEqual([...once]);
        expect(other.get(1)).not.toEqual(once.get(1));
    });

    test('an object picks the same frames whatever else is in the build', () => {
        const alone = [observation({ id: 1, first: 0, last: 999 })];
        const crowded = selected([...alone, observation({ id: 2, video: 'b.mp4', first: 0, last: 999 })]);

        const a = sampleFrames(assignSplits(connectedGroups(alone), { train: 1 }), sampling(10));
        const b = sampleFrames(assignSplits(connectedGroups(crowded), { train: 1 }), sampling(10));

        expect(b.get(1)).toEqual(a.get(1));
    });

    test('a frame picked for one object carries the box of every selected object in it', () => {
        // Two animals on the same stretch of video, so each one's picks land in the other's span.
        const rows = selected([
            observation({ id: 1, first: 0, last: 999, species: 1, comname: 'Anemone' }),
            observation({ id: 2, first: 0, last: 999, species: 2, comname: 'Mussel' }),
        ]);
        const plan = extractionPlan(assignSplits(connectedGroups(rows), { train: 1 }), vocabulary(rows), sampling(10));
        const [entry] = [...plan.values()];

        expect(entry.frames.size).toBeGreaterThan(10);
        for (const lines of entry.frames.values()) expect(lines).toHaveLength(2);
    });

    test('balancing gives every class the image count of the largest at N per object', () => {
        // Six anemones and two mussels, every track long. At N = 10 the anemones get 60
        // images, so the two mussels take 30 each.
        const rows = selected([
            ...[1, 2, 3, 4, 5, 6].map((id) => observation({ id, video: `a${id}.mp4`, first: 0, last: 499, species: 1, comname: 'Anemone' })),
            ...[7, 8].map((id) => observation({ id, video: `m${id}.mp4`, first: 0, last: 499, species: 2, comname: 'Mussel' })),
        ]);
        const splits = assignSplits(connectedGroups(rows), { train: 1 });
        const estimate = estimateBuild(splits, vocabulary(rows), sampling(10, true));

        expect(estimate.per_class.map((c) => [c.comname, c.images])).toEqual([['Anemone', 60], ['Mussel', 60]]);
        expect(sampleFrames(splits, sampling(10, true)).get(7)).toHaveLength(30);
    });

    test('balancing stops at what the tracks hold, and spreads a short track\'s shortfall', () => {
        // The mussels want 60: a track of 5 frames gives all 5 and the other gives 55.
        const rows = selected([
            ...[1, 2, 3, 4, 5, 6].map((id) => observation({ id, video: `a${id}.mp4`, first: 0, last: 499, species: 1, comname: 'Anemone' })),
            observation({ id: 7, video: 'm7.mp4', first: 0, last: 4, species: 2, comname: 'Mussel' }),
            observation({ id: 8, video: 'm8.mp4', first: 0, last: 499, species: 2, comname: 'Mussel' }),
            observation({ id: 9, video: 'u9.mp4', first: 0, last: 2, species: 3, comname: 'Urchin' }),
        ]);
        const picked = sampleFrames(assignSplits(connectedGroups(rows), { train: 1 }), sampling(10, true));

        expect(picked.get(7)).toHaveLength(5);
        expect(picked.get(8)).toHaveLength(55);
        expect(picked.get(9)).toHaveLength(3);
        expect(picked.get(1)).toHaveLength(10);
    });

    test('balancing is per split, against that split\'s own largest class', () => {
        const rows = selected([
            ...[1, 2, 3, 4].map((id) => observation({ id, video: `a${id}.mp4`, first: 0, last: 499, species: 1, comname: 'Anemone' })),
            observation({ id: 5, video: 'm5.mp4', first: 0, last: 499, species: 2, comname: 'Mussel' }),
            observation({ id: 6, video: 'a6.mp4', first: 0, last: 499, species: 1, comname: 'Anemone' }),
            observation({ id: 7, video: 'm7.mp4', first: 0, last: 499, species: 2, comname: 'Mussel' }),
        ]);
        const splits = new Map([
            ['train', rows.filter((row) => row.observation_id <= 5)],
            ['eval', rows.filter((row) => row.observation_id > 5)],
        ]);
        const picked = sampleFrames(splits, sampling(10, true));

        expect(picked.get(5)).toHaveLength(40);
        expect(picked.get(7)).toHaveLength(10);
    });

    test('sampling never moves an observation between splits', () => {
        const rows = selected(Array.from({ length: 30 }, (_, i) => observation({
            id: i + 1,
            video: `v${i % 4}.mp4`,
            first: i * 1000,
            last: i * 1000 + 300,
            species: (i % 3) + 1,
            comname: ['A', 'B', 'C'][i % 3],
        })));
        const splits = assignSplits(connectedGroups(rows), { train: 0.8, eval: 0.2 });
        const classes = vocabulary(rows);

        const every = extractionPlan(splits, classes);
        const sampled = extractionPlan(splits, classes, sampling(10, true));

        expect([...sampled.keys()].sort()).toEqual([...every.keys()].sort());
        for (const [key, entry] of sampled) expect(entry.split).toBe(every.get(key).split);
    });

    test('without sampling the plan is every frame, as before', () => {
        const rows = [observation({ id: 1, first: 100, last: 199 })];
        const splits = assignSplits(connectedGroups(rows), { train: 1 });

        expect([...extractionPlan(splits, vocabulary(rows), null).values()][0].frames.size).toBe(100);
        expect(samplingSettings(undefined)).toBeNull();
        expect(samplingSettings({ frames_per_object: null })).toBeNull();
    });

    test('the estimate counts what the plan cuts, and what every frame would have been', () => {
        const rows = selected([
            observation({ id: 1, first: 0, last: 999, species: 1, comname: 'Anemone' }),
            observation({ id: 2, first: 500, last: 1499, species: 2, comname: 'Mussel' }),
        ]);
        const splits = assignSplits(connectedGroups(rows), { train: 1 });
        const classes = vocabulary(rows);
        const plan = extractionPlan(splits, classes, sampling(10));
        const estimate = estimateBuild(splits, classes, sampling(10));

        expect(estimate.images).toBe([...plan.values()].reduce((sum, entry) => sum + entry.frames.size, 0));
        expect(estimate.every_frame).toBe(1500);
        expect(estimate.per_split).toEqual({ train: estimate.images });
    });

    test('the settings: a seed is chosen when none is given, and a bad value is refused', () => {
        expect(samplingSettings({ frames_per_object: 10 }, () => 0.5)).toEqual({
            frames_per_object: 10, balance_classes: false, seed: 1073741823,
        });
        expect(samplingSettings({ frames_per_object: 4, balance_classes: true, seed: 9 }))
            .toEqual({ frames_per_object: 4, balance_classes: true, seed: 9 });
        expect(() => samplingSettings({ frames_per_object: 0 })).toThrow(/1 or more/);
        expect(() => samplingSettings({ frames_per_object: 2.5 })).toThrow(/whole number/);
        expect(() => samplingSettings({ frames_per_object: 10, balance_classes: 'yes' })).toThrow(/true or false/);
        expect(() => samplingSettings({ frames_per_object: 10, seed: -1 })).toThrow(/seed/);
        expect(DEFAULT_FRAMES_PER_OBJECT).toBe(10);
    });
});
