/**
 * Cutting habitat stretches into segments (#342, decided 2026-11-10).
 *
 * Pure: no database. Each test names the decision it holds.
 *
 * @fileoverview Unit tests for service/habitat-segments.js.
 * @module tests/habitat-segments
 */

const { formatTimeSpan, deriveTc } = require('../db/timecode');
const { segmentsOf, matches } = require('../service/habitat-segments');

let nextId = 1;

/** An annotated stretch: clock start and end in seconds, in one file starting at `fileStart`. */
const stretch = (comname, startS, endS, { video = 'a.mp4', fileStart = 0 } = {}) => ({
    observation_id: nextId++,
    comname,
    actualPosition: formatTimeSpan(startS * 1000),
    mediaPosition: formatTimeSpan((startS - fileStart) * 1000),
    tc: deriveTc(startS * 1000),
    etc: deriveTc(endS * 1000),
    video_source: video,
});

const seconds = (segments) => segments.map((s) => [s.label, s.start_ms / 1000, s.end_ms / 1000]);

describe('habitat segments', () => {
    test('cut wherever any substrate starts or stops, each labelled with its combination', () => {
        // Mud 0-300 with Boulder 120-180 on top: three segments.
        const segments = segmentsOf([stretch('Mud', 0, 300), stretch('Boulder', 120, 180)]);
        expect(seconds(segments)).toEqual([['Mud', 0, 120], ['Mud + Boulder', 120, 180], ['Mud', 180, 300]]);
        expect(segments[1].length_ms).toBe(60000);
    });

    test('a segment names every stretch under it, so a review lands on them', () => {
        const mud = stretch('Mud', 0, 300);
        const boulder = stretch('Boulder', 120, 180);
        const [, both] = segmentsOf([mud, boulder]);
        expect(both.stretch_ids).toEqual([mud.observation_id, boulder.observation_id].sort((a, b) => a - b));
    });

    test('segments shorter than 2 seconds are left out', () => {
        // Sand ends at 61 and Rock starts at 60: a 1 s overlap, left out.
        const segments = segmentsOf([stretch('Sand', 0, 61), stretch('Rock', 60, 120)]);
        expect(seconds(segments)).toEqual([['Sand', 0, 60], ['Rock', 61, 120]]);
    });

    test('a gap no stretch covers is no segment', () => {
        expect(seconds(segmentsOf([stretch('Rock', 0, 30), stretch('Rock', 50, 90)]))).toEqual([['Rock', 0, 30], ['Rock', 50, 90]]);
    });

    test('one stretch ending as another of the same substrate begins is one segment', () => {
        expect(seconds(segmentsOf([stretch('Sand', 0, 40), stretch('Sand', 40, 90)]))).toEqual([['Sand', 0, 90]]);
    });

    test('the middle is placed in the video that holds it', () => {
        // Clock 0-200 in a.mp4, then b.mp4 starting at clock 200.
        const [segment] = segmentsOf([
            stretch('Rock', 100, 200, { video: 'a.mp4' }),
            stretch('Rock', 200, 400, { video: 'b.mp4', fileStart: 200 }),
        ]);
        expect([segment.start_ms, segment.end_ms]).toEqual([100000, 400000]);
        expect(segment.middle).toEqual({ video_source: 'b.mp4', media_ms: 50000 });
    });

    test('a stretch whose times do not read is left out rather than guessed at', () => {
        const broken = { ...stretch('Mud', 0, 60), etc: null };
        expect(segmentsOf([broken, stretch('Rock', 0, 60)]).map((s) => s.label)).toEqual(['Rock']);
    });
});

describe('the substrate filter', () => {
    const segment = { substrates: ['Boulder', 'Mud'] };

    test('includes all of these', () => {
        expect(matches(segment, { substrates: ['Mud'], mode: 'all' })).toBe(true);
        expect(matches(segment, { substrates: ['Mud', 'Boulder'], mode: 'all' })).toBe(true);
        expect(matches(segment, { substrates: ['Mud', 'Sand'], mode: 'all' })).toBe(false);
    });

    test('exactly these: "Mud alone" is exactly Mud', () => {
        expect(matches(segment, { substrates: ['Mud'], mode: 'exactly' })).toBe(false);
        expect(matches(segment, { substrates: ['Boulder', 'Mud'], mode: 'exactly' })).toBe(true);
        expect(matches({ substrates: ['Mud'] }, { substrates: ['Mud'], mode: 'exactly' })).toBe(true);
    });

    test('any of these', () => {
        expect(matches(segment, { substrates: ['Sand', 'Boulder'], mode: 'any' })).toBe(true);
        expect(matches(segment, { substrates: ['Sand', 'Rock'], mode: 'any' })).toBe(false);
    });

    test('nothing chosen matches everything', () => {
        expect(matches(segment, { substrates: [] })).toBe(true);
    });
});
