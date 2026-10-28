/**
 * The top bar says which code is answering.
 *
 * **A server serves the code it was started with, not the code on your branch.** One here
 * ran five days behind its checkout for a day without anybody noticing, and the evidence
 * looked like a defect in the feature somebody had just written -- twice, the second time
 * against a process nineteen hours old. The checkout cannot answer that question, because
 * the checkout has moved on; only the process knows, so MARP reads it once at startup and
 * the bar shows it passively.
 *
 * **The cases that matter are the unhappy ones**, and they are what most of this file is:
 * a MARP too old to carry `server` at all, and a MARP that carries it with a null commit
 * because git could not answer. Both must leave the label *absent* rather than drawing
 * "unknown" or an empty parenthesis -- a label nobody can trust is worse than no label,
 * which is the same rule the freshness control beside it already follows.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

/** A session answer carrying whatever `server` block the test is about. */
const sessionWith = (server) => async () => ({
    user: { user_id: 1, username: 'jest-reader', permissions: ['jobs:read'] },
    ...(server === undefined ? {} : { server }),
});

/**
 * Draw a screen whose session answer is ours, and hand back the label.
 *
 * @param {Object} t - The test, for its `after` hook.
 * @param {Object|undefined} server - The `server` block MARP returns, or undefined.
 * @returns {Promise<{label: Element|null, screen: Object}>}
 */
async function barWith(t, server) {
    const screen = await drawScreen('jobs.html', { whoAmI: sessionWith(server) });

    t.after(screen.close);

    // The fill is asynchronous and deliberately not awaited by the chrome.
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    return { screen, label: screen.document.querySelector('[data-server-started]') };
}

test('says when the API started, with the commit in its title', async (t) => {
    const startedAt = new Date(Date.now() - 90 * 1000).toISOString();
    const commit = '75891cc374e9db6e9f8e161f8a080be80693e3a4';
    const { label } = await barWith(t, { started_at: startedAt, commit });

    assert.ok(label, 'the bar carries a place for it');
    assert.equal(label.hidden, false, 'and shows it once MARP has answered');
    assert.match(label.textContent, /^API started /);

    // Within the day it borrows the freshness label's own vocabulary, so the two
    // beside each other read as one thought rather than two clocks.
    assert.match(label.textContent, /2m ago$/);

    // **The commit is in the title, not the label.** The question people ask is
    // "is this current", not "which hash".
    assert.ok(label.title.includes(commit), 'the commit is reachable');
    assert.ok(!label.textContent.includes(commit), 'but not in the way');
});

test('shows a date once the server is more than a day old, which is the whole point', async (t) => {
    // 127h ago is arithmetic the reader has to do, and this label exists for exactly
    // the server that has been up for days.
    const startedAt = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
    const { label } = await barWith(t, { started_at: startedAt, commit: 'a'.repeat(40) });

    assert.equal(label.hidden, false);
    assert.ok(!/ago/.test(label.textContent), `a date, not an age: ${label.textContent}`);
});

test('says the commit is unknown rather than drawing an empty one', async (t) => {
    // A deployed copy with no .git, or no git on PATH. MARP sends null rather than a
    // guess, and the title has to say so in words.
    const { label } = await barWith(t, { started_at: new Date().toISOString(), commit: null });

    assert.equal(label.hidden, false, 'when it started is still worth saying');
    assert.match(label.title, /unknown/i);
    assert.ok(!label.title.includes('null'), 'and not by printing the word null');
});

test('stays hidden against a MARP that does not carry it', async (t) => {
    // An older coordinator, or one this app is pointed at across a version gap. The
    // label is absent rather than drawn empty.
    const { label } = await barWith(t, undefined);

    assert.ok(label, 'the element is still in the bar');
    assert.equal(label.hidden, true, 'but says nothing');
    assert.equal(label.textContent, '');
});

test('stays hidden when the session read fails outright', async (t) => {
    // Signed out, or MARP not answering. The chrome must not be what breaks a page.
    const screen = await drawScreen('jobs.html', {
        whoAmI: async () => { throw Object.assign(new Error('no answer'), { status: 503 }); },
    });

    t.after(screen.close);
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    const label = screen.document.querySelector('[data-server-started]');

    assert.equal(label.hidden, true);
});
