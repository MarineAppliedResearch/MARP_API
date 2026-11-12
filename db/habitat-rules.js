/**
 * A habitat model's decision rules: how its per-frame scores become habitat stretches (#287).
 *
 * Settled with Isaac on 2026-11-10 (MARP_API#287, question 3): the rules are stored with the
 * model in MARP, shown on the Models screen, and sent to the worker with every run, so one can
 * be changed later -- Mud's raise, say -- without retraining.
 *
 * Two parts, from two places:
 *
 * - **What training decided**, published by the trainer: the substrates in output order, the
 *   cut-off for each picked on the tuning dives, the crop it was trained on and its input size.
 *   The crop is kept because a later change of the habitat crop must not break an older model.
 * - **The stretch rules**, settled on the feasibility runs and kept here as defaults: 3 frames
 *   a second, scores averaged over 1 s, Mud's cut-off raised by 0.2, at most one of Mud, Sand
 *   and Gravel at a time, stretches at least 2 s, breaks of 2 s or less bridged.
 *
 * Pure: no database. The registry stores what `rulesForModel` returns; a lease sends what
 * `rulesForRun` returns.
 *
 * @fileoverview Validating, storing and applying a habitat model's decision rules.
 * @module db/habitat-rules
 */

'use strict';

/** The rules' shape, so a stored set can be recognised and moved on later. */
const RULES_VERSION = 1;

/** The stretch rules settled on #287, applied unless a model's stored rules say otherwise. */
const SETTLED = Object.freeze({
    samples_per_second: 3,
    average_s: 1,
    raise: Object.freeze({ Mud: 0.2 }),
    // Mud, Sand and Gravel never overlap (Isaac, 2026-11-10, A18): one group, applied to
    // whichever of them a model has.
    exclusive: Object.freeze([Object.freeze(['Mud', 'Sand', 'Gravel'])]),
    min_stretch_s: 2,
    bridge_s: 2,
});

/** A cut-off is never raised past this, as on the feasibility runs. */
const MAX_CUT_OFF = 0.95;

/** The artifact role the trainer publishes its half of the rules under. */
const RULES_ROLE = 'decision_rules';

/** Thrown for a rules file that cannot be stored as it stands. */
class HabitatRulesError extends Error {}

const refuse = (message) => { throw new HabitatRulesError(message); };
const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * The rules to store for a newly trained habitat model.
 *
 * @param {Object} published - The trainer's `decision_rules` file: `{ substrates, cut_offs,
 *   crop: {x0, y0, x1, y1}, input_size }`.
 * @param {string[]} classNames - The dataset's substrates in class order, which the model's
 *   outputs follow.
 * @returns {Object} The rules, settled stretch rules included.
 * @throws {HabitatRulesError} When the file does not describe this model.
 */
function rulesForModel(published, classNames) {
    if (!published || typeof published !== 'object') refuse('the trainer published no decision rules');

    const substrates = published.substrates;
    if (!Array.isArray(substrates) || substrates.join('|') !== classNames.join('|')) {
        refuse(`the rules name substrates ${JSON.stringify(substrates)}, but the model was trained on `
            + `${JSON.stringify(classNames)} in that order`);
    }

    const cutOffs = published.cut_offs || {};
    for (const name of substrates) {
        if (!isFraction(cutOffs[name])) refuse(`the cut-off for ${name} is ${JSON.stringify(cutOffs[name])}, not a number from 0 to 1`);
    }

    const crop = published.crop || {};
    if (![crop.x0, crop.y0, crop.x1, crop.y1].every(isFraction) || crop.x0 >= crop.x1 || crop.y0 >= crop.y1) {
        refuse(`the crop ${JSON.stringify(published.crop)} is not a box inside the frame`);
    }

    const size = published.input_size;
    if (!Number.isInteger(size) || size <= 0) refuse(`the input size ${JSON.stringify(size)} is not a whole number of pixels`);

    return {
        version: RULES_VERSION,
        substrates: [...substrates],
        tuned_cut_offs: Object.fromEntries(substrates.map((n) => [n, cutOffs[n]])),
        crop: { x0: crop.x0, y0: crop.y0, x1: crop.x1, y1: crop.y1 },
        input_size: size,
        samples_per_second: SETTLED.samples_per_second,
        average_s: SETTLED.average_s,
        raise: { ...SETTLED.raise },
        exclusive: SETTLED.exclusive.map((group) => [...group]),
        min_stretch_s: SETTLED.min_stretch_s,
        bridge_s: SETTLED.bridge_s,
    };
}

/**
 * The cut-off each substrate is judged by: tuned, plus its raise, at most 0.95.
 *
 * @param {Object} rules - Stored rules.
 * @returns {Object} Substrate to cut-off.
 */
function effectiveCutOffs(rules) {
    const raise = rules.raise || {};
    return Object.fromEntries(rules.substrates.map((name) => [
        name,
        Math.round(Math.min(rules.tuned_cut_offs[name] + (raise[name] || 0), MAX_CUT_OFF) * 1e6) / 1e6,
    ]));
}

/**
 * What a run is sent: the stored rules with each substrate's effective cut-off worked out, so
 * the worker applies exactly what MARP shows and does no arithmetic of its own on them.
 *
 * @param {Object} rules - Stored rules.
 * @returns {Object} The rules plus `cut_offs`.
 */
function rulesForRun(rules) {
    // A group is stored whole (Mud, Sand, Gravel) and applied to whichever of them the model
    // has, so a run is sent only those; a group left with one member constrains nothing.
    const exclusive = (rules.exclusive || [])
        .map((group) => group.filter((name) => rules.substrates.includes(name)))
        .filter((group) => group.length > 1);
    return { ...rules, exclusive, cut_offs: effectiveCutOffs(rules) };
}

/**
 * A model's rules with its never-together groups replaced, as a person sets them on the
 * Models screen (#287, R9; Isaac, 2026-11-10: editable, per model).
 *
 * A group names two or more substrates of which at most one may be present at a moment. A
 * name may be one of the model's substrates or one the settled groups know of that the model
 * lacks (Gravel), so a group can be stored whole before the model can see all of it.
 *
 * @param {Object} rules - Stored rules.
 * @param {Array<Array<string>>} groups - The groups to store; an empty list means none.
 * @returns {Object} The rules with `exclusive` replaced.
 * @throws {HabitatRulesError} When a group is not two or more distinct known names.
 */
function withExclusive(rules, groups) {
    if (!Array.isArray(groups)) refuse('the never-together groups must be a list of lists of substrates');
    const known = new Set([...rules.substrates, ...SETTLED.exclusive.flat()]);
    const clean = groups.map((group) => {
        if (!Array.isArray(group) || group.length < 2) refuse(`a never-together group needs two or more substrates, not ${JSON.stringify(group)}`);
        const unknown = group.filter((name) => !known.has(name));
        if (unknown.length) refuse(`${unknown.join(', ')} is not a substrate this model or the settled groups know`);
        if (new Set(group).size !== group.length) refuse(`a substrate appears twice in ${JSON.stringify(group)}`);
        return [...group];
    });
    return { ...rules, exclusive: clean };
}

module.exports = {
    RULES_VERSION,
    RULES_ROLE,
    SETTLED,
    MAX_CUT_OFF,
    HabitatRulesError,
    rulesForModel,
    effectiveCutOffs,
    rulesForRun,
    withExclusive,
};
