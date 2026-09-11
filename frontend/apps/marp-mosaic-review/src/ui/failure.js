/**
 * What the reviewer is told when a call did not work.
 *
 * **Three distinct states, and none of them is presented as one of the others** (A4, R20).
 * #68 names this explicitly, and the fixture could not model any of it — so before this
 * the client had exactly one failure, "the commit could not be saved", standing in for
 * three situations with three different answers:
 *
 * | | What happened | What the reviewer should do |
 * | --- | --- | --- |
 * | **expired** | the seven-day session cookie lapsed | sign in again — *here*, so the page survives |
 * | **refused** | the account lacks the permission | nothing. Retrying is cruel, so it is not offered |
 * | **failed** | a dropped socket, a 5xx, DNS | try again |
 *
 * **None of them discards a mark.** That is the part that matters most and it is why the
 * expired panel does not navigate: marks, outcomes and pinned pages are deliberately not
 * persisted — the app's `CLAUDE.md`, *The question persists; the work in progress does
 * not* — so a redirect to a login page would cost the reviewer their uncommitted page.
 * Signing in happens in a new tab and the reviewer comes back to exactly what they left.
 *
 * `request` is the fourth kind and it is not a reviewer-facing state: a 400 is a defect in
 * this client. It is shown anyway rather than swallowed, because a silent 400 is how a
 * filter comes to narrow nothing without anybody noticing.
 */
import { state, actions } from '../store.js';
import { FAILURE } from '../api/errors.js';
import { $, ICON } from './dom.js';

/** Where the login page is. The only address this file knows, and it is not the API. */
const LOGIN = '/';

/**
 * The panel for one kind of failure.
 *
 * Each one says what happened, what it means for the work on screen, and offers exactly
 * the actions that can help — which for `refused` is none.
 */
function panelFor(failure) {
  const marksSafe = '<p class="keep">Nothing you have marked on this page is lost.</p>';

  if (failure.kind === FAILURE.EXPIRED) {
    return `
      <div class="fail fail--expired" role="alertdialog" aria-label="Session expired">
        <h3>${ICON.eye}Your session has expired</h3>
        <p>MARP signs you out after a while. Sign in again and carry on from here.</p>
        ${marksSafe}
        <div class="failfoot">
          <!-- A new tab, deliberately: this page holds the reviewer's uncommitted marks
               and they are not persisted anywhere, so navigating away loses them. -->
          <a class="btn" href="${LOGIN}" target="_blank" rel="noopener"
             data-act="signin">Sign in again</a>
          <button type="button" class="btn ghost" data-act="retry-after-signin">
            I have signed in &mdash; carry on</button>
        </div>
      </div>`;
  }

  if (failure.kind === FAILURE.REFUSED) {
    const which = failure.permission
      ? `You are missing the <code>${failure.permission}</code> permission.`
      : 'Your account is not allowed to do that.';
    return `
      <div class="fail fail--refused" role="alertdialog" aria-label="Not permitted">
        <h3>${ICON.cross}Not permitted</h3>
        <p>${which} Ask whoever administers MARP to grant it.</p>
        <!-- No retry. It will never work, and offering one teaches the reviewer to press
             a button that cannot help. -->
        ${marksSafe}
        <div class="failfoot">
          <button type="button" class="btn ghost" data-act="dismiss">Close</button>
        </div>
      </div>`;
  }

  const title = failure.kind === FAILURE.REQUEST
    ? 'MARP refused that request'
    : 'MARP could not be reached';
  const body = failure.kind === FAILURE.REQUEST
    ? 'That is a fault in this page rather than in your work. The message is below, and it '
      + 'is worth reporting.'
    : 'The connection dropped or the server is having trouble. Trying again usually works.';

  return `
    <div class="fail fail--failed" role="alertdialog" aria-label="${title}">
      <h3>${ICON.cross}${title}</h3>
      <p>${body}</p>
      <p class="failmsg">${failure.message}</p>
      ${marksSafe}
      <div class="failfoot">
        <button type="button" class="btn" data-act="retry">Try again</button>
        <button type="button" class="btn ghost" data-act="dismiss">Close</button>
      </div>
    </div>`;
}

export function renderFailure() {
  const host = $('#failure');
  if (!host) return;

  if (!state.failure) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }

  host.hidden = false;
  host.innerHTML = panelFor(state.failure);
}

/**
 * Delegated, because the panel is rewritten on every render like everything else here.
 *
 * "Try again" is `refresh()` rather than a replay of whatever failed. That is deliberate:
 * re-sending a commit the reviewer has not looked at since would be a decision they did
 * not take twice, and the marks are still on screen so committing again is one click.
 */
export function wireFailure() {
  const host = $('#failure');
  if (!host) return;

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const what = act.dataset.act;

    if (what === 'dismiss') { actions.dismissFailure(); return; }
    if (what === 'retry' || what === 'retry-after-signin') {
      actions.dismissFailure();
      actions.refresh();
    }
    /* `signin` is a real link and is left to the browser. */
  });
}
