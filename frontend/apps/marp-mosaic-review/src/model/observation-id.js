/** Read-only presentation for an observation primary key. */

export function observationIdText(observationId) {
  if (!Number.isInteger(observationId)) {
    throw new TypeError(`Expected an integer observation_id, got ${JSON.stringify(observationId)}.`);
  }
  return String(observationId);
}
