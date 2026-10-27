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
 * **This map is not the whole answer any more, and must not be treated as one.**
 * A session type that names a list this map has never heard of still resolves,
 * against the database, by `speciesListNamed` on the ingest repository. See
 * *Adding a list without a deploy* below, which is #223 and is the reason.
 *
 * @fileoverview Session type to species list mapping.
 * @author Isaac Travers
 * @module db/species-lists
 */

'use strict';

/**
 * Maps a session's `type` onto the annotation list its observations belong to.
 *
 * Every entry here is a type whose name **differs** from its list, or predates
 * the convention below. Nothing new should need adding: see `speciesListNamed`.
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
    // FathomNet-family detectors classify morphotaxonomic groups rather than
    // species, so each model's vocabulary is its own list and needs its own
    // session type. `scripts/seed-morphotaxa-vocabulary.js` writes the rows and
    // says why a list per model rather than one shared one.
    //
    // **Only `MBARI_Benthic` is named here, and the other five are deliberately
    // absent.** Its list is called `MBARI_Benthic_Supercategory`, so the two
    // differ and nothing but this map can bridge them. `FathomNet_VME`,
    // `FathomNet_Trash`, `MBARI_315k`, `MBARI_Megalodon` and `NOAA_Sea_Urchin`
    // each name their list exactly, so they resolve against the database -- and
    // leaving them out is what keeps that path load-bearing rather than
    // decorative. If the fallback ever breaks, five live models stop ingesting
    // and somebody finds out at once, which is the opposite of #223.
    MBARI_Benthic: 'MBARI_Benthic_Supercategory',
});

/**
 * The species list a session type reads against, from the static map alone.
 *
 * Null rather than a default, because a default here would attribute an
 * observation to a list nobody chose. **Null does not mean "no such list"** --
 * it means this map does not name one, and the caller should ask the database.
 * `speciesListForSessionType` stays synchronous and pure so the SQL projection
 * in `repository/mosaic.repository.js` and this module's own tests can use it
 * without a connection.
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

/**
 * Maps a species list back onto the session type that reads it.
 *
 * **The forward map is not one-to-one, so this one has to choose.** `Invert` and
 * `Inverts` are both session types reading the `Inverts` list, and an inverse
 * derived mechanically would have no grounds to pick. `Invert` is named here
 * because it is the one the corpus and the ingest tests use; the other remains a
 * type MARP accepts, it is simply not the one MARP produces.
 *
 * Only lists whose name differs from their type need an entry, for the same
 * reason the forward map is short: everything else resolves by being called the
 * same thing. See `sessionTypeForSpeciesList`.
 *
 * @constant
 * @type {Object<string, string>}
 */
const SPECIES_LIST_TO_SESSION_TYPE = Object.freeze({
    Inverts: 'Invert',
    Substrate_60Seconds: 'Substrate60Second',
    MBARI_Benthic_Supercategory: 'MBARI_Benthic',
});

/**
 * The session type whose observations read against a given species list.
 *
 * **Falls back to the list's own name rather than to null**, which is the mirror
 * of `speciesListNamed` on the ingest repository and the same decision as #223: a
 * list seeded after this file was written names a type called the same thing, so
 * a new model needs a seeder run and nothing else. A list this map has never
 * heard of is therefore answered, not refused -- and if the answer is wrong, the
 * ingest refuses it at `checkSessionTypeAgainstModel`, which is the check that
 * can actually see the model.
 *
 * @param {string} speciesList - A `species.species_list` value.
 * @returns {string|null} The `sessions.type` to use, or null for a non-string.
 */
function sessionTypeForSpeciesList(speciesList) {
    if (typeof speciesList !== 'string' || speciesList.trim() === '') {
        return null;
    }

    const list = speciesList.trim();

    return SPECIES_LIST_TO_SESSION_TYPE[list] || list;
}

module.exports = {
    SESSION_TYPE_TO_SPECIES_LIST,
    SPECIES_LIST_TO_SESSION_TYPE,
    speciesListForSessionType,
    sessionTypeForSpeciesList,
};
