/**
 * Records the platform-level walkthroughs.
 *
 *   npm run demo                     the platform tour, silent
 *   npm run demo:narrated            spoken
 *
 * Needs a running MARP (`npm run dev`) and, for the sign-in scene, an account in
 * MARP_DEMO_USERNAME and MARP_DEMO_PASSWORD. The recorder is shared: tools/walkthrough/.
 */
import { recordWalkthroughs } from './walkthrough/record.mjs';
import { scenarios } from '../tests/walkthrough/scenarios.mjs';

await recordWalkthroughs({ scenarios, defaultId: 'platform' });
