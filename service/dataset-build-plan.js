/**
 * Turning selected observations into a build plan.
 *
 * Pure functions over rows, with no database and no ffmpeg, because this is where the
 * correctness argument lives and it should be testable in milliseconds. The service
 * beside this one does the slow, side-effecting half.
 *
 * Two decisions are made here and both are load-bearing:
 *
 * 1. **Which observations must share a split.** The Datasets screen states the rule --
 *    *"An observation or connected frame group keeps its first split assignment"* -- and
 *    it exists because the same frame can carry two animals. Put one in train and the
 *    other in eval and the model is evaluated on a picture it was trained on, which
 *    makes the evaluation worthless and the number flattering.
 * 2. **What class index each species gets.** A YOLO label is an index, and an index is
 *    meaningless without the ordered list. Assigned by common name so the same selection
 *    always produces the same vocabulary, whatever order the rows arrived in.
 *
 * @fileoverview Grouping, splitting and vocabulary for a dataset build.
 * @author Isaac Travers
 * @module service/dataset-build-plan
 */

/**
 * How far apart two groups must be before they are different scenes.
 *
 * **Frame-exact overlap is not the only leak.** Two observations five frames apart in
 * one video are nearly the same picture: the same patch of seabed, the same lighting,
 * the animal barely moved. Put one in train and the other in eval and the evaluation is
 * partly scored on pictures the model trained on, so the number comes back flattering
 * and nothing downstream can tell.
 *
 * 125 frames is five seconds at 25fps, which is a long time in slow ROV transect video
 * and short enough that genuinely separate encounters stay separate. **The right number
 * is empirical**, not a constant somebody derived, which is why a build can ask for
 * another -- raise it where the camera is near-stationary.
 *
 * Isaac, 2026-10-21, asked for it: *"we want to watch out for near miss leakage, we
 * don't want to think our training is better than it is."*
 *
 * @constant
 * @type {number}
 */
const NEAR_MISS_FRAMES = 125;

/**
 * The connected groups of observations that share frames.
 *
 * Two observations are connected when they are in the same video and their frame spans
 * overlap; connection is transitive, so A overlapping B and B overlapping C puts all
 * three in one group even when A and C do not touch. That transitivity is the whole
 * reason this is a union rather than a pairwise check: a chain of overlaps through a
 * busy stretch of video is one group, and splitting it anywhere leaks a frame.
 *
 * **Linear, because the rows arrive sorted by video then first frame.** Walking them in
 * that order means a new group starts exactly when a row begins after the furthest frame
 * any previous row in the group reached. The selection query's `ORDER BY` is therefore
 * part of this function's contract rather than a convenience.
 *
 * @param {Array<Object>} rows - Selected observations, ordered by `video_source` then
 * `first_framenum`.
 * @param {number} [buffer] - Frames of separation below which two groups are treated
 * as one scene. See {@link NEAR_MISS_FRAMES}.
 * @returns {Array<Array<Object>>} The groups, in the order their first row appeared.
 */
function connectedGroups(rows, buffer = NEAR_MISS_FRAMES) {
    const groups = [];
    let current = null;
    let reach = -1;
    let video = null;

    for (const row of rows) {
        const first = Number(row.first_framenum);
        const last = Number(row.last_framenum);

        /* A different video can never share a frame, so it always starts a group --
           frame numbers are per video and comparing them across two is meaningless. */
        const sameVideo = row.video_source === video;

        /* `+ buffer`, not just `>`: two observations five frames apart are nearly the
           same picture -- same scene, same lighting, the animal barely moved -- so
           splitting them across train and eval scores the model on what it memorised.
           Frame-exact overlap is the obvious leak; this is the one that quietly
           flatters the number. */
        if (!current || !sameVideo || first > reach + buffer) {
            current = [];
            groups.push(current);
            reach = last;
            video = row.video_source;
        } else {
            reach = Math.max(reach, last);
        }

        current.push(row);
    }

    return groups;
}

/**
 * Assign each group to a split, keeping the requested proportions.
 *
 * **Groups are placed whole, and stratified by species.** Whole, because that is the
 * rule. Stratified because a proportional split measured only in frames can put most of
 * a rare species in one split and leave another without it -- with three species and
 * seventy-three groups that is not a remote risk, and a model evaluated on a species it
 * barely trained on tells you nothing useful about either.
 *
 * The method is **iterative stratification** (Sechidis et al., 2011), which is the
 * established answer for multi-label data: a connected group can carry several species,
 * so it cannot be put in one species' bucket. Each group goes to whichever split is
 * furthest below its share *of the rarest species that group contains*, because the
 * common species come out proportional whatever you do and the rare ones are what a
 * naive split gets wrong. Ties fall back to overall frames, which keeps the sizes right.
 *
 * Measured in frames rather than observations throughout: frames are what the model
 * sees, and one observation spanning 400 frames is not the contribution of one spanning
 * two.
 *
 * Each group goes wherever it leaves the result closest to the requested share, measured
 * in frames rather than observations: frames are what the model sees, and one observation
 * spanning 400 frames is not the same contribution as one spanning 2.
 *
 * **Deterministic.** The same selection and the same ratios produce the same split every
 * time, so a rebuild is comparable with what it replaces, and a test can assert an exact
 * membership rather than a distribution.
 *
 * @param {Array<Array<Object>>} groups - From {@link connectedGroups}.
 * @param {Object} ratios - `{train, eval}`, any positive numbers; normalised here.
 * @returns {Map<string, Array<Object>>} Split name to its observations.
 */
function assignSplits(groups, ratios = { train: 0.8, eval: 0.2 }) {
    const names = Object.keys(ratios).filter((name) => Number(ratios[name]) > 0);

    if (!names.length) {
        throw new Error('At least one split must have a share above zero.');
    }

    const total = names.reduce((sum, name) => sum + Number(ratios[name]), 0);
    const want = Object.fromEntries(names.map((name) => [name, Number(ratios[name]) / total]));
    const held = Object.fromEntries(names.map((name) => [name, 0]));
    const out = new Map(names.map((name) => [name, []]));

    const frames = (group) => group.reduce(
        (sum, row) => sum + (Number(row.last_framenum) - Number(row.first_framenum) + 1), 0
    );

    /* Frames per species, per group and overall. A group is multi-label -- one stretch
       of video can hold three species -- which is why simple stratified sampling does
       not apply and why this is counted rather than bucketed. */
    const speciesOf = (group) => {
        const counted = new Map();

        for (const row of group) {
            const id = Number(row.species_id);
            const span = Number(row.last_framenum) - Number(row.first_framenum) + 1;

            counted.set(id, (counted.get(id) || 0) + span);
        }

        return counted;
    };

    const wanted = new Map();
    const measured = groups.map((group) => {
        const species = speciesOf(group);

        for (const [id, count] of species) wanted.set(id, (wanted.get(id) || 0) + count);

        return { group, size: frames(group), species };
    });

    /* Held per split per species, so "starved" is a question that can be asked. */
    const heldSpecies = Object.fromEntries(names.map((name) => [name, new Map()]));

    /* **Rarest first.** Iterative stratification: the examples carrying the scarcest
       species are placed while every split still has room, because those are the ones a
       proportional split gets wrong. A rare species placed last lands wherever is left
       over, which is how train ends up without one. */
    const rarity = (entry) => Math.min(...[...entry.species.keys()].map((id) => wanted.get(id) || 0));

    const ordered = measured.sort((a, b) =>
        rarity(a) - rarity(b)
        || b.size - a.size
        || a.group[0].observation_id - b.group[0].observation_id);

    let placed = 0;

    for (const entry of ordered) {
        const { group, size, species } = entry;

        /* Which split is furthest from its share **of the rarest species this group
           carries**, falling back to overall frames when that cannot separate them.
           Deciding on the rarest species rather than on the total is the whole point:
           the common ones come out proportional whatever you do. */
        const scarcest = [...species.keys()]
            .sort((a, b) => (wanted.get(a) || 0) - (wanted.get(b) || 0))[0];

        let best = null;
        let bestShortfall = -Infinity;

        for (const name of names) {
            const have = heldSpecies[name].get(scarcest) || 0;
            const target = (wanted.get(scarcest) || 0) * want[name];
            const shortfall = target - have;

            /* Ties -- and at the start every split is equally starved -- are broken by
               overall frames, so the sizes stay proportional too. */
            const overall = (placed + size) * want[name] - held[name];
            const score = shortfall + overall / 1e6;

            if (score > bestShortfall) {
                bestShortfall = score;
                best = name;
            }
        }

        out.get(best).push(...group);
        held[best] += size;
        placed += size;

        for (const [id, count] of species) {
            heldSpecies[best].set(id, (heldSpecies[best].get(id) || 0) + count);
        }
    }

    return out;
}

/**
 * Place observations in the splits their subsets asked for.
 *
 * The builder is a union of queries, each sent to a split by the person assembling it --
 * "these dives into train, those into eval" is a sentence they said, not a ratio for the
 * server to guess at. So this honours what was declared, and {@link assignSplits} is only
 * for a build that declared nothing.
 *
 * Two rules decide the overlaps, and the screen states both:
 *
 * - **"If a match is already assigned elsewhere, its first split assignment is kept."**
 *   An observation matched by two subsets belongs to the earlier one. Re-querying the
 *   same dives into a second split should not move what is already placed.
 * - **"An observation or connected frame group keeps its first split assignment."** A
 *   group that ends up spanning two splits is pulled whole into the one its earliest
 *   member claimed -- otherwise a frame holding two animals is in both, and the
 *   evaluation is scored on pictures the model trained on.
 *
 * @param {Array<{split: string, rows: Array<Object>}>} subsets - In the order they were
 * added, which is what "first" means.
 * @returns {Map<string, Array<Object>>} Split name to its observations.
 */
function assignFromSubsets(subsets) {
    /* First wins, so a later subset never moves what an earlier one placed. */
    const splitOf = new Map();
    const rowOf = new Map();

    for (const subset of subsets) {
        for (const row of subset.rows) {
            const id = Number(row.observation_id);

            if (splitOf.has(id)) continue;

            splitOf.set(id, subset.split);
            rowOf.set(id, row);
        }
    }

    /* Group coherence is repaired after placement rather than prevented during it: the
       groups are only knowable once every subset has contributed, because two subsets
       can each hold half of one overlapping run. */
    const rows = [...rowOf.values()].sort(
        (a, b) => String(a.video_source).localeCompare(String(b.video_source))
            || a.first_framenum - b.first_framenum
            || a.observation_id - b.observation_id
    );

    /* Rank once. "Earliest" is insertion order into `splitOf`, and recomputing that
       inside the loop is a scan of every placed observation per row -- quadratic over a
       build that can hold a hundred thousand of them. */
    const rank = new Map();
    let next = 0;

    for (const id of splitOf.keys()) rank.set(id, next++);

    const out = new Map();

    for (const group of connectedGroups(rows)) {
        const owner = group.reduce(
            (first, row) => (rank.get(Number(row.observation_id)) < rank.get(Number(first.observation_id))
                ? row
                : first),
            group[0]
        );

        const split = splitOf.get(Number(owner.observation_id));

        if (!out.has(split)) out.set(split, []);

        out.get(split).push(...group);
    }

    return out;
}

/**
 * The class index each species gets.
 *
 * **By common name, not by id and not by frequency.** The same selection has to produce
 * the same vocabulary whichever machine builds it and whatever order the rows arrive in,
 * because the index is written into every label file and a dataset rebuilt with a
 * different order is a dataset whose labels mean something else. Sorting by name is
 * stable, inspectable, and the order a person reading `data.yaml` expects.
 *
 * `species_id` is what the index *means*; `comname` is only how it is ordered and what
 * the archive's `names:` list shows. A rename therefore changes the printed name and
 * never the mapping, which is why `dataset_classes` stores the id.
 *
 * @param {Array<Object>} rows - Selected observations.
 * @returns {Array<{species_id: number, comname: string, class_index: number}>} The
 * vocabulary, index order.
 */
function vocabulary(rows) {
    const bySpecies = new Map();

    for (const row of rows) {
        const id = Number(row.species_id);

        if (!bySpecies.has(id)) {
            bySpecies.set(id, { species_id: id, comname: row.comname || `species ${id}` });
        }
    }

    return [...bySpecies.values()]
        .sort((a, b) => a.comname.localeCompare(b.comname) || a.species_id - b.species_id)
        .map((entry, index) => ({ ...entry, class_index: index }));
}

/**
 * Every frame a build has to cut, per video, with the labels that belong on it.
 *
 * One pass over the selection produces the whole extraction plan, because ffmpeg cuts a
 * set of frames from one video in a single pass and the expensive thing is opening the
 * video, not the frames taken from it. A plan built per observation would open the same
 * video once per animal in it.
 *
 * **A frame carries every box visible in it**, not one. That is the same fact the split
 * rule is about, seen from the other side: if two observations share a frame, that
 * frame's label file has two lines, and writing one line per observation would produce
 * two images with the same name and one of them would win.
 *
 * Boxes are already normalised in `keyframes` -- `x`, `y`, `width`, `height` are
 * fractions of the frame -- which is YOLO's own format, so nothing is converted here.
 * `interpolateBox` is **not** used: it is the thumbnail path's, it returns a box only
 * between two keyframes, and this walks every frame of the span anyway.
 *
 * **Sampled when the build asks** (#296): only the frames picked for some object are cut,
 * and each picked frame still carries the box of every selected object in it -- an
 * unlabelled animal in a training image teaches the model it is background. Without
 * `sampling` this is every frame, exactly as it was.
 *
 * @param {Map<string, Array<Object>>} splits - From {@link assignSplits}.
 * @param {Array<Object>} classes - From {@link vocabulary}.
 * @param {?Object} [sampling] - From {@link samplingSettings}; null for every frame.
 * @returns {Map<string, {split: string, frames: Map<number, Array<string>>}>} Keyed by
 * video source; each frame number maps to its label lines.
 */
function extractionPlan(splits, classes, sampling = null) {
    const indexOf = new Map(classes.map((c) => [c.species_id, c.class_index]));
    const byVideo = new Map();

    /* Every frame picked for any object, per split and video. Splits are settled before
       this, so a picked frame is shared only with objects in the same split. */
    const chosen = new Map();

    if (sampling) {
        const picked = sampleFrames(splits, sampling);

        for (const [split, rows] of splits) {
            for (const row of rows) {
                const key = `${split}::${row.video_source}`;

                if (!chosen.has(key)) chosen.set(key, new Set());
                for (const frame of picked.get(Number(row.observation_id))) chosen.get(key).add(frame);
            }
        }

        for (const [key, frames] of chosen) chosen.set(key, [...frames].sort((a, b) => a - b));
    }

    for (const [split, rows] of splits) {
        for (const row of rows) {
            const key = `${split}::${row.video_source}`;

            if (!byVideo.has(key)) {
                byVideo.set(key, { split, video: row.video_source, frames: new Map() });
            }

            const plan = byVideo.get(key);
            const boxes = row.keyframes || [];
            const index = indexOf.get(Number(row.species_id));

            const first = Number(row.first_framenum);
            const last = Number(row.last_framenum);

            /* Sampled: the chosen frames this object's track reaches, whoever picked
               them. Otherwise every frame of the track. */
            const frames = sampling
                ? chosen.get(key).filter((frame) => frame >= first && frame <= last)
                : Array.from({ length: last - first + 1 }, (_, i) => first + i);

            for (const frame of frames) {
                const box = boxAt(boxes, frame);

                if (!box) continue;

                if (!plan.frames.has(frame)) plan.frames.set(frame, []);

                plan.frames.get(frame).push(
                    `${index} ${box.cx.toFixed(6)} ${box.cy.toFixed(6)} `
                    + `${box.w.toFixed(6)} ${box.h.toFixed(6)}`
                );
            }
        }
    }

    return byVideo;
}

/**
 * The box at one frame, interpolated between the keyframes either side of it.
 *
 * Returned as YOLO wants it -- centre, width, height, all fractions -- rather than as the
 * top-left corner the keyframe stores, because every caller here wants the former and
 * converting at the edge means converting once.
 *
 * Outside the keyframes' own range there is nothing to interpolate between and this
 * returns null rather than clamping: a box held still past the last keyframe is a claim
 * nobody made about where the animal was.
 *
 * @param {Array<Object>} boxes - The observation's keyframes, ascending by framenum.
 * @param {number} frame - The frame wanted.
 * @returns {?{cx: number, cy: number, w: number, h: number}} The box, or null.
 */
function boxAt(boxes, frame) {
    let before = null;
    let after = null;

    for (const box of boxes) {
        const at = Number(box.framenum);

        if (at <= frame && (!before || at > Number(before.framenum))) before = box;
        if (at >= frame && (!after || at < Number(after.framenum))) after = box;
    }

    if (!before || !after) return null;

    const span = Number(after.framenum) - Number(before.framenum);
    const t = span === 0 ? 0 : (frame - Number(before.framenum)) / span;
    const mix = (a, b) => Number(a) + (Number(b) - Number(a)) * t;

    /* **`x, y` is the centre already.** It is not the top-left, and this added half a
       width and half a height to it -- so every label written before 2026-10-21 was
       shifted half a box right and down, off the animal it was naming.

       `service/thumbnail-geometry.js` records the answer and how it was reached (F1):
       centre-origin, "confirmed three times in two other repositories and then confirmed
       by eye in the spike: the centre-origin box sits on the animal, the top-left box is
       shifted half a box right and down and contains bare rubble". The thumbnail path
       reads `box.x * sourceWidth` as the centre, and this now agrees with it.

       The real-video suite is what caught it, by asserting every coordinate lies in
       0..1 and finding 1.012 -- the overflow a doubled half-width produces at the right
       edge. No unit fixture would have: a box at 0.1 with width 0.2 is in range read
       either way, and only the edges disagree. */
    const cx = mix(before.x, after.x);
    const cy = mix(before.y, after.y);
    const w = mix(before.width, after.width);
    const h = mix(before.height, after.height);

    /* **Boxes do run off the edge** -- measured over 78 real keyframes they span
       [-0.0105, 1.0275] horizontally (thumbnail-geometry, F3). YOLO reads a box as the
       region of the image it is in, so the part outside the frame is not in the picture
       and must not be in the label. Clipped to the frame and re-centred on what is left,
       rather than clamped: clamping the centre keeps a width that reaches outside and
       describes a box bigger than the animal in view. */
    const left = Math.max(0, cx - w / 2);
    const right = Math.min(1, cx + w / 2);
    const top = Math.max(0, cy - h / 2);
    const bottom = Math.min(1, cy + h / 2);

    // Entirely outside the frame: nothing of it is in this picture to label.
    if (right <= left || bottom <= top) return null;

    return {
        cx: (left + right) / 2,
        cy: (top + bottom) / 2,
        w: right - left,
        h: bottom - top,
    };
}

/**
 * Where a split's pictures go in a CLASSIFICATION archive.
 *
 * **Not the same mapping as a detection archive, and the difference is the whole
 * reason this exists.** A detection archive names its directories in `data.yaml`, so
 * it can call the held-out split `eval` and tell Ultralytics where to look. A
 * classification archive has no `data.yaml` at all -- **the directory names are the
 * contract** -- and Ultralytics classify looks for `train`, `val` and `test`.
 *
 * So an archive built through the detection mapping would ship `train/` and `eval/`,
 * and classify would find no validation split whatever. `eval` and `validation` both
 * land in `val` here, which is what they have always meant.
 *
 * @constant
 * @type {Object<string, string>}
 */
const CLASSIFICATION_DIRECTORIES = {
    train: 'train',
    eval: 'val',
    validation: 'val',
    test: 'test',
};

/**
 * The directory one split writes into inside a classification archive.
 *
 * Refuses an unknown name rather than inventing one, for the reason the detection
 * side does: an unrecognised split is a request that cannot be honoured, and the
 * failure anybody wants is the build saying so rather than an archive quietly missing
 * a third of itself.
 *
 * @param {string} split - The split's name, as the builder sent it.
 * @returns {string} The directory inside the archive.
 * @throws {Error} When the name is not one a classification archive has a place for.
 */
function classificationDirectoryFor(split) {
    const directory = CLASSIFICATION_DIRECTORIES[split];

    if (!directory) {
        throw new Error(
            `"${split}" is not a split a classification archive has a place for; `
            + `it holds ${Object.keys(CLASSIFICATION_DIRECTORIES).join(', ')}`
        );
    }

    return directory;
}

/**
 * How many characters of the readable half a folder name keeps.
 *
 * The species id in front already makes the name unique, so this is purely about a
 * person reading a directory listing. 48 holds every name in the catalogue but the
 * longest few -- `Lost/ abandoned/ or irretrievable instrument/marker` is 51 -- and
 * the exact name is in `classes.json` either way.
 *
 * @constant
 * @type {number}
 */
const CLASS_SLUG_LENGTH = 48;

/**
 * The directory name one class gets inside a classification archive.
 *
 * **`<species_id>_<slug>`, because `species.comname` cannot be a directory name.**
 * Measured against the real catalogue rather than assumed, three things in that
 * column break a folder, and each produces an archive that looks correct:
 *
 * - **A slash is a path separator.** 37 of 1,404 names carry one, and the worst is
 *   not obscure: `Blue/Deacon Rockfish` has over five thousand observations. Written
 *   literally, `train/Blue/Deacon Rockfish/` is a folder `Blue` holding a folder
 *   `Deacon Rockfish`, and Ultralytics reads the class as **`Blue`**.
 * - **Case alone does not distinguish two directories** on Windows or macOS. `Fish`
 *   and `fish` are two species rows holding 194 and 124 observations, and they would
 *   train as one class with nothing in the archive to say so.
 * - **A trailing dot or space is silently stripped by Windows.** `UI Cancer sp.`
 *   becomes `UI Cancer sp`, which is no longer the name it is supposed to be.
 *
 * **The id leads, and that is what does the work.** It is unique by construction, so
 * the case collision and the stripped dot stop being special cases rather than being
 * handled as two more rules. The slug after it is for a person browsing the archive
 * and carries no meaning the build relies on.
 *
 * **The exact name is not lost; it moves.** `classes.json` beside the splits maps
 * every folder to its `species_id` and its untouched `comname`, so the archive still
 * states its vocabulary in MARP's own words -- as data a reader and a check can both
 * see, rather than as a convention encoded in directory names. Refusing these species
 * instead was the alternative, and it would have locked `Blue/Deacon Rockfish` out of
 * every classification dataset over a path separator.
 *
 * **The consequence travels with the model.** Ultralytics keeps no names list for a
 * classify dataset -- the folder names are the entire vocabulary -- so a model trained
 * on this archive reports `145_blue-deacon-rockfish`, and something on MARP's side has
 * to read it back through `classes.json` or through the id in front of it.
 *
 * @param {{species_id: number, comname: string}} entry - One class from
 * {@link vocabulary}.
 * @returns {string} A directory name that is safe on every filesystem MARP runs on,
 * and unique within the archive.
 */
function classFolderName(entry) {
    const slug = String(entry.comname == null ? '' : entry.comname)
        .toLowerCase()
        /* Everything outside a-z0-9 becomes a separator, which covers the slash, the
           colon, the quote and every accented letter in one rule rather than a list
           that would have to grow. */
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, CLASS_SLUG_LENGTH)
        /* Again after the cut: truncating mid-word can leave the separator at the end,
           and a trailing dash is the trailing-character problem this is avoiding. */
        .replace(/-+$/, '');

    /* A name with no letters or digits in it at all leaves the id alone, which is
       still a valid, unique directory. */
    return slug ? `${entry.species_id}_${slug}` : String(entry.species_id);
}

/**
 * The archive's `classes.json`: what each folder name actually means.
 *
 * **A classification archive has no `data.yaml`, so without this it states its own
 * vocabulary only in directory names** -- and those are encoded handles. This is the
 * file that makes the encoding reversible, and it is the archive's answer to "which
 * species is class `145_blue-deacon-rockfish`".
 *
 * **`task` and `crop_source` ride along so the archive is self-describing.** They are
 * on the `datasets` row as well, which is where MARP reads them; this copy is for
 * whoever is holding the tar without the database -- a second machine, an agent, a
 * year from now. The crop method especially: two classification datasets cut by
 * different rules are identical in every other respect, and a model is only traceable
 * to the pixels it learned from if something says which rule made them.
 *
 * @param {Array<Object>} classes - From {@link vocabulary}.
 * @param {string} cropSource - How the pictures were cut.
 * @returns {string} The file's contents, newline-terminated.
 */
function classesJson(classes, cropSource) {
    return `${JSON.stringify({
        task: 'classification',
        crop_source: cropSource,
        /* In class-index order, which is vocabulary order, so the file reads the same
           way twice for the same selection and a diff between two builds is about the
           species rather than about ordering. */
        classes: classes.map((entry) => ({
            folder: classFolderName(entry),
            species_id: entry.species_id,
            comname: entry.comname,
            class_index: entry.class_index,
        })),
    }, null, 2)}\n`;
}
/**
 * Every picture a classification build has to write, in one flat list.
 *
 * **One picture per annotated box, which is one per observation**, because that is
 * what a classification example is: a crop of a thing, labelled with what it is. The
 * detection side plans per video, since the cost there is opening the video; here
 * every picture already exists on disk as the mosaic tile a reviewer saw, so there is
 * nothing to batch and the flat list is the honest shape.
 *
 * **The split comes from `assignSplits`, unchanged and deliberately so.** A crop lands
 * in the split its frame landed in, so a detection model and a classification model
 * built from one selection are evaluated on the same held-out video. Splitting the
 * crops independently would put two crops of one frame on both sides, which is the
 * same leak the frame-based stratification exists to prevent -- and it would also mean
 * two models described as trained "on the same data" could not be compared at all.
 *
 * @param {Map<string, Array<Object>>} splits - From {@link assignSplits}.
 * @param {Array<Object>} classes - From {@link vocabulary}.
 * @returns {Array<{observation_id: number, split: string, directory: string,
 * folder: string, species_id: number, comname: string, class_index: number}>} In
 * split order, then observation order, so a build is deterministic and a test can
 * assert a list. `folder` is the encoded directory name and `comname` is the species
 * as MARP records it; the two differ on purpose and only `folder` reaches the disk.
 */
function classificationPlan(splits, classes) {
    const indexOf = new Map(classes.map((entry) => [entry.species_id, entry]));
    const wanted = [];

    for (const [split, rows] of splits) {
        const directory = classificationDirectoryFor(split);

        /* Sorted, so the same selection produces the same archive: `packageArchive`
           hashes the tar, and an archive whose file order wandered would get a new
           SHA-256 for a build that changed nothing. */
        const ordered = [...rows].sort((a, b) => a.observation_id - b.observation_id);

        for (const row of ordered) {
            const entry = indexOf.get(Number(row.species_id));

            /* The vocabulary is built from these same rows, so a row with no class is
               a selection that disagrees with itself rather than a case to skip. */
            if (!entry) {
                throw new Error(
                    `Observation ${row.observation_id} names species ${row.species_id}, `
                    + 'which is not in this build\'s vocabulary.'
                );
            }

            wanted.push({
                observation_id: Number(row.observation_id),
                split,
                directory,
                folder: classFolderName(entry),
                species_id: entry.species_id,
                comname: entry.comname,
                class_index: entry.class_index,
            });
        }
    }

    return wanted;
}

/**
 * How many frames a build takes from each object when the build flow does not say.
 *
 * **Every frame of a track is about 92 near-copies of one animal.** Dataset 391 cut
 * 155,258 images from 1,683 objects, and an epoch on it took 1 h 40 min. Ten frames
 * spread across a track keeps the poses and angles and drops the copies (#296).
 *
 * @constant
 * @type {number}
 */
const DEFAULT_FRAMES_PER_OBJECT = 10;

/** The largest seed a build records: a 31-bit integer, so it survives JSON and SQL. */
const MAX_SEED = 2147483647;

/**
 * The sampling a build asked for, checked and filled in.
 *
 * **Absent means every frame.** A spec queued before #296, retried or reclaimed, keeps
 * meaning what it meant, and *Duplicate setup* of an old dataset fills *Every frame*.
 * `frames_per_object: null` says the same thing out loud.
 *
 * **The seed is chosen here when none is given**, and then recorded, so a rebuild through
 * *Duplicate setup* picks the same frames.
 *
 * @param {?Object} asked - `{frames_per_object, balance_classes, seed}` from the request.
 * @param {Function} [random] - Where a new seed comes from; a test passes its own.
 * @returns {?{frames_per_object: number, balance_classes: boolean, seed: number}} The
 * settings, or null for every frame.
 * @throws {Error} A message naming what was wrong and what is allowed.
 */
function samplingSettings(asked, random = Math.random) {
    if (asked === undefined || asked === null) return null;

    if (typeof asked !== 'object' || Array.isArray(asked)) {
        throw new Error('sampling must be an object: {frames_per_object, balance_classes, seed}.');
    }

    const n = asked.frames_per_object;

    if (n === undefined || n === null) return null;

    if (!Number.isInteger(n) || n < 1) {
        throw new Error('sampling.frames_per_object must be a whole number of 1 or more, or null for every frame.');
    }

    if (asked.balance_classes !== undefined && typeof asked.balance_classes !== 'boolean') {
        throw new Error('sampling.balance_classes must be true or false.');
    }

    let seed = asked.seed;

    if (seed === undefined || seed === null) {
        seed = Math.floor(random() * MAX_SEED);
    } else if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
        throw new Error(`sampling.seed must be a whole number from 0 to ${MAX_SEED}.`);
    }

    return { frames_per_object: n, balance_classes: asked.balance_classes === true, seed };
}

/**
 * A random number generator for one object, from the build's seed and the object's id.
 *
 * **Per object, not one stream for the build.** One stream would make each object's picks
 * depend on how many objects came before it, so adding a query to a build would move the
 * frames of every object after it. Seeded by id, the same object picks the same frames
 * whatever else is in the build.
 *
 * FNV-1a to mix the two into 32 bits, then mulberry32: small, fast, and the same on every
 * machine, which `Math.random` is not.
 *
 * @param {number} seed - The build's seed.
 * @param {number} id - The observation.
 * @returns {function(): number} Numbers in [0, 1).
 */
function objectRandom(seed, id) {
    let hash = 0x811c9dc5;

    for (const ch of `${seed}:${id}`) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    let state = hash;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The frames of an object's track that have a box to label.
 *
 * Usually every frame from first to last; a frame whose box falls wholly outside the
 * picture has nothing to label, and is not a frame to pick.
 *
 * @param {Object} row - A selected observation.
 * @returns {Array<number>} Ascending.
 */
function framesWithBox(row) {
    const boxes = row.keyframes || [];
    const out = [];

    for (let frame = Number(row.first_framenum); frame <= Number(row.last_framenum); frame++) {
        if (boxAt(boxes, frame)) out.push(frame);
    }

    return out;
}

/**
 * Up to `n` frames spread across a track: one random frame from each of `n` equal stretches.
 *
 * **Spread, so the picks cover the whole track** -- the animal approaching, beside and
 * behind the camera -- **and random within each stretch**, so they are not evenly spaced
 * copies of one rhythm (decided with Isaac in #296). A track with `n` frames or fewer
 * gives all of them.
 *
 * @param {Array<number>} available - From {@link framesWithBox}.
 * @param {number} n - How many to take.
 * @param {function(): number} random - From {@link objectRandom}.
 * @returns {Array<number>} The picks, ascending.
 */
function pickFrames(available, n, random) {
    if (available.length <= n) return [...available];

    const picks = [];

    for (let i = 0; i < n; i++) {
        const lo = Math.floor((i * available.length) / n);
        const hi = Math.floor(((i + 1) * available.length) / n);

        picks.push(available[lo + Math.floor(random() * (hi - lo))]);
    }

    return picks;
}

/**
 * How many frames each object takes, per split.
 *
 * Without balancing, `n` each. **With it, every class aims for what the largest class gets
 * at `n` per object** (#296, *equal frames per class*), so a class with fewer objects takes
 * more frames from each. Balanced within each split, against that split's own largest
 * class, so validation and test are sampled the way train is (settled 2026-10-29, A2).
 *
 * A class's target is shared across its objects evenly, shortest track first: an object
 * that cannot give its share gives every frame it has, and the rest is spread over the
 * longer ones. A class whose tracks cannot reach the target gives everything.
 *
 * @param {Map<string, Array<Object>>} splits - Split name to its observations.
 * @param {Map<number, Array<number>>} available - Observation id to its frames with a box.
 * @param {{frames_per_object: number, balance_classes: boolean}} sampling - The settings.
 * @returns {Map<number, number>} Observation id to how many frames it takes.
 */
function quotas(splits, available, sampling) {
    const n = sampling.frames_per_object;
    const out = new Map();

    for (const rows of splits.values()) {
        if (!sampling.balance_classes) {
            for (const row of rows) out.set(Number(row.observation_id), n);
            continue;
        }

        const byClass = new Map();

        for (const row of rows) {
            const id = Number(row.species_id);

            if (!byClass.has(id)) byClass.set(id, []);
            byClass.get(id).push(row);
        }

        const length = (row) => available.get(Number(row.observation_id)).length;
        const atN = (members) => members.reduce((sum, row) => sum + Math.min(n, length(row)), 0);
        const target = Math.max(...[...byClass.values()].map(atN));

        for (const members of byClass.values()) {
            const ordered = [...members].sort((a, b) => length(a) - length(b)
                || Number(a.observation_id) - Number(b.observation_id));
            let remaining = target;

            ordered.forEach((row, index) => {
                const share = Math.ceil(remaining / (ordered.length - index));
                const take = Math.min(length(row), Math.max(0, share));

                out.set(Number(row.observation_id), take);
                remaining -= take;
            });
        }
    }

    return out;
}

/**
 * The frames picked for each object, when a build samples.
 *
 * @param {Map<string, Array<Object>>} splits - Split name to its observations.
 * @param {{frames_per_object: number, balance_classes: boolean, seed: number}} sampling -
 * From {@link samplingSettings}.
 * @returns {Map<number, Array<number>>} Observation id to its picked frames, ascending.
 */
function sampleFrames(splits, sampling) {
    const available = new Map();

    for (const rows of splits.values()) {
        for (const row of rows) available.set(Number(row.observation_id), framesWithBox(row));
    }

    const take = quotas(splits, available, sampling);
    const picked = new Map();

    for (const [id, frames] of available) {
        picked.set(id, pickFrames(frames, take.get(id), objectRandom(sampling.seed, id)));
    }

    return picked;
}

/**
 * What a build would cut, without cutting it: images in total, per split and per class.
 *
 * **The same plan the build runs**, so the estimate on the build flow is the plan rather
 * than a second calculation that could drift from it (#296). Per class counts images
 * holding the class, as the build's own tally does. `every_frame` is the same selection
 * without sampling, for "how many times fewer".
 *
 * @param {Map<string, Array<Object>>} splits - Split name to its observations.
 * @param {Array<Object>} classes - From {@link vocabulary}.
 * @param {?Object} sampling - From {@link samplingSettings}; null for every frame.
 * @returns {{observations: number, images: number, every_frame: number,
 * per_split: Object<string, number>, per_class: Array<Object>}}
 */
function estimateBuild(splits, classes, sampling) {
    const plan = extractionPlan(splits, classes, sampling);
    const perSplit = {};
    const perClass = new Map(classes.map((entry) => [entry.class_index, 0]));
    let images = 0;

    for (const entry of plan.values()) {
        perSplit[entry.split] = (perSplit[entry.split] || 0) + entry.frames.size;
        images += entry.frames.size;

        for (const lines of entry.frames.values()) {
            for (const klass of new Set(lines.map((line) => Number(line.split(' ')[0])))) {
                perClass.set(klass, (perClass.get(klass) || 0) + 1);
            }
        }
    }

    /* Every frame is counted as frames with a box, per split and video, rather than by
       building a second plan: the labels are not needed to count them. */
    let everyFrame = images;

    if (sampling) {
        const seen = new Map();

        for (const [split, rows] of splits) {
            for (const row of rows) {
                const key = `${split}::${row.video_source}`;

                if (!seen.has(key)) seen.set(key, new Set());
                for (const frame of framesWithBox(row)) seen.get(key).add(frame);
            }
        }

        everyFrame = [...seen.values()].reduce((sum, frames) => sum + frames.size, 0);
    }

    return {
        observations: [...splits.values()].reduce((sum, rows) => sum + rows.length, 0),
        images,
        every_frame: everyFrame,
        per_split: perSplit,
        per_class: classes.map((entry) => ({
            species_id: entry.species_id,
            comname: entry.comname,
            class_index: entry.class_index,
            images: perClass.get(entry.class_index) || 0,
        })),
    };
}

module.exports = {
    DEFAULT_FRAMES_PER_OBJECT,
    MAX_SEED,
    NEAR_MISS_FRAMES,
    CLASSIFICATION_DIRECTORIES,
    CLASS_SLUG_LENGTH,
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
    framesWithBox,
    objectRandom,
    pickFrames,
    sampleFrames,
    samplingSettings,
    vocabulary,
};
