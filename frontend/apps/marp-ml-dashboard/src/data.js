/**
 * The data seam.
 *
 * Today it reads one fixture. When this app is wired to MARP, the twelve
 * `/api/v2/gpu/...` routes arrive *here* and nowhere else -- which is the same
 * arrangement the Picture Mosaic Reviewer uses, for the same reason: a tab that
 * fetches for itself is a tab that has to be rewritten twice.
 *
 * The fixture's field names already follow the real response shapes recorded on
 * #104, so wiring is meant to be a change of source rather than a change of
 * vocabulary. Where the API has no representation at all, DESIGN.md's "What has
 * no API behind it" says so, numbered.
 */

const FIXTURE = new URL('../fixtures/ml-dashboard.json', import.meta.url);

let cache = null;

/** Load the whole dataset once. Every tab reads it out of `ctx.data`. */
export async function load() {
  if (cache) return cache;
  const res = await fetch(FIXTURE);
  if (!res.ok) throw new Error(`fixture ${res.status} ${res.statusText}`);
  cache = index(await res.json());
  return cache;
}

/**
 * Add the lookups every tab would otherwise build for itself, and would build
 * slightly differently. Nothing here invents data -- it only indexes it.
 */
function index(d) {
  const byId = (rows, key) => new Map((rows || []).map((r) => [r[key], r]));

  d.jobById = byId(d.jobs, 'id');
  d.workerById = byId(d.workers, 'worker_id');
  d.modelById = byId(d.models, 'id');
  d.datasetById = byId(d.datasets, 'id');
  d.runById = byId(d.runs, 'id');

  // Events arrive as one flat list so the fixture stays a flat file; the job
  // views want them per job and in order.
  d.eventsByJob = new Map();
  for (const e of (d.events || [])) {
    if (!d.eventsByJob.has(e.job_id)) d.eventsByJob.set(e.job_id, []);
    d.eventsByJob.get(e.job_id).push(e);
  }
  for (const list of d.eventsByJob.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  return d;
}

/** The states this app treats as still moving. */
export const LIVE = new Set(['running', 'cancelling']);
/** The states that put a job on the needs-attention list. */
export const ATTN = new Set(['failed', 'issues']);

/** Testing affordance: swap the dataset for a fixture of your own. */
export function _setData(d) { cache = d ? index(d) : null; }
