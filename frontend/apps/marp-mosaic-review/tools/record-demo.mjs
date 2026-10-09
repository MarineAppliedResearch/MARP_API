/**
 * Records this application's walkthroughs.
 *
 *   npm run demo                      the default scenario, silent
 *   npm run demo -- delete            a named scenario
 *   npm run demo:narrated -- review   spoken
 *   npm run demo:all                  every scenario, spoken
 *
 * The recorder itself is shared -- see MARP_API/tools/walkthrough/ and ADR-0007. This
 * file is only the part that is about this application: which scenarios exist, and which
 * one runs when you name none.
 */
import { recordWalkthroughs } from '../../../../tools/walkthrough/record.mjs';
import { scenarios } from '../tests/walkthrough/scenarios.mjs';

await recordWalkthroughs({ scenarios, defaultId: 'review' });
