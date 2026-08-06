/**
 * Unit tests for Scheduler#_locateFrameIndex -- the pure frame-lookup
 * math shared by every render-loop tick, step, and seek.
 *
 * Only this one method is covered here: the rest of Scheduler (play/pause
 * pacing, lookahead prefetch, seek races) depends on requestAnimationFrame,
 * performance.now(), and real decoded segments, and is exercised instead
 * by the E2E suite against the real running engine.
 *
 * @fileoverview Unit tests for Scheduler's frame-locating logic.
 * @author Isaac Travers
 * @module video-engine/test/unit/scheduler.test
 */

const { Scheduler } = require('../../src/scheduler.js');

/**
 * Builds a Scheduler with the minimal fakes its constructor needs, none of
 * which are exercised by the pure frame-locating logic under test here.
 *
 * @returns {Scheduler} A Scheduler instance safe to call `_locateFrameIndex` on.
 */
function makeScheduler() {
    return new Scheduler({
        segmentIndex: { totalDuration: 0, segments: [] },
        frameStore: { buffers: new Map() },
        canvasRenderer: { onFramePresented: () => {}, canvas: { width: 0, height: 0 } },
        emit: () => {},
    });
}

describe('Scheduler#_locateFrameIndex', () => {
    // Whole-microsecond timestamps, matching how the real demuxer always
    // stores them (see demuxer.js's Math.round(... * 1e6)).
    const gopBuffer = {
        frames: [{ timestamp: 0 }, { timestamp: 1_000_000 }, { timestamp: 2_000_000 }],
    };

    test('atOrBefore lands on the exact frame when the target matches a timestamp exactly', () => {
        const scheduler = makeScheduler();
        expect(scheduler._locateFrameIndex(gopBuffer, 1.0, 'atOrBefore')).toBe(1);
    });

    test('atOrBefore lands on the earlier frame when the target falls between two frames', () => {
        const scheduler = makeScheduler();
        expect(scheduler._locateFrameIndex(gopBuffer, 1.5, 'atOrBefore')).toBe(1);
    });

    test('atOrAfter lands on the exact frame when the target matches a timestamp exactly', () => {
        const scheduler = makeScheduler();
        expect(scheduler._locateFrameIndex(gopBuffer, 1.0, 'atOrAfter')).toBe(1);
    });

    test('atOrAfter lands on the later frame when the target falls between two frames', () => {
        const scheduler = makeScheduler();
        expect(scheduler._locateFrameIndex(gopBuffer, 1.5, 'atOrAfter')).toBe(2);
    });

    test('atOrAfter is not thrown off by a sub-microsecond float overshoot past an exact frame timestamp', () => {
        // Regression guard: repeated +-1/fps arithmetic on targetTimeSeconds
        // can leave it a fraction of a microsecond past an exact frame
        // timestamp -- harmless for atOrBefore, but silently breaks a
        // naive atOrAfter ('>=') comparison exactly on the target frame.
        const scheduler = makeScheduler();
        const justPastOneSecond = 1.0000000004;
        expect(scheduler._locateFrameIndex(gopBuffer, justPastOneSecond, 'atOrAfter')).toBe(1);
    });
});
