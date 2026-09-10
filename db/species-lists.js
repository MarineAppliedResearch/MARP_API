/**
 * Which annotation list a session's observations were recorded against.
 *
 * `species` is partitioned into lists (`Fish`, `Inverts`, `GULF_Fish`, ...) and a
 * `taxserial` only identifies a species *within* a list: values below 10000 are
 * local codes invented per list and reused across lists. The only thing that
 * implies which list was in use is the owning session's `type`, so any code that
 * has to go from an observation to a species row needs this map.
 *
 * It first existed inside
 * `migrations/20260901120500-add-observations-species-id.js`, which keeps its own
 * copy on purpose: a migration is a record of what was run against a database on
 * a particular day, and importing a live module into one would let a later edit
 * here silently change what a past migration means.
 *
 * Two session types in the development database fall outside this (`InvertGULF`
 * and `Other`, two observations between them). They are reported rather than
 * guessed at -- `Other` genuinely does not say which list was in use.
 *
 * @fileoverview Session type to species list mapping.
 * @author Isaac Travers
 * @module db/species-lists
 */

'use strict';

/**
 * Maps a session's `type` onto the annotation list its observations belong to.
 *
 * @constant
 * @type {Object<string, string>}
 */
const SESSION_TYPE_TO_SPECIES_LIST = Object.freeze({
    Fish: 'Fish',
    Invert: 'Inverts',
    Inverts: 'Inverts',
    GULF_Fish: 'GULF_Fish',
    GULF_Inverts: 'GULF_Inverts',
    Habitat: 'Habitat',
    Substrate60Second: 'Substrate_60Seconds',
    MarineDebris: 'MarineDebris',
});

/**
 * The species list a session type reads against, or null when it does not say.
 *
 * Null rather than a default, because a default here would attribute an
 * observation to a list nobody chose.
 *
 * @param {string} sessionType - A `sessions.type` value.
 * @returns {string|null} The `species.species_list` value, or null.
 */
function speciesListForSessionType(sessionType) {
    if (typeof sessionType !== 'string') {
        return null;
    }

    return SESSION_TYPE_TO_SPECIES_LIST[sessionType.trim()] || null;
}

module.exports = {
    SESSION_TYPE_TO_SPECIES_LIST,
    speciesListForSessionType,
};
