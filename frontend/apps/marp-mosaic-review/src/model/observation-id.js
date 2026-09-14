/** Read-only presentation and clipboard behavior for an observation primary key. */

export function observationIdText(observationId) {
  if (!Number.isInteger(observationId)) {
    throw new TypeError(`Expected an integer observation_id, got ${JSON.stringify(observationId)}.`);
  }
  return String(observationId);
}

export async function copyObservationId(observationId, clipboard) {
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    throw new Error('Clipboard access is unavailable.');
  }
  await clipboard.writeText(observationIdText(observationId));
}
