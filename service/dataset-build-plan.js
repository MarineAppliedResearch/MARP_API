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
 * @returns {Array<Array<Object>>} The groups, in the order their first row appeared.
 */
function connectedGroups(rows) {
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

        if (!current || !sameVideo || first > reach) {
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
 * **Groups are placed whole and largest first.** Whole, because that is the rule. Largest
 * first, because placing a 400-frame group after the quota is nearly full overshoots by
 * however much is left of it -- greedy-largest keeps the realised proportions close to
 * the requested ones, which taking them in arrival order does not.
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

    const ordered = groups
        .map((group) => ({ group, size: frames(group) }))
        .sort((a, b) => b.size - a.size || a.group[0].observation_id - b.group[0].observation_id);

    let placed = 0;

    for (const { group, size } of ordered) {
        /* Where does this group leave the realised shares closest to the requested ones?
           Measured after placing it, so a split that is already over its share stops
           attracting groups rather than being topped up to the end. */
        let best = null;
        let bestError = Infinity;

        for (const name of names) {
            const after = placed + size;
            const error = names.reduce((sum, other) => {
                const share = (held[other] + (other === name ? size : 0)) / (after || 1);

                return sum + Math.abs(share - want[other]);
            }, 0);

            if (error < bestError) {
                bestError = error;
                best = name;
            }
        }

        out.get(best).push(...group);
        held[best] += size;
        placed += size;
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
 * @param {Map<string, Array<Object>>} splits - From {@link assignSplits}.
 * @param {Array<Object>} classes - From {@link vocabulary}.
 * @returns {Map<string, {split: string, frames: Map<number, Array<string>>}>} Keyed by
 * video source; each frame number maps to its label lines.
 */
function extractionPlan(splits, classes) {
    const indexOf = new Map(classes.map((c) => [c.species_id, c.class_index]));
    const byVideo = new Map();

    for (const [split, rows] of splits) {
        for (const row of rows) {
            const key = `${split}::${row.video_source}`;

            if (!byVideo.has(key)) {
                byVideo.set(key, { split, video: row.video_source, frames: new Map() });
            }

            const plan = byVideo.get(key);
            const boxes = row.keyframes || [];
            const index = indexOf.get(Number(row.species_id));

            for (let frame = Number(row.first_framenum); frame <= Number(row.last_framenum); frame++) {
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

    const x = mix(before.x, after.x);
    const y = mix(before.y, after.y);
    const w = mix(before.width, after.width);
    const h = mix(before.height, after.height);

    return { cx: x + w / 2, cy: y + h / 2, w, h };
}

module.exports = {
    assignSplits,
    boxAt,
    connectedGroups,
    extractionPlan,
    vocabulary,
};
