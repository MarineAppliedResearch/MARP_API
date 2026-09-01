/**
 * Unit tests for the timecode arithmetic in `db/timecode.js`.
 *
 * Pure functions over strings and numbers, so no database and no fixtures. They are
 * here because every bug this work produced lived in exactly these few lines, and
 * each one was found by accident rather than by testing:
 *
 * - parsing ticks with a rounding division instead of a truncating one moved 7,501
 *   frame indices by one and carried `.9995` into the next whole second
 * - `formatTimeSpan` wrote `-17:36:09.0800000` that `parseTimeSpan` could not read,
 *   so once a shift pushed positions negative nothing could touch those rows
 *
 * Both are asserted below, by value, so neither can come back.
 *
 * @fileoverview Unit tests for timecode parsing, formatting and derivation.
 * @author Isaac Travers
 * @module tests/timecode
 */

const {
    ASSUMED_FPS,
    parseTimeSpan,
    formatTimeSpan,
    deriveTc,
    deriveFrame,
    absoluteFrame,
    shiftTruncated,
    classifyRow,
} = require('../db/timecode');

describe('parseTimeSpan', () => {

    it('reads the shapes the observation columns actually hold', () => {
        expect(parseTimeSpan('00:00:00')).toBe(0);
        expect(parseTimeSpan('00:15:01')).toBe(901000);
        expect(parseTimeSpan('00:15:01.4400000')).toBe(901440);
        expect(parseTimeSpan('21:12:28.3600000')).toBe(76348360);
    });

    it('reads the day prefix a rollover produces', () => {
        expect(parseTimeSpan('1.00:00:05.0000000')).toBe(86405000);
        expect(parseTimeSpan('1.01:27:47.0000000')).toBe(91667000);
    });

    /**
     * TimeSpan.Milliseconds truncates ticks. Rounding here is not a rounding error,
     * it is a different frame: `.7596838` is 759 ms and frame 18, but 760 ms and
     * frame 19. That difference showed up on 7,501 rows.
     */
    it('truncates ticks to whole milliseconds rather than rounding', () => {
        expect(parseTimeSpan('00:00:00.7596838')).toBe(759);
        expect(parseTimeSpan('00:00:00.7600000')).toBe(760);
    });

    /**
     * The same truncation at a second boundary. Rounding `.9995390` up to 1000 ms
     * would carry into the next whole second and change the derived timecode.
     */
    it('does not carry a sub-millisecond fraction into the next second', () => {
        expect(parseTimeSpan('21:03:18.9995390')).toBe(75798999);
        expect(deriveTc(parseTimeSpan('21:03:18.9995390'))).toBe('21:03:18');
    });

    it('reads a negative value, with or without a day part', () => {
        expect(parseTimeSpan('-17:36:09.0800000')).toBe(-63369080);
        expect(parseTimeSpan('-1.00:00:05.0000000')).toBe(-86405000);
    });

    it('returns null for anything it cannot read, rather than guessing', () => {
        expect(parseTimeSpan(null)).toBeNull();
        expect(parseTimeSpan('')).toBeNull();
        expect(parseTimeSpan('1')).toBeNull();
        expect(parseTimeSpan('2016:22')).toBeNull();
        expect(parseTimeSpan('14:29:50.')).toBeNull();
        expect(parseTimeSpan('not a time')).toBeNull();
    });
});

describe('formatTimeSpan', () => {

    it('writes what TimeSpan.ToString() writes', () => {
        expect(formatTimeSpan(0)).toBe('00:00:00.0000000');
        expect(formatTimeSpan(901440)).toBe('00:15:01.4400000');
        expect(formatTimeSpan(76348360)).toBe('21:12:28.3600000');
    });

    it('adds a day part only past 24 hours', () => {
        expect(formatTimeSpan(86399000)).toBe('23:59:59.0000000');
        expect(formatTimeSpan(86405000)).toBe('1.00:00:05.0000000');
    });

    /**
     * The round trip is the contract. A shift can push a position negative, and a
     * value this module writes but cannot read makes those rows untouchable -- which
     * is exactly what happened to a session shifted by 18 hours.
     */
    it('round trips through parseTimeSpan, including negatives', () => {
        const values = [
            '00:00:00.0000000',
            '00:15:01.4400000',
            '21:12:28.3600000',
            '1.00:00:05.0000000',
            '-17:36:09.0800000',
            '-1.00:00:05.0000000',
        ];

        for (const value of values) {
            expect(formatTimeSpan(parseTimeSpan(value))).toBe(value);
        }
    });
});

describe('deriveTc', () => {

    it('truncates at the second, the way the GUI does when recording', () => {
        expect(deriveTc(parseTimeSpan('21:12:28.3600000'))).toBe('21:12:28');
        expect(deriveTc(parseTimeSpan('21:12:28.9990000'))).toBe('21:12:28');
    });

    /**
     * The old GUI took everything before the *first* dot, which turned
     * `1.00:00:59.61` into `1`. There are 34 such rows. Splitting on the last dot
     * keeps the day, which is what the current code does and what this preserves.
     */
    it('keeps the day part instead of collapsing to it', () => {
        expect(deriveTc(parseTimeSpan('1.00:00:59.6196065'))).toBe('1.00:00:59');
    });
});

describe('deriveFrame and absoluteFrame', () => {

    /**
     * Two different quantities that both get called a frame. `observations.frame` is
     * the sub-second index; `keyframes.framenum` is absolute. Conflating them is how
     * an earlier version of this work nearly rewrote the wrong column.
     */
    it('derives the sub-second index, 0 to 24', () => {
        expect(deriveFrame(parseTimeSpan('21:12:28.0000000'))).toBe('0');
        expect(deriveFrame(parseTimeSpan('21:12:28.3600000'))).toBe('9');
        expect(deriveFrame(parseTimeSpan('21:12:28.9600000'))).toBe(String(ASSUMED_FPS - 1));
    });

    it('derives the absolute frame from a media position', () => {
        expect(absoluteFrame(parseTimeSpan('00:00:00.0000000'))).toBe(0);
        expect(absoluteFrame(parseTimeSpan('00:01:10.3200000'))).toBe(1758);
        expect(absoluteFrame(parseTimeSpan('00:04:13.9200000'))).toBe(6348);
    });

    it('keeps a sub-second index in range for a negative time', () => {
        const frame = Number(deriveFrame(parseTimeSpan('-00:00:00.3600000')));

        expect(frame).toBeGreaterThanOrEqual(0);
        expect(frame).toBeLessThan(ASSUMED_FPS);
    });
});

describe('shiftTruncated', () => {

    /**
     * `etc` has no sub-second part and no stored position of its own, so a shift
     * smaller than a second cannot move it. That is its recorded resolution, not a
     * bug, and a caller should not expect otherwise.
     */
    it('leaves a whole-second value alone for a sub-second shift', () => {
        expect(shiftTruncated('20:23:34', 120)).toBe('20:23:34');
    });

    it('moves it for a shift of a second or more', () => {
        expect(shiftTruncated('20:23:34', 3000)).toBe('20:23:37');
        expect(shiftTruncated('20:23:34', -4000)).toBe('20:23:30');
    });

    it('hands back anything it cannot read, unchanged', () => {
        expect(shiftTruncated('1', 120)).toBe('1');
        expect(shiftTruncated(null, 120)).toBeNull();
        expect(shiftTruncated('', 120)).toBe('');
    });
});

describe('classifyRow', () => {

    it('recognises a row this arithmetic produced', () => {
        const verdict = classifyRow({
            mediaPosition: '00:01:10.3200000',
            actualPosition: '20:20:31.2800000',
            tc: '20:20:31',
            frame: '7',
        });

        expect(verdict.readable).toBe(true);
        expect(verdict.tcDerivable).toBe(true);
        expect(verdict.frameDerivable).toBe(true);
    });

    /**
     * The DaVinci Resolve era left frame values like '06', zero-padded, that no
     * formula here produces. Those must be reported as not derivable so a correction
     * leaves them exactly as recorded rather than replacing them with a guess.
     */
    it('recognises a frame value something else wrote', () => {
        const verdict = classifyRow({
            mediaPosition: '00:05:04.8358594',
            actualPosition: '14:37:11.8074885',
            tc: '14:37:11',
            frame: '06',
        });

        expect(verdict.tcDerivable).toBe(true);
        expect(verdict.frameDerivable).toBe(false);
    });

    it('recognises a timecode that lost its day part', () => {
        const verdict = classifyRow({
            mediaPosition: '00:10:51.0778676',
            actualPosition: '1.00:00:16.1852746',
            tc: '00:00:16',
            frame: '4',
        });

        expect(verdict.tcDerivable).toBe(false);
    });

    it('reports an unreadable row rather than throwing', () => {
        const verdict = classifyRow({
            mediaPosition: null,
            actualPosition: null,
            tc: null,
            frame: null,
        });

        expect(verdict.readable).toBe(false);
        expect(verdict.actualMs).toBeNull();
    });
});
