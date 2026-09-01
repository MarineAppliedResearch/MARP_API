/**
 * Reads the seven annotation species lists out of `seed-data/species/lists/`
 * and turns them into rows shaped for the `species` table.
 *
 * These CSVs are the files the annotation GUI shipped and read directly, copied
 * here unchanged so the import has a checked-in source that can be diffed later.
 * They are read-only source material: the API becomes the place the lists are
 * edited, not these files.
 *
 * Shared between the import migration and its tests, so both agree on what the
 * files mean. Deliberately has no database dependency.
 *
 * Refs #52.
 *
 * @fileoverview Parses the annotation species list CSVs into species-table rows.
 * @author Isaac Travers
 * @module seed-data/species/species-source
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Directory holding the seven list CSVs.
 *
 * @constant
 * @type {string}
 */
const LISTS_DIR = path.join(__dirname, 'lists');

/**
 * Directory holding the species pictures, one subdirectory per list.
 *
 * @constant
 * @type {string}
 */
const IMAGES_DIR = path.join(__dirname, 'images');

/**
 * CSV header to `species` column. Two headers map to one column because the
 * lists are not consistent with each other: `GULF_Inverts` calls the scientific
 * name `Species_name`, and `MarineDebris` writes `ReportGroup` without the
 * underscore.
 *
 * @constant
 * @type {Object<string, string>}
 */
const CSV_TO_COLUMN = {
    taxserial: 'taxserial',
    COMNAME: 'comname',
    species: 'species',
    Species_name: 'species',
    Taxonomic_Level: 'taxonomic_level',
    Report_Group: 'report_group',
    ReportGroup: 'report_group',
    Observation_Type: 'observation_type',
    Depth_Min: 'depth_min',
    Depth_Max: 'depth_max',
    Habitat_Preference: 'habitat_preference',
    Region: 'region',
    Likelihood: 'likelihood',
    Max_Size: 'max_size',
    Record_Max: 'record_max',
    note: 'notes',
    GUI_HomeOrder: 'gui_home_order',
    GUI_MainTab: 'gui_maintab',
    GUI_SubTab: 'gui_subtab',
    GUI_MainTabOrder: 'gui_main_tab_order',
    GUI_SubTabOrder: 'gui_sub_tab_order',
    GUI_ItemOrder: 'gui_item_order',
    GUI_DisplayName: 'gui_display_name',
};

/**
 * Headers deliberately not imported, listed so a reader can tell "ignored on
 * purpose" from "forgotten". `COMNAME0`/`species0` and the two old-taxserial
 * columns are remnants of an earlier import; `typeTC`/`typeDive` appear only on
 * the Inverts list and nothing reads them.
 *
 * @constant
 * @type {Array<string>}
 */
const IGNORED_HEADERS = [
    'Old taxserial code',
    'Old taxserial (pre 2018)',
    'COMNAME0',
    'species0',
    'typeTC',
    'typeDive',
];

/** Columns parsed as integers. @constant @type {Array<string>} */
const INTEGER_COLUMNS = ['taxserial', 'max_size', 'record_max'];

/** Columns parsed as floats. @constant @type {Array<string>} */
const FLOAT_COLUMNS = ['depth_min', 'depth_max'];

/**
 * Lowest value a taxserial can take and still be a real ITIS serial. Below
 * this, taxserials are local codes invented per list -- and reused across
 * lists for unrelated things, which is why the list is part of a row's
 * identity.
 *
 * @constant
 * @type {number}
 */
const ITIS_MIN = 10000;

/**
 * Synthetic taxserial range used by the Habitat list for things that are not
 * taxa at all (`666001` Rock, `667001` TYPE 1). Six-digit, so they would
 * otherwise be mistaken for ITIS serials. Habitat also contains six genuine
 * ITIS serials, so this has to be a value range rather than a per-list rule.
 *
 * @constant
 * @type {Array<number>}
 */
const SYNTHETIC_TSN_RANGE = [666000, 667999];

/**
 * Parse CSV text into an array of row objects keyed by header.
 *
 * Hand-rolled rather than pulling in a dependency, but it does handle quoted
 * fields: 15 rows of `Inverts.csv` contain commas inside quotes, and splitting
 * on commas alone corrupts them.
 *
 * @param {string} text - Raw file contents.
 * @returns {Array<Object<string, string>>} One object per data row.
 */
function parseCsv(text) {
    /** @type {Array<Array<string>>} */
    const rows = [];
    /** @type {Array<string>} */
    let row = [];
    let field = '';
    let inQuotes = false;

    // Strip a UTF-8 BOM and normalise line endings before scanning, so the
    // state machine below only has to think about quotes and separators.
    const source = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];

        if (inQuotes) {
            if (char === '"') {
                // A doubled quote inside a quoted field is a literal quote.
                if (source[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    // Whatever is left after the last newline, unless the file ended cleanly.
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    if (rows.length === 0) {
        return [];
    }

    const headers = rows[0].map((header) => header.trim());

    return rows.slice(1).map((cells) => {
        /** @type {Object<string, string>} */
        const record = {};
        headers.forEach((header, index) => {
            if (header) {
                record[header] = (cells[index] || '').trim();
            }
        });
        return record;
    });
}

/**
 * Whether a taxserial is a real ITIS serial rather than a local code or one of
 * Habitat's synthetic values.
 *
 * @param {number} taxserial - Value to classify.
 * @returns {boolean} True when it can be treated as an ITIS TSN.
 */
function isItisTsn(taxserial) {
    if (!Number.isInteger(taxserial) || taxserial < ITIS_MIN) {
        return false;
    }
    return taxserial < SYNTHETIC_TSN_RANGE[0] || taxserial > SYNTHETIC_TSN_RANGE[1];
}

/**
 * Convert one parsed CSV row into `species` column values.
 *
 * @param {string} speciesList - Name of the list this row came from.
 * @param {Object<string, string>} csvRow - One row as returned by {@link parseCsv}.
 * @returns {Object} Column values, with blanks left as null.
 */
function toSpeciesRecord(speciesList, csvRow) {
    /** @type {Object} */
    const record = { species_list: speciesList };

    for (const [header, column] of Object.entries(CSV_TO_COLUMN)) {
        const raw = (csvRow[header] || '').trim();
        if (raw === '') {
            // Only set null if nothing has already filled this column via the
            // other header that maps to it (species / Species_name).
            if (!(column in record)) {
                record[column] = null;
            }
            continue;
        }

        if (INTEGER_COLUMNS.includes(column)) {
            const parsed = Number.parseInt(raw, 10);
            record[column] = Number.isNaN(parsed) ? null : parsed;
        } else if (FLOAT_COLUMNS.includes(column)) {
            const parsed = Number.parseFloat(raw);
            record[column] = Number.isNaN(parsed) ? null : parsed;
        } else {
            record[column] = raw;
        }
    }

    record.itis_tsn = isItisTsn(record.taxserial) ? record.taxserial : null;

    return record;
}

/**
 * Merge two records for the same `(list, taxserial)`, taking whichever copy has
 * a value for each column.
 *
 * Picking the "more complete" row would be wrong. The two `Inverts` duplicates
 * are complementary rather than one being a superset: for taxserial 57 one copy
 * carries the home placement and the depth/region/habitat attributes while the
 * other carries the tab placement, and choosing by field count drops the tab
 * placement, removing UI branched sponge from Other -> Sponge.
 *
 * @param {Object} into - Record merged so far; not mutated.
 * @param {Object} from - Record to merge in.
 * @returns {{record: Object, conflicts: Array<Object>}} Merged record, plus any
 * column where both copies had a different non-null value.
 */
function mergeRecords(into, from) {
    const record = { ...into };
    /** @type {Array<Object>} */
    const conflicts = [];

    for (const [column, value] of Object.entries(from)) {
        if (value === null || value === undefined) {
            continue;
        }
        if (record[column] === null || record[column] === undefined) {
            record[column] = value;
            continue;
        }
        if (record[column] !== value) {
            conflicts.push({ column, kept: record[column], discarded: value });
        }
    }

    return { record, conflicts };
}

/**
 * Read every list CSV and return import-ready rows.
 *
 * Fully-empty rows are skipped rather than imported: `MarineDebris.csv` has six
 * of them sitting between real entries as spacers, with no taxserial and no
 * display name, so they never appeared in the GUI either. They are reported
 * rather than dropped silently, so a genuinely half-filled row in future does
 * not vanish the same way.
 *
 * @param {Object} [options]
 * @param {string} [options.dir] - Directory to read; defaults to {@link LISTS_DIR}.
 * @returns {{records: Array<Object>, skippedEmpty: Array<Object>, merged: Array<Object>}}
 * `records` is one row per `(list, taxserial)`, `skippedEmpty` and `merged`
 * describe what the parse had to decide.
 */
function readSpeciesLists(options = {}) {
    const dir = options.dir || LISTS_DIR;

    /** @type {Map<string, Object>} */
    const byKey = new Map();
    /** @type {Array<Object>} */
    const skippedEmpty = [];
    /** @type {Array<Object>} */
    const merged = [];

    const files = fs.readdirSync(dir).filter((file) => file.toLowerCase().endsWith('.csv')).sort();

    for (const file of files) {
        const speciesList = path.basename(file, path.extname(file));
        const csvRows = parseCsv(fs.readFileSync(path.join(dir, file), 'utf8'));

        csvRows.forEach((csvRow, index) => {
            const hasAnyValue = Object.values(csvRow).some((value) => (value || '').trim() !== '');
            if (!hasAnyValue) {
                // +2 rather than +1: row 1 is the header, and this is the line
                // number somebody would look at in a spreadsheet.
                skippedEmpty.push({ speciesList, line: index + 2 });
                return;
            }

            const record = toSpeciesRecord(speciesList, csvRow);
            const key = `${speciesList} ${record.taxserial}`;
            const existing = byKey.get(key);

            if (!existing) {
                byKey.set(key, record);
                return;
            }

            const result = mergeRecords(existing, record);
            byKey.set(key, result.record);
            merged.push({
                speciesList,
                taxserial: record.taxserial,
                line: index + 2,
                conflicts: result.conflicts,
            });
        });
    }

    return { records: [...byKey.values()], skippedEmpty, merged };
}

module.exports = {
    LISTS_DIR,
    IMAGES_DIR,
    CSV_TO_COLUMN,
    IGNORED_HEADERS,
    ITIS_MIN,
    SYNTHETIC_TSN_RANGE,
    parseCsv,
    isItisTsn,
    toSpeciesRecord,
    mergeRecords,
    readSpeciesLists,
};
