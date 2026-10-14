/** Pure validation and ordering rules for the shared review-imagery cache. */

'use strict';

const EVICTION_ORDERS = ['full_frames_first', 'oldest_first', 'thumbnails_first'];

function validateSettings({ maxBytes, lowWatermarkPercent, evictionOrder }) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new TypeError('maxBytes must be a positive safe integer.');
    }
    if (!Number.isInteger(lowWatermarkPercent)
        || lowWatermarkPercent < 50 || lowWatermarkPercent > 99) {
        throw new TypeError('lowWatermarkPercent must be an integer from 50 through 99.');
    }
    if (!EVICTION_ORDERS.includes(evictionOrder)) {
        throw new TypeError(`evictionOrder must be one of ${EVICTION_ORDERS.join(', ')}.`);
    }
    return { maxBytes, lowWatermarkPercent, evictionOrder };
}

function lowWatermarkBytes(maxBytes, percent) {
    return Math.floor((maxBytes * percent) / 100);
}

function orderEvictionCandidates(candidates, order) {
    const rank = (item) => {
        if (order === 'oldest_first') return 0;
        if (order === 'thumbnails_first') return item.kind === 'thumbnail' ? 0 : 1;
        return item.kind === 'full_frame' ? 0 : 1;
    };
    const time = (item) => new Date(item.accessed_at || 0).getTime();

    return [...candidates].sort((a, b) => rank(a) - rank(b)
        || time(a) - time(b)
        || a.observation_id - b.observation_id
        || a.kind.localeCompare(b.kind));
}

module.exports = {
    EVICTION_ORDERS,
    lowWatermarkBytes,
    orderEvictionCandidates,
    validateSettings,
};
