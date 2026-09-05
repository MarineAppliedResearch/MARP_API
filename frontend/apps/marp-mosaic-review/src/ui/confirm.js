/**
 * The confirmation shown before a permanent delete.
 *
 * Deliberately the only modal in this application. Everything else here is one gesture
 * with no dialog, because a reviewer does it thousands of times; this one is done rarely
 * and cannot be undone, so it interrupts.
 *
 * It knows nothing about what to destroy. `state.confirm` carries the impact, computed by
 * `model/modes.js` from the same rule the commit itself uses, so the number on screen
 * cannot disagree with the number acted on.
 */

import { $, el, ICON } from './dom.js';
import { state, actions } from '../store.js';

/**
 * The line under the count.
 *
 * The count alone stops nobody -- somebody who has decided to delete a page reads "10
 * observations" and clicks. What gives them pause is that some of those already carry a
 * decision: a review somebody made, or a sample already teaching a model. So that line is
 * only drawn when there is something to say, and it says nothing when there is not,
 * rather than printing two reassuring zeroes.
 */
function alsoLine({ reviewed, promoted }) {
  const parts = [];
  if (reviewed) parts.push(`${reviewed} already reviewed`);
  if (promoted) parts.push(`${promoted} promoted as training ${promoted === 1 ? 'sample' : 'samples'}`);
  if (!parts.length) return '';
  return `<p class="confirm__also">Including <strong>${parts.join('</strong> and <strong>')}</strong>.</p>`;
}

export function renderConfirm() {
  const host = $('#confirm');
  if (!host) return;

  const impact = state.confirm;
  if (!impact) {
    host.replaceChildren();
    host.hidden = true;
    return;
  }

  const noun = impact.count === 1 ? 'observation' : 'observations';
  host.hidden = false;
  host.replaceChildren(el(`
    <div class="confirm__scrim" data-confirm-scrim>
      <div class="confirm__box" role="alertdialog" aria-modal="true"
           aria-labelledby="confirmTitle" aria-describedby="confirmBody">
        <div class="confirm__icon">${ICON.del}</div>
        <h2 class="confirm__title" id="confirmTitle">
          Permanently delete ${impact.count} ${noun}?
        </h2>
        <div id="confirmBody">
          ${alsoLine(impact)}
          <p class="confirm__warn">This cannot be undone. There is no recovery.</p>
        </div>
        <div class="confirm__actions">
          <button type="button" class="btn" data-confirm="cancel">Cancel</button>
          <button type="button" class="btn btn--danger" data-confirm="go">
            Delete ${impact.count} ${noun}
          </button>
        </div>
      </div>
    </div>
  `));

  /* Focus lands on Cancel, not on Delete. Enter and Space are the keys somebody is most
     likely to hit without reading, and neither of them should destroy anything. */
  host.querySelector('[data-confirm="cancel"]').focus();
}

export function wireConfirm() {
  const host = $('#confirm');
  if (!host) return;

  host.addEventListener('click', (e) => {
    const button = e.target.closest('[data-confirm]');
    if (button) {
      if (button.dataset.confirm === 'go') actions.confirmDelete();
      else actions.cancelDelete();
      return;
    }
    /* Clicking the backdrop cancels. Dismissing a dialog by any route that is not the
       Delete button means no. */
    if (e.target.closest('[data-confirm-scrim]') && !e.target.closest('.confirm__box')) {
      actions.cancelDelete();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!state.confirm) return;
    if (e.key === 'Escape') { e.preventDefault(); actions.cancelDelete(); }
  });
}
